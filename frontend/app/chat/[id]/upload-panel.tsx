"use client";

import { useState } from "react";
import type { CleaningReport } from "@/lib/api";

export function UploadPanel({
  chatId,
  initialReports,
  initialNotes,
}: {
  chatId: string;
  initialReports: CleaningReport[];
  initialNotes: string;
}) {
  const [reports, setReports] = useState(initialReports);
  const [notes, setNotes] = useState(initialNotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${chatId}/files`, { method: "POST", body: new FormData(form) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Upload failed (${res.status})`);
      const fresh: CleaningReport[] = body.reports;
      setReports((old) => [...old.filter((r) => !fresh.some((f) => f.table === r.table)), ...fresh]);
      (form.elements.namedItem("files") as HTMLInputElement).value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          upload(e.currentTarget);
        }}
      >
        <input type="file" name="files" accept=".csv" multiple required disabled={busy} />
        <textarea
          name="dataset_notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Dataset Notes (optional): business definitions the analysis must follow, e.g. what counts as revenue"
          className="min-h-20 rounded border border-zinc-400 p-2 text-sm"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Cleaning and loading…" : "Upload CSVs"}
        </button>
      </form>
      {busy && <p role="status" className="mt-3 text-sm text-zinc-500">Ingesting files, this can take a while for large CSVs.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex flex-col gap-4">
        {reports.map((r) => (
          <Report key={r.table} report={r} />
        ))}
      </div>
    </section>
  );
}

function Report({ report: r }: { report: CleaningReport }) {
  return (
    <article className="rounded border border-zinc-300 p-4 text-sm" aria-label={`Cleaning Report for ${r.table}`}>
      <h2 className="font-semibold">
        {r.table} <span className="font-normal text-zinc-500">({r.filename})</span>
        {r.replaced && <span className="ml-2 text-xs text-amber-600">replaced earlier Table</span>}
      </h2>
      <p className="mt-1 text-zinc-500">
        {r.rows_loaded.toLocaleString()} rows loaded of {r.rows_read.toLocaleString()} read ·{" "}
        {r.duplicates_removed.toLocaleString()} duplicate rows removed · {r.encoding} · delimiter {JSON.stringify(r.delimiter)}
      </p>
      <table className="mt-3 w-full text-left">
        <thead>
          <tr className="text-zinc-500">
            <th>Column</th><th>Type</th><th>Nulls (kept)</th><th>Values trimmed</th>
          </tr>
        </thead>
        <tbody>
          {r.columns.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td><td>{c.type}</td><td>{c.nulls}</td><td>{c.values_trimmed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.outliers.length > 0 && (
        <div className="mt-3">
          <h3 className="font-medium">Flagged, not removed</h3>
          <ul className="mt-1 list-disc pl-5">
            {r.outliers.map((o) => (
              <li key={`${o.column}-${o.rule}`}>
                <b>{o.column}</b>:{" "}
                {o.rule === "iqr"
                  ? `${o.count} outliers outside ${o.lower?.toFixed(2)} to ${o.upper?.toFixed(2)} (IQR)`
                  : `${o.count} non-positive values`}
                <span className="block break-all text-xs text-zinc-500">
                  e.g. {o.samples.slice(0, 2).map((s) => JSON.stringify(s)).join(" ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
