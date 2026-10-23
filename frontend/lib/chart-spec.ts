/** A Chart Spec as the backend sends it (backend/app/chart_spec.py). Never code: the frontend only draws it. */
export const CHART_TYPES = ["line", "bar", "pie", "scatter"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export type ChartSpec = {
  type: ChartType;
  title: string;
  x_key: string;
  x_label: string;
  y_label: string;
  series: { key: string; label: string }[];
  data: Record<string, string | number | null>[];
};
