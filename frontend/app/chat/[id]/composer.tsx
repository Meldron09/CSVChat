"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Textarea } from "@/components/ui";
import { useAsOfDate } from "./as-of-date";
import { useDataset } from "./dataset-context";

const count = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The message box, pinned under the Transcript: Enter sends, Shift+Enter adds a newline, grows with its text, disabled while `busy`
 * or until a Table exists (with a hint). While data is loaded and there are no Turns, a one-line Dataset summary shows above it.
 */
export function Composer({ busy, onSend }: { busy: boolean; onSend: (question: string) => void }) {
  const [question, setQuestion] = useState("");
  const { asOfDate } = useAsOfDate();
  const { profile, hasTables, turnCount } = useDataset();
  const box = useRef<HTMLTextAreaElement>(null);
  const hadFocus = useRef(false);

  // Auto-grow: fit the content; the CSS max-height then makes it scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [question]);

  // Disabling drops focus: give it back when the Turn finishes.
  useEffect(() => {
    if (busy) hadFocus.current = document.activeElement === box.current || document.activeElement === document.body;
    else if (hadFocus.current) box.current?.focus();
  }, [busy]);

  const send = () => {
    const q = question.trim();
    if (!q || busy || !hasTables) return;
    setQuestion("");
    onSend(q);
  };

  return (
    <form
      className="shrink-0 border-t border-border bg-background p-4"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {profile && hasTables && turnCount === 0 && (
        <p className="mx-auto mb-2 max-w-3xl text-sm text-muted">
          {count(profile.tables.length, "table")} · {count(profile.tables.reduce((n, t) => n + t.row_count, 0), "row")} ·{" "}
          {count(profile.relationships.length, "relationship")}
        </p>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          ref={box}
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask a question about your data"
          aria-label="Question"
          className="max-h-48 flex-1 resize-none"
          disabled={busy || !hasTables}
          aria-describedby={hasTables ? undefined : "composer-hint"}
        />
        <Button type="submit" disabled={busy || !hasTables || !question.trim()} /* a blank As-of Date is allowed: the Orchestrator asks for it */>
          {busy ? "Working…" : "Ask"}
        </Button>
      </div>
      {!hasTables && (
        <p id="composer-hint" className="mx-auto mt-1 max-w-3xl text-xs text-muted">
          Add data to start asking: drop CSV files or load the sample dataset in the Dataset panel.
        </p>
      )}
      <p className="mx-auto mt-1 max-w-3xl text-xs text-muted">{asOfDate ? `as of ${asOfDate}` : "no as-of date"}</p>
    </form>
  );
}
