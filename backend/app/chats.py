"""Chat store: the `app.chats` table plus the per-Chat Postgres schema (ADR-0002)."""

import uuid

import psycopg
import psycopg.rows
from psycopg import sql
from psycopg.types.json import Jsonb

from app.settings import READONLY_ROLE, Settings

CREATE_CHATS = """
CREATE TABLE IF NOT EXISTS app.chats (
    id uuid PRIMARY KEY,
    schema_name text NOT NULL UNIQUE,
    dataset_notes text,
    as_of_date date,
    schema_profile jsonb,
    cleaning_reports jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
)
"""


def schema_name(chat_id: uuid.UUID) -> str:
    return f"chat_{chat_id.hex}"


def init_store(settings: Settings) -> None:
    with psycopg.connect(settings.owner_dsn) as conn:
        conn.execute(CREATE_CHATS)


def create_chat(settings: Settings) -> uuid.UUID:
    chat_id = uuid.uuid4()
    schema = sql.Identifier(schema_name(chat_id))
    ro = sql.Identifier(READONLY_ROLE)
    with psycopg.connect(settings.owner_dsn) as conn:  # one transaction: schema, grants, row
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(schema))
        conn.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(schema, ro))
        # Tables the owner creates later (ingestion) become readable by the read-only role.
        conn.execute(
            sql.SQL("ALTER DEFAULT PRIVILEGES IN SCHEMA {} GRANT SELECT ON TABLES TO {}").format(schema, ro)
        )
        conn.execute(
            "INSERT INTO app.chats (id, schema_name) VALUES (%s, %s)", (chat_id, schema_name(chat_id))
        )
    return chat_id


def get_chat(settings: Settings, chat_id: str) -> dict | None:
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        return None
    with psycopg.connect(settings.owner_dsn, row_factory=psycopg.rows.dict_row) as conn:
        return conn.execute(
            "SELECT id, dataset_notes, as_of_date, schema_profile, cleaning_reports FROM app.chats WHERE id = %s",
            (chat_uuid,),
        ).fetchone()


def save_ingestion(settings: Settings, chat_id: uuid.UUID, reports: list[dict], dataset_notes: str | None) -> None:
    """Merge Cleaning Reports into the Chat (a re-uploaded Table's report replaces the old one) and store Dataset Notes if given."""
    with psycopg.connect(settings.owner_dsn) as conn:
        (stored,) = conn.execute("SELECT cleaning_reports FROM app.chats WHERE id = %s FOR UPDATE", (chat_id,)).fetchone()
        replaced = {r["table"] for r in reports}
        merged = [r for r in stored or [] if r["table"] not in replaced] + reports
        conn.execute(
            "UPDATE app.chats SET cleaning_reports = %s, dataset_notes = COALESCE(%s, dataset_notes) WHERE id = %s",
            (Jsonb(merged), dataset_notes, chat_id),
        )
