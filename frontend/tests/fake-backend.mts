// Fake backend for the Playwright suite: same endpoints and payloads as the real FastAPI backend,
// typed against the frontend's own API definitions (lib/api.ts) so type drift fails `npm run build`.
// Run directly with Node (type stripping): `node tests/fake-backend.mts` (port: FAKE_BACKEND_PORT, default 4010).
// Scenario triggers (question keywords, upload filenames) are documented in tests/README.md.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Chat, ChatEvent, CleaningReport, SchemaProfile, TranscriptTurn } from "../lib/api";
import type { ChartSpec } from "../lib/chart-spec";

const PORT = Number(process.env.FAKE_BACKEND_PORT ?? 4010);
const SAMPLE_AS_OF = "2024-11-04";
const SAMPLE_NOTES = "Revenue means paid orders only (fake sample notes).";
const SAMPLE_TABLES = ["customers", "order_items", "orders", "payment", "products", "reviews", "shipments", "suppliers"];

const chats = new Map<string, Chat>();
const calls: string[] = []; // "METHOD /path", served at GET /__test/calls (e.g. to count POST /chats)

// ---------- responses ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}
const detail = (res: ServerResponse, status: number, msg: string, extra: object = {}) => json(res, status, { detail: msg, ...extra });
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

// ---------- fixtures ----------
function profileOf(reports: CleaningReport[]): SchemaProfile {
  const tables = reports.map((r) => ({
    name: r.table,
    row_count: r.rows_loaded,
    columns: r.columns.map((c) => ({ name: c.name, type: c.type, samples: ["a", "b"] })),
  }));
  const has = (t: string) => reports.some((r) => r.table === t);
  const relationships: SchemaProfile["relationships"] = has("orders") && has("customers")
    ? [{ from_table: "orders", from_column: "customer_id", to_table: "customers", to_column: "id", cardinality: "many_to_one", match: 0.98 }]
    : [];
  return { tables, relationships };
}

function makeReport(table: string, filename: string, rowsRead: number, dupes: number, replaced = false): CleaningReport {
  return {
    table, filename, replaced,
    encoding: "utf-8", delimiter: ",",
    rows_read: rowsRead, duplicates_removed: dupes, duplicates_basis: "whitespace-normalised values",
    rows_loaded: rowsRead - dupes,
    columns: [
      { name: "id", original_name: "id", type: "bigint", nulls: 0, null_tokens_converted: 0, values_trimmed: 0 },
      { name: "name", original_name: "Name", type: "text", nulls: 1, null_tokens_converted: 1, values_trimmed: 0 },
    ],
    outliers: table === "orders"
      ? [{ column: "total", rule: "iqr", count: 2, samples: [{ id: 7, total: 9999 }], lower: 0, upper: 500 }]
      : [],
  };
}

// Report for an uploaded CSV: columns from the header line, rows counted, identical lines deduplicated.
function reportFromCsv(filename: string, text: string, replaced: boolean): CleaningReport {
  const [header = "", ...rows] = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const table = filename.replace(/\.csv$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const r = makeReport(table, filename, rows.length, rows.length - new Set(rows).size, replaced);
  r.columns = header.split(",").map((n) => ({ name: n.trim().toLowerCase(), original_name: n.trim(), type: "text", nulls: 0, null_tokens_converted: 0, values_trimmed: 0 }));
  return r;
}

const LINE_CHART: ChartSpec = {
  type: "line", title: "Monthly revenue", x_key: "month", x_label: "Month", y_label: "Revenue (USD)",
  series: [{ key: "revenue", label: "Revenue" }],
  data: [{ month: "2024-08", revenue: 120 }, { month: "2024-09", revenue: 150 }, { month: "2024-10", revenue: 135 }],
};

const BAR_CHART: ChartSpec = {
  type: "bar", title: "Revenue by region", x_key: "region", x_label: "Region", y_label: "Revenue (USD)",
  series: [{ key: "revenue", label: "Revenue" }, { key: "cost", label: "Cost" }],
  data: [{ region: "North", revenue: 12400, cost: 8100 }, { region: "South", revenue: 25000, cost: 15200 }, { region: "West", revenue: 1234567, cost: 900000 }],
};

// ---------- multipart (just enough: filenames, file text, plain fields) ----------
function parseMultipart(req: IncomingMessage, body: Buffer) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers["content-type"] ?? "");
  const files: { filename: string; text: string }[] = [];
  const fields: Record<string, string> = {};
  if (!boundary) return { files, fields };
  for (const part of body.toString("latin1").split(`--${boundary[1] ?? boundary[2]}`)) {
    const [head, ...rest] = part.split("\r\n\r\n");
    const content = rest.join("\r\n\r\n").replace(/\r\n$/, "");
    const name = /name="([^"]*)"/.exec(head)?.[1];
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    if (filename !== undefined) files.push({ filename, text: Buffer.from(content, "latin1").toString("utf8") });
    else if (name) fields[name] = content;
  }
  return { files, fields };
}

// ---------- handlers ----------
function upload(chat: Chat, req: IncomingMessage, body: Buffer, res: ServerResponse) {
  const { files, fields } = parseMultipart(req, body);
  if (!files.length) return detail(res, 422, "No files: send one or more .csv files in the multipart field 'files'");
  const notCsv = files.filter((f) => !/\.csv$/i.test(f.filename)).map((f) => f.filename);
  if (notCsv.length) return detail(res, 415, `Not a CSV file: ${notCsv.join(", ")} (expected .csv)`);
  const reports: CleaningReport[] = [];
  for (const f of files) {
    // Scenario: a file whose name starts with "bad" is rejected; the files before it stay loaded.
    if (/^bad/i.test(f.filename)) {
      store(chat, reports);
      return detail(res, 422, `${f.filename}: could not parse as CSV (inconsistent number of columns)`, { reports, schema_profile: chat.schema_profile });
    }
    const replaced = (chat.cleaning_reports ?? []).concat(reports).some((r) => r.filename === f.filename);
    reports.push(reportFromCsv(f.filename, f.text, replaced));
  }
  store(chat, reports);
  if (fields.dataset_notes) chat.dataset_notes ??= fields.dataset_notes;
  json(res, 200, { reports, schema_profile: chat.schema_profile });
}

/** Merge reports into the chat (replace by table) and recompute the Schema Profile. */
function store(chat: Chat, reports: CleaningReport[]) {
  if (!reports.length) return;
  const all = [...(chat.cleaning_reports ?? [])];
  for (const r of reports) {
    const i = all.findIndex((x) => x.table === r.table);
    if (i >= 0) all[i] = r; else all.push(r);
  }
  chat.cleaning_reports = all;
  chat.schema_profile = profileOf(all);
}

function sample(chat: Chat, res: ServerResponse) {
  const reports = SAMPLE_TABLES.map((t) => makeReport(t, `${t}.csv`, 100, t === "orders" ? 3 : 0, !!chat.cleaning_reports?.some((r) => r.table === t)));
  store(chat, reports);
  chat.dataset_notes = chat.dataset_notes?.trim() ? chat.dataset_notes : SAMPLE_NOTES;
  chat.as_of_date = SAMPLE_AS_OF;
  json(res, 200, { reports, schema_profile: chat.schema_profile, dataset_notes: chat.dataset_notes, as_of_date: SAMPLE_AS_OF });
}

const busy = new Set<string>();

async function messages(chat: Chat, req: IncomingMessage, res: ServerResponse) {
  const { question, as_of_date } = JSON.parse((await readBody(req)).toString() || "{}") as { question?: string; as_of_date?: string | null };
  if (!question) return json(res, 422, { detail: [{ type: "string_too_short", loc: ["body", "question"], msg: "String should have at least 1 character" }] });
  const q = question.toLowerCase();
  // Scenarios, by keyword in the question (see tests/README.md).
  if (q.includes("busy") || busy.has(chat.id)) return detail(res, 409, "This Chat is still answering a previous message; wait for it to finish, then ask again.");
  busy.add(chat.id);
  const gap = q.includes("slow") ? 700 : 30;
  const turn: TranscriptTurn = { question, as_of_date: as_of_date ?? "", queries: [], answer: "", charts: [] };
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
  const send = async (e: ChatEvent) => { res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`); await sleep(gap); };
  try {
    await send({ event: "step", data: { node: "orchestrator", message: "Planning the analysis" } });
    if (!q.includes("hello")) { // "hello" = direct reply, no steps or SQL
      await send({ event: "step", data: { node: "sql_analyst", message: `Task 1: writing SQL for: ${question}`, task: 0 } });
      const sql = { task: 0, sub_question: question, sql: "SELECT date_trunc('month', order_date) AS month, SUM(total) AS revenue FROM orders GROUP BY 1" };
      turn.queries.push({ task: 0, sub_question: sql.sub_question, sql: sql.sql, error: null });
      await send({ event: "sql", data: sql });
    }
    if (q.includes("fail")) {
      turn.error = "SQL guard rejected the query: only SELECT statements are allowed";
      await send({ event: "error", data: { message: turn.error } });
      return;
    }
    if (q.includes("drop")) return; // stream closes with no terminal event
    const wantsChart = q.includes("chart") || q.includes("malformed") || q.includes("multi");
    if (wantsChart) await send({ event: "step", data: { node: "chart_builder", message: "Deciding whether charts are warranted" } });
    await send({ event: "step", data: { node: "synthesizer", message: "Writing the answer" } });
    const text = `Revenue grew **12%** over the period. (As-of Date used: ${as_of_date || SAMPLE_AS_OF})`;
    for (const word of text.match(/\S+\s*/g) ?? []) await send({ event: "token", data: { text: word } });
    const bad = { type: "line", title: "Broken chart" } as unknown as ChartSpec; // "malformed": violates the Chart Spec
    const charts = q.includes("malformed") ? [bad] : q.includes("multi") ? [BAR_CHART] : wantsChart ? [LINE_CHART] : [];
    turn.answer = text; turn.charts = charts;
    await send({ event: "answer", data: { text, as_of_date: as_of_date || SAMPLE_AS_OF, charts } });
  } finally {
    if (!q.includes("drop")) chat.transcript.push(turn); // a dropped stream is never recorded, like a crashed backend
    busy.delete(chat.id);
    res.end();
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  const method = req.method ?? "GET";
  if (path === "/health") return json(res, 200, { ok: true });
  if (path === "/__test/calls") return json(res, 200, calls);
  calls.push(`${method} ${path}`);

  if (method === "POST" && path === "/chats") {
    const id = randomUUID();
    chats.set(id, { id, dataset_notes: null, as_of_date: null, schema_profile: null, cleaning_reports: null, transcript: [] });
    return json(res, 200, { id });
  }
  const m = /^\/chats\/([^/]+)(?:\/(files|sample|messages))?$/.exec(path);
  const chat = m && chats.get(m[1]);
  if (!m || !chat) return detail(res, 404, "Chat not found");

  if (!m[2] && method === "GET") return json(res, 200, chat);
  if (!m[2] && method === "PUT") {
    const b = JSON.parse((await readBody(req)).toString() || "{}") as { dataset_notes?: string | null; as_of_date?: string | null };
    if (b.dataset_notes?.includes("FAIL_SAVE")) return detail(res, 500, "Could not save notes"); // scenario: notes autosave failure
    if (b.as_of_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.as_of_date)) return json(res, 422, { detail: [{ type: "date_from_datetime_parsing", loc: ["body", "as_of_date"], msg: "Input should be a valid date" }] });
    if ("dataset_notes" in b) chat.dataset_notes = b.dataset_notes ?? null;
    if ("as_of_date" in b) chat.as_of_date = b.as_of_date ?? null;
    return json(res, 200, chat);
  }
  if (method === "POST" && m[2] === "files") return upload(chat, req, await readBody(req), res);
  if (method === "POST" && m[2] === "sample") return sample(chat, res);
  if (method === "POST" && m[2] === "messages") return messages(chat, req, res);
  detail(res, 405, "Method not allowed");
}).listen(PORT, "127.0.0.1", () => console.log(`fake backend on http://127.0.0.1:${PORT}`));
