"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ChatEvent } from "@/lib/api";
import { readSse } from "@/lib/sse";
import { TurnView, type Turn } from "./turn";

/** The browser's local today as YYYY-MM-DD. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Header (with the As-of Date), `children` (the upload panel), transcript of this page session, and message box. */
export function ChatPanel({ chatId, children }: { chatId: string; children: ReactNode }) {
  const [asOfDate, setAsOfDate] = useState(""); // filled after mount: the server doesn't know the browser's today
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const busy = turns.some((t) => t.status === "running");

  useEffect(() => setAsOfDate(today()), []);

  const update = (id: number, change: (t: Turn) => Partial<Turn>) =>
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...change(t) } : t)));

  function apply(id: number, { event, data }: ChatEvent) {
    if (event === "step") update(id, (t) => ({ steps: [...t.steps, data.message] }));
    else if (event === "sql") update(id, (t) => ({ queries: [...t.queries, { subQuestion: data.sub_question, sql: data.sql }] }));
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
      {children}
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
          disabled={busy || !asOfDate || !question.trim()}
          className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Working…" : "Ask"}
        </button>
      </form>
    </>
  );
}
