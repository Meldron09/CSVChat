"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { AsOfDateField } from "./as-of-date";

const ID = "dataset-sidebar";
const LG = "(min-width: 1024px)"; // Tailwind's `lg`

/** Header button that opens the sidebar as a drawer (below `lg` only). */
export function OpenSidebarButton() {
  return (
    <Button variant="secondary" className="px-3 py-1 lg:hidden" onClick={() => (document.getElementById(ID) as HTMLDialogElement).showModal()}>
      Dataset
    </Button>
  );
}

/**
 * The Dataset sidebar. One native <dialog>: from `lg` up it is always shown, in flow, beside the chat pane;
 * below `lg` it is hidden until OpenSidebarButton opens it modally (the browser traps focus, restores it on close, Escape closes).
 * `children` is the Dataset content (upload, relationships, reports, notes).
 */
export function DatasetSidebar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  // A drawer left open while the window grows to `lg` would stay modal over the now-static sidebar.
  useEffect(() => {
    const mq = window.matchMedia(LG);
    const close = () => mq.matches && ref.current?.close();
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, []);

  return (
    <dialog
      ref={ref}
      id={ID}
      aria-label="Dataset"
      onClick={(e) => e.target === ref.current && ref.current.close()} // a click on the backdrop
      className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(24rem,90vw)] overflow-y-auto border-r border-border bg-background p-4 text-foreground backdrop:bg-black/50 lg:static lg:block lg:h-auto lg:w-96 lg:shrink-0 lg:bg-surface"
    >
      <div className="mb-4 flex items-center justify-between lg:hidden">
        <h2 className="font-semibold">Dataset</h2>
        <Button variant="secondary" className="px-3 py-1" onClick={() => ref.current?.close()}>
          Close
        </Button>
      </div>
      <AsOfDateField />
      {children}
    </dialog>
  );
}
