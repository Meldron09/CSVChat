"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui";

type Choice = "light" | "dark" | "system";
const CHOICES: Choice[] = ["light", "dark", "system"];

/**
 * Light / dark / system. "system" = no stored choice and no data-theme on <html>, so CSS follows the OS.
 * The inline script in app/layout.tsx applies a stored choice before first paint; this only reflects and changes it.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system"); // matches the server render; the stored choice is read after mount

  useEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") setChoice(t);
    } catch {}
  }, []);

  function pick(c: Choice) {
    setChoice(c);
    const root = document.documentElement;
    if (c === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = c;
    try {
      if (c === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", c);
    } catch {}
  }

  return (
    <div role="group" aria-label="Theme" className="flex gap-1">
      {CHOICES.map((c) => (
        <Button key={c} variant={choice === c ? "primary" : "secondary"} aria-pressed={choice === c} onClick={() => pick(c)} className="px-3 py-1 capitalize">
          {c}
        </Button>
      ))}
    </div>
  );
}
