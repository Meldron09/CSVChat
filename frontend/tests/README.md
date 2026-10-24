# Frontend end-to-end tests

Playwright drives the real Next frontend (a production build) in Chromium. The Next server calls the backend server-side, so
`page.route()` cannot mock it; instead a small fake backend (`fake-backend.mts`) implements the real endpoints and its
payloads are typed against `lib/api.ts`, so contract drift fails `npm run build`.

## Run

```sh
cd frontend
npm install
npx playwright install chromium   # once; Playwright is pinned to 1.63.0
npm run test:e2e                  # starts fake backend + frontend, runs the suite
```

Ports: frontend `3100` (`E2E_FRONTEND_PORT`), fake backend `4010` (`FAKE_BACKEND_PORT`). They avoid 3000/8000 on purpose and
servers are never reused, so a running compose stack is never touched. Report: `npx playwright show-report`.

Against another backend (e.g. the real compose stack): `BACKEND_URL=http://localhost:8000 npm run test:e2e` skips the fake
and points the frontend at that URL (only suitable for tests written for a real backend).

## Writing tests

Open `/` in `beforeEach`; each visit creates a fresh Chat in the fake, so tests are independent. Assert only on what a user
sees. `GET http://127.0.0.1:4010/__test/calls` returns every `METHOD /path` the fake has served (e.g. to count `POST /chats`).
The fake keeps state per Chat and records finished Turns, so reloading shows the Transcript like the real backend.

## Scenario triggers

Questions (`POST /chats/{id}/messages`), matched case-insensitively anywhere in the question. Default: steps, SQL, streamed
Markdown-ish Answer ending "(As-of Date used: ...)", no Chart.

| Keyword | Effect |
|---|---|
| `chart` | Answer includes a line Chart titled "Monthly revenue" |
| `malformed` | Answer includes an invalid Chart Spec (renders the malformed-chart notice) |
| `fail` | Failed Turn: `error` event "SQL guard rejected the query: only SELECT statements are allowed" |
| `drop` | Stream closes with no terminal event (connection-closed error); Turn is not recorded |
| `slow` | 700 ms between events (to observe the running state); default is 30 ms |
| `hello` | Direct reply: no steps or SQL |
| `busy` | HTTP 409 "still answering" before streaming |

Uploads (`POST /chats/{id}/files`): reports are derived from the CSV (header = columns, rows counted, identical rows removed;
re-uploading a filename sets `replaced`).

| Trigger | Effect |
|---|---|
| filename starts with `bad` | 422 "could not parse as CSV"; files before it stay loaded and come back as partial `reports` |
| a non-`.csv` filename | 415 for the whole request, no `reports` |

Other: `POST /chats/{id}/sample` loads 8 tables, the sample notes and As-of Date `2024-11-04`. Saving Dataset Notes containing
`FAIL_SAVE` returns 500 (notes save failure). Add new scenarios in `fake-backend.mts` and list them here.
