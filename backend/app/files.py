"""POST /chats/{id}/files and POST /chats/{id}/sample: ingestion into the Chat's Dataset."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from app import chats, ingestion, sample, schema_profile
from app.deps import existing_chat

router = APIRouter()
MB = 1024 * 1024


def ingest_files(settings, chat: dict, files: list, dataset_notes: str | None = None) -> tuple[int, dict]:
    """Ingest (filename, binary file) pairs in order (blocking). Returns (200, `{reports, schema_profile}`) or, when a
    file is rejected, (that file's status, `{detail, reports, schema_profile}`): the files before it stay loaded, so
    their Cleaning Reports and the updated Schema Profile are returned with the error."""
    reports, failure = [], None
    try:
        for filename, fileobj in files:
            try:
                report = ingestion.ingest(settings, str(chat["id"]), chats.schema_name(chat["id"]), filename, fileobj)
            except ingestion.IngestionError as e:
                failure = e
                break
            chats.save_ingestion(settings, chat["id"], [report], dataset_notes)
            reports.append(report)
    finally:  # files loaded before a rejected (or crashed) one still change the Dataset
        if reports:
            chats.save_profile(settings, chat["id"], schema_profile.build_profile(settings, chats.schema_name(chat["id"])))
    body = {"reports": reports, "schema_profile": chats.get_chat(settings, str(chat["id"]))["schema_profile"]}
    return (failure.status, {"detail": str(failure), **body}) if failure else (200, body)


def _respond(status: int, body: dict) -> JSONResponse:
    return JSONResponse(jsonable_encoder(body), status_code=status)


@router.post("/chats/{chat_id}/files")
async def upload_files(request: Request, chat: dict = Depends(existing_chat)):
    """Multipart upload: `files` (one or more .csv) and optional `dataset_notes`.

    The request body is checked against `max_request_bytes` from its Content-Length *before* it is read, so an
    oversized upload is refused with 413 without being spooled to disk. The per-file cap (`max_upload_bytes`) is
    enforced while each file is copied to the raw-upload folder (ingestion.py)."""
    settings = request.app.state.settings
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        raise HTTPException(400, "Invalid Content-Length") from None
    if declared > settings.max_request_bytes:
        raise HTTPException(
            413,
            f"Upload is {declared // MB}MB, over the {settings.max_request_bytes // MB}MB limit for one request "
            f"(files up to {settings.max_upload_bytes // MB}MB each)",
        )
    async with request.form() as form:
        uploads = [f for f in form.getlist("files") if isinstance(f, UploadFile)]
        notes = form.get("dataset_notes")
        if not uploads:
            raise HTTPException(422, "No files: send one or more .csv files in the multipart field 'files'")
        if bad := [f.filename for f in uploads if not (f.filename or "").lower().endswith(".csv")]:
            raise HTTPException(415, f"Not a CSV file: {', '.join(map(str, bad))} (expected .csv)")
        files = [(f.filename, f.file) for f in uploads]
        return _respond(*await run_in_threadpool(ingest_files, settings, chat, files, notes if isinstance(notes, str) else None))


@router.post("/chats/{chat_id}/sample")
def load_sample(request: Request, chat: dict = Depends(existing_chat)):
    """One click: load the bundled Online Shop CSVs, set the As-of Date, and set the Revenue Dataset Notes unless the
    Chat already has notes of its own (those are never overwritten)."""
    settings = request.app.state.settings
    paths = sorted(sample.SAMPLE_DIR.glob("*.csv"))
    if not paths:
        raise HTTPException(500, f"Sample dataset missing at {sample.SAMPLE_DIR}")
    own_notes = (chat["dataset_notes"] or "").strip()
    files = [(p.name, p.open("rb")) for p in paths]
    try:
        status, body = ingest_files(settings, chat, files, None if own_notes else sample.SAMPLE_NOTES)
    finally:
        for _, f in files:
            f.close()
    if status != 200:
        return _respond(status, body)
    chats.update_chat(settings, chat["id"], {"as_of_date": date.fromisoformat(sample.SAMPLE_AS_OF)})
    return {**body, "dataset_notes": chat["dataset_notes"] if own_notes else sample.SAMPLE_NOTES, "as_of_date": sample.SAMPLE_AS_OF}
