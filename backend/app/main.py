from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI, HTTPException
from langchain_core.language_models import BaseChatModel

from app import chats
from app.model import build_model
from app.settings import Settings


def create_app(
    settings: Settings | None = None,
    model_factory: Callable[[Settings], BaseChatModel] = build_model,
) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        chats.init_store(settings)
        yield

    app = FastAPI(lifespan=lifespan)
    app.state.settings = settings
    app.state.model_factory = model_factory  # used by the agent graph in later tickets

    @app.post("/chats")
    def create_chat():
        return {"id": str(chats.create_chat(settings))}

    @app.get("/chats/{chat_id}")
    def get_chat(chat_id: str):
        chat = chats.get_chat(settings, chat_id)
        if chat is None:
            raise HTTPException(404, "Chat not found")
        return chat

    return app


app = create_app()
