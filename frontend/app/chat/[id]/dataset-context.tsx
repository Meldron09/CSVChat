"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { errorMessage } from "@/lib/errors";
import type { CleaningReport, SchemaProfile } from "@/lib/api";
import { useAsOfDate } from "./as-of-date";

type Dataset = {
  reports: CleaningReport[];
  profile: SchemaProfile | null;
  notes: string;
  setNotes: (notes: string) => void;
  /** Names of the files (or "the sample dataset") being ingested; null when idle. */
  processing: string[] | null;
  error: string | null;
  upload: (files: File[]) => void;
  loadSample: () => void;
  /** At least one Table exists: the composer is enabled. */
  hasTables: boolean;
  /**
   * Turns in the Chat, reported by the chat pane. A deliberate mirror: the chat pane owns the Turns, while the sidebar-side
   * consumers (Composer's Dataset summary, header New chat guard) only need the count. Lifting Turns into this context would
   * re-render the whole sidebar on every streamed token.
   */
  turnCount: number;
  setTurnCount: (n: number) => void;
};

const DatasetContext = createContext<Dataset | null>(null);

export function useDataset() {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error("useDataset must be used inside DatasetProvider");
  return ctx;
}

/** Owns the Chat's Dataset on the client (Cleaning Reports, Schema Profile, Notes, upload state) so the sidebar and the chat pane can both read it. */
export function DatasetProvider({
  chatId,
  initialReports,
  initialProfile,
  initialNotes,
  initialTurnCount,
  children,
}: {
  chatId: string;
  initialReports: CleaningReport[];
  initialProfile: SchemaProfile | null;
  initialNotes: string;
  initialTurnCount: number;
  children: ReactNode;
}) {
  const [reports, setReports] = useState(initialReports);
  const [profile, setProfile] = useState(initialProfile);
  const [notes, setNotes] = useState(initialNotes);
  const [turnCount, setTurnCount] = useState(initialTurnCount);
  const { setAsOfDate } = useAsOfDate();
  const [processing, setProcessing] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** POST to the Chat (the files, or the bundled sample) and show the new Cleaning Reports and Relationships. */
  async function send(path: "files" | "sample", names: string[], body?: FormData) {
    if (processing) return;
    setProcessing(names);
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
      if (path === "sample") {
        setNotes(json.dataset_notes);
        setAsOfDate(json.as_of_date);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProcessing(null);
    }
  }

  const upload = (files: File[]) => {
    if (files.length === 0) return;
    const body = new FormData();
    files.forEach((f) => body.append("files", f));
    body.append("dataset_notes", notes); // still sent with the files, as the old upload form did
    send("files", files.map((f) => f.name), body);
  };

  return (
    <DatasetContext
      value={{
        reports, profile, notes, setNotes, processing, error, upload,
        loadSample: () => send("sample", ["the sample dataset"]),
        hasTables: (profile?.tables.length ?? 0) > 0,
        turnCount, setTurnCount,
      }}
    >
      {children}
    </DatasetContext>
  );
}
