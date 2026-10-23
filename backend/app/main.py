from contextlib import asynccontextmanager
from datetime import date
from typing import Callable

from fastapi import FastAPI, Form, HTTPException, UploadFile
from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

from app import chats, ingestion, messages, sample, schema_profile
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
    app.include_router(messages.router)

    def existing_chat(chat_id: str) -> dict:
        chat = chats.get_chat(settings, chat_id)
        if chat is None:
            raise HTTPException(404, "Chat not found")
        return chat

    @app.post("/chats")
    def create_chat():
        return {"id": str(chats.create_chat(settings))}

    def chat_view(chat: dict) -> dict:
        """The Chat store row plus the transcript from the checkpoint (empty before the first turn)."""
        state = app.state.graph.get_state({"configurable": {"thread_id": str(chat["id"])}})
        return {**chat, "transcript": state.values.get("turns", [])}

    @app.get("/chats/{chat_id}")
    def get_chat(chat_id: str):
        return chat_view(existing_chat(chat_id))

    @app.put("/chats/{chat_id}")
    def update_chat(chat_id: str, body: ChatUpdate):
        """Edit Dataset Notes / As-of Date at any time; the next message uses them. Returns the Chat like GET."""
        chat = existing_chat(chat_id)
        chats.update_chat(settings, chat["id"], body.model_dump(include=body.model_fields_set))
        return chat_view(chats.get_chat(settings, chat_id))

    def ingest_files(chat: dict, files: list, dataset_notes: str | None = None) -> dict:
        """Ingest (filename, binary file) pairs in order (blocking). A rejected file stops the request, but files
        before it stay loaded and reported."""
        reports = []
        try:
            for filename, fileobj in files:
                try:
                    report = ingestion.ingest(settings, str(chat["id"]), chats.schema_name(chat["id"]), filename, fileobj)
                except ingestion.IngestionError as e:
                    raise HTTPException(e.status, str(e)) from e
                chats.save_ingestion(settings, chat["id"], [report], dataset_notes)
                reports.append(report)
        finally:  # files loaded before a rejected one still change the Dataset
            if reports:
                chats.save_profile(settings, chat["id"], schema_profile.build_profile(settings, chats.schema_name(chat["id"])))
        return {"reports": reports, "schema_profile": chats.get_chat(settings, str(chat["id"]))["schema_profile"]}

    @app.post("/chats/{chat_id}/files")
    def upload_files(chat_id: str, files: list[UploadFile], dataset_notes: str | None = Form(None)):
        chat = existing_chat(chat_id)
        if bad := [f.filename for f in files if not (f.filename or "").lower().endswith(".csv")]:
            raise HTTPException(415, f"Not a CSV file: {', '.join(map(str, bad))} (expected .csv)")
        return ingest_files(chat, [(f.filename, f.file) for f in files], dataset_notes)

    @app.post("/chats/{chat_id}/sample")
    def load_sample(chat_id: str):
        """One click: load the bundled Online Shop CSVs, set the Revenue Dataset Notes and the As-of Date."""
        chat = existing_chat(chat_id)
        paths = sorted(sample.SAMPLE_DIR.glob("*.csv"))
        if not paths:
            raise HTTPException(500, f"Sample dataset missing at {sample.SAMPLE_DIR}")
        files = [(p.name, p.open("rb")) for p in paths]
        try:
            out = ingest_files(chat, files, sample.SAMPLE_NOTES)
        finally:
            for _, f in files:
                f.close()
        chats.update_chat(settings, chat["id"], {"as_of_date": date.fromisoformat(sample.SAMPLE_AS_OF)})
        return {**out, "dataset_notes": sample.SAMPLE_NOTES, "as_of_date": sample.SAMPLE_AS_OF}

    return app


app = create_app()
