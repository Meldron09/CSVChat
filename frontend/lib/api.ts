// Server-side only: the frontend's server talks to the backend over the compose network.
// The browser reaches the backend through the streaming proxy at /api/* (app/api/[...path]/route.ts).
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export type OutlierFlag = {
  column: string;
  rule: "iqr" | "non_positive";
  count: number;
  samples: Record<string, unknown>[];
  lower?: number;
  upper?: number;
};

export type CleaningReport = {
  table: string;
  filename: string;
  replaced: boolean;
  encoding: string;
  delimiter: string;
  rows_read: number;
  duplicates_removed: number;
  rows_loaded: number;
  columns: { name: string; original_name: string; type: string; nulls: number; values_trimmed: number }[];
  outliers: OutlierFlag[];
};

export type Chat = {
  id: string;
  dataset_notes: string | null;
  as_of_date: string | null;
  schema_profile: unknown;
  cleaning_reports: CleaningReport[] | null;
};

export async function createChat(): Promise<{ id: string }> {
  const res = await fetch(`${BACKEND_URL}/chats`, { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error(`POST /chats failed: ${res.status}`);
  return res.json();
}

/** Returns null when the Chat does not exist. */
export async function getChat(id: string): Promise<Chat | null> {
  const res = await fetch(`${BACKEND_URL}/chats/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /chats/${id} failed: ${res.status}`);
  return res.json();
}
