"use client";

import { useState } from "react";
import { useDataset } from "./dataset-context";
import { NotesEditor } from "./notes-editor";
import { TablesList } from "./tables-list";

/** The Dataset sidebar's content: add data (a drop strip with the sample link under it), upload status and errors, Notes, Tables. */
export function UploadPanel({ chatId }: { chatId: string }) {
  const { reports, profile, notes, setNotes, processing, error, upload, loadSample } = useDataset();
  const [over, setOver] = useState(false);
  const busy = processing !== null;

  return (
    <section className="mt-6 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Data</h2>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (!busy) upload(Array.from(e.dataTransfer.files));
          }}
          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-dashed px-3 py-3 text-sm transition-colors has-[:disabled]:cursor-default has-[:disabled]:opacity-60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${over ? "border-brand bg-background" : "border-border-strong"}`}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16" />
          </svg>
          <span>
            Drop CSV files here, or <span className="font-semibold text-brand underline">choose files</span>
          </span>
          <input
            type="file"
            accept=".csv"
            multiple
            aria-label="CSV files"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              upload(Array.from(e.target.files ?? []));
              e.target.value = ""; // so choosing the same file again still fires
            }}
          />
        </label>
        <button
          type="button"
          onClick={loadSample}
          disabled={busy}
          className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-brand underline transition-colors enabled:hover:text-brand/80 disabled:opacity-60"
        >
          Load sample dataset
        </button>
        {busy && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-brand" />
            <span className="break-all">Cleaning and loading {processing.join(", ")}…</span>
          </p>
        )}
        {error && <p role="alert" className="text-sm text-danger-text">{error}</p>}
      </div>
      <NotesEditor chatId={chatId} notes={notes} setNotes={setNotes} disabled={busy} />
      <TablesList reports={reports} profile={profile} />
    </section>
  );
}
