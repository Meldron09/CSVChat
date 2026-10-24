import { test, expect } from "@playwright/test";
import type { Relationship, SchemaProfile } from "../lib/api";
import { layoutGraph, type GraphLayout } from "../lib/graph-layout";

// Node-side (no browser): the schema graph's pure layout function.

const table = (name: string, row_count = 100) => ({ name, row_count, columns: [] });
const rel = (from_table: string, to_table: string, cardinality: Relationship["cardinality"] = "many_to_one"): Relationship =>
  ({ from_table, from_column: `${to_table}_id`, to_table, to_column: "id", cardinality, match: 1 });

// The real sample dataset's shape (the mockup's graph).
const SAMPLE: SchemaProfile = {
  tables: [
    table("customers", 10000), table("order_items", 20000), table("orders", 15000), table("payment", 15000),
    table("products", 2000), table("reviews", 1106), table("shipments", 15000), table("suppliers", 100),
  ],
  relationships: [
    rel("order_items", "orders"), rel("order_items", "products"), rel("orders", "customers"), rel("payment", "orders"),
    rel("products", "suppliers"), rel("reviews", "customers"), rel("reviews", "products"), rel("shipments", "orders"),
  ],
};

/** Every invariant that must hold for any input. */
function check(profile: SchemaProfile, g: GraphLayout) {
  expect(g.nodes.map((n) => n.name).sort()).toEqual(profile.tables.map((t) => t.name).sort());
  const byName = new Map(g.nodes.map((n) => [n.name, n]));
  for (const n of g.nodes) {
    expect(n.h).toBeGreaterThanOrEqual(44);
    expect(n.x).toBeGreaterThanOrEqual(0);
    expect(n.y).toBeGreaterThanOrEqual(0);
    expect(n.x + n.w).toBeLessThanOrEqual(g.width);
    expect(n.y + n.h).toBeLessThanOrEqual(g.height);
  }
  for (const [i, a] of g.nodes.entries())
    for (const b of g.nodes.slice(i + 1)) {
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
    }
  expect(g.edges).toHaveLength(profile.relationships.length);
  const onBorder = ([x, y]: [number, number], n: { x: number; y: number; w: number; h: number }) =>
    ((x === n.x || x === n.x + n.w) && y >= n.y && y <= n.y + n.h) || ((y === n.y || y === n.y + n.h) && x >= n.x && x <= n.x + n.w);
  for (const e of g.edges) {
    const from = byName.get(e.from)!;
    const to = byName.get(e.to)!;
    expect(onBorder(e.points[0], from), `${e.from}->${e.to} starts on ${e.from}`).toBe(true);
    expect(onBorder(e.points.at(-1)!, to), `${e.from}->${e.to} ends on ${e.to}`).toBe(true);
    for (const [x, y] of e.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(g.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(g.height);
    }
    // segments are axis-aligned and never cross another node's interior
    for (let i = 1; i < e.points.length; i++) {
      const [[x1, y1], [x2, y2]] = [e.points[i - 1], e.points[i]];
      expect(x1 === x2 || y1 === y2).toBe(true);
      for (const n of g.nodes) {
        if (n.name === e.from || n.name === e.to) continue;
        const crosses = Math.min(x1, x2) < n.x + n.w && Math.max(x1, x2) > n.x && Math.min(y1, y2) < n.y + n.h && Math.max(y1, y2) > n.y;
        expect(crosses, `${e.from}->${e.to} crosses ${n.name}`).toBe(false);
      }
    }
  }
}

const layout = (p: SchemaProfile) => {
  const g = layoutGraph(p);
  check(p, g);
  return g;
};

test("the sample dataset: orders is the hub, its neighbours sit next to it", () => {
  const g = layout(SAMPLE);
  const hub = g.nodes.find((n) => n.hub)!;
  expect(hub.name).toBe("orders");
  expect(g.nodes.filter((n) => n.hub)).toHaveLength(1);
  for (const name of ["customers", "order_items", "payment", "shipments"]) {
    const n = g.nodes.find((x) => x.name === name)!;
    const steps = Math.abs(n.x - hub.x) / (n.w + 56) + Math.abs(n.y - hub.y) / (n.h + 48);
    expect(steps, `${name} next to orders`).toBe(1);
  }
  expect(g.width).toBeLessThanOrEqual(900); // fits the main pane at 1440px
});

test("arrows run from the many side to the one side", () => {
  const g = layout({ tables: [table("orders"), table("customers")], relationships: [rel("orders", "customers")] });
  expect(g.edges[0]).toMatchObject({ from: "orders", to: "customers" });
});

test("no tables, one table, no relationships", () => {
  expect(layoutGraph({ tables: [], relationships: [] }).nodes).toEqual([]);
  const one = layout({ tables: [table("good", 2)], relationships: [] });
  expect(one.nodes).toHaveLength(1);
  expect(one.nodes[0].hub).toBe(false); // nothing connects to it
  const many = layout({ tables: ["a", "b", "c", "d", "e", "f", "g"].map((n) => table(n)), relationships: [] });
  expect(many.nodes.some((n) => n.hub)).toBe(false);
  expect(many.height).toBeLessThan(many.width); // packed row by row, not one per row
});

test("hub ties break on rows, then name", () => {
  const g = layout({ tables: [table("b", 5), table("a", 5), table("c", 9)], relationships: [rel("a", "b"), rel("c", "b"), rel("a", "c")] });
  expect(g.nodes.find((n) => n.hub)!.name).toBe("c"); // all have 2 neighbours; c has the most rows
  const h = layout({ tables: [table("b", 5), table("a", 5)], relationships: [rel("a", "b")] });
  expect(h.nodes.find((n) => n.hub)!.name).toBe("a");
});

test("cycles, self-references, one-to-one and duplicate relationships", () => {
  layout({
    tables: ["a", "b", "c", "d"].map((n) => table(n)),
    relationships: [rel("a", "b"), rel("b", "c"), rel("c", "a"), rel("d", "d"), rel("a", "d", "one_to_one"), rel("a", "b")],
  });
});

test("disconnected components and isolated tables", () => {
  const g = layout({
    tables: ["a", "b", "c", "x", "y", "lonely", "alone"].map((n) => table(n)),
    relationships: [rel("a", "b"), rel("c", "b"), rel("x", "y")],
  });
  const row = (name: string) => g.nodes.find((n) => n.name === name)!.y;
  expect(row("x")).toBeGreaterThan(Math.max(row("a"), row("b"), row("c"))); // a component of its own, below
});

test("20+ tables: a chain, a star and a dense mesh", () => {
  const names = Array.from({ length: 24 }, (_, i) => `t${String(i).padStart(2, "0")}`);
  const tables = names.map((n, i) => table(n, 1000 - i));
  layout({ tables, relationships: names.slice(1).map((n, i) => rel(n, names[i])) });
  layout({ tables, relationships: names.slice(1).map((n) => rel(n, names[0])) });
  const mesh = names.flatMap((n, i) => names.slice(i + 1, i + 4).map((m) => rel(m, n)));
  const g = layout({ tables, relationships: mesh });
  expect(g.width).toBeLessThan(2000);
});

test("long table names do not change the geometry", () => {
  const long = "a_very_long_table_name_that_goes_on_and_on_and_on_for_a_while";
  const g = layout({ tables: [table(long), table("b")], relationships: [rel(long, "b")] });
  expect(new Set(g.nodes.map((n) => n.w)).size).toBe(1); // the name truncates in the node; its full name is the accessible name
});

test("relationships naming missing tables are ignored", () => {
  const p = { tables: [table("a")], relationships: [rel("a", "ghost")] };
  expect(layoutGraph(p).edges).toHaveLength(0);
});
