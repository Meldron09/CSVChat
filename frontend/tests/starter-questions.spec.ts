import { test, expect } from "@playwright/test";
import type { Relationship, SchemaProfile } from "../lib/api";
import { starterQuestions } from "../lib/starter-questions";

// Node-side (no browser): the starter questions generated from the Schema Profile.

const col = (name: string, type: string) => ({ name, type, samples: [] });
const rel = (from_table: string, from_column: string, to_table: string): Relationship =>
  ({ from_table, from_column, to_table, to_column: from_column, cardinality: "many_to_one", match: 1 });

// The real sample dataset's shape.
const SAMPLE: SchemaProfile = {
  tables: [
    { name: "customers", row_count: 10000, columns: [col("customer_id", "bigint"), col("first_name", "text"), col("email", "text")] },
    { name: "order_items", row_count: 20000, columns: [col("order_item_id", "bigint"), col("order_id", "bigint"), col("product_id", "bigint"), col("quantity", "bigint"), col("price_at_purchase", "numeric")] },
    { name: "orders", row_count: 15000, columns: [col("order_id", "bigint"), col("order_date", "date"), col("customer_id", "bigint"), col("total_price", "numeric")] },
    { name: "payment", row_count: 15000, columns: [col("payment_id", "bigint"), col("order_id", "bigint"), col("payment_method", "text"), col("amount", "numeric"), col("transaction_status", "text")] },
    { name: "products", row_count: 2000, columns: [col("product_id", "bigint"), col("product_name", "text"), col("category", "text"), col("price", "numeric"), col("supplier_id", "bigint")] },
    { name: "reviews", row_count: 1106, columns: [col("review_id", "bigint"), col("product_id", "bigint"), col("customer_id", "bigint"), col("rating", "bigint"), col("review_date", "date")] },
    { name: "shipments", row_count: 15000, columns: [col("shipment_id", "bigint"), col("order_id", "bigint"), col("shipment_date", "date"), col("carrier", "text"), col("shipment_status", "text")] },
    { name: "suppliers", row_count: 100, columns: [col("supplier_id", "bigint"), col("supplier_name", "text")] },
  ],
  relationships: [
    rel("order_items", "order_id", "orders"), rel("order_items", "product_id", "products"), rel("orders", "customer_id", "customers"),
    rel("payment", "order_id", "orders"), rel("products", "supplier_id", "suppliers"), rel("reviews", "customer_id", "customers"),
    rel("reviews", "product_id", "products"), rel("shipments", "order_id", "orders"),
  ],
};
const ALL_NAMES = SAMPLE.tables.map((t) => t.name);

function check(profile: SchemaProfile) {
  const qs = starterQuestions(profile);
  expect(qs).toHaveLength(4);
  expect(new Set(qs.map((q) => q.question)).size).toBe(4);
  const present = new Set(profile.tables.map((t) => t.name));
  for (const q of qs) {
    expect(q.uses.length).toBeGreaterThan(0);
    for (const u of q.uses) expect(present.has(u), `${q.question} uses ${u}`).toBe(true);
    for (const absent of ALL_NAMES.filter((n) => !present.has(n))) expect(q.question).not.toMatch(new RegExp(`\\b${absent.replace("_", "[ _]")}\\b`));
  }
  return qs;
}

test("the sample dataset gets four schema-specific questions", () => {
  expect(check(SAMPLE)).toEqual([
    { question: "Total price by month over the past year", uses: ["orders"] },
    { question: "Top 10 products by quantity", uses: ["order_items", "products"] },
    { question: "How many payments are there per payment method?", uses: ["payment"] },
    { question: "Which customers have the most reviews?", uses: ["reviews", "customers"] },
  ]);
});

test("a single table with no relationships still gets four", () => {
  const qs = check({ tables: [{ name: "good", row_count: 2, columns: [col("id", "text"), col("name", "text")] }], relationships: [] });
  expect(qs.every((q) => q.uses.join() === "good")).toBe(true);
});

test("a single table without usable columns still gets four", () => {
  check({ tables: [{ name: "category", row_count: 0, columns: [] }], relationships: [] });
});

test("the fake backend's sample shape (id and name columns, one relationship)", () => {
  const t = (name: string) => ({ name, row_count: 100, columns: [col("id", "bigint"), col("name", "text")] });
  const qs = check({ tables: ALL_NAMES.map(t), relationships: [rel("orders", "customer_id", "customers")] });
  expect(qs[0]).toEqual({ question: "Which customers have the most orders?", uses: ["orders", "customers"] });
});

test("an empty profile gets none", () => {
  expect(starterQuestions({ tables: [], relationships: [] })).toEqual([]);
});
