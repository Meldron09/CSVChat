"use client";

import { useState } from "react";
import { useDataset } from "./dataset-context";
import { NotesEditor } from "./notes-editor";
import { TablesList } from "./tables-list";

/** The Dataset sidebar's content: add data (a drop zone with the sample option beside it), upload status and errors, Notes, Tables. */
export function UploadPanel({ chatId }: { chatId: string }) {
  const { reports, profile, notes, setNotes, processing, error, upload, loadSample, hasTables } = useDataset();
  const [over, setOver] = useState(false);
  const busy = processing !== null;
  const box = `flex items-center justify-center rounded-card border-2 border-dashed text-center text-sm ${hasTables ? "p-3" : "p-6"}`;

  return (
    <section className="mt-6 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
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
          className={`${box} cursor-pointer has-[:disabled]:cursor-default has-[:disabled]:opacity-60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${over ? "border-accent bg-background" : "border-border-strong"}`}
        >
          <span>
            Drop CSV files here or <span className="font-medium text-accent underline">choose files</span>
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
          className={`${box} border-border-strong transition-colors enabled:hover:bg-background disabled:opacity-60`}
        >
          Load sample dataset
        </button>
      </div>
      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-accent" />
          <span className="break-all">Cleaning and loading {processing.join(", ")}…</span>
        </p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <NotesEditor chatId={chatId} notes={notes} setNotes={setNotes} disabled={busy} />
      <TablesList reports={reports} profile={profile} />
    </section>
  );
}
