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
    <div className="flex flex-col gap-2">
      <label htmlFor="dataset-notes" className="text-sm font-semibold">Business definitions</label>
      <Textarea
        id="dataset-notes"
        name="dataset_notes"
        value={notes}
        onChange={(e) => {
          dirty.current = true;
          setNotes(e.target.value);
          setStatus(null);
        }}
        onBlur={save}
        aria-describedby="notes-help"
        className="min-h-32"
        disabled={disabled}
      />
      <span id="notes-help" className="text-xs text-muted">Rules the analysis must follow, e.g. what counts as revenue. Saved when you click out of the box.</span>
      {status === "saving" && <p role="status" className="text-sm text-muted">Saving notes…</p>}
      {status === "saved" && <p role="status" className="text-sm text-muted">Notes saved. Applies to your next question.</p>}
      {typeof status === "object" && status && <p role="alert" className="text-sm text-danger-text">Notes not saved: {status.failed}. Click out of the field to retry.</p>}
    </div>
  );
}
