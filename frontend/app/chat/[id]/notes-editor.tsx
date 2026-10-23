"use client";

import { useState } from "react";

/** Dataset Notes box (also submitted with the upload form) plus a Save button: notes stay editable any time. */
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
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setStatus("Saving…");
    try {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataset_notes: notes }),
      });
      setStatus(res.ok ? "Saved. Applies to your next question." : `Save failed (${res.status})`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <textarea
        name="dataset_notes"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setStatus(null);
        }}
        aria-label="Dataset Notes"
        placeholder="Dataset Notes (optional): business definitions the analysis must follow, e.g. what counts as revenue"
        className="min-h-20 rounded border border-zinc-400 p-2 text-sm"
        disabled={disabled}
      />
      <div className="flex items-center gap-3 text-sm">
        <button type="button" onClick={save} disabled={disabled} className="rounded border border-zinc-400 px-3 py-1 disabled:opacity-60">
          Save notes
        </button>
        {status && <span role="status" className="text-zinc-500">{status}</span>}
      </div>
    </>
  );
}
