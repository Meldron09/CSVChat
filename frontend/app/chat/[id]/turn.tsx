import type { TranscriptTurn } from "@/lib/api";
import type { ChartSpec } from "@/lib/chart-spec";
import { ChartView } from "./chart";

export type Turn = {
  id: number;
  question: string;
  asOfDate: string;
  steps: string[]; // progress messages in arrival order
  queries: { task: number; subQuestion: string; sql: string }[]; // parallel tasks interleave: shown in arrival order, labelled by task
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

export function TurnView({ turn }: { turn: Turn }) {
  return (
    <article className="flex flex-col gap-3 text-sm" aria-label={`Question: ${turn.question}`}>
      <p className="self-end rounded bg-zinc-900 px-3 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900">
        {turn.question} <span className="text-xs opacity-60">(as of {turn.asOfDate})</span>
      </p>
      {turn.steps.length > 0 && (
        <ol className="list-decimal pl-5 text-zinc-500" aria-label="Progress">
          {turn.steps.map((s, i) => (
            <li key={i}>
              {s}
              {turn.status === "running" && i === turn.steps.length - 1 && "…"}
            </li>
          ))}
        </ol>
      )}
      {turn.queries.map((q, i) => (
        <details key={i} open className="rounded border border-zinc-300 p-2" aria-label="SQL query">
          <summary className="cursor-pointer text-xs text-zinc-500">Task {q.task + 1} SQL: {q.subQuestion}</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs">{q.sql}</pre>
        </details>
      ))}
      {turn.text && <p className="whitespace-pre-wrap rounded border border-zinc-300 px-3 py-2">{turn.text}</p>}
      {turn.charts?.map((spec, i) => <ChartView key={i} spec={spec} />)}
      {turn.status === "error" && (
        <p role="alert" className="text-red-600">
          This question failed: {turn.error}
        </p>
      )}
    </article>
  );
}
