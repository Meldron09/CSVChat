"""POST /chats/{id}/files and POST /chats/{id}/sample: ingestion into the Chat's Dataset."""

from datetime import date

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile

from app import chats, ingestion, sample, schema_profile
from app.deps import existing_chat

router = APIRouter()


def ingest_files(settings, chat: dict, files: list, dataset_notes: str | None = None) -> dict:
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


@router.post("/chats/{chat_id}/files")
def upload_files(request: Request, files: list[UploadFile], dataset_notes: str | None = Form(None), chat: dict = Depends(existing_chat)):
    if bad := [f.filename for f in files if not (f.filename or "").lower().endswith(".csv")]:
        raise HTTPException(415, f"Not a CSV file: {', '.join(map(str, bad))} (expected .csv)")
    return ingest_files(request.app.state.settings, chat, [(f.filename, f.file) for f in files], dataset_notes)


@router.post("/chats/{chat_id}/sample")
def load_sample(request: Request, chat: dict = Depends(existing_chat)):
    """One click: load the bundled Online Shop CSVs, set the Revenue Dataset Notes and the As-of Date."""
    settings = request.app.state.settings
    paths = sorted(sample.SAMPLE_DIR.glob("*.csv"))
    if not paths:
        raise HTTPException(500, f"Sample dataset missing at {sample.SAMPLE_DIR}")
    files = [(p.name, p.open("rb")) for p in paths]
    try:
        out = ingest_files(settings, chat, files, sample.SAMPLE_NOTES)
    finally:
        for _, f in files:
            f.close()
    chats.update_chat(settings, chat["id"], {"as_of_date": date.fromisoformat(sample.SAMPLE_AS_OF)})
    return {**out, "dataset_notes": sample.SAMPLE_NOTES, "as_of_date": sample.SAMPLE_AS_OF}
