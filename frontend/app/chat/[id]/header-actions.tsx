"use client";

import { useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui";
import { useDataset } from "./dataset-context";

/** "Copy chat link" and "New chat". Opening `/` creates a Chat, so New chat is a plain <a>, never a prefetching next/link. */
export function HeaderActions() {
  const { reports, turnCount } = useDataset();
  const hasContent = reports.length > 0 || turnCount > 0; // a Chat with Tables or Turns is worth guarding
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState<"" | "ok" | "failed">("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(""), 3000);
  }

  const message = copied === "ok" ? "Link copied" : copied === "failed" ? "Could not copy the link" : "";

  return (
    <>
      {/* Out of flow (absolute, under the header's right edge) so showing it never moves the header. */}
      <span role="status" className="pointer-events-none absolute right-4 top-full z-10 mt-2">
        {copied && (
          <span className="block rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground shadow-md">{message}</span>
        )}
      </span>
      <Button variant="ghost" onClick={copy}>
        Copy chat link
      </Button>
      <a
        href="/"
        className={buttonClass("secondary")}
        onClick={(e) => {
          if (!hasContent) return; // an empty Chat just navigates
          e.preventDefault();
          dialog.current?.showModal(); // modal: the browser traps focus, restores it on close, Escape closes
        }}
      >
        New chat
      </a>
      <dialog
        ref={dialog}
        aria-label="Start a new chat?"
        onClick={(e) => e.target === dialog.current && dialog.current.close()} // a click on the backdrop
        className="m-auto w-[min(26rem,90vw)] rounded-card border border-border bg-background p-6 text-foreground shadow-md backdrop:bg-black/50"
      >
        <h2 className="font-semibold">Start a new chat?</h2>
        <p className="mt-2 text-sm text-muted">This Chat keeps its Tables and Turns, but you will need its link to come back to it.</p>
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={copy}>
            Copy link
          </Button>
          <Button variant="secondary" autoFocus onClick={() => dialog.current?.close()}>
            Cancel
          </Button>
          <a href="/" className={buttonClass("brand")}>
            New chat
          </a>
        </div>
      </dialog>
    </>
  );
}
