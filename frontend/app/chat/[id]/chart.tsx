"use client";

import { Component, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { CHART_TYPES, type ChartSpec } from "@/lib/chart-spec";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Theme tokens from globals.css (light-dark()), so SVG colours follow the theme live. Series beyond five reuse the palette.
const COLORS = [1, 2, 3, 4, 5].map((n) => `var(--chart-${n})`);
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
const axisFmt = (v: unknown) => (typeof v === "number" ? compact.format(v) : String(v));
const tipFmt = (v: unknown) => (typeof v === "number" ? full.format(v) : String(v));
const axisProps = { tick: { fill: "var(--muted)", fontSize: 12 }, stroke: "var(--border)" };
const labelStyle = { fill: "var(--muted)", fontSize: 12, textAnchor: "middle" } as const;
const grid = <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />;
// Hover highlight (bar column / line cursor) in tokens; recharts would otherwise draw its own grey.
const cursor = { stroke: "var(--border-strong)", fill: "var(--border)", fillOpacity: 0.4 };
const tooltip = (extra?: object) => (
  <Tooltip
    cursor={cursor}
    formatter={tipFmt}
    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--foreground)" }}
    itemStyle={{ color: "var(--foreground)" }}
    labelStyle={{ color: "var(--muted)" }}
    {...extra}
  />
);
const legend = (extra?: object) => <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: "var(--foreground)" }}>{v}</span>} {...extra} />;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";

/** The spec if it is well formed enough to draw, else null (the backend validates too; this keeps a bad spec from crashing the page). */
export function parseSpec(raw: unknown): ChartSpec | null {
  if (!isObj(raw) || !(CHART_TYPES as readonly unknown[]).includes(raw.type)) return null;
  const { title, x_key, x_label, y_label, series, data } = raw;
  if (!isStr(title) || !isStr(x_key) || !isStr(x_label) || !isStr(y_label)) return null;
  if (!Array.isArray(series) || series.length === 0 || !series.every((s) => isObj(s) && isStr(s.key) && isStr(s.label))) return null;
  if (!Array.isArray(data) || data.length === 0 || !data.every(isObj)) return null;
  // like the backend: every row has an x value and every series has at least one numeric value (else it draws nothing)
  if (!data.every((r) => r[x_key] != null)) return null;
  if (!series.every((s) => data.some((r) => typeof r[s.key as string] === "number"))) return null;
  return raw as ChartSpec;
}

function Plot({ spec }: { spec: ChartSpec }) {
  const { type, x_key, x_label, y_label, series, data } = spec;
  const xAxis = (extra?: object) => (
    <XAxis dataKey={x_key} label={{ value: x_label, position: "insideBottom", offset: -8, style: labelStyle }} height={50} {...axisProps} {...extra} />
  );
  // Only value (Y) axes are compact; X labels render as-is (a numeric x_key such as a year must stay "2023").
  const yAxis = (extra?: object) => <YAxis label={{ value: y_label, angle: -90, position: "insideLeft", style: labelStyle }} width={70} tickFormatter={axisFmt} {...axisProps} {...extra} />;
  const common = { data, margin: { top: 8, right: 16, bottom: 8, left: 8 } };

  if (type === "pie") {
    const s = series[0];
    const slices = data.filter((r) => typeof r[s.key] === "number");
    return (
      <PieChart>
        <Pie isAnimationActive={false} data={slices} dataKey={s.key} nameKey={x_key} stroke="var(--surface)" label={({ value }) => axisFmt(value)}>
          {slices.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        {tooltip()}
        {legend()}
      </PieChart>
    );
  }
  if (type === "scatter") {
    const s = series[0];
    return (
      <ScatterChart margin={common.margin}>
        {grid}
        {xAxis({ type: "number", name: x_label })}
        {yAxis({ type: "number", dataKey: s.key, name: y_label })}
        {tooltip({ cursor: { ...cursor, strokeDasharray: "3 3" } })}
        <Scatter isAnimationActive={false} name={s.label} data={data} fill={COLORS[0]} />
      </ScatterChart>
    );
  }
  const Chart = type === "line" ? LineChart : BarChart;
  return (
    <Chart {...common}>
      {grid}
      {xAxis()}
      {yAxis()}
      {tooltip()}
      {series.length > 1 && legend({ verticalAlign: "top" })}
      {series.map((s, i) =>
        type === "line" ? (
          <Line isAnimationActive={false} key={s.key} dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} dot={false} />
        ) : (
          <Bar isAnimationActive={false} key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
        ),
      )}
    </Chart>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Unavailable /> : this.props.children;
  }
}

const Unavailable = () => (
  <p role="alert" className="text-sm text-muted">
    A chart could not be displayed.
  </p>
);

/** One chart, titled, with labelled axes. A malformed spec renders a notice instead of crashing the page. */
export function ChartView({ spec: raw }: { spec: unknown }) {
  const spec = parseSpec(raw);
  if (!spec) return <Unavailable />;
  return (
    <Card as="figure" aria-label={`Chart: ${spec.title}`}>
      <figcaption className="mb-2 text-base font-semibold">{spec.title}</figcaption>
      <div className="h-72 w-full">
        <Boundary>
          <ResponsiveContainer width="100%" height="100%">
            <Plot spec={spec} />
          </ResponsiveContainer>
        </Boundary>
      </div>
    </Card>
  );
}
