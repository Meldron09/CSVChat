# One Postgres schema and one read-only role per Chat, not shared tables

Each Chat's Dataset is loaded into its own Postgres schema (`chat_<uuid>`), and SQL Analysts query as that Chat's own read-only login role, which has `USAGE` on that schema and `SELECT` on its tables and nothing else. We rejected shared tables keyed by a dataset id: two users uploading `orders.csv` would collide, every generated query would need a dataset filter the LLM could forget, and isolation would depend on the model rather than the database.

## How isolation is enforced

- `create_chat` (as the owner role, which has `CREATEROLE`) creates the schema and a login role with the same name, `chat_<uuid hex>`. The role gets `CONNECT` on the database, `USAGE` on its schema, and default `SELECT` on tables the owner creates there later (ingestion). There is no shared read-only role and no role has access to more than one Chat's schema.
- The role's password is an HMAC of the chat id under a server secret (`DB_CHAT_ROLE_SECRET`), so nothing per-Chat is stored and no query can obtain another Chat's credentials.
- Each query opens a connection as the Chat's role with `search_path` fixed to the Chat's schema, `default_transaction_read_only=on` and a 10s `statement_timeout` (`SQL_TIMEOUT_MS`). `SELECT * FROM chat_<other>.orders`, `app.chats` and writes all fail with "permission denied" from the database.
- `sqlglot` SELECT/WITH-only validation runs first (`app/sql_guard.py`) as a separate, friendlier line of defence; the database does not rely on it.
- Everything goes through one function, `sql_guard.run_sql`.

## Rejected: one shared login role plus `SET LOCAL ROLE chat_<id>` per query

It needs the login role to be a member of every Chat role, and a plain `SELECT set_config('role', 'chat_<other>', true)` then switches into another Chat's role from inside a query (verified on Postgres 17, even with `INHERIT FALSE`). A parser blocklist would be the only barrier. Per-Chat login roles have no such membership to abuse.

## Consequences

- A Dataset can't be reused across Chats; each Chat re-uploads its files.
- Schemas and roles accumulate indefinitely; a TTL cleanup job (drop schema and role) is future work.
- Re-uploading a file with the same name replaces that Table and re-profiles the Dataset.
- `pg_catalog` stays readable to every role by Postgres design, so table and schema names (not data) of other Chats are visible to a query.
- The owner role needs `CREATEROLE` (`db/init.sh`); a database created by an older init script needs `docker compose down -v`.
