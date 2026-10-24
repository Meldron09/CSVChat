import { test, expect, type Page } from "@playwright/test";
import type { CleaningReport, Relationship, SchemaProfile } from "../lib/api";
import { csv, loadSample, openChat, question, shoot } from "./helpers";

// Visual review harness, not a regression test: SHOTS=1 SHOTS_DIR=/some/dir npx playwright test screenshots
// Later redesign stages add states here and bump STAGE.
test.skip(!process.env.SHOTS, "set SHOTS=1 and SHOTS_DIR to write screenshots");
const STAGE = process.env.SHOTS_STAGE ?? "stage-4";

test("empty chat", async ({ page }) => {
  await openChat(page);
  await shoot(page, STAGE, "empty");
});

test("sample dataset loaded", async ({ page }) => {
  await openChat(page);
  await loadSample(page);
  await question(page).fill("Revenue by month over the past year"); // enables the Ask button
  await shoot(page, STAGE, "sample");
});

test.describe("header", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copy-link toast", async ({ page }) => {
    await openChat(page);
    await shoot(page, STAGE, "header-toast", async () => {
      await page.getByRole("button", { name: "Copy chat link" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
    });
  });

  test("new chat dialog", async ({ page }) => {
    await openChat(page);
    await loadSample(page);
    await page.getByRole("link", { name: "New chat" }).first().click();
    await shoot(page, STAGE, "new-chat-dialog");
  });
});

// Below `lg` the sidebar is a drawer; open it for the narrow shots (the wide layout shows it in flow).
const openDrawer = async (page: import("@playwright/test").Page) => {
  const button = page.getByRole("button", { name: "Dataset", exact: true });
  if (await button.isVisible()) await button.click();
};

test.describe("sidebar", () => {
  test("empty chat, drawer open", async ({ page }) => {
    await openChat(page);
    await shoot(page, STAGE, "sidebar-empty", () => openDrawer(page));
  });

  test("sample loaded, drawer open", async ({ page }) => {
    await openChat(page);
    await loadSample(page);
    await shoot(page, STAGE, "sidebar-sample", () => openDrawer(page));
  });

  test("upload in progress", async ({ page }) => {
    await openChat(page);
    await page.route("**/api/chats/*/files", () => {}); // never answers: the spinner stays
    await page.getByLabel("CSV files").setInputFiles(csv("orders.csv", "id\n1\n"));
    await expect(page.getByText("Cleaning and loading")).toBeAttached();
    await shoot(page, STAGE, "sidebar-uploading", () => openDrawer(page));
  });

  test("upload error", async ({ page }) => {
    await openChat(page);
    await page.getByLabel("CSV files").setInputFiles(csv("bad.csv", "x"));
    await expect(page.getByRole("alert").filter({ hasText: "bad.csv" })).toBeVisible();
    await shoot(page, STAGE, "sidebar-error", () => openDrawer(page));
  });
});

// The real Online Shop sample's shape (the mockup), served in place of the fake's 8 x 100-row sample for the main-pane shots.
const SHOP: [string, number, [string, string][]][] = [
  ["customers", 10000, [["customer_id", "bigint"], ["first_name", "text"], ["last_name", "text"], ["email", "text"]]],
  ["order_items", 20000, [["order_item_id", "bigint"], ["order_id", "bigint"], ["product_id", "bigint"], ["quantity", "bigint"], ["price_at_purchase", "numeric"]]],
  ["orders", 15000, [["order_id", "bigint"], ["order_date", "date"], ["customer_id", "bigint"], ["total_price", "numeric"]]],
  ["payment", 15000, [["payment_id", "bigint"], ["order_id", "bigint"], ["payment_method", "text"], ["amount", "numeric"], ["transaction_status", "text"]]],
  ["products", 2000, [["product_id", "bigint"], ["product_name", "text"], ["category", "text"], ["price", "numeric"], ["supplier_id", "bigint"]]],
  ["reviews", 1106, [["review_id", "bigint"], ["product_id", "bigint"], ["customer_id", "bigint"], ["rating", "bigint"], ["review_date", "date"]]],
  ["shipments", 15000, [["shipment_id", "bigint"], ["order_id", "bigint"], ["shipment_date", "date"], ["carrier", "text"], ["shipment_status", "text"]]],
  ["suppliers", 100, [["supplier_id", "bigint"], ["supplier_name", "text"]]],
];
const link = (from_table: string, to_table: string, column: string): Relationship =>
  ({ from_table, from_column: column, to_table, to_column: column, cardinality: "many_to_one", match: 1 });

async function serveShopSample(page: Page) {
  const reports: CleaningReport[] = SHOP.map(([table, rows, cols]) => ({
    table, filename: `${table}.csv`, replaced: false, encoding: "utf-8", delimiter: ",", rows_read: rows, duplicates_removed: 0,
    duplicates_basis: "whitespace-normalised values", rows_loaded: rows,
    columns: cols.map(([name, type]) => ({ name, original_name: name, type, nulls: 0, null_tokens_converted: 0, values_trimmed: 0 })),
    outliers: table === "orders" || table === "order_items"
      ? [{ column: table === "orders" ? "total_price" : "quantity", rule: "iqr", count: 12, samples: [], lower: 0, upper: 500 }]
      : [],
  }));
  const schema_profile: SchemaProfile = {
    tables: SHOP.map(([name, row_count, cols]) => ({ name, row_count, columns: cols.map(([n, type]) => ({ name: n, type, samples: [] })) })),
    relationships: [
      link("order_items", "orders", "order_id"), link("order_items", "products", "product_id"), link("orders", "customers", "customer_id"),
      link("payment", "orders", "order_id"), link("products", "suppliers", "supplier_id"), link("reviews", "customers", "customer_id"),
      link("reviews", "products", "product_id"), link("shipments", "orders", "order_id"),
    ],
  };
  await page.route("**/api/chats/*/sample", (route) =>
    route.fulfill({ json: { reports, schema_profile, dataset_notes: "Revenue = the sum of orders.total_price over completed, shipped orders.", as_of_date: "2026-10-24" } }));
}

test.describe("main pane", () => {
  test("shop sample loaded, no turns", async ({ page }) => {
    await openChat(page);
    await serveShopSample(page);
    await loadSample(page);
    await shoot(page, STAGE, "main-shop-sample");
  });

  test("fake sample loaded, no turns", async ({ page }) => {
    await openChat(page);
    await loadSample(page);
    await shoot(page, STAGE, "main-fake-sample");
  });

  test("single-table upload", async ({ page }) => {
    await openChat(page);
    await page.getByLabel("CSV files").setInputFiles(csv("sales.csv", "id,region,amount\n1,North,5\n2,South,7\n"));
    await expect(page.getByRole("heading", { name: "How your tables connect" })).toBeVisible();
    await shoot(page, STAGE, "main-single-table");
  });

  test("first turn", async ({ page }) => {
    await openChat(page);
    await loadSample(page);
    await page.getByRole("region", { name: "Start with a question" }).getByRole("button").first().click();
    await expect(question(page)).toBeEnabled();
    await shoot(page, STAGE, "main-first-turn");
  });
});
