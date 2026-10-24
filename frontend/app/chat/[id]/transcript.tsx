"use client";

import { useEffect, useRef } from "react";
import { TurnView, type Turn } from "./turn";

const NEAR_BOTTOM = 48; // px from the bottom that still counts as "at the bottom"

/** The scrolling list of Turns. Follows new content (new Turns, streamed text, charts) unless the user has scrolled up. */
export function Transcript({ turns, onRetry, busy }: { turns: Turn[]; onRetry: (question: string) => void; busy: boolean }) {
  const scroller = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastTop = useRef(0);

  const toBottom = () => scroller.current?.scrollTo({ top: scroller.current.scrollHeight });

  useEffect(() => {
    if (!content.current || !scroller.current) return;
    const ro = new ResizeObserver(() => following.current && toBottom());
    ro.observe(content.current); // content grew (streamed text, charts)
    ro.observe(scroller.current); // viewport shrank (the composer grew)
    return () => ro.disconnect();
  }, []);

  // On load, and whenever a Turn is added (the user just asked): jump to the bottom, even from further up.
  useEffect(() => {
    following.current = true;
    toBottom();
  }, [turns.length]);

  return (
    <section
      ref={scroller}
      aria-label="Transcript"
      aria-live="polite" // announces the status line and the finished Answer; streamed text is aria-hidden (see turn.tsx)
      tabIndex={0} // keyboard users can scroll it
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        // Only scrolling *up* stops following: our own scroll-to-bottom can look "far from the bottom" if content grew meanwhile.
        if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM) following.current = true;
        else if (el.scrollTop < lastTop.current) following.current = false;
        lastTop.current = el.scrollTop;
      }}
    >
      <div ref={content} className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
        {turns.map((t, i) => (
          // The As-of Date chip shows only when the date differs from the previous Turn's (the first Turn always shows it).
          <TurnView key={t.id} turn={t} showAsOf={t.asOfDate !== turns[i - 1]?.asOfDate} onRetry={() => onRetry(t.question)} retryDisabled={busy} />
        ))}
      </div>
    </section>
  );
}
