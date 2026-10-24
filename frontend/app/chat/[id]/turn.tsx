import { Button, Card } from "@/components/ui";
import type { TranscriptTurn } from "@/lib/api";
import type { ChartSpec } from "@/lib/chart-spec";
import { ChartView } from "./chart";
import { AnswerMarkdown } from "./markdown";

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
    <Card as="details" className="p-2">
      <summary className="cursor-pointer text-xs text-muted">How this was answered</summary>
      <div className="mt-2 flex flex-col gap-3 text-xs">
        {steps(shared)}
        {tasks.map((task) => {
          const queries = turn.queries.filter((q) => q.task === task);
          return (
            <section key={task} aria-label={`Task ${task + 1}`} className="flex flex-col gap-1">
              <h3 className="font-semibold">Task {task + 1}{queries[0] && `: ${queries[0].subQuestion}`}</h3>
              {steps(turn.steps.filter((s) => s.task === task))}
              {queries.map((q, i) => <pre key={i} className="overflow-x-auto whitespace-pre-wrap rounded-control bg-background p-2">{q.sql}</pre>)}
            </section>
          );
        })}
      </div>
    </Card>
  );
}

export function TurnView({ turn, showAsOf, onRetry, retryDisabled }: { turn: Turn; showAsOf: boolean; onRetry: () => void; retryDisabled: boolean }) {
  const running = turn.status === "running";
  const answer = turn.text && <Card as="div" className="px-3 py-2"><AnswerMarkdown>{turn.text}</AnswerMarkdown></Card>;
  return (
    <article className="flex flex-col gap-3 text-sm" aria-label={`Question: ${turn.question}`}>
      <p className="self-end rounded-card bg-accent px-3 py-2 text-accent-foreground">
        {turn.question}
        {showAsOf && turn.asOfDate && <span className="ml-2 rounded-full border border-current px-2 text-xs opacity-80">as of {turn.asOfDate}</span>}
      </p>
      {running ? (
        <>
          {/* One status line; the Transcript's polite live region announces it as it changes. */}
          <p className="text-muted">{turn.steps.at(-1)?.message ?? "Starting"}…</p>
          {/* Streamed text is hidden from assistive tech: the finished Answer (a new node) is announced instead of every token. */}
          {turn.text && <div key="streaming" aria-hidden="true">{answer}</div>}
        </>
      ) : (
        <div key="answer" className="flex flex-col gap-3">
          {answer}
          {turn.charts?.map((spec, i) => <ChartView key={i} spec={spec} />)}
        </div>
      )}
      {!running && (turn.steps.length > 0 || turn.queries.length > 0) && <HowAnswered turn={turn} />}
      {turn.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-danger">
          <p>This question failed: {turn.error}</p>
          <Button variant="secondary" onClick={onRetry} disabled={retryDisabled}>Retry</Button>
        </div>
      )}
    </article>
  );
}
