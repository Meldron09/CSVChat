"use client";

import { useState } from "react";
import type { CleaningReport, SchemaProfile } from "@/lib/api";
import { Button } from "@/components/ui";
import { useAsOfDate } from "./as-of-date";
import { useReportCount } from "./chat-content";
import { NotesEditor } from "./notes-editor";
import { TablesList } from "./tables-list";

export function UploadPanel({
  chatId,
  initialReports,
  initialProfile,
  initialNotes,
}: {
  chatId: string;
  initialReports: CleaningReport[];
  initialProfile: SchemaProfile | null;
  initialNotes: string;
}) {
  const [reports, setReports] = useState(initialReports);
  useReportCount("tables", reports.length);
  const [profile, setProfile] = useState(initialProfile);
  const [notes, setNotes] = useState(initialNotes);
  const { setAsOfDate } = useAsOfDate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** POST to the Chat (the form's files, or the bundled sample) and show the new Cleaning Reports and Relationships. */
  async function send(path: string, body?: FormData, form?: HTMLFormElement) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${chatId}/${path}`, { method: "POST", body });
      const json = await res.json().catch(() => null);
      // a rejected file still reports the files loaded before it: show them, whatever the status
      const fresh: CleaningReport[] = Array.isArray(json?.reports) ? json.reports : [];
      if (fresh.length > 0) {
        setProfile(json.schema_profile);
        setReports((old) => [...old.filter((r) => !fresh.some((f) => f.table === r.table)), ...fresh]);
      }
      if (!res.ok) {
        const loaded = fresh.length > 0 ? ` (${fresh.length} earlier file(s) were loaded; their Tables are listed below)` : "";
        throw new Error(`${json?.detail ?? `Upload failed (${res.status})`}${loaded}`);
      }
      if (form) (form.elements.namedItem("files") as HTMLInputElement).value = "";
      if (path === "sample") {
        setNotes(json.dataset_notes);
        setAsOfDate(json.as_of_date);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const loadSample = () => send("sample");

  return (
    <section className="mt-6">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          send("files", new FormData(e.currentTarget), e.currentTarget);
        }}
      >
        <input type="file" name="files" accept=".csv" multiple required disabled={busy} aria-label="CSV files" />
        <NotesEditor chatId={chatId} notes={notes} setNotes={setNotes} disabled={busy} />
        <div className="flex gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Cleaning and loading…" : "Upload CSVs"}
          </Button>
          <Button type="button" variant="secondary" onClick={loadSample} disabled={busy}>
            Load sample dataset
          </Button>
        </div>
      </form>
      {busy && <p role="status" className="mt-3 text-sm text-muted">Ingesting files, this can take a while for large CSVs.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <TablesList reports={reports} profile={profile} />
    </section>
  );
}
