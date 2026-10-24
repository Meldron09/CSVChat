# Frontend UX redesign: implementation summary

Implements spec #13 (tickets #14 to #23) on branch `frontend-ux-redesign`, PR #24. Frontend only: nothing in `backend/`, `db/` or `docker-compose.yml` changed. Design rationale lives in [frontend-ux-redesign.md](frontend-ux-redesign.md); how to run the tests lives in `frontend/tests/README.md`.

Result: the page is a header, a Dataset sidebar and a Chat pane with a pinned composer. Turns lead with the Answer (Markdown, then Charts) and fold progress and SQL into a closed "How this was answered" disclosure. Tables open in a slide-over, a new Chat starts with a drop zone, themes are light, dark or system, and charts follow the theme. The Playwright suite has 66 tests passing and 1 skipped (the opt-in real-stack smoke test).

## Task graph and order of delivery

```
#14 harness ─┬─ #15 tokens/theme ─┬─ #16 shell ─┬─ #19 Turn
             │                    │             ├─ #20 As-of Date + Notes
             │                    │             ├─ #21 Tables + slide-over ── #23 First-run
             │                    │             └─ #22 Copy link + New chat
             │                    └─ #17 Charts
             └─ #18 Real-stack smoke test
```

Each ticket was built by its own agent in its own worktree and merged into the PR branch. Several tickets ran in parallel; merging them together broke 7 tests written against separate branches, which were fixed in a follow-up commit (see Integration).

## Per-ticket summaries

### #14 Playwright harness and fake backend
- `@playwright/test` is pinned to 1.63.0. `npm run test:e2e` builds the frontend, starts the fake backend (port 4010) and `next start` (port 3100), and runs the suite. A production build is used so link prefetching and theme-flash behaviour are real. Setting `BACKEND_URL` skips the fake and points the frontend at another backend.
- `frontend/tests/fake-backend.mts` is a Node `http` server typed against `lib/api.ts` and `lib/chart-spec.ts`, so `next build` type-checks it against the real contract. It implements create Chat, get and update Chat, file upload, sample load and the SSE message stream, with per-Chat state, so a reload shows the saved Transcript.
- Scenarios are triggered by question keywords (`chart`, `malformed`, `fail`, `drop`, `slow`, `hello`, `busy`) and by upload filenames (`bad*` gives a 422 with partial reports; a non-`.csv` gives a 415). Notes containing `FAIL_SAVE` return a 500. Later tickets added more keywords (`multi`, `markdown`, `plain`, `tasks`, `years`) and a `slow` upload name.
- Deviation: the fake is `.mts` so Node treats it as ESM without changing the package type. Tests find failures by text because Next's route announcer is also `role=alert`.

### #15 Design tokens, shared components, theme toggle
- Tokens live in `app/globals.css` as CSS variables using `light-dark()`. `<html data-theme>` overrides the OS setting. Utilities such as `bg-surface`, `text-muted`, `border-border`, `bg-accent`, `rounded-control` and `rounded-card` come from `@theme inline`. `--chart-1` to `--chart-5` are declared for charts.
- `components/ui.tsx` holds `Button` (primary and secondary), `Card`, `Input` and `Textarea`. `components/theme-toggle.tsx` is a self-contained Light, Dark and System toggle that stores the choice in `localStorage`.
- An inline script in `<head>` applies a stored choice before first paint, with `suppressHydrationWarning` on `<html>`. A global `:focus-visible` ring covers every control, and a global reduced-motion rule turns off animations and transitions.
- Tests: following the OS, switching, persistence and no flash (the test blocks the JS bundle so only the inline script can apply the theme), stored choice beating the OS, focus rings and reduced motion.
- Deviation: `light-dark()` plus `data-theme` replaces Tailwind's `dark:` variant, so styling uses tokens rather than `dark:` classes.

### #16 Two-pane shell with pinned composer
- `page.tsx` composes the header, the Dataset sidebar and the Chat pane. The files under `app/chat/[id]/` are split by responsibility so later tickets could change different areas: `header.tsx`, `dataset-sidebar.tsx`, `as-of-date.tsx`, `upload-panel.tsx`, `chat-pane.tsx`, `transcript.tsx`, `turn.tsx` and `composer.tsx`.
- The sidebar is one native `<dialog>`: in flow from the `lg` breakpoint up, a modal drawer below it, with focus trap, focus restore and Escape handled by the browser.
- The composer is an auto-growing textarea. Enter sends, Shift+Enter adds a newline, IME composition is ignored, and it is disabled while a Turn runs. The Transcript follows new Turns and stops following once the user scrolls up.
- Tests (11) cover wide and 390px layouts, the drawer, composer keys, auto-grow, disabled-while-running, the pinned composer and auto-scroll.

### #17 Chart polish
- `chart.tsx` takes series colours from `--chart-*` and axis, grid and tooltip colours from tokens, so switching theme updates charts live. Axes and pie labels use compact numbers (12.4K) and tooltips show the full number with locale separators. Bars have rounded tops, gridlines are horizontal only and softer, and the legend appears only for more than one series. The malformed-spec notice is unchanged.
- Tests cover colours in light and dark, compact ticks and tooltips, the legend rule and the malformed notice.

### #18 Real-stack smoke test
- `tests/real-stack.spec.ts` is skipped unless `E2E_REAL_STACK` is set. `npm run test:e2e:real` sets the flag and `BACKEND_URL` (default `http://localhost:8000`) and runs only this spec. The default suite shows it as skipped.
- It loads the sample dataset, asks one question and waits for the Turn to finish. After code review it checks that the "How this was answered" disclosure appears, the composer is enabled again, no "This question failed" text is shown, and the Answer has non-empty text.
- **Not verified end to end.** The one live run against the compose stack got as far as the SQL step and then stalled: no Answer in 240 seconds, with the backend returning 200 and no errors. The cause is probably the stack's cloud-hosted model (`gpt-oss:120b-cloud`) but it was not diagnosed. The test was rewritten after that run (see Code review) and has not been run against a live stack since.

### #19 Answer-first Turn
- A running Turn shows one status line (latest step) with the streamed text hidden from screen readers. A finished Turn shows the Markdown Answer, then Charts, then a closed native `<details>` "How this was answered" with shared steps and a section per task (sub-question, steps, SQL).
- Markdown uses `react-markdown` and `remark-gfm` (new dependencies) with raw HTML disabled, so HTML in an Answer shows as literal text. GFM tables scroll horizontally, and plain-text Answers keep their line breaks.
- A failed Turn shows "This question failed: ..." and a Retry button, which adds a new Turn and keeps the failed one. Retry is disabled while another Turn runs. The As-of Date chip shows only when the date differs from the previous Turn's (the first Turn always shows it). The Transcript is an `aria-live="polite"` region.
- A resumed Chat renders saved Turns the same way, failed ones still failed.
- Tests (8) cover running, done and failed Turns, Retry, the chip rule, Markdown, plain-text passthrough and resume.

### #20 As-of Date and Dataset Notes in the sidebar
- The As-of Date field sits at the top of the sidebar with helper text saying "past year" and "last 6 months" resolve against it. A blank date is allowed. It is still saved on the Chat, sent with every message and defaults to the local today.
- The composer shows a read-only "as of <date>" line.
- Dataset Notes save when the field loses focus, only if edited since the last successful save. The indicator shows "Saving notes...", "Notes saved. Applies to your next question." or an error alert that says to click out of the field to retry. The Save button is gone.
- Limitation: a failed As-of Date save is still silent (the existing fire-and-forget request). The ticket only required a visible failure for notes.

### #21 Tables list and Table slide-over
- `tables-list.tsx` shows each Table with its row count and an "n flagged" badge, where n counts outlier flags plus one if duplicate rows were removed. A compact Relationships list has an empty message when none are found.
- `table-slide-over.tsx` is a native `<dialog>` opened with `showModal()`: a right-hand panel 40rem wide, a full-screen sheet on phones. It holds that Table's Cleaning Report and a "Schema Profile (what the agents see)" disclosure with its columns. Focus is trapped and restored, and Escape closes it, including when it sits on top of the phone drawer.
- Tests (8) cover the list, badge, relationships, open and close, placement, backdrop, keyboard behaviour and the phone sheet.

### #22 Copy chat link and New chat guard
- "Copy chat link" copies the Chat URL and shows a visible confirmation (or a failure message). "New chat" is a plain `<a href="/">`, never a prefetched Next link, because opening the root address creates a Chat. With Tables or Turns it opens a confirmation dialog (Copy link, Cancel, New chat); an empty Chat just navigates.
- `components/ui.tsx` gained `buttonClass()` so links can look like buttons.
- Tests (9) cover copy, both New chat paths and keyboard behaviour. The no-stray-Chat test asserts that loading a Chat page or hovering New chat makes no browser request to `/`. It does not count `POST /chats` on the fake, since concurrent specs create Chats on the same fake.

### #23 First-run flow
- `dataset-context.tsx` (`DatasetProvider`, `useDataset()`) holds reports, Schema Profile, notes and upload state, and `upload()` and `loadSample()` replace the old form logic with the same partial-report merge and "earlier file(s) were loaded" note.
- An empty Chat shows a drop zone and "Load sample dataset" as two equal boxes. Choosing or dropping files uploads at once. While uploading there is a spinner with the file names, and errors appear inline in the sidebar.
- The composer is disabled with a hint until a Table exists. Once data is loaded and there are no Turns, a summary line such as "8 tables · 797 rows · 1 relationship" appears above it. The "replaced" badge appears on the Table row in the list.
- Deviation: the drop zone lives in the Dataset sidebar, so on a phone a first-time user relies on the composer hint and the header's Dataset button rather than a drop zone in the Chat pane.
- Tests (9) cover the empty state, chooser and drag-and-drop uploads, spinner, rejection with partial reports, replacement, sample load and the summary line.

## Integration

- Merging #19 to #22 broke 7 tests written against separate branches: #21 removed the inline Cleaning Report that two specs looked for, and #20 and #19 together made the "as of" text appear twice. These were fixed in a follow-up commit by updating the tests to the intended behaviour.
- #23 was merged last by a merger agent, which resolved conflicts in `page.tsx`, `upload-panel.tsx` and `chat-pane.tsx`. #22 had added its own context for the table and Turn counts; that was removed so the header's New chat guard reads from `useDataset()`. `turn.spec.ts` and the header-actions spec now load the sample first, because the composer is disabled on an empty Chat.

## Code review

`/code-review` ran on PR #24 with two axes. Fixed in one follow-up commit:
- The real-stack test asserted a closing "(As-of Date used: ...)" line that the backend only adds when the Answer does not already mention the date. It now checks for a finished Turn with Answer text instead.
- The numeric X axis was compacted, so a year such as 2023 showed as "2K". Only the value axis and pie labels are compact now.
- The As-of Date chip could render with a blank date. It is now hidden for blank dates.
- Duplicated test helpers moved to `tests/helpers.ts`, the repeated error-message idiom to `lib/errors.ts`, and a shared `Badge` was added to `components/ui.tsx`.
- The root `README.md` no longer says the frontend has no tests.

Left as is, deliberately:
- Chart tooltips show the full number with locale separators, not a compact one. The ticket text can be read either way.
- The "n flagged" definition, the sidebar order, and Retry using the current As-of Date rather than the failed Turn's.
- `turnCount` is still mirrored from the Chat pane into the Dataset context. Moving Turn state there would re-render the sidebar on every streamed token, so a comment explains it.
- Native `<dialog>` class strings are repeated in three components, and `UploadPanel` is a broad name for the sidebar body.

## Known gaps and follow-ups

- The real-stack smoke test has not passed against a live stack (see #18).
- The backend's `NO_AS_OF_REPLY` still says to set the As-of Date "in the header"; it is now in the sidebar. This is a backend string and out of scope.
- Header still shows the raw Chat id as text.
