"use client";

import { useEffect, useRef } from "react";
import type { CleaningReport, SchemaProfile } from "@/lib/api";
import { Button, Card } from "@/components/ui";

type ProfileTable = SchemaProfile["tables"][number];

/**
 * A Table's slide-over: a native modal <dialog> on the right, a full-screen sheet below `sm`.
 * The browser traps focus, restores it to the Table button on close, and Escape closes it. Mounted only while open.
 */
export function TableSlideOver({ report, profileTable, onClose }: { report: CleaningReport; profileTable?: ProfileTable; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={`Table ${report.table}`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()} // a click on the backdrop
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[min(40rem,100vw)] max-w-none overflow-y-auto border-l border-border bg-background p-0 text-foreground backdrop:bg-black/50 max-sm:w-screen max-sm:border-l-0"
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{report.table}</h2>
          <Button variant="secondary" className="px-3 py-1" onClick={() => ref.current?.close()}>
            Close
          </Button>
        </div>
        <Report report={report} />
        {profileTable && <SchemaProfileColumns table={profileTable} />}
      </div>
    </dialog>
  );
}

function SchemaProfileColumns({ table: t }: { table: ProfileTable }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Schema Profile (what the agents see)</summary>
      <p className="mt-2 text-muted">{t.row_count.toLocaleString()} rows</p>
      <ul className="mt-1 pl-3 text-xs">
        {t.columns.map((c) => (
          <li key={c.name} className="break-all">
            {c.name} <span className="text-muted">{c.type}</span>
            {c.samples.length > 0 && <span className="text-muted"> e.g. {c.samples.join(" | ")}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Report({ report: r }: { report: CleaningReport }) {
  return (
    <Card as="article" className="text-sm" aria-label={`Cleaning Report for ${r.table}`}>
      <h3 className="font-semibold">
        Cleaning Report <span className="font-normal text-muted">({r.filename})</span>
        {r.replaced && <span className="ml-2 text-xs text-warning">replaced earlier Table</span>}
      </h3>
      <p className="mt-1 text-muted">
        {r.rows_loaded.toLocaleString()} rows loaded of {r.rows_read.toLocaleString()} read ·{" "}
        {r.duplicates_removed.toLocaleString()} duplicate rows removed · {r.encoding} · delimiter {JSON.stringify(r.delimiter)}
      </p>
      {r.duplicates_removed > 0 && <p className="text-xs text-muted">Duplicates: {r.duplicates_basis}.</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-muted">
              <th>Column</th><th>Type</th><th>Nulls (kept)</th><th>Values trimmed</th>
            </tr>
          </thead>
          <tbody>
            {r.columns.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td><td>{c.type}</td>
                <td>
                  {c.nulls}
                  {c.null_tokens_converted > 0 && <span className="text-muted"> ({c.null_tokens_converted} from NA/null/none-style text)</span>}
                </td>
                <td>{c.values_trimmed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.outliers.length > 0 && (
        <div className="mt-3">
          <h4 className="font-medium">Flagged, not removed</h4>
          <ul className="mt-1 list-disc pl-5">
            {r.outliers.map((o) => (
              <li key={`${o.column}-${o.rule}`}>
                <b>{o.column}</b>:{" "}
                {o.rule === "iqr"
                  ? `${o.count} outliers outside ${o.lower?.toFixed(2)} to ${o.upper?.toFixed(2)} (IQR)`
                  : `${o.count} non-positive values`}
                <span className="block break-all text-xs text-muted">
                  e.g. {o.samples.slice(0, 2).map((s) => JSON.stringify(s)).join(" ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
