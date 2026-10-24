"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui";
import { useAsOfDate } from "./as-of-date";
import { useDataset } from "./dataset-context";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-24" -> "24 Oct 2026", from the string itself (a Date would shift it by the time zone). */
function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  return y && month && d ? `${Number(d)} ${month} ${y}` : iso;
}

/**
 * The message box, pinned under the Transcript: Enter sends, Shift+Enter adds a newline, grows with its text, disabled while `busy`
 * or until a Table exists (with a hint). The As-of Date chip edits the same date as the sidebar's field.
 */
export function Composer({ busy, onSend, box }: { busy: boolean; onSend: (question: string) => void; box: RefObject<HTMLTextAreaElement | null> }) {
  const [question, setQuestion] = useState("");
  const { asOfDate, setAsOfDate } = useAsOfDate();
  const { hasTables } = useDataset();
  const hadFocus = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const off = busy || !hasTables;

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

  const pickDate = () => {
    try {
      picker.current?.showPicker();
    } catch {
      picker.current?.focus(); // no showPicker (or not allowed here): the focused date field takes keyboard input
    }
  };

  return (
    <form
      className="shrink-0 bg-background"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {/* same column as the Transcript's content */}
      <div className="mx-auto max-w-4xl px-4 pb-4 pt-2 sm:px-8 sm:pb-6">
        <div
          className={`flex flex-col gap-2 rounded-card border p-3 shadow-md sm:p-4 ${off ? "border-dashed border-border-strong bg-surface" : "border-border bg-background"}`}
        >
          <textarea
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
            className="max-h-48 min-h-11 w-full resize-none rounded-control bg-transparent px-1 py-2 text-base text-foreground placeholder:text-muted disabled:cursor-not-allowed disabled:text-muted"
            disabled={off}
            aria-describedby={hasTables ? undefined : "composer-hint"}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="relative">
              <button
                type="button"
                onClick={pickDate}
                className={`inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold text-foreground ${off ? "bg-background" : "bg-surface"}`}
              >
                {asOfDate ? `As of ${formatDate(asOfDate)}` : "No as-of date"}
              </button>
              {/* Under the chip so the native picker opens beside it; not a second tab stop (the chip is the control). */}
              <input
                ref={picker}
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                aria-label="Pick a date"
                tabIndex={-1}
                className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
              />
            </span>
            <Button type="submit" variant={off ? "neutral" : "primary"} disabled={off || !question.trim()} /* a blank As-of Date is allowed: the Orchestrator asks for it */>
              {busy ? "Working…" : "Ask"}
            </Button>
          </div>
        </div>
        {!hasTables && (
          <p id="composer-hint" className="mt-2 text-sm text-muted">
            Add data to start asking: drop CSV files above or load the sample dataset.
          </p>
        )}
      </div>
    </form>
  );
}
