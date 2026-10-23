"use client";

import { Component, type ReactNode } from "react";
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

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
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
    <XAxis dataKey={x_key} label={{ value: x_label, position: "insideBottom", offset: -8 }} height={50} {...extra} />
  );
  const yAxis = (extra?: object) => <YAxis label={{ value: y_label, angle: -90, position: "insideLeft" }} width={70} {...extra} />;
  const common = { data, margin: { top: 8, right: 16, bottom: 8, left: 8 } };

  if (type === "pie") {
    const s = series[0];
    const slices = data.filter((r) => typeof r[s.key] === "number");
    return (
      <PieChart>
        <Pie isAnimationActive={false} data={slices} dataKey={s.key} nameKey={x_key} label>
          {slices.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    );
  }
  if (type === "scatter") {
    const s = series[0];
    return (
      <ScatterChart margin={common.margin}>
        <CartesianGrid strokeDasharray="3 3" />
        {xAxis({ type: "number", name: x_label })}
        {yAxis({ type: "number", dataKey: s.key, name: y_label })}
        <Tooltip cursor={{ strokeDasharray: "3 3" }} />
        <Scatter isAnimationActive={false} name={s.label} data={data} fill={COLORS[0]} />
      </ScatterChart>
    );
  }
  const Chart = type === "line" ? LineChart : BarChart;
  return (
    <Chart {...common}>
      <CartesianGrid strokeDasharray="3 3" />
      {xAxis()}
      {yAxis()}
      <Tooltip />
      {series.length > 1 && <Legend verticalAlign="top" />}
      {series.map((s, i) =>
        type === "line" ? (
          <Line isAnimationActive={false} key={s.key} dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} dot={false} />
        ) : (
          <Bar isAnimationActive={false} key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} />
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
  <p role="alert" className="text-xs text-zinc-500">
    A chart could not be displayed.
  </p>
);

/** One chart, titled, with labelled axes. A malformed spec renders a notice instead of crashing the page. */
export function ChartView({ spec: raw }: { spec: unknown }) {
  const spec = parseSpec(raw);
  if (!spec) return <Unavailable />;
  return (
    <figure className="rounded border border-zinc-300 p-3" aria-label={`Chart: ${spec.title}`}>
      <figcaption className="mb-2 text-sm font-medium">{spec.title}</figcaption>
      <div className="h-72 w-full">
        <Boundary>
          <ResponsiveContainer width="100%" height="100%">
            <Plot spec={spec} />
          </ResponsiveContainer>
        </Boundary>
      </div>
    </figure>
  );
}
