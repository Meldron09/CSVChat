"""SQL guard: the only way generated SQL reaches the database.

Two independent lines of defence (ADR-0002):
1. `validate_select` (sqlglot): exactly one statement, a plain SELECT/WITH query, nothing that writes.
2. The database: the query runs as the Chat's own read-only login role (USAGE + SELECT on that one schema,
   nothing else), with search_path fixed to the schema, read-only transactions and a statement timeout.
The first is a fast, friendly rejection; the second is what actually enforces isolation, because a parser can disagree
with Postgres about what a string means.
"""

import uuid
from dataclasses import dataclass

import psycopg
import sqlglot
from sqlglot import exp

from app import chats
from app.settings import Settings

# Nodes that must not appear anywhere in a query (e.g. a data-modifying CTE or SELECT ... INTO).
_FORBIDDEN = (exp.Into, exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Lock)


class SqlRejected(ValueError):
    """The SQL was refused before reaching the database."""


class SqlError(Exception):
    """The database refused an ordinary query (syntax error, unknown column, bad cast, ...). The model can fix it, so the
    SQL Analyst retries with this message. Everything else (SqlRejected, permission denied, timeout) is terminal."""


MAX_ROWS = 1000  # rows that may reach the model


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[list]
    truncated: bool = False  # the query had more than MAX_ROWS rows; only the first MAX_ROWS are kept


def validate_select(sql: str) -> str:
    """Return the SQL if it is a single SELECT/WITH query, else raise SqlRejected."""
    try:
        statements = [s for s in sqlglot.parse(sql, read="postgres") if s is not None]
    except sqlglot.errors.SqlglotError as e:
        raise SqlError(f"SQL could not be parsed: {e}") from e  # a typo the model can fix: retryable
    if len(statements) != 1:
        raise SqlRejected("Exactly one SQL statement is allowed")
    (stmt,) = statements
    if not isinstance(stmt, exp.Query) or stmt.find(*_FORBIDDEN):
        raise SqlRejected("Only SELECT/WITH queries are allowed")
    return sql


def run_sql(settings: Settings, chat_id: uuid.UUID, sql: str) -> QueryResult:
    """Validate and execute one query for a Chat. The single place SQL runs.

    Raises SqlRejected (guard, permission denied, timeout: terminal) or SqlError (ordinary database error: retryable).
    At most MAX_ROWS rows are returned, read through a server-side cursor so a huge result is never loaded in full.
    """
    validate_select(sql)
    options = (
        f"-c search_path={chats.schema_name(chat_id)} "
        f"-c statement_timeout={settings.sql_timeout_ms} "
        "-c default_transaction_read_only=on"
    )
    try:
        with psycopg.connect(chats.chat_dsn(settings, chat_id), options=options) as conn:
            with conn.cursor(name="q") as cur:
                cur.execute(sql)  # type: ignore[arg-type]  # generated text on purpose; validated above
                rows = cur.fetchmany(MAX_ROWS + 1)
                columns = [c.name for c in cur.description]
    except (psycopg.errors.InsufficientPrivilege, psycopg.errors.QueryCanceled) as e:
        raise SqlRejected(_message(e)) from e
    except psycopg.Error as e:
        if (e.sqlstate or "")[:2] in ("42", "22"):  # syntax/name errors and bad data (cast, division by zero)
            raise SqlError(str(e).strip()) from e
        raise
    return QueryResult(columns, [list(r) for r in rows[:MAX_ROWS]], truncated=len(rows) > MAX_ROWS)


def _message(e: psycopg.Error) -> str:
    return e.diag.message_primary or str(e).strip()
