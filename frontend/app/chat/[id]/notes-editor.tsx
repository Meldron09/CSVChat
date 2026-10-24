"use client";

import { useRef, useState } from "react";
import { Textarea } from "@/components/ui";
import { errorMessage } from "@/lib/errors";

type Status = "saving" | "saved" | { failed: string } | null;

/** Dataset Notes box (also submitted with the upload form). Edits are saved when the field loses focus. */
export function NotesEditor({
  chatId,
  notes,
  setNotes,
  disabled,
}: {
  chatId: string;
  notes: string;
  setNotes: (notes: string) => void;
  disabled: boolean;
}) {
  const [status, setStatus] = useState<Status>(null);
  const dirty = useRef(false); // edited since the last successful save (a failed save is retried on the next blur)

  async function save() {
    if (!dirty.current) return;
    setStatus("saving");
    try {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataset_notes: notes }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      dirty.current = false;
      setStatus("saved");
    } catch (e) {
      setStatus({ failed: errorMessage(e) });
    }
  }

  return (
    <>
      <Textarea
        name="dataset_notes"
        value={notes}
        onChange={(e) => {
          dirty.current = true;
          setNotes(e.target.value);
          setStatus(null);
        }}
        onBlur={save}
        aria-label="Dataset Notes"
        placeholder="Dataset Notes (optional): business definitions the analysis must follow, e.g. what counts as revenue"
        className="min-h-20"
        disabled={disabled}
      />
      {status === "saving" && <p role="status" className="text-sm text-muted">Saving notes…</p>}
      {status === "saved" && <p role="status" className="text-sm text-muted">Notes saved. Applies to your next question.</p>}
      {typeof status === "object" && status && <p role="alert" className="text-sm text-danger">Notes not saved: {status.failed}. Click out of the field to retry.</p>}
    </>
  );
}
