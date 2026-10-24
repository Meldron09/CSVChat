"use client";

import { useState } from "react";
import type { CleaningReport, SchemaProfile } from "@/lib/api";
import { Button, Card } from "@/components/ui";
import { useAsOfDate } from "./as-of-date";
import { NotesEditor } from "./notes-editor";

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
        const loaded = fresh.length > 0 ? ` (${fresh.length} earlier file(s) were loaded; their reports are below)` : "";
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
      {profile && <Profile profile={profile} />}
      <div className="mt-6 flex flex-col gap-4">
        {reports.map((r) => (
          <Report key={r.table} report={r} />
        ))}
      </div>
    </section>
  );
}

function Profile({ profile }: { profile: SchemaProfile }) {
  return (
    <Card as="article" className="mt-6 text-sm" aria-label="Relationships">
      <h2 className="font-semibold">Relationships</h2>
      {profile.relationships.length === 0 ? (
        <p className="mt-1 text-muted">No relationships found between the {profile.tables.length} table(s).</p>
      ) : (
        <ul className="mt-1 list-disc pl-5">
          {profile.relationships.map((r) => (
            <li key={`${r.from_table}.${r.from_column}>${r.to_table}`}>
              {r.from_table}.{r.from_column} → {r.to_table}.{r.to_column}{" "}
              <span className="text-muted">
                ({r.cardinality === "one_to_one" ? "one-to-one" : "many-to-one"}, {Math.round(r.match * 100)}% of values match)
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer font-medium">Schema Profile (what the agents see)</summary>
        {profile.tables.map((t) => (
          <div key={t.name} className="mt-2">
            <h3 className="font-medium">
              {t.name} <span className="font-normal text-muted">({t.row_count.toLocaleString()} rows)</span>
            </h3>
            <ul className="pl-3 text-xs">
              {t.columns.map((c) => (
                <li key={c.name} className="break-all">
                  {c.name} <span className="text-muted">{c.type}</span>
                  {c.samples.length > 0 && <span className="text-muted"> e.g. {c.samples.join(" | ")}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </Card>
  );
}

function Report({ report: r }: { report: CleaningReport }) {
  return (
    <Card as="article" className="text-sm" aria-label={`Cleaning Report for ${r.table}`}>
      <h2 className="font-semibold">
        {r.table} <span className="font-normal text-muted">({r.filename})</span>
        {r.replaced && <span className="ml-2 text-xs text-warning">replaced earlier Table</span>}
      </h2>
      <p className="mt-1 text-muted">
        {r.rows_loaded.toLocaleString()} rows loaded of {r.rows_read.toLocaleString()} read ·{" "}
        {r.duplicates_removed.toLocaleString()} duplicate rows removed · {r.encoding} · delimiter {JSON.stringify(r.delimiter)}
      </p>
      {r.duplicates_removed > 0 && <p className="text-xs text-muted">Duplicates: {r.duplicates_basis}.</p>}
      <table className="mt-3 w-full text-left">
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
