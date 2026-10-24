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
servers are never reused, so a running compose stack is never touched. Report: `npx playwright show-report`. Specs share their helpers (locators, `csv`, `loadSample`, `ask`, `openChat`, the fake backend URL) from `tests/helpers.ts`.

Against another backend (e.g. the real compose stack): `BACKEND_URL=http://localhost:8000 npm run test:e2e` skips the fake
and points the frontend at that URL (only suitable for tests written for a real backend).

## Real-stack smoke test

`real-stack.spec.ts` loads the sample dataset and asks one question against the real backend and language model, expecting
a finished Turn with an Answer. It is skipped (reported as skipped, not failed) unless `E2E_REAL_STACK=1`, so `npm run test:e2e` never calls the
model. To run it, start the stack (`docker compose up --build` from the repo root; the model, Ollama by default, must be
reachable) and then:

```sh
cd frontend
npm run test:e2e:real                                     # backend at http://localhost:8000
BACKEND_URL=http://localhost:9000 npm run test:e2e:real   # another address
```

It sets `E2E_REAL_STACK=1` and `BACKEND_URL`, runs only this spec, and still starts its own frontend on 3100. It creates a
real Chat in the stack's database and can take minutes (timeout 5 min); it passes when the Turn finishes with a non-empty Answer and no "This question failed" text (the wording is up to the model; the backend
only appends its "(As-of Date used: ...)" line when the Answer does not already mention the date, so that is not relied on).

## Writing tests

Open `/` in `beforeEach`; each visit creates a fresh Chat in the fake, so tests are independent. Assert only on what a user
sees. `GET ${FAKE_URL}/__test/calls` (port 4010 by default) returns every `METHOD /path` the fake has served (e.g. to count `POST /chats`).
The fake keeps state per Chat and records finished Turns, so reloading shows the Transcript like the real backend.
Tests can read what was saved with `GET http://127.0.0.1:${FAKE_BACKEND_PORT}/chats/{id}` (e.g. `as_of_date`, `dataset_notes`); a question's Answer echoes the As-of Date it was sent.

`tables.spec.ts` needs no extra fake scenarios: the sample's `orders` Table (97 rows, IQR outlier flag, 3 duplicates removed) is
the flagged one; an uploaded CSV with a repeated line gives a "1 flagged" Table; a single upload has no relationships (the
empty message); `orders` and `customers` together give one relationship.

## Scenario triggers

Questions (`POST /chats/{id}/messages`), matched case-insensitively anywhere in the question. Default: steps, SQL, streamed
Markdown-ish Answer ending "(As-of Date used: ...)", no Chart.

| Keyword | Effect |
|---|---|
| `chart` | Answer includes a line Chart titled "Monthly revenue" |
| `multi` | Answer includes a two-series bar Chart "Revenue by region" with large values (12400 ... 1234567) |
| `years` | Answer includes a one-series bar Chart "Revenue by year" whose x values are the numbers 2021 to 2023 (X labels must not be compacted) |
| `malformed` | Answer includes an invalid Chart Spec (renders the malformed-chart notice) |
| `markdown` | Answer with bold, a list, a GFM table and a raw `<b>` tag (which must show as text, not render) |
| `plain` | Plain-text Answer with single newlines and no Markdown syntax |
| `tasks` | Adds a second parallel task (step + SQL), so "How this was answered" has two task groups |
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
| filename contains `slow` | the response is held for 1.5 s (to observe the upload spinner and file names) |

Other: `POST /chats/{id}/sample` loads 8 tables, the sample notes and As-of Date `2024-11-04`. Saving Dataset Notes containing
`FAIL_SAVE` returns 500 (notes save failure). Add new scenarios in `fake-backend.mts` and list them here.

## Theme tests (`theme.spec.ts`)

Colours are CSS `light-dark()` tokens, so tests switch the OS with `page.emulateMedia({ colorScheme })` and assert the computed
`body` background. The no-flash test blocks `/_next/static/**/*.js` so only the inline `<head>` script can have applied the theme.

## Chart tests (`chart.spec.ts`)

Chart colours are CSS variables (`--chart-*`, axis and grid tokens), so tests switch the OS with `emulateMedia` and compare the
computed `fill`/`stroke` of SVG elements. Compact numbers use `Intl.NumberFormat` in the browser locale (Playwright: en-US).

## Shell tests (`shell.spec.ts`)

Layout at wide (default 1280px) and phone (`test.use({ viewport })`, 390px) widths, the sidebar drawer (a native `<dialog>`: focus trap/restore, Escape), composer keys and auto-grow, the pinned composer, and Transcript auto-scroll. The Transcript is `getByRole("region", { name: "Transcript" })`; scroll it with `el.scrollTop = ...` in `evaluate`. Use the `slow` keyword to hold a Turn in the running state. Note `getByLabel("Question")` also matches Turn articles (`aria-label="Question: ..."`) once a Turn exists: use `getByRole("textbox", { name: "Question", exact: true })`.

## Turn tests (`turn.spec.ts`)

Running (one status line; streamed text is `aria-hidden` inside the Transcript's `aria-live="polite"` region), done (Markdown, Charts, closed "How this was answered" disclosure grouped by task), failed + Retry (new Turn, failed one stays), the As-of Date chip rule, Markdown/plain-text rendering and resume after reload. Keywords: `markdown`, `plain`, `tasks`, `slow`, `fail`.

## Screenshots (`screenshots.spec.ts`)

Visual-review harness for the redesign, skipped unless `SHOTS=1`: `SHOTS=1 SHOTS_DIR=/some/dir SHOTS_STAGE=stage-N npx playwright test screenshots` writes light/dark x 1440/390 PNGs of each state to `$SHOTS_DIR/<stage>/` (helper `shoot` in `helpers.ts`). Nothing is asserted and the images are not committed.
