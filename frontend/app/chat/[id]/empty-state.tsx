"use client";

import { starterQuestions } from "@/lib/starter-questions";
import type { SchemaProfile } from "@/lib/api";
import { useDataset } from "./dataset-context";
import { DropZone, UploadError } from "./drop-zone";
import { SchemaGraph } from "./schema-graph";

const count = (n: number, noun: string) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
const list = new Intl.ListFormat("en-GB", { type: "conjunction" }); // "a, b and c", as in the mockup

/** "8 tables, 78,206 rows and 8 relationships, loaded and cleaned. Outliers are flagged, not removed." */
const datasetSummary = ({ tables, relationships }: SchemaProfile) =>
  `${count(tables.length, "table")}, ${count(tables.reduce((n, t) => n + t.row_count, 0), "row")} and ${count(relationships.length, "relationship")}, loaded and cleaned. Outliers are flagged, not removed.`;

/**
 * What the chat pane shows before the first Turn: the page's <h1>, then either the large drop zone (no Tables yet) or the
 * Dataset summary, schema graph and starter questions. The first Turn replaces all of it.
 */
export function EmptyState({ onAsk }: { onAsk: (question: string) => void }) {
  const { profile, reports, hasTables } = useDataset();

  return (
    // not announced: the transcript's live region is for Turns
    <div aria-live="off" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">Ask anything about your data.</h1>
        <p className="max-w-2xl text-muted">
          {hasTables && profile
            ? datasetSummary(profile)
            : "Add CSV files to start. Each file is cleaned and becomes a table, CSVChat works out how the tables connect, and then you can ask questions in plain language."}
        </p>
      </div>
      {hasTables && profile ? (
        <>
          <UploadError />
          <SchemaGraph profile={profile} reports={reports} />
          <section aria-labelledby="starters" className="flex flex-col gap-3">
            <h2 id="starters" className="text-base font-semibold">Start with a question</h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {starterQuestions(profile).map((q) => (
                <li key={q.question} className="flex">
                  <button
                    type="button"
                    onClick={() => onAsk(q.question)}
                    className="flex min-h-11 w-full flex-col gap-1 rounded-card border border-border bg-background px-5 py-4 text-left shadow-sm transition-colors hover:border-brand"
                  >
                    <span className="font-semibold leading-snug">{q.question}</span>
                    <span className="text-sm text-muted">{list.format(q.uses)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <DropZone size="large" />
      )}
    </div>
  );
}
