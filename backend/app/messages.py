"""POST /chats/{id}/messages: runs the graph and streams its events as server-sent events."""

import logging
from datetime import date

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app import chats, schema_profile
from app.events import format_sse
from app.sql_guard import SqlRejected
from app.state import Context, turn_input

router = APIRouter()
log = logging.getLogger(__name__)


class MessageIn(BaseModel):
    question: str = Field(min_length=1)
    as_of_date: date | None = None  # sent with every message; the Chat's "today". Blank/missing: the Orchestrator asks for it

    @field_validator("as_of_date", mode="before")
    @classmethod
    def blank_is_missing(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


@router.post("/chats/{chat_id}/messages")
def post_message(chat_id: str, body: MessageIn, request: Request):
    settings, model_factory = request.app.state.settings, request.app.state.model_factory
    chat = chats.get_chat(settings, chat_id)
    if chat is None:
        raise HTTPException(404, "Chat not found")
    state = turn_input(
        body.question,
        body.as_of_date.isoformat() if body.as_of_date else "",
        chat["dataset_notes"],
        schema_profile.render_for_prompt(chat["schema_profile"]),
    )
    config = {"configurable": {"thread_id": str(chat["id"])}}  # one checkpointed thread per Chat

    def events():
        try:
            context = Context(settings=settings, model=model_factory(settings), chat_id=chat["id"])
            for part in request.app.state.graph.stream(state, config, context=context, stream_mode="custom"):
                yield format_sse(part["event"], part["data"])
        except Exception as e:  # mid-stream failures reach the client as an `error` event
            if not isinstance(e, SqlRejected):
                log.exception("message failed")
            yield format_sse("error", {"message": (str(e).strip().splitlines() or [type(e).__name__])[0]})

    # no-transform + X-Accel-Buffering: keep proxies from compressing or buffering the stream
    headers = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}
    return StreamingResponse(events(), media_type="text/event-stream", headers=headers)
