# Backend

FastAPI service on Python 3.12, managed with `uv`.

## Tests

Tests run on the host against the compose Postgres (real database, no mocks). One command from the repo root:

```sh
make test
```

which is `docker compose up -d --wait db` followed by `cd backend && uv run pytest`.

The DB connection is read from env, so a checkout running its own stack just sets the same variables as for compose:

| Variable | Default | Meaning |
| --- | --- | --- |
| `POSTGRES_PORT` | `55432` | host port of the compose Postgres (also what pytest connects to) |
| `POSTGRES_HOST` | `localhost` | Postgres host |
| `DB_OWNER_PASSWORD` | `owner` | owner role password (dev default) |
| `DB_CHAT_ROLE_SECRET` | `dev-chat-role-secret` | secret the per-Chat read-only role passwords are derived from |
| `SQL_TIMEOUT_MS` | `10000` | statement timeout for generated SQL |
| `MAX_UPLOAD_BYTES` / `MAX_REQUEST_BYTES` | 200MB / 1GiB | per-file and per-upload-request size limits |
| `OLLAMA_MODEL` / `OLLAMA_BASE_URL` | `gpt-oss:20b-cloud` / `http://localhost:11434` | the chat model (`host.docker.internal` inside compose) |

`BACKEND_PORT`, `FRONTEND_PORT` and `COMPOSE_PROJECT_NAME` control the other host ports and the compose project name, so several checkouts can run concurrently, e.g.
`COMPOSE_PROJECT_NAME=csvchat2 POSTGRES_PORT=55433 BACKEND_PORT=8001 FRONTEND_PORT=3001 make test`.

Roles and the `app` / `checkpoints` schemas are created by `db/init.sh` only on a fresh volume; after changing it run `docker compose down -v` (needed once after pulling the per-Chat role change: the owner role now has `CREATEROLE`).

## Model

The chat model is built in one place, `app/model.py:build_model`; the messages route calls `app.state.model_factory(app.state.settings)` per message, and `create_app(model_factory=...)` lets tests substitute a scripted fake.
Agents get structured output via tool calling (`with_structured_output(..., method="function_calling")` in `app/agents/common.py`), not Ollama's `format=` JSON schema, because gpt-oss ignores `format`.

## Asking questions

`POST /chats/{id}/messages` with `{"question": str, "as_of_date": "YYYY-MM-DD"}` (404 unknown Chat, 422 bad body, 409 when the Chat is still answering an earlier message) streams `text/event-stream`. Each frame is `event: <name>` + `data: <json>`:

| event | data |
| --- | --- |
| `step` | `{node, message}`: progress (`orchestrator`, `sql_analyst`, `synthesizer`); SQL Analyst steps also carry `task` (0-based) |
| `sql` | `{task, sub_question, sql}`: a query, just before it runs; `task` is the 0-based index of its sub-question |
| `token` | `{text}`: next piece of the Answer |
| `answer` | `{text, as_of_date, charts}`: the final Answer (`charts`: validated Chart Specs, `[]` when none or for direct replies; the only event that carries charts) |
| `error` | `{message}`: terminal; the run stopped. The turn is recorded in the transcript as failed (see Resume) |

**One message at a time per Chat.** `messages.lock_chat` takes a Postgres session-level advisory lock (`pg_try_advisory_lock(hashtextextended('csvchat:<chat id>'))`) on its own connection for the whole turn and the second concurrent message gets `409` instead of racing: each run appends to the transcript it loaded at the start, so without the lock the last checkpoint would drop the other turn. A database lock rather than an in-process one so that it also holds across several backend workers; it is released when the turn ends or the worker dies (the connection closes). The second message is refused, not queued, so no worker is held for a whole LLM run.

A multi-part question is split by the Orchestrator into at most `MAX_SUB_QUESTIONS` (4, `app/agents/orchestrator.py`; extra parts get a `step` notice, are passed to the Synthesizer as `State.dropped_sub_questions`, and the Answer always states that they were not answered) independent sub-questions, one parallel SQL Analyst each; a simple question yields exactly one. `step`/`sql` events of parallel tasks interleave (use `task` to tell them apart) but all precede the first `token`. Cross-file parts stay one sub-question joined through the Relationships in the Schema Profile. The Synthesizer receives the results ordered by `task` and merges them.

The graph (`app/graph.py`) is Orchestrator, SQL Analyst (one per sub-question via `Send`), Chart Builder (runs once after all analysts; skips failed results and makes no model call without usable rows; `app/chart_spec.py` validates each Chart Spec, max 3, 2,000 rows each; a series with no value in any row is invalid), Synthesizer, with typed state in `app/state.py`; each agent lives in `app/agents/`. Nodes send events with `events.emit(event, **data)` (works from parallel branches). All generated SQL runs through `sql_guard.run_sql`: sqlglot SELECT/WITH-only check, then the Chat's own read-only role (ADR-0002). The As-of Date, Dataset Notes and rendered Schema Profile go into every agent prompt.

SQL failures: an ordinary database error (syntax, unknown column or table, bad cast; also SQL sqlglot cannot parse) is fed back to the model and the query retried, at most 2 times per sub-question (the retry state is local to each SQL Analyst call, so parallel analysts are independent); if it still fails the result carries `error`, and the Synthesizer reports that part plainly (when every part failed it answers without calling the model). Adversarial or forbidden SQL is never retried: guard rejections (`DROP`, multiple statements, writes), `permission denied` (other Chats' schemas, `app`, `checkpoints`) and the 10s statement timeout are terminal and end the stream with an `error` event; data is unchanged because the Chat's role is read-only. Results are capped at 1,000 rows (`sql_guard.MAX_ROWS`, read through a server-side cursor); a truncated result is flagged to the Synthesizer and the Answer always says so.

**Direct replies.** Some questions get a plain reply with no analysts, Synthesizer or `sql` events (still `step`, streamed `token`s, then `answer` with `charts: []`): no Tables uploaded ("upload data first") and a blank/missing `as_of_date` ("set the As-of Date") are decided in code in `agents/orchestrator.py` before any model call; "can't be answered from this data" is the Orchestrator model setting `Plan.direct_reply`. `graph.route` sends these to the `direct_reply` node.

## Resume and follow-ups

Each Chat is one LangGraph thread (thread id = chat id) persisted by `PostgresSaver` in the `checkpoints` schema (owner role, a `psycopg_pool` pool with `autocommit` + `dict_row` and `search_path=checkpoints`, built in `create_app`'s lifespan; the graph is compiled per app by `graph.build_graph(checkpointer)`). A restart loses nothing.

- **State.** `State.turns` is the only key that persists: the transcript, one `Turn` `{question, as_of_date, queries: [{task, sub_question, sql, error}], answer, charts, error}` appended by the `record_turn` node, the last node of both the Answer and the direct-reply path. Every other key is per-turn; `state.turn_input` resets all of them (list reducers `add_or_reset` take `None` as "clear") when a turn starts, so a finished or failed turn never leaks into the next. A turn that fails (an `error` event) is appended by the messages route instead (`record_failed_turn`, via `update_state(..., as_node="record_turn")`) with `answer: ""`, `charts: []`, `error: <the error text>` and `queries` built from the `sql` events seen so far (so sibling parallel analysts show up); it is written before the `error` event is sent, and the thread stays usable. `render_history` shows such a turn to the model only as its question plus a "failed" marker (no SQL, no error text).
- **`GET /chats/{id}`** returns the Chat store row (`id, dataset_notes, as_of_date, schema_profile (with relationships), cleaning_reports`) plus `transcript`: all turns, oldest first, Chart Specs included (`[]` before the first turn); 404 for an unknown id. `PUT` returns the same shape.
- **History policy.** The Orchestrator renders the last `state.HISTORY_TURNS` (6) turns as question, SQL run and answer text (`agents/common.render_history`) and puts them in `State.history`; every agent prompt gets them through `dataset_context` (Orchestrator: make follow-up sub-questions self-contained; SQL Analyst: may reuse earlier SQL; Synthesizer: answer only the new question). Chart Specs are never sent to the model. Older turns stay in the transcript only. Direct replies are turns too.

## Sample dataset, Dataset Notes, As-of Date

- `POST /chats/{id}/sample` (404 unknown Chat) ingests the 8 Online Shop 2024 CSVs from `sample-data/` (tracked in git, 3MB; the original `Online Shop 2024/` folder is gitignored; compose mounts it at `/sample-data`), sets the As-of Date to 2024-11-04 and the sample Dataset Notes (both in `app/sample.py`) and returns `{reports, schema_profile, dataset_notes, as_of_date}`. The sample notes are stored only when the Chat has no (or blank) Dataset Notes; notes the user wrote are kept and returned as `dataset_notes`. The As-of Date is always set.
- `PUT /chats/{id}` with `{"dataset_notes"?: str|null, "as_of_date"?: "YYYY-MM-DD"|null}` updates only the fields sent and returns the Chat like `GET`. The next message reads the stored notes, so edits apply to later answers.

## Scripted fake model (tests)

Tests drive only the HTTP API (assert on responses, SSE events and `fake_model.prompt_text(role)`); shared constants and helpers live in `tests/helpers.py` and shared fixtures (`loaded_chat`, `sample_chat`, `ask`, ...) in `tests/conftest.py`, and test files never import each other. The deliberate exception is `chat_role_connect` / `query` in `conftest.py`: a database connection as the Chat's own read-only role, used by `test_isolation.py` (isolation is a database property) and to read loaded Tables back.

`tests/fake_model.py:FakeChatModel` replaces the LLM; the `fake_model` fixture (conftest) is injected through `create_app(model_factory=...)` into the `client` fixture, and `ask(chat_id, question, as_of_date="2024-11-04")` returns the parsed SSE events.

```python
fake_model.script("orchestrator", {"sub_questions": ["Total revenue?"]})  # structured output: dict or pydantic instance
fake_model.script("sql_analyst", {"sql": "SELECT sum(total_price) FROM orders"})
fake_model.script("synthesizer", "Revenue is 60.75.")                      # text, streamed word by word
events = ask(chat_id, "What is the revenue?")
assert "2024-11-04" in fake_model.prompt_text("sql_analyst")               # also fake_model.prompts(role)
```

Roles are the `role:<name>` tags set by `agents/common.py` (`orchestrator`, `sql_analyst`, `synthesizer`; a new agent just passes its own name). Responses are consumed per role in call order; an `Exception` is raised by the call; a callable receives the messages and returns the response (to tell parallel calls of one role apart). An unscripted call fails with an AssertionError.

## Ingestion

`POST /chats/{id}/files` (multipart: `files` one or more `.csv`, optional `dataset_notes`) blocks until every file is cleaned and loaded; see `app/ingestion.py` and the route in `app/files.py`. Errors: 404 unknown Chat, 415 non-CSV, 413 over `MAX_REQUEST_BYTES` (default 1GiB per request, checked from `Content-Length` before the body is read) or over `MAX_UPLOAD_BYTES` (default 200MB per file, checked while the file is copied to the raw-upload folder, i.e. after Starlette has spooled the body), 422 empty/unparseable or no files. Files are ingested in order; when one is rejected the files before it stay loaded and the error body is `{detail, reports, schema_profile}` with their Cleaning Reports and the updated Schema Profile. Cleaning: empty cells are NULL everywhere; `NA`/`N/A`/`nan`/`null`/`none` are NULL markers only in non-text columns and counted per column as `null_tokens_converted` (a column whose only values are such tokens stays text); duplicates are detected on whitespace-normalised values (the report's `duplicates_basis` says so). The raw upload is kept untouched in `UPLOAD_DIR/<chat id>/<table>.csv` (compose volume `uploads`). The sample-dataset tests read `ONLINE_SHOP_DIR` (default: the bundled `sample-data/`; skipped if the directory is missing).

## Schema Profile

After every upload `app/schema_profile.py` rebuilds the Chat's Schema Profile (per Table: row count, columns, types, up to 3 sample values; plus Relationships), stores it in `app.chats.schema_profile` and returns it from `POST /chats/{id}/files` and `GET /chats/{id}`. Relationships are inferred deterministically in SQL: `<table>_id` columns (singular or plural table name) point at that Table's `<table>_id`/`id`, other shared column names pair a unique side with a non-unique one, and a link needs a unique parent column plus at least 90% of the child's distinct values present in it (so shared names like `address` are not joined). `render_for_prompt(profile)` gives the compact text form for agent prompts.
