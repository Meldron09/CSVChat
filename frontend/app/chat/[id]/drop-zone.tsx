"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useDataset } from "./dataset-context";

const UploadIcon = ({ className }: { className: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16" />
  </svg>
);

/** The upload error, announced. Rendered once per screen: by the DropZone, or by the EmptyState once Tables exist (see DropZone). */
export function UploadError() {
  const { error } = useDataset();
  return error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null;
}

/**
 * Adding data: a drop zone around the `CSV files` chooser, "Load sample dataset", the upload spinner and the upload error.
 * One instance is ever rendered (R2): the large one in the main pane while the Chat has no Tables, then the sidebar strip.
 */
export function DropZone({ size }: { size: "strip" | "large" }) {
  const { processing, upload, loadSample, turnCount } = useDataset();
  const [over, setOver] = useState(false);
  const busy = processing !== null;
  const large = size === "large";

  const zone = large
    ? `flex min-h-48 flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed px-6 py-10 text-center ${over ? "border-brand bg-surface" : "border-border-strong bg-background"}`
    : `flex min-h-11 items-center gap-3 rounded-control border border-dashed px-3 py-3 text-sm ${over ? "border-brand bg-background" : "border-border-strong"}`;

  return (
    <div className={large ? "flex flex-col gap-4" : "flex flex-col gap-2"}>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) upload(Array.from(e.dataTransfer.files));
        }}
        className={`${zone} cursor-pointer transition-colors has-[:disabled]:cursor-default has-[:disabled]:opacity-60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand`}
      >
        {large ? (
          <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-surface text-brand">
            <UploadIcon className="size-6" />
          </span>
        ) : (
          <UploadIcon className="size-4 shrink-0" />
        )}
        <span className={large ? "text-base" : undefined}>
          Drop CSV files here, or <span className="font-semibold text-brand underline">choose files</span>
        </span>
        {large && <span className="text-sm text-muted">Each file becomes a table. You can add more files later.</span>}
        <input
          type="file"
          accept=".csv"
          multiple
          aria-label="CSV files"
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []));
            e.target.value = ""; // so choosing the same file again still fires
          }}
        />
      </label>
      {large ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <Button variant="secondary" onClick={loadSample} disabled={busy}>
            Load sample dataset
          </Button>
          <span>Eight tables from an online shop, to try it out.</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={loadSample}
          disabled={busy}
          className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-brand underline transition-colors enabled:hover:text-brand/80 disabled:opacity-60"
        >
          Load sample dataset
        </button>
      )}
      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-brand" />
          <span className="break-all">Cleaning and loading {processing.join(", ")}…</span>
        </p>
      )}
      {/* With Tables but no Turns the EmptyState shows the error instead: below `lg` this strip sits in the closed drawer. */}
      {(large || turnCount > 0) && <UploadError />}
    </div>
  );
}
