"use client";

import { useState } from "react";
import { flaggedCount, type CleaningReport, type SchemaProfile } from "@/lib/api";
import { Badge, Card } from "@/components/ui";
import { TableSlideOver } from "./table-slide-over";

/**
 * The Dataset sidebar's Tables: one row per Table (name, row count, "n flagged" badge). Relationships are in the main pane's schema graph.
 * Clicking a Table opens its slide-over (full Cleaning Report and Schema Profile columns).
 */
export function TablesList({ reports, profile }: { reports: CleaningReport[]; profile: SchemaProfile | null }) {
  const [openTable, setOpenTable] = useState<string | null>(null);
  const open = reports.find((r) => r.table === openTable);

  return (
    <>
      <section aria-label="Tables" className="flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold">Tables</h2>
          {reports.length > 0 && <span className="text-muted">{reports.reduce((n, r) => n + r.rows_loaded, 0).toLocaleString("en-US")} rows</span>}
        </div>
        <Card pad="p-2">
          {reports.length === 0 ? (
            <p className="px-2 py-1 text-muted">No Tables yet. Upload CSV files or load the sample dataset.</p>
          ) : (
            <ul className="flex flex-col">
              {reports.map((r) => {
                const n = flaggedCount(r);
                return (
                  <li key={r.table}>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setOpenTable(r.table)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface"
                    >
                      <span className="min-w-0 flex-1 break-all font-semibold">{r.table}</span>
                      {r.replaced && <Badge>replaced</Badge>}
                      {n > 0 && <Badge tone="warning">{n} flagged</Badge>}
                      <span className="shrink-0 text-right tabular-nums text-muted">
                        {r.rows_loaded.toLocaleString("en-US")}
                        <span className="sr-only"> rows</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
      {open && <TableSlideOver report={open} profileTable={profile?.tables.find((t) => t.name === open.table)} onClose={() => setOpenTable(null)} />}
    </>
  );
}
