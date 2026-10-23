"""Chat store: the `app.chats` table plus the per-Chat Postgres schema (ADR-0002)."""

import hmac
import uuid

import psycopg
import psycopg.rows
from psycopg import sql
from psycopg.types.json import Jsonb

from app.settings import Settings

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


def _chat_password(settings: Settings, chat_id: uuid.UUID) -> str:
    """HMAC of the chat id: a Chat's role is reachable only by whoever holds the server secret, never from SQL run as another role."""
    return hmac.new(settings.chat_role_secret.encode(), schema_name(chat_id).encode(), "sha256").hexdigest()


def chat_dsn(settings: Settings, chat_id: uuid.UUID) -> str:
    """DSN of the Chat's own read-only login role (its name is the schema name)."""
    return settings.dsn(schema_name(chat_id), _chat_password(settings, chat_id))


def init_store(settings: Settings) -> None:
    with psycopg.connect(settings.owner_dsn) as conn:
        conn.execute(CREATE_CHATS)


def create_chat(settings: Settings) -> uuid.UUID:
    """One transaction: the Chat's schema, its read-only login role (USAGE + SELECT on that schema only, ADR-0002), the row."""
    chat_id = uuid.uuid4()
    name = schema_name(chat_id)
    schema = role = sql.Identifier(name)
    password = _chat_password(settings, chat_id)
    with psycopg.connect(settings.owner_dsn) as conn:
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(schema))
        conn.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(role, password))
        conn.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(sql.Identifier(settings.db_name), role))
        conn.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(schema, role))
        # Tables the owner creates later (ingestion) become readable by the Chat's role.
        conn.execute(sql.SQL("ALTER DEFAULT PRIVILEGES IN SCHEMA {} GRANT SELECT ON TABLES TO {}").format(schema, role))
        conn.execute("INSERT INTO app.chats (id, schema_name) VALUES (%s, %s)", (chat_id, name))
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


def save_profile(settings: Settings, chat_id: uuid.UUID, profile: dict) -> None:
    with psycopg.connect(settings.owner_dsn) as conn:
        conn.execute("UPDATE app.chats SET schema_profile = %s WHERE id = %s", (Jsonb(profile), chat_id))
