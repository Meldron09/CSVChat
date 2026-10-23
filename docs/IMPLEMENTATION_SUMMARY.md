# CSVChat — implementation summary

Implements spec [#1](https://github.com/Meldron09/CSVChat/issues/1) (tickets #2–#11) on one branch, PR [#12](https://github.com/Meldron09/CSVChat/pull/12). Vocabulary follows [`CONTEXT.md`](../CONTEXT.md); decisions are in [`docs/adr/`](adr/). For setup and usage see the root [`README.md`](../README.md).

## How the work was done

The tickets form a task graph, not a list:

```
#2 → #3 → #4 → #5 → { #6, #7, #8, #10 } → #9 → #11
```

- Each ticket was implemented by its own subagent in its own git worktree, then merged onto the PR branch `csvchat-poc`.
- #2–#5 were strictly sequential. #6, #7, #8 and #10 were implemented **in parallel** after #5, which was deliberately structured (one module per concern, typed graph state, a reusable scripted fake model) so they would not collide. #6 fast-forwarded; #8 was merged onto it by a merger agent; #10 and #7 were merged by a second merger, and an integration test was added at the seam.
- After #11, a two-axis code review (Standards, Spec) ran on the whole branch, and one implementer fixed every finding (see [Code review](#code-review-and-fixes)).

## Architecture in one paragraph

A Next.js frontend (`frontend/`) talks only to itself; a route-handler proxy at `/api/*` streams requests and responses (uploads, SSE) to a FastAPI backend (`backend/`). The backend ingests CSVs into a **per-Chat Postgres schema** and answers questions with a LangGraph pipeline on Ollama (`ChatOllama`): **Orchestrator** → parallel **SQL Analysts** (`Send`) → **Chart Builder** → **Synthesizer**, with a `direct_reply` branch for edge cases and a `record_turn` node that persists the transcript through the Postgres checkpointer. Charts are declarative Chart Specs (ADR-0001), never code. Every SQL statement runs through a guard and as a per-Chat database role (ADR-0002).

## Per-ticket implementation

### #2 — Walking skeleton
- `docker-compose.yml` with `db` (postgres:17-alpine, healthcheck), `backend`, `frontend`; each of `backend/` and `frontend/` has a Dockerfile. Host ports and the compose project name are env-overridable so several stacks can run side by side.
- `db/init.sh` creates a non-superuser owner role, the `app` and `checkpoints` schemas, and revokes `PUBLIC`.
- Backend (uv, Python 3.12): `POST /chats` (UUID + per-Chat schema), `GET /chats/{id}` (404 for unknown or malformed ids); the Chat store is `app.chats`.
- The model is built at one injectable point, `create_app(..., model_factory=build_model)`, configured by `OLLAMA_MODEL` / `OLLAMA_BASE_URL` (default `gpt-oss:20b-cloud`). Tests substitute a fake there.
- Frontend: `/` creates a Chat and redirects to `/chat/[id]`; unknown ids show "Chat not found" with a 404.
- Harness: `make test` brings up the compose Postgres and runs `pytest` against it.

### #3 — Upload, clean, ingest, Cleaning Report
- `POST /chats/{id}/files` takes multiple CSVs plus optional Dataset Notes.
- Ingestion sniffs encoding (UTF-8, Latin-1 fallback) and delimiter, keeps the raw upload on disk, and reads in 100k-row chunks in two passes: type inference (bigint / numeric / date / timestamp / text), then trim and whitespace-normalise, exact-duplicate removal (a 64-bit row-hash array across chunks), and `COPY` as the owner role. Drop, create and load run in one transaction, so a failed re-upload keeps the old Table.
- Outliers are **flagged, never removed**: IQR (1.5×, in SQL after load) on numeric columns, plus a non-positive rule on price/amount/cost/total/quantity-like columns. On the sample data this flags the two `price_at_purchase = 0` items (order_item_id 15001 and 15002).
- Errors: 415 non-CSV, 413 oversize, 422 empty or unparseable. Re-uploading a same-named file replaces the Table.
- Measured once by hand: a 195MB / 2.25M-row file ingested in ~46s with backend memory peaking ~340MiB (baseline ~100MiB).
- Frontend: upload panel with a busy state and Cleaning Reports; the `/api` proxy streams multipart bodies without buffering.

### #4 — Relationships and Schema Profile
- Deterministic, no LLM. `<t>_id` → Table `t`'s `<t>_id` or `id` (plural and naive singular), plus other shared column names; a link is kept only if the parent column is unique, types are identical and ≥ 90% of the child's distinct values exist in the parent.
- The 8 sample files yield exactly the 8 expected Relationships; `customers.address` vs `suppliers.address` (shared values, not keys) stays unjoined. Re-inferred on every upload or replace.
- The Schema Profile (per Table: columns, types, up to 3 sample values; plus Relationships) is stored on the Chat, returned by the upload and `GET`, shown in the UI, and rendered for prompts by `render_for_prompt`.

### #5 — Ask a question, streamed text Answer
- `POST /chats/{id}/messages` streams `step`, `sql`, `token`, `answer`, `error` as SSE. The As-of Date is sent with every message and the Answer states it.
- Modules: `sql_guard.py` (sqlglot SELECT/WITH-only check + the single `run_sql`), `state.py`, `events.py`, `agents/{orchestrator,sql_analyst,synthesizer,common}.py`, `graph.py`, `messages.py`.
- **Isolation is database-enforced.** The first design (`SET LOCAL ROLE` from a shared role) was rejected because a query can escape it with `set_config('role', …)`. Instead each Chat gets its own LOGIN role with USAGE/SELECT on its own schema only; each query connects as that role with a fixed `search_path`, a 10 s `statement_timeout` and `default_transaction_read_only=on`. ADR-0002 was rewritten to match.
- Structured output uses tool calling (gpt-oss ignores Ollama's `format=`), with one nudge-and-retry if the model answers in text.
- A reusable scripted fake chat model (`tests/fake_model.py`) scripts responses per agent role, streams tokens and records prompts.
- Verified against real `gpt-oss:20b-cloud`: "total revenue for the past year" → 32,398,768.21.

### #6 — SQL failure handling and adversarial safety
- Ordinary DB errors (SQLSTATE classes 42 and 22, unparsable SQL) are retried up to 2 times with the database error fed back; after that the Answer reports the failure honestly (a fixed message with no model call if every part failed).
- Guard rejections (non-SELECT, multi-statement, writable CTE), `permission denied` and timeouts are terminal `error` events and are never retried.
- Results are capped at 1,000 rows via a server-side cursor (`fetchmany(1001)`), and the model is told when a result was truncated.
- Tests: retry then success, retry exhaustion, and 7 adversarial cases, with orders count/sum/table list verified unchanged through the owner connection.

### #8 — Multi-part and cross-file questions in parallel
- The Orchestrator decomposes into independent sub-questions (max 4); a simple question yields exactly one. Fan-out uses LangGraph `Send`; each `step` / `sql` event carries a `task` index.
- A cross-file part stays one sub-question joined through the Relationships in the Schema Profile. The Synthesizer merges results in sub-question order.
- Tests prove genuine parallelism with a `threading.Barrier(3)` inside the fake model, and check that the scripted supplier/review join returns correct rows on the real sample data.
- Real run: a two-part question split into 2 parallel tasks (30 s total).

### #10 — Sample dataset, Dataset Notes, edge-case replies
- The 8 Online Shop CSVs (3.2MB) are committed under `sample-data/` and mounted into the backend. `POST /chats/{id}/sample` and a "Load sample dataset" button load them, pre-fill the Revenue Dataset Notes and set the As-of Date to 2024-11-04.
- `PUT /chats/{id}` edits Dataset Notes and the As-of Date; the edited notes appear in every agent's prompt.
- Direct replies, decided **in code before any model call**: no Tables → "upload data first"; blank As-of Date → asks for it. The model may also set `Plan.direct_reply` to decline an unanswerable question. These stream as tokens and a final `answer` with no `sql` events.
- Revenue on the sample data follows the agreed definition: 32,398,768.21 over 11,410 orders.

### #7 — Charts in Answers
- `chart_spec.py` is a validated Pydantic `ChartSpec` (line / bar / pie / scatter; title, axis labels, 1–5 series, inline rows). `agents/chart_builder.py` makes one model call over all results, validates each chart independently, caps at 3, and skips failed or empty results.
- An invalid spec is rejected, reported in a `step` and never reaches the Answer; the Synthesizer is told not to claim it. Charts appear **only** in the final `answer` event.
- Frontend: Recharts renderer (`chart.tsx`) for all four types, with parse checks and an error boundary so a malformed spec shows a message rather than crashing the page.

### #9 — Resume and follow-ups
- The Postgres checkpointer (`PostgresSaver`, `checkpoints` schema, thread id = chat id) persists each Chat. Only `State.turns` persists; a `record_turn` node ends both the Answer and direct-reply paths, and every other state key is reset per turn.
- `GET /chats/{id}` rebuilds the transcript (questions, Answers, Chart Specs) plus notes, As-of Date, Cleaning Reports and Relationships. A second app instance on the same DB returns an identical response.
- History policy: the last 6 turns (question, SQL run, answer text) reach the model; Chart Specs never do; older turns stay in the transcript only.
- Frontend: the page renders the saved transcript on load, then appends new turns. Verified end to end: `docker compose restart backend`, then a reload in headless Chrome re-renders both turns and charts.

### #11 — README and delivery
- Root `README.md`: problem, architecture, setup/run (including `ollama signin` for `:cloud` models and a `qwen3:8b` local fallback), libraries and why, evaluation (accuracy, large-dataset performance, edge cases, and what is deliberately not tested), sample-data quirks, limitations.
- Golden figures were verified in SQL (revenue 32,398,768.21; per-category revenue; the lowest-rated-supplier tie presented as a trap, not a golden).
- A fresh-clone check passed: `docker compose up` healthy, sample dataset loads in headless Chrome, `make test` green, and the real model answered the revenue question correctly. It also fixed a real gap: the sample-data tests defaulted to an absolute path on one machine and would have been silently skipped on a clean clone.

## Code review and fixes

Two parallel read-only reviewers (Standards, Spec) ran on the whole branch; one implementer then fixed every finding.

| Finding | Outcome |
|---|---|
| Tests reached into module internals; test files imported each other | Fixed. Tests assert through HTTP/SSE/recorded prompts; shared helpers in `tests/helpers.py` and `conftest.py`; the one DB-level isolation check is a documented exception. The env→`ChatOllama` wiring test was dropped. |
| Smells: duplicated result dict, duplicated retry count, repeated sort/filter, re-listed DatasetInfo keys, `main.py` doing too much, hand-copied chart types | Fixed (single `AnalystResult`, `ordered_results`, `DatasetInfo` bundle, typed `Turn`, ingestion/sample routes moved to `app/files.py`, one frontend chart-type list). |
| Daily trend charts rejected by a 200-row cap | Fixed: cap is 2,000 rows (tests at 365, 730, 2,000; 2,001 rejected). |
| Charts with an empty series validated | Fixed: a series with no non-null value is rejected (backend and frontend). |
| Fan-out silently dropped parts beyond 4 | Fixed: the Synthesizer is told and the Answer says which parts were not answered. |
| One terminal SQL error lost the whole turn | Fixed: the `error` event is kept (ticket #6), and the turn is now recorded in the transcript as failed. |
| Concurrent messages could lose a turn | Fixed: a per-Chat Postgres advisory lock; a concurrent message gets 409. |
| A failed multi-file upload hid the files that had loaded | Fixed: the error carries the reports and the UI shows them. |
| 200MB cap checked only after the body was received | **Partly fixed**: early 413 from `Content-Length` (default 1GiB total); the per-file cap still runs after Starlette spools the body; chunked uploads without `Content-Length` skip the early check. Documented. |
| Text values like `NA` / `null` silently became NULL | Fixed: only converted in non-text columns, and counted as `null_tokens_converted` in the Cleaning Report. |
| Default credentials and an exposed Postgres | **Partly fixed**: Postgres bound to `127.0.0.1`; defaults unchanged, with a README "Security notes for this PoC" section. |
| `/sample` overwrote user-edited notes; dedup on whitespace-normalised values undocumented | Fixed / documented. |

Result: 98 → 115 backend tests.

## Known limitations

- Chart values are not cross-checked against the SQL results, so a model could in principle invent numbers.
- A failed turn keeps sibling analysts' SQL but not their result rows; a client that disconnects mid-turn records nothing.
- `/sample` always overwrites the As-of Date (only the notes are protected). The 409 "Chat is still answering" message is shown as "This question failed: …" in the UI.
- Real-model reliability: Ollama cloud returned intermittent 502s during development, and one run ended with "The Orchestrator returned neither sub-questions nor a direct reply". Only some paths were exercised against the real model (revenue, a two-part question, simple count); charts and follow-ups were verified with a scripted stand-in. The local `qwen3:8b` fallback is unevaluated.
- Ingestion blocks the request; per-Chat schemas are kept indefinitely; no auth (all by design for the PoC — see the spec's Out of Scope).
- The ingestion performance figures come from a single manual run, not a benchmark.
