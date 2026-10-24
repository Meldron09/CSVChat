"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

/** One SQL statement: mono, scrolls sideways instead of wrapping, with a button that copies it. */
export function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState<"" | "ok" | "failed">("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied("ok");
    } catch {
      setCopied("failed"); // no clipboard (insecure context) or permission denied
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 3000);
  }

  return (
    <div className="flex flex-col">
      <div className="-mb-1 flex items-center justify-end gap-2">
        {/* Always rendered, so the message is announced when it appears. */}
        <span role="status" className="text-sm text-muted">{copied === "ok" ? "Copied" : copied === "failed" ? "Could not copy the SQL" : ""}</span>
        <Button variant="ghost" onClick={copy}>Copy SQL</Button>
      </div>
      <pre tabIndex={0} className="overflow-x-auto whitespace-pre rounded-control border border-border bg-surface p-3 font-mono text-xs">{sql}</pre>
    </div>
  );
}
