# Frontend UX redesign: agreed design

Outcome of a design session on the `frontend/` UI. Vocabulary follows `CONTEXT.md` (Chat, Dataset, Table, Turn, Transcript, Answer, Chart Spec, Cleaning Report, Schema Profile, Dataset Notes, As-of Date).

## Where we are today

- One column, `max-w-3xl`: header, upload form, Relationships card, Cleaning Reports, Transcript, message box, stacked in that order. Every Table adds a tall Cleaning Report, so the Transcript is pushed far down and the message box is not pinned.
- Answers render as `whitespace-pre-wrap` plain text. SQL blocks are open by default between the progress steps and the Answer.
- Grey-only styling, with the button and input classes copy-pasted per file. Dark mode follows the OS, but the chart palette ignores it.
- No empty state, no way to copy the Chat link or start a new Chat, and the raw chat id is shown as text.

## Principles

- The person asking questions comes first. The Answer (text and Charts) is the hero of each Turn. SQL, Cleaning Reports and the Schema Profile stay one click away, collapsed by default, so the tool stays checkable.
- No backend changes. Only `frontend/` changes.
- Tailwind only, plus `react-markdown` and `remark-gfm`. Native `<dialog>` and `<details>`, no headless UI library.
- Not a CodeMonk deliverable: neutral palette, one accent colour.

## Decisions

### Layout (two panes)
- Left sidebar holds the Dataset: As-of Date, Tables, Relationships, Dataset Notes, add CSVs. The right pane is the Transcript with a pinned composer.
- Below `lg` the sidebar becomes a drawer (native `<dialog>`).
- Header: app name, "Copy chat link", "New chat", theme toggle (light / dark / system).

### First run
- Empty Chat: a CSV drop zone with "Load sample dataset" beside it as an equal option. The composer is disabled, with a hint, until a Table exists.
- Data loaded, no Turns yet: a one-line dataset summary above the composer ("8 tables · 12,345 rows · 7 relationships"). No suggested-question chips.
- Upload feedback: indeterminate spinner plus the file names being processed (the backend does one POST, with no progress events). Errors are inline in the sidebar. Partial failures keep today's behaviour: files loaded before a rejected one stay in the Tables list, with the "(n earlier file(s) were loaded)" note, and a replaced Table keeps its "replaced" badge.

### Turn
- While running: a single live status line with the latest step, plus the streaming Answer.
- When done: Answer (Markdown text, then Charts) is the main content. Progress steps and SQL collapse into one closed "How this was answered" disclosure, grouped by task.
- As-of Date chip shows on a Turn only when it differs from the previous Turn's.
- Answers render through `react-markdown` + `remark-gfm`. Plain text passes through unchanged, so this is safe without a backend prompt change.
- A failed Turn shows its error and a **Retry** button that re-asks the same question as a new Turn. The original failed Turn stays in the Transcript.

### Composer
- Pinned to the bottom of the chat pane. Auto-growing textarea, Enter sends, Shift+Enter adds a newline.
- A read-only "as of YYYY-MM-DD" label sits in the composer. The editable As-of Date is in the sidebar, with helper text: "'Past year' and 'last 6 months' resolve against this date".
- The Transcript auto-scrolls to the newest Turn unless the user has scrolled up.
- No Stop button (the backend has no cancel).

### Dataset sidebar and Table slide-over
- Tables list: name, row count, and an "n flagged" badge when the Cleaning Report has outliers or removed duplicates. Relationships as a compact list.
- Clicking a Table opens a right-hand slide-over (`<dialog>`, full-screen sheet on mobile) with that Table's full Cleaning Report and its columns from the Schema Profile. The "Schema Profile (what the agents see)" disclosure moves here.
- Dataset Notes autosave on blur through the existing PUT, with a small indicator that keeps the wording "Applies to your next question".

### Sharing and new Chats
- "Copy chat link" copies the `/chat/{id}` URL. No recent-Chats list.
- "New chat" confirms only when the Chat has Tables or Turns. An empty Chat just navigates. The confirmation is a native `<dialog>` with Copy link, New chat and Cancel.
- Implementation trap: `GET /` creates a Chat. "New chat" must be a plain `<a>` (or `prefetch={false}`), never a prefetched `<Link href="/">`, or stray Chats get created.

### Charts
- Theme-aware palette.
- Compact number formatting on axes and tooltips (12.4k) with locale separators.
- Rounded bar tops, softer gridlines. The legend stays multi-series only.
- No PNG export or "Copy data" this pass.

### Theme and accessibility
- Design tokens (colours, radius, spacing) in `globals.css`, and shared Button / Card / Input components replacing the copy-pasted classes.
- Theme toggle follows the OS until the user picks, then persists in `localStorage`, applied by a no-flash inline script.
- `:focus-visible` rings on all controls, `prefers-reduced-motion` respected, Transcript is `aria-live="polite"` (announce the status line and the finished Answer, not every streamed token).

## Testing

Playwright end-to-end, with everything in `frontend/tests/` (mirroring `backend/tests/`).

- **Fake backend** (small Node server in `frontend/tests/`): implements `POST /chats`, `GET/PUT /chats/{id}`, `/files`, `/sample` and the SSE `/messages`, matching the types in `lib/api.ts`. Playwright starts it and points `BACKEND_URL` at it (the Next server calls the backend server-side, so `page.route()` can't intercept those calls). It scripts a streamed Answer with a Chart, a failed Turn, and a rejected upload with partial reports.
- **Behaviour tests** against the fake backend: first run, upload and partial failure, sample load, Turn states, Retry, composer keys and scroll, As-of Date chip rule, sidebar and slide-over, Notes autosave, New chat guard, theme (light, dark, system, no flash), mobile width.
- **Smoke test** against the real stack (`docker compose`): load the sample and ask one question. Skipped unless a flag is set, because it calls the real LLM.
- No Vitest, no linter work in this pass. `npm run build` type-checks.

## Suggested slice order

0. Playwright harness: config, fake backend, one passing test of the current UI.
1. Design tokens, shared Button / Card / Input, theme toggle, two-pane shell with the existing content ported.
2. Turn redesign, Markdown, pinned composer, auto-scroll, Retry, As-of Date chip rule.
3. Dataset sidebar, Table slide-over, Notes autosave, As-of Date in sidebar and composer.
4. First-run flow (drop zone, disabled composer, dataset summary), Copy link, New chat with its guard.
5. Chart polish.

Slices 2–4 depend on slice 1. Each slice lands with its own Playwright tests.

## Deliberately out of scope (each needs a backend change)

- Result tables from the SQL Analysts.
- A Stop button (needs backend cancel).
- Generated suggested questions.
- A Synthesizer prompt tweak so Answers are consistently Markdown.

## Notes for whoever builds this

- `frontend/AGENTS.md`: this is Next 16 with breaking changes. Run `npm install` and read `node_modules/next/dist/docs/` before writing code.
- No ADR: every decision above is cheap to reverse.
