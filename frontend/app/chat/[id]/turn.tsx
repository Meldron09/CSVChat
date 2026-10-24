import { Button } from "@/components/ui";
import type { TranscriptTurn } from "@/lib/api";
import type { ChartSpec } from "@/lib/chart-spec";
import { formatDate } from "./as-of-date";
import { ChartView } from "./chart";
import { AnswerMarkdown } from "./markdown";
import { SqlBlock } from "./sql-block";

export type Step = { message: string; task?: number }; // task: 0-based parallel SQL Analyst index, absent for shared steps

export type Turn = {
  id: number;
  question: string;
  asOfDate: string | null; // null/blank: the Chat had no As-of Date when asked
  steps: Step[]; // progress messages in arrival order
  queries: { task: number; subQuestion: string; sql: string }[];
  charts?: ChartSpec[]; // Chart Specs, only from the final answer event
  text: string; // streamed token by token, replaced by the final Answer text
  status: "running" | "done" | "error";
  error?: string;
};

/** A turn from the saved transcript: finished (or failed: no answer, the error text and the SQL seen), so no progress steps. */
export function fromTranscript(t: TranscriptTurn, id: number): Turn {
  const queries = t.queries.map((q) => ({ task: q.task, subQuestion: q.sub_question, sql: q.sql }));
  const turn: Turn = { id, question: t.question, asOfDate: t.as_of_date, steps: [], queries, charts: t.charts, text: t.answer, status: "done" };
  return t.error ? { ...turn, status: "error", error: t.error } : turn;
}

/** Steps and SQL grouped by task: shared steps first, then each task in order. */
function HowAnswered({ turn }: { turn: Turn }) {
  const tasks = [...new Set([...turn.steps, ...turn.queries].map((x) => x.task).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);
  const shared = turn.steps.filter((s) => s.task === undefined);
  const steps = (list: Step[]) =>
    list.length > 0 && (
      <ol className="list-decimal pl-5 text-muted">
        {list.map((s, i) => <li key={i}>{s.message}</li>)}
      </ol>
    );
  return (
    <details className="group">
      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-sm font-semibold text-brand [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 3 5 5-5 5" /></svg>
        How this was answered
      </summary>
      <div className="flex flex-col gap-4 border-l border-border pl-4 text-sm">
        {steps(shared)}
        {tasks.map((task) => {
          const queries = turn.queries.filter((q) => q.task === task);
          return (
            <section key={task} aria-label={`Task ${task + 1}`} className="flex flex-col gap-1">
              <h3 className="font-semibold">Task {task + 1}{queries[0] && `: ${queries[0].subQuestion}`}</h3>
              {steps(turn.steps.filter((s) => s.task === task))}
              {queries.map((q, i) => <SqlBlock key={i} sql={q.sql} />)}
            </section>
          );
        })}
      </div>
    </details>
  );
}

const Check = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-1 size-4 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8.5 3.5 3.5L13 4.5" /></svg>
);
// A ring with one dark quarter; it turns, and under reduced motion (globals.css switches animations off) it stays a static ring.
const Spinner = () => <span aria-hidden="true" className="mt-1 size-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-brand" />;

/** The progress of a running Turn: every step so far, the last one marked as in progress. Inside the Transcript's live region. */
function Checklist({ steps }: { steps: Step[] }) {
  const list = steps.length > 0 ? steps : [{ message: "Starting" }];
  return (
    <ol className="flex flex-col gap-1 text-sm text-muted">
      {list.map((s, i) => {
        const current = i === list.length - 1;
        return (
          <li key={i} className="flex gap-2" aria-current={current ? "step" : undefined}>
            {current ? <Spinner /> : <Check />}
            <span>
              {s.message}
              {/* Only the step in progress ends in an ellipsis; it goes when the step completes (a removal, so the list is not re-announced). */}
              {current && "…"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function TurnView({ turn, showAsOf, onRetry, retryDisabled }: { turn: Turn; showAsOf: boolean; onRetry: () => void; retryDisabled: boolean }) {
  const running = turn.status === "running";
  const answer = turn.text && <div className="text-base"><AnswerMarkdown>{turn.text}</AnswerMarkdown></div>;
  return (
    <article className="flex flex-col gap-4" aria-label={`Question: ${turn.question}`}>
      <div className="flex max-w-[85%] flex-col items-end gap-1 self-end">
        <p className="whitespace-pre-wrap break-words rounded-card border border-border bg-surface px-4 py-2 text-base">{turn.question}</p>
        {showAsOf && turn.asOfDate && <span className="rounded-chip bg-surface px-2 py-0.5 text-xs text-muted">As of {formatDate(turn.asOfDate)}</span>}
      </div>
      {running ? (
        <>
          <Checklist steps={turn.steps} />
          {/* Streamed text is hidden from assistive tech: the finished Answer (a new node) is announced instead of every token. */}
          {turn.text && <div key="streaming" aria-hidden="true">{answer}</div>}
        </>
      ) : (
        <div key="answer" className="flex flex-col gap-4">
          {answer}
          {turn.charts?.map((spec, i) => <ChartView key={i} spec={spec} />)}
        </div>
      )}
      {!running && (turn.steps.length > 0 || turn.queries.length > 0) && <HowAnswered turn={turn} />}
      {turn.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-l-2 border-danger pl-3 text-base text-danger-text">
          <p>This question failed: {turn.error}</p>
          <Button variant="secondary" onClick={onRetry} disabled={retryDisabled}>Retry</Button>
        </div>
      )}
    </article>
  );
}
