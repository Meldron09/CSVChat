"""POST /chats/{id}/messages: runs the graph and streams its events as server-sent events."""

import logging
from datetime import date

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app import schema_profile
from app.deps import existing_chat
from app.events import format_sse
from app.sql_guard import SqlRejected
from app.state import Context, DatasetInfo, QueryRecord, Turn, turn_input

router = APIRouter()
log = logging.getLogger(__name__)


class MessageIn(BaseModel):
    question: str = Field(min_length=1)
    as_of_date: date | None = None  # sent with every message; the Chat's "today". Blank/missing: the Orchestrator asks for it

    @field_validator("as_of_date", mode="before")
    @classmethod
    def blank_is_missing(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


def lock_chat(settings, chat_id) -> psycopg.Connection:
    """Take the Chat's turn lock or raise 409: one message at a time per Chat.

    A Postgres session-level advisory lock keyed on the chat id, held on its own connection for the whole turn.
    It is correct across several backend workers/processes (unlike an in-process lock), and it is released by closing
    the connection, so a crashed worker cannot leave a Chat locked. Without it two simultaneous turns would each append
    to the transcript they loaded at the start and the last checkpoint would silently drop the other turn.
    ponytail: the second message is refused (409), not queued; a queue would hold a worker for a whole LLM run."""
    conn = psycopg.connect(settings.owner_dsn, autocommit=True)
    try:
        locked = conn.execute("SELECT pg_try_advisory_lock(hashtextextended(%s, 0))", (f"csvchat:{chat_id}",)).fetchone()[0]
    except BaseException:
        conn.close()
        raise
    if not locked:
        conn.close()
        raise HTTPException(409, "This Chat is still answering a previous message; wait for it to finish, then ask again.")
    return conn


@router.post("/chats/{chat_id}/messages")
def post_message(body: MessageIn, request: Request, chat: dict = Depends(existing_chat)):
    settings, model_factory, graph = request.app.state.settings, request.app.state.model_factory, request.app.state.graph
    lock = lock_chat(settings, chat["id"])
    info = DatasetInfo(
        question=body.question,
        as_of_date=body.as_of_date.isoformat() if body.as_of_date else "",
        dataset_notes=chat["dataset_notes"],
        schema_profile=schema_profile.render_for_prompt(chat["schema_profile"]),
        history="",
    )
    config = {"configurable": {"thread_id": str(chat["id"])}}  # one checkpointed thread per Chat

    def events():
        queries: dict[int, QueryRecord] = {}  # the SQL seen so far, last attempt per task: what a failed turn keeps
        try:
            try:
                context = Context(settings=settings, model=model_factory(settings), chat_id=chat["id"])
                for part in graph.stream(turn_input(info), config, context=context, stream_mode="custom"):
                    if part["event"] == "sql":
                        d = part["data"]
                        queries[d["task"]] = QueryRecord(task=d["task"], sub_question=d["sub_question"], sql=d["sql"], error=None)
                    yield format_sse(part["event"], part["data"])
            except Exception as e:  # mid-stream failures reach the client as an `error` event
                if not isinstance(e, SqlRejected):
                    log.exception("message failed")
                message = (str(e).strip().splitlines() or [type(e).__name__])[0]
                record_failed_turn(graph, config, info, message, [queries[t] for t in sorted(queries)])
                yield format_sse("error", {"message": message})
        finally:
            lock.close()  # releases the turn lock

    # no-transform + X-Accel-Buffering: keep proxies from compressing or buffering the stream
    headers = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}
    return StreamingResponse(events(), media_type="text/event-stream", headers=headers)


def record_failed_turn(graph, config: dict, info: DatasetInfo, error: str, queries: list[QueryRecord]) -> None:
    """Append the failed turn to the transcript (question, the SQL seen, the error text; no answer), as if `record_turn`
    had run, so the question survives a reload and the thread stays usable. Parallel analysts that were already
    running show up in `queries`. Recording is best effort: it must never replace the `error` event."""
    turn = Turn(question=info["question"], as_of_date=info["as_of_date"], queries=queries, answer="", charts=[], error=error)
    try:
        graph.update_state(config, {"turns": [turn]}, as_node="record_turn")
    except Exception:
        log.exception("could not record the failed turn")
