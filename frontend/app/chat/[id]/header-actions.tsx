"use client";

import { useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui";
import { useChatHasContent } from "./chat-content";

/** "Copy chat link" and "New chat". Opening `/` creates a Chat, so New chat is a plain <a>, never a prefetching next/link. */
export function HeaderActions() {
  const hasContent = useChatHasContent();
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

  const message = copied === "ok" ? "Chat link copied" : copied === "failed" ? "Could not copy the link" : "";

  return (
    <>
      <span role="status" className="text-sm text-muted">
        {message}
      </span>
      <Button variant="secondary" className="px-3 py-1" onClick={copy}>
        Copy chat link
      </Button>
      <a
        href="/"
        className={buttonClass("secondary", "px-3 py-1")}
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
        className="m-auto w-[min(26rem,90vw)] rounded-card border border-border bg-background p-4 text-foreground backdrop:bg-black/50"
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
          <a href="/" className={buttonClass("primary")}>
            New chat
          </a>
        </div>
      </dialog>
    </>
  );
}
