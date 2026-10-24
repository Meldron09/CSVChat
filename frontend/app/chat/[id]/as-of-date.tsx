"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Input } from "@/components/ui";

/** The browser's local today as YYYY-MM-DD. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const AsOfDate = createContext<{ asOfDate: string; setAsOfDate: (date: string) => void }>({ asOfDate: "", setAsOfDate: () => {} });

/** The Chat's As-of Date, shared by the sidebar (edits it, e.g. when the sample loads) and the chat pane (sends it with each message). */
export const useAsOfDate = () => useContext(AsOfDate);

export function AsOfDateProvider({ chatId, savedAsOf, children }: { chatId: string; savedAsOf: string | null; children: ReactNode }) {
  const [asOfDate, setAsOfDateState] = useState(savedAsOf ?? ""); // else filled after mount: the server doesn't know the browser's today

  useEffect(() => {
    if (!savedAsOf) setAsOfDateState(today());
  }, [savedAsOf]);

  // Edits are saved on the Chat too (blank clears it); every message still carries the date.
  const setAsOfDate = (date: string) => {
    setAsOfDateState(date);
    fetch(`/api/chats/${chatId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ as_of_date: date || null }),
    }).catch(() => {});
  };

  return <AsOfDate value={{ asOfDate, setAsOfDate }}>{children}</AsOfDate>;
}

/** The editable As-of Date field (lives at the top of the sidebar). */
export function AsOfDateField() {
  const { asOfDate, setAsOfDate } = useAsOfDate();
  return (
    <label className="flex flex-col text-sm">
      As-of Date
      <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} required className="p-1" />
    </label>
  );
}
