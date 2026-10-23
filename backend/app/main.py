from contextlib import asynccontextmanager
from datetime import date
from typing import Callable

from fastapi import Depends, FastAPI
from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

from app import chats, files, messages
from app.deps import existing_chat
from app.graph import build_graph
from app.model import build_model
from app.settings import Settings


class ChatUpdate(BaseModel):
    """Fields left out are unchanged; null clears."""

    dataset_notes: str | None = None
    as_of_date: date | None = None


def create_app(
    settings: Settings | None = None,
    model_factory: Callable[[Settings], BaseChatModel] = build_model,
) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        chats.init_store(settings)
        # The LangGraph checkpointer persists every Chat's thread (thread id = chat id) in the `checkpoints` schema.
        # PostgresSaver needs autocommit + dict_row connections; the owner role has no `public`, hence the search_path.
        with ConnectionPool(
            settings.owner_dsn,
            kwargs={"autocommit": True, "row_factory": dict_row, "options": "-c search_path=checkpoints"},
        ) as pool:
            saver = PostgresSaver(pool)
            saver.setup()
            app.state.graph = build_graph(saver)
            yield

    app = FastAPI(lifespan=lifespan)
    app.state.settings = settings
    app.state.model_factory = model_factory  # the single model construction point; called per message
    app.include_router(files.router)
    app.include_router(messages.router)

    @app.post("/chats")
    def create_chat():
        return {"id": str(chats.create_chat(settings))}

    def chat_view(chat: dict) -> dict:
        """The Chat store row plus the transcript from the checkpoint (empty before the first turn)."""
        state = app.state.graph.get_state({"configurable": {"thread_id": str(chat["id"])}})
        return {**chat, "transcript": state.values.get("turns", [])}

    @app.get("/chats/{chat_id}")
    def get_chat(chat: dict = Depends(existing_chat)):
        return chat_view(chat)

    @app.put("/chats/{chat_id}")
    def update_chat(body: ChatUpdate, chat: dict = Depends(existing_chat)):
        """Edit Dataset Notes / As-of Date at any time; the next message uses them. Returns the Chat like GET."""
        chats.update_chat(settings, chat["id"], body.model_dump(include=body.model_fields_set))
        return chat_view(chats.get_chat(settings, str(chat["id"])))

    return app


app = create_app()
