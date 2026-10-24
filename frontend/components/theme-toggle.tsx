"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui";

const DARK = "(prefers-color-scheme: dark)";

/**
 * One icon button that toggles light <-> dark. The choice is stored; with nothing stored the page follows the OS.
 * The inline script in app/layout.tsx applies a stored choice before first paint; this only reflects and changes it.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null); // unknown until mounted (the server cannot know), so the label is neutral until then

  useEffect(() => {
    const mq = window.matchMedia(DARK);
    const read = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem("theme");
      } catch {}
      setDark(stored === "dark" || (stored !== "light" && mq.matches));
    };
    read();
    mq.addEventListener("change", read); // the OS changing matters only while nothing is stored, which read() handles
    return () => mq.removeEventListener("change", read);
  }, []);

  function toggle() {
    const next = dark ? "light" : "dark";
    setDark(next === "dark");
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
  }

  return (
    <Button variant="ghost" aria-label={dark === null ? "Switch theme" : dark ? "Switch to light theme" : "Switch to dark theme"} onClick={toggle} className="size-11 shrink-0 p-0!">
      <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {dark ? (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </Button>
  );
}
