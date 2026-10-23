# CSVChat

Chat with several related CSV files in plain English and get back text, charts, or both.

Vocabulary (Chat, Dataset, Table, Relationship, As-of Date, Chart Spec, ...) is defined in [CONTEXT.md](CONTEXT.md). The two big design decisions are recorded as ADRs: [0001: charts are declarative Chart Specs, not generated code](docs/adr/0001-chart-specs-not-generated-code.md) and [0002: one Postgres schema and one read-only role per Chat](docs/adr/0002-one-postgres-schema-per-chat.md). Backend details (API, SSE events, test helpers) are in [backend/README.md](backend/README.md).

## 1. Problem statement

An analyst has several related CSV exports (customers, orders, order items, products, payments, shipments, reviews, suppliers) and wants answers like "What is the total revenue for the past year?" or "Which supplier's products got the lowest-rated reviews?", including questions that span files and follow-ups like "now break it down by category". Today that means loading each file into a notebook, working out how the files join, cleaning them by hand and writing queries and charts yourself.

CSVChat is a proof of concept (a take-home assignment) that does this end to end: upload many CSVs at once, have them cleaned and linked automatically, ask questions in a chat, and get an Answer with a streamed text explanation and charts. A Chat is identified by its id in the URL, so it can be resumed after a refresh or a server restart.

## 2. How it works

```
 Browser (Next.js, Recharts)
   |  /api/* proxied by a Next route handler (streams uploads and SSE, no CORS)
   v
 FastAPI backend ---- upload ----> Ingestion: sniff encoding/delimiter, chunked clean, COPY
   |                                  -> Postgres schema chat_<uuid>  (+ Cleaning Report, Relationships)
   |
   |-- POST /chats/{id}/messages (SSE) --> LangGraph on Ollama (ChatOllama)
   |
   |      Orchestrator --(Send, parallel)--> SQL Analyst x N --> Chart Builder --> Synthesizer
   |         |                                   |                  |                |
   |         | direct reply (no data,            | sqlglot guard +  | Chart Specs    | streams the
   |         | no As-of Date, unanswerable)      | per-Chat role    | (validated)    | Answer text
   |         v                                   v                  v                v
   |        END                         Postgres, read-only    answer event      token events
   v
 Postgres 17: owner role (ingestion) | chat_<uuid> schema + role per Chat | app.chats | checkpoints (LangGraph)
```

**Frontend** (`frontend/`, Next.js 16 App Router, TypeScript, Tailwind, Recharts). Opening `/` creates a Chat and redirects to `/chat/<id>`. The page has the upload panel (with "Load sample dataset"), the Cleaning Report and Relationships, an editable Dataset Notes box, an As-of Date field (pre-filled with the browser's today), and the transcript. It reads the SSE stream with `fetch` and shows progress steps, each SQL query as it runs, the Answer streaming in, and charts when the Answer completes.

**Backend** (`backend/`, FastAPI, Python 3.12, `uv`). Endpoints: `POST /chats`, `GET`/`PUT /chats/{id}`, `POST /chats/{id}/files`, `POST /chats/{id}/sample` (one click: loads the eight bundled Online Shop CSVs and sets the As-of Date to 2024-11-04; it fills the Dataset Notes with the Revenue definition only when the Chat has none, so notes you wrote are never overwritten), `POST /chats/{id}/messages`. No auth: anyone holding a chat id can use that Chat. One message at a time per Chat: a message sent while the Chat is still answering gets `409`.

**Ingestion and cleaning** (`app/ingestion.py`). The request blocks until every file is loaded. The raw upload is kept untouched on disk. Encoding is sniffed (UTF-8, Latin-1 fallback) and the delimiter is sniffed (`, ; tab |`). Two chunked passes of 100k rows: type inference (bigint, numeric, date, timestamp, else text; leading-zero values such as zip codes stay text), then cleaning and a bulk `COPY` into the Chat's schema. Cleaning trims and whitespace-normalizes text, turns empty cells into NULL (nothing is filled in) and removes exact duplicate rows across chunks. Duplicates are detected on the whitespace-normalised values, so two rows that differ only in spacing count as one; the Cleaning Report says so. The tokens `NA`/`N/A`/`nan`/`null`/`none` are treated as NULL markers only in numeric and date columns, and every such conversion is counted per column in the Cleaning Report (`null_tokens_converted`, separate from genuinely empty cells); in text columns they stay as written (a city called "None" or a surname "Null" is data), and a column whose only values are such tokens stays text. Outliers are flagged, never deleted: IQR (1.5x) on numeric columns, plus an explicit "value <= 0" rule on price/amount/cost/total/quantity-like columns. Each file produces a Cleaning Report. Re-uploading a same-named file replaces that Table atomically. Limits: 200MB per file (`MAX_UPLOAD_BYTES`) and 1GiB per upload request (`MAX_REQUEST_BYTES`); the request limit is checked from `Content-Length` before the body is read, so an oversized upload is refused with 413 without being spooled to disk. If a file in a multi-file upload is rejected, the files before it stay loaded and the error response carries their Cleaning Reports and the updated Schema Profile, which the UI shows.

**Relationship inference** (`app/schema_profile.py`, deterministic, no LLM, re-run after every upload). A `<table>_id` column links to that Table's `<table>_id`/`id`; other shared column names pair a unique side with a non-unique one. A link is kept only if the parent column is unique, the types match and at least 90% of the child's distinct values exist in the parent, so `customers.address` and `suppliers.address` (same name, overlapping values, not keys) are not joined. The Relationships plus per-Table columns, types and sample values form the Schema Profile that goes into every agent prompt.

**Agents** (`app/graph.py`, `app/agents/`, LangGraph):

- *Orchestrator*: decides whether the question needs fan-out and splits it into at most 4 independent sub-questions (cross-file parts stay one sub-question joined via the Relationships); parts beyond the cap are passed to the Synthesizer and the Answer says plainly that they were not answered. It replies directly, without analysts, when nothing is uploaded or the As-of Date is missing (both decided in code, no model call) or when the question cannot be answered from the data (model decision).
- *SQL Analyst*: one per sub-question, run in parallel via LangGraph `Send`. Writes SQL, runs it through the guard, and on an ordinary database error (syntax, unknown column, bad cast) retries up to 2 times with the error fed back; if still failing, the part is reported as failed rather than guessed.
- *Chart Builder*: one call over all successful results; produces up to 3 Chart Specs (line, bar, pie, scatter) of up to 2,000 rows each (enough for a multi-year daily series; the cap bounds the checkpoint and `answer` payload), each validated by Pydantic (`app/chart_spec.py`); a malformed spec, including one whose series key appears in no row, is rejected and never reaches the Answer. Charts are data, not code ([ADR-0001](docs/adr/0001-chart-specs-not-generated-code.md)), so they are stored in the checkpoint and re-render on reload.
- *Synthesizer*: merges the results into the Answer, states the As-of Date used, reports failed parts and truncated results plainly, and streams its text.

**SQL guard** (`app/sql_guard.py`, [ADR-0002](docs/adr/0002-one-postgres-schema-per-chat.md)). `sqlglot` first checks for exactly one SELECT/WITH statement with nothing that writes. Then the query runs as the Chat's own login role (`USAGE` and `SELECT` on that Chat's schema only), with `search_path` fixed to the schema, read-only transactions, a 10s statement timeout (`SQL_TIMEOUT_MS`) and a 1,000-row cap read through a server-side cursor. Isolation is enforced by Postgres, not by the parser or the model: `SELECT * FROM chat_<other>.orders` and `app.chats` fail with "permission denied".

**SSE events** from `POST /chats/{id}/messages`: `step` (progress), `sql` (each query as it runs), `token` (Answer text), `answer` (final text, As-of Date and Chart Specs; the only event that carries charts) and `error` (terminal). A turn that ends in `error` is still recorded in the transcript (the question, the SQL seen so far and the error text, no answer), so a reload shows it; the model is only told that the question failed. Details in [backend/README.md](backend/README.md).

**Dates.** Relative phrases ("past year", "last 6 months") are resolved against the As-of Date the user sets, never the system clock; the Answer states the date it used.

**Memory and follow-ups.** Each Chat is one LangGraph thread persisted by the Postgres checkpointer (`checkpoints` schema). The persisted state is the transcript (questions, queries, answers, Chart Specs, and the error text of failed turns), so `GET /chats/{id}` rebuilds it after a refresh or restart. The model sees only the last 6 turns (question, SQL run, answer text; never Chart Specs; a failed turn is just a marker); older turns stay visible in the transcript. A turn holds a per-Chat Postgres advisory lock while it runs, which is what makes concurrent messages safe across several backend workers.

## 3. Setup and run

### Prerequisites

- Docker with Compose v2.
- [Ollama](https://ollama.com) running on the **host** (it is not part of the compose stack). The containers reach it at `http://host.docker.internal:11434`. On Linux, Ollama must listen on an address reachable from the Docker bridge (for example `OLLAMA_HOST=0.0.0.0 ollama serve`).
- For `make test` only: [`uv`](https://docs.astral.sh/uv/) on the host.

### Choose a model

The default is `gpt-oss:20b-cloud`, an Ollama cloud model. `:cloud` models need an Ollama account:

```sh
ollama signin
ollama pull gpt-oss:20b-cloud   # registers the cloud model locally; no large download
```

Local fallback, no sign-in needed:

```sh
ollama pull qwen3:8b
OLLAMA_MODEL=qwen3:8b docker compose up --build
```

Expect lower quality from a small local model: more malformed structured output from the Orchestrator and Chart Builder (the agents rely on tool calling for structured output), more SQL retries, weaker multi-table joins and shakier prose. The development and manual verification in this repo were done with `gpt-oss:20b-cloud`; `qwen3:8b` has not been evaluated here.

### Start the stack

```sh
docker compose up --build
```

Then open <http://localhost:3000>. A new Chat is created and its id appears in the URL. Click **Load sample dataset** to load the eight bundled Online Shop 2024 CSVs (`sample-data/`), which also fills the Dataset Notes with the Revenue definition and sets the As-of Date to 2024-11-04. Or upload your own CSVs. Then ask a question, for example "What is the total revenue for the past year?".

| Service | Host port (default) | Override |
| --- | --- | --- |
| frontend | 3000 | `FRONTEND_PORT` |
| backend (FastAPI) | 8000 | `BACKEND_PORT` |
| Postgres | 55432 | `POSTGRES_PORT` |

Environment variables (all optional; set them in the shell or a `.env` file next to `docker-compose.yml`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `OLLAMA_MODEL` | `gpt-oss:20b-cloud` | chat model |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | where the backend reaches Ollama |
| `POSTGRES_PASSWORD` | `postgres` | Postgres superuser password |
| `DB_OWNER_PASSWORD` | `owner` | password of the `csvchat_owner` role (ingestion, migrations) |
| `DB_CHAT_ROLE_SECRET` | `dev-chat-role-secret` | secret from which each Chat's read-only role password is derived |
| `COMPOSE_PROJECT_NAME` | checkout directory name | lets several checkouts run side by side |

The defaults are development values; change the two secrets for anything shared. Not set through compose but supported by the backend: `SQL_TIMEOUT_MS` (10000), `MAX_UPLOAD_BYTES` (200MB per file), `MAX_REQUEST_BYTES` (1GiB per upload request), `UPLOAD_DIR`.

**Security notes for this PoC.** The defaults are for local development only: the Postgres superuser password is `postgres`, the `csvchat_owner` role password is `owner`, and `DB_CHAT_ROLE_SECRET` defaults to the public constant `dev-chat-role-secret`, so anyone who knows it can derive every Chat's database password (they are HMACs of the chat id). There is no authentication: whoever has a chat id can read and use that Chat, and the backend and frontend ports are published on all interfaces. Compose publishes Postgres on `127.0.0.1` only. For anything beyond your own machine set `POSTGRES_PASSWORD`, `DB_OWNER_PASSWORD` and `DB_CHAT_ROLE_SECRET` (shell or `.env`; use a fresh volume, because the passwords are set when the database is first created), put the services behind an authenticating reverse proxy, and do not expose the backend port directly.

To run next to another checkout: `COMPOSE_PROJECT_NAME=csvchat2 POSTGRES_PORT=55433 BACKEND_PORT=8001 FRONTEND_PORT=3001 docker compose up --build`.

The database init script runs only on an empty volume. If you change `db/init.sh` or upgrade from an older checkout, run `docker compose down -v` first (this deletes all Chats).

### Run the tests

```sh
make test
```

This starts the compose Postgres (`docker compose up -d --wait db`) and runs `pytest` in `backend/` (115 tests, about 40s). With non-default ports or secrets, pass the same variables as for compose, e.g. `POSTGRES_PORT=55433 make test`. The sample-data tests use the bundled `sample-data/`; set `ONLINE_SHOP_DIR` to point them at another copy of the dataset.

The tests drive only the backend HTTP API, against a real Postgres and a scripted fake chat model injected at the one place the model is built (`app/model.py:build_model`, `create_app(model_factory=...)`), and assert on responses, SSE events and the prompts the fake model received. They never call a real LLM. The one deliberate exception is the database-level isolation check (and reading loaded Tables back), which connects to Postgres as the Chat's own role through a single fixture in `tests/conftest.py`.

## 4. Libraries and why

| Library | Used for | Why |
| --- | --- | --- |
| FastAPI, uvicorn | HTTP API, SSE | Typed request models, easy streaming responses, required Python API |
| LangGraph | agent graph, parallel fan-out, checkpointer | `Send` gives parallel SQL Analysts; the Postgres checkpointer gives resumable Chats and the transcript for free |
| langchain-ollama (`ChatOllama`) | the LLM | Talks to host Ollama, local or cloud, with tool calling for structured output; model swapped by one env var |
| psycopg 3, psycopg-pool | Postgres access, `COPY`, per-Chat role connections, checkpointer pool | Fast bulk load via `COPY`, server-side cursors for the row cap |
| pandas | chunked CSV reading and cleaning | Robust parsing and vectorised cleaning in bounded-memory chunks |
| sqlglot | SQL validation | Parses generated SQL so only a single SELECT/WITH gets through (defence in depth; the database is the real barrier) |
| Pydantic (via FastAPI) | Chart Spec and API models | Validates model-produced chart specs before they reach the UI |
| Postgres 17 | data store, Chat store, checkpoints | One database for data, roles/schemas for isolation, and persistence |
| Next.js 16, React 19, Tailwind 4 | frontend | Required by the assignment (Next.js/React); the Next route handler doubles as a streaming proxy to the backend |
| Recharts | charts | Declarative React charts that map directly onto Chart Specs |
| pytest, httpx | tests | HTTP-level tests with FastAPI's test client |
| Docker, Compose, `uv` | packaging, dependency management | One-command start; locked, reproducible Python dependencies |

## 5. Evaluation

The assignment does not require evaluation code. This section describes what is already tested in the repo and how the rest would be done properly.

### 5.1 Accuracy of AI insights

What the repo guarantees without an LLM: the SQL that runs is the SQL shown to the user (each `sql` event), the Revenue definition is injected through the Dataset Notes, and the Revenue SQL has a test against the real data (exact figure below). What it cannot guarantee is that the model writes correct SQL or describes the numbers correctly, so a proper validation would be:

1. **Golden-query set.** A versioned file of questions with expected figures computed independently by hand-written SQL on the sample data, run against the live stack and compared automatically (numbers within a tolerance, categories as sets). Figures verified for the bundled sample with the As-of Date 2024-11-04 and the Revenue definition from the Dataset Notes (Completed payment, non-Cancelled shipment, `orders.total_price`):

   | Question | Expected result |
   | --- | --- |
   | Total revenue for the past year | 32,398,768.21 over 11,410 orders (all 15,000 orders sum to 42,495,704.81, so the filter matters) |
   | Revenue by month, last 6 months (orders after 2024-05-04) | 2024-05 2,503,880.30; 06 2,637,190.12; 07 2,824,397.51; 08 2,743,929.01; 09 2,771,614.13; 10 2,928,010.59; 2024-11 (4 days) 322,457.41 |
   | Revenue by product category (line items of qualifying orders) | Electronics 11,619,321.02; Home & Kitchen 8,473,658.41; Accessories 7,632,046.59; Furniture 4,673,742.19 |
   | How many customers? | 10,000 |
   | Average review rating | 2.76 (1,106 reviews) |
   | Top-selling product by units | External SSD (product 1308), 120 units |
   | First and last order date | 2023-11-05 and 2024-11-04 |
   | Orders where the payment amount equals the order total | 1 |

   The "lowest-rated suppliers" question is a good trap rather than a clean golden: three suppliers (502, 503, 504) tie at an average rating of 1.000 over 14 reviews each, and supplier names repeat (25 distinct names across 100 suppliers), so the expected answer must be defined by `supplier_id` and tie handling.
2. **LLM-vs-SQL comparison.** For each golden question, extract the numbers from the Answer text and the Chart Spec data and compare them with the result of the golden SQL; also compare the model's SQL result set with the golden result set (execution accuracy), not the SQL text. This is also how to close a known gap: chart values are not cross-checked against the SQL results today.
3. **As-of Date handling.** Same relative question with different As-of Dates (2024-11-04, 2024-06-30, a date before all data, a date after), asserting the filter window and that the Answer states the date; plus the missing-date path asks for it.
4. **Cross-file questions.** Joins across three or more tables (reviews -> products -> suppliers, order_items -> products -> orders -> payment/shipments), including the `address` trap where a naive join would be wrong.
5. **Larger question set.** A few hundred questions across difficulty levels (single-table aggregates, joins, time windows, follow-ups, multi-part, unanswerable), scored per category, repeated several times per question to measure run-to-run variance, and run per candidate model to compare `gpt-oss:20b-cloud` with local fallbacks.
6. **Human spot checks.** Review of a sample of Answers for faithfulness (does the text say what the numbers say), tone and chart choice; an LLM judge can pre-screen but not replace this.

### 5.2 Performance on large datasets

Measured once, manually, with a single CSV of about 195MB (2.25M rows) uploaded through the API: ingestion finished in about 46s with the backend container peaking around 340MiB (about 100MiB idle). A 205MB file was rejected with 413 and no partial file left behind. The design points behind this:

- Chunked reading (100k rows per chunk, two passes) keeps memory bounded by the chunk size plus 8 bytes per distinct row for de-duplication hashes.
- `COPY` for loading instead of row inserts; outliers are computed in SQL after the load, over whole columns.
- Upload is streamed to disk in 1MB blocks with a 200MB cap; the Next proxy streams request bodies.
- At query time: a 10s statement timeout and a 1,000-row cap read through a server-side cursor, so an expensive query or a huge result cannot hang a request or flood the model's context. There are no indexes on loaded Tables; analytic scans are sequential.

A proper load test would: generate datasets at 10MB / 100MB / 200MB and many columns/rows shapes; record ingestion time, peak backend and Postgres memory and disk per size; run concurrent uploads and concurrent questions on several Chats (k6 or Locust against the API) while recording p50/p95 latency of ingestion, time to first `token` and total time per question; check the 1,000-row cap and timeout actually trigger on large joins; and measure the Schema Profile rebuild time as column and table counts grow. The 46s figure was a single run on a development machine and is not a benchmark.

### 5.3 Edge cases and robustness

Tested (automated, through the HTTP API against real Postgres with the scripted fake model):

- Ingestion: a deliberately dirty CSV (duplicates, nulls, untrimmed text, outliers), a Latin-1 semicolon-delimited file, the eight sample files (row counts, types, the two zero-price `order_items` rows flagged, Relationships), replace-on-reupload, non-CSV rejection (415), oversized rejection (413, per file and per request from `Content-Length`), empty/unparseable files (422), a rejected file in a multi-file upload still returning the reports of the files before it, NA/None/null text kept in text columns and counted when converted in typed columns, duplicate rows across chunk boundaries and the raw upload kept untouched.
- Relationship inference on the sample data, including the unjoined `address` columns and re-inference after a replace.
- SQL safety: `DROP TABLE`, multi-statement input, writable CTEs, reads of another Chat's schema and of `app.chats`, `SET ROLE`/`set_config('role', ...)`, other Chats' credentials, and runaway queries hitting the statement timeout. Each ends the stream with an `error` event, the data is verified unchanged, and the turn (with its sibling analysts' queries) is recorded in the transcript as failed.
- Failed SQL: ordinary errors are retried up to 2 times with the error fed back, then reported honestly in the Answer; partial failure alongside a success.
- Questions: unanswerable question, question with no upload, missing As-of Date, direct replies skipping the chart path, an invalid Chart Spec (including an empty series) rejected and absent from the `answer`, a 365-point daily line chart accepted, parts dropped by the 4-sub-question cap reported in the Answer.
- Parallelism, ordering and resume: a barrier proves sub-question analysts run concurrently; SSE ordering; transcript and Chart Specs rebuild after reload and across two app instances; the 6-turn history window; a failed turn in the transcript and the thread usable afterwards; a second message to a busy Chat getting 409 without losing a turn.

Deliberately not tested: real LLM output (nondeterministic and slow; see 5.1 for how it would be) and the frontend (verified through the SSE contract and manual runs in a browser).

## 6. Known quirks of the sample data

Verified in SQL on the bundled Online Shop 2024 files (`sample-data/`):

- **Payment amounts do not match order totals.** `payment.amount` equals `orders.total_price` for exactly one of 15,000 orders (order 11030). Payments are unrelated random values. Revenue must not use `payment.amount`; the sample Dataset Notes say so, and `order_items` line totals do add up to `orders.total_price`.
- **Pending shipments carry delivery dates.** In fact every shipment has a `delivery_date`, including all 3,559 Pending and all 730 Cancelled ones.
- **Order dates run 2023-11-05 to 2024-11-04**, so "the past year" only makes sense with an As-of Date; with 2024-11-04 it covers every order. Reviews, shipment and delivery dates run past that date (to 2024-11-16).
- **Two items with a non-positive price.** `order_items` rows 15001 (order 2800, product 1851) and 15002 (order 4799, product 32) have `price_at_purchase = 0.00` (none are negative). They are flagged by the "value <= 0" rule in the Cleaning Report; an IQR rule would not catch them. Their orders still reconcile because the totals include the zero lines.
- Smaller things: 111 `orders.total_price` values are IQR outliers (flagged, kept); `payment_method` has a single value; supplier names repeat (25 distinct names for 100 suppliers), so grouping by name instead of `supplier_id` merges suppliers; `customers.address` and `suppliers.address` share values but are not keys.

The sample has no nulls, exact duplicates or orphaned keys, so cleaning is exercised mainly by the zero-price rows and the dirty-CSV test fixture.

## 7. Limitations and future work

- **Answer quality depends on the model.** No automated accuracy evaluation exists (see 5.1). Chart values are not cross-checked against the SQL results, so a model could in principle put invented numbers in a chart. A model can also fail to produce valid structured output: during development, `gpt-oss:20b-cloud` returned cloud-side 502/"Internal Server Error" responses at times, and one run ended with "The Orchestrator returned neither sub-questions nor a direct reply" (not investigated: model or prompt). Such failures surface as an `error` event; retry the question. The Orchestrator caps a plan at 4 sub-questions; the rest are not analysed (the Answer says which).
- **Failed turns keep little.** A turn that ends in an `error` event is recorded with its question, the SQL seen and the error text, but not the results of sibling analysts that finished, and a browser that disconnects mid-turn records nothing. The transcript keeps the final SQL per task, not each retry attempt.
- **Busy Chats are refused, not queued.** A message sent while the Chat is answering gets `409` (a per-Chat Postgres advisory lock); the UI also disables Ask while a turn runs.
- **No auth.** A Chat is protected only by its unguessable id; there is no chat list and no user accounts.
- **No cleanup.** Chat schemas, roles and raw uploads accumulate indefinitely; a TTL job (drop schema and role, delete files) is future work. Datasets are not shared between Chats.
- **Ingestion blocks the request.** No background job or progress reporting; the UI shows a busy state. The 1GiB request limit is checked from `Content-Length` before the body is read, but the 200MB per-file limit is only applied after Starlette has spooled the multipart body to a temp file (up to the request limit), and a chunked upload without `Content-Length` skips the early check, so a single file between 200MB and the request limit costs disk and time before it is rejected with 413. A streaming multipart parser would remove this.
- **Whitespace-normalised dedup.** Rows that differ only in spacing are treated as duplicates (and reported as such); case differences are not.
- **Conservative type inference.** Thousands separators, decimal commas and ambiguous date formats stay text. Row de-duplication uses 64-bit hashes (collisions are theoretical).
- **Relationships are heuristic.** Irregular plurals (`people` / `person_id`) and non-unique "parent" columns are not handled; bigint columns do not link to numeric ones.
- **Charts** are limited to line, bar, pie and scatter, at most 3 per Answer and 2,000 rows each.
- **Isolation caveat.** `pg_catalog` is readable by every role, so table and schema names (not data) of other Chats are visible to a query.
- **Frontend** has no automated tests and the progress steps shown live are not kept after a reload.
