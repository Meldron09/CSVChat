"use client";

import { createContext, useEffect, useState, type ReactNode } from "react";
import type { ChatEvent } from "@/lib/api";
import { readSse } from "@/lib/sse";
import { TurnView, type Turn } from "./turn";

/** The browser's local today as YYYY-MM-DD. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Lets the upload panel (a child) set the As-of Date, e.g. when the sample dataset loads. */
export const SetAsOfDate = createContext<(date: string) => void>(() => {});

/** Header (with the As-of Date), `children` (the upload panel), transcript (saved turns, then this page session's), and message box. */
export function ChatPanel({ chatId, savedAsOf, initialTurns, children }: { chatId: string; savedAsOf: string | null; initialTurns: Turn[]; children: ReactNode }) {
  const [asOfDate, setAsOfDateState] = useState(savedAsOf ?? ""); // else filled after mount: the server doesn't know the browser's today
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>(initialTurns); // the saved transcript; new turns append
  const busy = turns.some((t) => t.status === "running");

  // Edits are saved on the Chat too (blank clears it); every message still carries the date.
  const setAsOfDate = (date: string) => {
    setAsOfDateState(date);
    fetch(`/api/chats/${chatId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ as_of_date: date || null }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (!savedAsOf) setAsOfDateState(today());
  }, [savedAsOf]);

  const update = (id: number, change: (t: Turn) => Partial<Turn>) =>
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...change(t) } : t)));

  function apply(id: number, { event, data }: ChatEvent) {
    if (event === "step") update(id, (t) => ({ steps: [...t.steps, data.message] }));
    else if (event === "sql") update(id, (t) => ({ queries: [...t.queries, { task: data.task, subQuestion: data.sub_question, sql: data.sql }] }));
    else if (event === "token") update(id, (t) => ({ text: t.text + data.text }));
    else if (event === "answer") update(id, () => ({ text: data.text, charts: data.charts, status: "done" }));
    else if (event === "error") update(id, () => ({ status: "error", error: data.message }));
  }

  async function ask() {
    const id = turns.length;
    const q = question.trim();
    setQuestion("");
    setTurns((all) => [...all, { id, question: q, asOfDate, steps: [], queries: [], text: "", status: "running" }]);
    try {
      // the As-of Date is sent with every message
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, as_of_date: asOfDate }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.detail === "string" ? body.detail : `Request failed (${res.status})`);
      }
      for await (const frame of readSse(res.body)) apply(id, frame as ChatEvent);
      update(id, (t) => (t.status === "running" ? { status: "error", error: "The connection closed before the answer finished." } : {}));
    } catch (e) {
      update(id, () => ({ status: "error", error: e instanceof Error ? e.message : String(e) }));
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">CSVChat</h1>
          <p className="mt-2 text-sm text-zinc-500">Chat {chatId}</p>
        </div>
        <label className="flex flex-col text-sm">
          As-of Date
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            required
            className="rounded border border-zinc-400 p-1"
          />
        </label>
      </header>
      <SetAsOfDate value={setAsOfDate}>{children}</SetAsOfDate>
      <section className="mt-8 flex flex-col gap-6" aria-label="Transcript">
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} />
        ))}
      </section>
      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your data"
          aria-label="Question"
          className="flex-1 rounded border border-zinc-400 p-2 text-sm"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !question.trim()} // a blank As-of Date is allowed: the Orchestrator asks for it
          className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Working…" : "Ask"}
        </button>
      </form>
    </>
  );
}
