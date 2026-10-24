"use client";

import { useState } from "react";
import type { CleaningReport, SchemaProfile } from "@/lib/api";
import { Card } from "@/components/ui";
import { TableSlideOver } from "./table-slide-over";

/** What the "n flagged" badge counts: each flagged-not-removed outlier rule, plus one if duplicate rows were removed. */
const flaggedCount = (r: CleaningReport) => r.outliers.length + (r.duplicates_removed > 0 ? 1 : 0);

/**
 * The Dataset sidebar's Tables: one row per Table (name, row count, "n flagged" badge) and a compact Relationships list.
 * Clicking a Table opens its slide-over (full Cleaning Report and Schema Profile columns).
 */
export function TablesList({ reports, profile }: { reports: CleaningReport[]; profile: SchemaProfile | null }) {
  const [openTable, setOpenTable] = useState<string | null>(null);
  const open = reports.find((r) => r.table === openTable);

  return (
    <>
      <Card as="section" className="mt-6 text-sm" aria-label="Tables">
        <h2 className="font-semibold">Tables</h2>
        {reports.length === 0 ? (
          <p className="mt-1 text-muted">No Tables yet. Upload CSV files or load the sample dataset.</p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {reports.map((r) => {
              const n = flaggedCount(r);
              return (
                <li key={r.table}>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setOpenTable(r.table)}
                    className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left hover:bg-background"
                  >
                    <span className="min-w-0 flex-1 break-all font-medium">{r.table}</span>
                    <span className="shrink-0 text-muted">{r.rows_loaded.toLocaleString()} rows</span>
                    {r.replaced && <span className="shrink-0 rounded-control border border-border-strong px-1.5 text-xs text-muted">replaced</span>}
                    {n > 0 && <span className="shrink-0 rounded-control border border-warning px-1.5 text-xs text-warning">{n} flagged</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {profile && (
        <Card as="section" className="mt-4 text-sm" aria-label="Relationships">
          <h2 className="font-semibold">Relationships</h2>
          {profile.relationships.length === 0 ? (
            <p className="mt-1 text-muted">No relationships found between the {profile.tables.length} table(s).</p>
          ) : (
            <ul className="mt-1 list-disc pl-5">
              {profile.relationships.map((r) => (
                <li key={`${r.from_table}.${r.from_column}>${r.to_table}`} className="break-all">
                  {r.from_table}.{r.from_column} → {r.to_table}.{r.to_column}{" "}
                  <span className="text-muted">({r.cardinality === "one_to_one" ? "one-to-one" : "many-to-one"})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {open && <TableSlideOver report={open} profileTable={profile?.tables.find((t) => t.name === open.table)} onClose={() => setOpenTable(null)} />}
    </>
  );
}
