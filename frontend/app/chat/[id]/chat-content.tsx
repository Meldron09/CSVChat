"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Counts = { tables: number; turns: number };
const Content = createContext<{ counts: Counts; setCount: (kind: keyof Counts, n: number) => void }>({ counts: { tables: 0, turns: 0 }, setCount: () => {} });

/** What the Chat holds right now, so the header can tell an empty Chat from one with work in it. Seeded from the server render. */
export function ChatContentProvider({ initial, children }: { initial: Counts; children: ReactNode }) {
  const [counts, setCounts] = useState(initial);
  const setCount = (kind: keyof Counts, n: number) => setCounts((c) => (c[kind] === n ? c : { ...c, [kind]: n }));
  return <Content value={{ counts, setCount }}>{children}</Content>;
}

/** Components that own Tables or Turns report how many they hold, in one call. */
export function useReportCount(kind: keyof Counts, n: number) {
  const { setCount } = useContext(Content);
  useEffect(() => setCount(kind, n), [kind, n]); // setCount is a fresh closure each render; it only reads state through the updater
}

/** True once the Chat has any Tables or Turns. */
export const useChatHasContent = () => {
  const { tables, turns } = useContext(Content).counts;
  return tables > 0 || turns > 0;
};
