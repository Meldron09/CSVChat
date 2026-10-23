export type Turn = {
  id: number;
  question: string;
  asOfDate: string;
  steps: string[]; // progress messages in arrival order
  queries: { subQuestion: string; sql: string }[];
  text: string; // streamed token by token, replaced by the final Answer text
  status: "running" | "done" | "error";
  error?: string;
};

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
          <summary className="cursor-pointer text-xs text-zinc-500">SQL: {q.subQuestion}</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs">{q.sql}</pre>
        </details>
      ))}
      {turn.text && <p className="whitespace-pre-wrap rounded border border-zinc-300 px-3 py-2">{turn.text}</p>}
      {turn.status === "error" && (
        <p role="alert" className="text-red-600">
          {turn.error}
        </p>
      )}
    </article>
  );
}
