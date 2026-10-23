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


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[list]


def validate_select(sql: str) -> str:
    """Return the SQL if it is a single SELECT/WITH query, else raise SqlRejected."""
    try:
        statements = [s for s in sqlglot.parse(sql, read="postgres") if s is not None]
    except sqlglot.errors.SqlglotError as e:
        raise SqlRejected(f"SQL could not be parsed: {e}") from e
    if len(statements) != 1:
        raise SqlRejected("Exactly one SQL statement is allowed")
    (stmt,) = statements
    if not isinstance(stmt, exp.Query) or stmt.find(*_FORBIDDEN):
        raise SqlRejected("Only SELECT/WITH queries are allowed")
    return sql


def run_sql(settings: Settings, chat_id: uuid.UUID, sql: str) -> QueryResult:
    """Validate and execute one query for a Chat. The single place SQL runs.

    Ticket #6 plugs in here: the 1,000-row cap on `fetchall` below and turning DB errors into retryable failures.
    """
    validate_select(sql)
    options = (
        f"-c search_path={chats.schema_name(chat_id)} "
        f"-c statement_timeout={settings.sql_timeout_ms} "
        "-c default_transaction_read_only=on"
    )
    with psycopg.connect(chats.chat_dsn(settings, chat_id), options=options) as conn:
        cur = conn.execute(sql)  # type: ignore[arg-type]  # generated text on purpose; validated above
        return QueryResult([c.name for c in cur.description], [list(r) for r in cur.fetchall()])
