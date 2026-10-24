"use client";

import { useId, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { flaggedCount, type CleaningReport, type SchemaProfile } from "@/lib/api";
import { PAD, layoutGraph } from "@/lib/graph-layout";
import { TableSlideOver } from "./table-slide-over";

const rows = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"}`;

/**
 * "How your tables connect": the schema graph (HTML buttons over an SVG edge layer, laid out by lib/graph-layout.ts) with a
 * visually hidden list of the Relationships, then "Worth a look" (the flagged Tables). Every Table opens its slide-over.
 * Deliberately not a named region: tests and assistive tech find the sidebar's list as the region "Tables".
 */
export function SchemaGraph({ profile, reports }: { profile: SchemaProfile; reports: CleaningReport[] }) {
  const g = useMemo(() => layoutGraph(profile), [profile]);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const open = reports.find((r) => r.table === openTable);
  const flagged = new Map(reports.map((r) => [r.table, flaggedCount(r)]));
  const flaggedReports = reports.filter((r) => flagged.get(r.table)! > 0);
  const arrow = useId();
  const titleId = useId();

  return (
    <Card pad="p-5 sm:p-8">
      <h2 id={titleId} className="text-base font-semibold">How your tables connect</h2>
      <p className="mt-1 text-sm text-muted">
        {profile.relationships.length > 0 ? "Arrows run from the many side to the one side. " : "No relationships found. "}
        Select a table for its cleaning report.
      </p>
      {/* pulled into the card's padding by the layout's outer gutter, so the nodes line up with the text above */}
      <div className="overflow-x-auto" style={{ margin: `${12 - PAD}px -20px ${-PAD / 2}px` }}>
        <div role="group" aria-labelledby={titleId} className="relative" style={{ width: g.width, height: g.height }}>
          <svg aria-hidden width={g.width} height={g.height} className="absolute inset-0">
            <defs>
              <marker id={arrow} viewBox="0 0 8 8" refX="8" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 8 4 0 8z" className="fill-muted" />
              </marker>
            </defs>
            {g.edges.map((e, i) => (
              <polyline key={i} points={e.points.join(" ")} fill="none" strokeWidth="1.25" className="stroke-muted" markerEnd={`url(#${arrow})`} />
            ))}
          </svg>
          {g.nodes.map((n) => {
            const f = flagged.get(n.name) ?? 0;
            return (
              <button
                key={n.name}
                type="button"
                aria-haspopup="dialog"
                aria-label={`${n.name}, ${rows(n.rows)}${f > 0 ? `, ${f} flagged` : ""}`}
                title={n.name}
                onClick={() => setOpenTable(n.name)}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                className={`absolute flex flex-col justify-center rounded-control border px-3 text-left shadow-sm transition-colors ${
                  n.hub ? "border-brand bg-brand text-brand-foreground enabled:hover:bg-brand/85" : "border-border-strong bg-background text-foreground hover:border-brand"
                }`}
              >
                <span className={`block truncate text-sm font-semibold leading-tight ${f > 0 ? "pr-4" : ""}`}>{n.name}</span>
                <span className={`block text-xs leading-tight ${n.hub ? "text-brand-foreground/80" : "text-muted"}`}>{rows(n.rows)}</span>
                {f > 0 && <span aria-hidden className="absolute right-3 top-[0.8rem] size-2 rounded-full bg-warning" />}
              </button>
            );
          })}
        </div>
      </div>
      <ul aria-label="Relationships" className="sr-only">
        {profile.relationships.length === 0 ? (
          <li>No relationships found.</li>
        ) : (
          profile.relationships.map((r, i) => (
            <li key={i}>
              {r.from_table}.{r.from_column} to {r.to_table}.{r.to_column}, {r.cardinality === "one_to_one" ? "one to one" : "many to one"}
            </li>
          ))
        )}
      </ul>
      <div className="mt-6 rounded-card bg-surface p-5">
        <h3 className="text-base font-semibold">Worth a look</h3>
        {flaggedReports.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Nothing flagged: no outliers or duplicate rows were found.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">Flagged rows stay in your data. Questions can still use them.</p>
            <ul className="mt-2 flex flex-col">
              {flaggedReports.map((r) => (
                <li key={r.table}>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setOpenTable(r.table)}
                    className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand underline transition-colors hover:text-brand/80"
                  >
                    <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
                    <span className="break-all">
                      {r.table}, {flagged.get(r.table)} flagged
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {open && <TableSlideOver report={open} profileTable={profile.tables.find((t) => t.name === open.table)} onClose={() => setOpenTable(null)} />}
    </Card>
  );
}
