"use client";

import { useState } from "react";
import type { ChatEvent } from "@/lib/api";
import { readSse } from "@/lib/sse";
import { useAsOfDate } from "./as-of-date";
import { Composer } from "./composer";
import { Transcript } from "./transcript";
import type { Turn } from "./turn";

/** The chat pane: owns the Turns and asking; renders the Transcript and the pinned Composer. */
export function ChatPane({ chatId, initialTurns }: { chatId: string; initialTurns: Turn[] }) {
  const { asOfDate } = useAsOfDate();
  const [turns, setTurns] = useState<Turn[]>(initialTurns); // the saved transcript; new turns append
  const busy = turns.some((t) => t.status === "running");

  const update = (id: number, change: (t: Turn) => Partial<Turn>) =>
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...change(t) } : t)));

  function apply(id: number, { event, data }: ChatEvent) {
    if (event === "step") update(id, (t) => ({ steps: [...t.steps, { message: data.message, task: data.task }] }));
    else if (event === "sql") update(id, (t) => ({ queries: [...t.queries, { task: data.task, subQuestion: data.sub_question, sql: data.sql }] }));
    else if (event === "token") update(id, (t) => ({ text: t.text + data.text }));
    else if (event === "answer") update(id, () => ({ text: data.text, charts: data.charts, status: "done" }));
    else if (event === "error") update(id, () => ({ status: "error", error: data.message }));
  }

  async function ask(q: string) {
    const id = turns.length;
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
    <div className="flex min-w-0 flex-1 flex-col">
      <Transcript turns={turns} onRetry={ask} busy={busy} />
      <Composer busy={busy} onSend={ask} />
    </div>
  );
}
