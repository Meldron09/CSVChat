from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI, Form, HTTPException, UploadFile
from langchain_core.language_models import BaseChatModel

from app import chats, ingestion, messages, schema_profile
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
    app.state.model_factory = model_factory  # the single model construction point; called per message
    app.include_router(messages.router)

    @app.post("/chats")
    def create_chat():
        return {"id": str(chats.create_chat(settings))}

    @app.get("/chats/{chat_id}")
    def get_chat(chat_id: str):
        chat = chats.get_chat(settings, chat_id)
        if chat is None:
            raise HTTPException(404, "Chat not found")
        return chat

    @app.post("/chats/{chat_id}/files")
    def upload_files(chat_id: str, files: list[UploadFile], dataset_notes: str | None = Form(None)):
        """Ingest each CSV (blocking) into the Chat's schema. Files are processed in order; a rejected file
        stops the request, but files before it stay loaded and reported."""
        chat = chats.get_chat(settings, chat_id)
        if chat is None:
            raise HTTPException(404, "Chat not found")
        if bad := [f.filename for f in files if not (f.filename or "").lower().endswith(".csv")]:
            raise HTTPException(415, f"Not a CSV file: {', '.join(map(str, bad))} (expected .csv)")
        reports = []
        try:
            for f in files:
                try:
                    report = ingestion.ingest(settings, str(chat["id"]), chats.schema_name(chat["id"]), f.filename, f.file)
                except ingestion.IngestionError as e:
                    raise HTTPException(e.status, str(e)) from e
                chats.save_ingestion(settings, chat["id"], [report], dataset_notes)
                reports.append(report)
        finally:  # files loaded before a rejected one still change the Dataset
            if reports:
                chats.save_profile(settings, chat["id"], schema_profile.build_profile(settings, chats.schema_name(chat["id"])))
        return {"reports": reports, "schema_profile": chats.get_chat(settings, chat_id)["schema_profile"]}

    return app


app = create_app()
