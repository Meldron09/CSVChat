import { test, expect, type Page } from "@playwright/test";
import { csv, loadSample, openChat, question, transcript } from "./helpers";

// The main pane before the first Turn: Dataset summary, schema graph, "Worth a look" and starter questions.
// The fake sample: 8 Tables, one Relationship (orders -> customers); `orders` has 2 flagged (an outlier rule + duplicates).
test.beforeEach(({ page }) => openChat(page));

const graph = (page: Page) => page.getByRole("group", { name: "How your tables connect" });
const slideOver = (page: Page, table: string) => page.getByRole("dialog", { name: `Table ${table}` });

test("the schema graph shows every Table; a node opens its slide-over and gets focus back", async ({ page }) => {
  await loadSample(page);
  await expect(graph(page).getByRole("button")).toHaveCount(8);
  const node = graph(page).getByRole("button", { name: "orders, 97 rows, 2 flagged" });
  await expect(node).toHaveAttribute("aria-haspopup", "dialog");
  await expect(graph(page).getByRole("button", { name: "customers, 100 rows", exact: true })).toBeVisible();
  for (const box of await graph(page).getByRole("button").all()) expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await node.click();
  await expect(slideOver(page, "orders").getByLabel("Cleaning Report for orders")).toContainText("97 rows loaded of 100 read");
  await page.keyboard.press("Escape");
  await expect(slideOver(page, "orders")).toBeHidden();
  await expect(node).toBeFocused();
});

test("\"Worth a look\" lists the flagged Tables and opens their slide-over", async ({ page }) => {
  await loadSample(page);
  const link = page.getByRole("button", { name: "orders, 2 flagged", exact: true });
  await expect(page.getByText("Flagged rows stay in your data. Questions can still use them.")).toBeVisible();
  await link.click();
  await expect(slideOver(page, "orders")).toBeVisible();
});

test("\"Worth a look\" says so when nothing is flagged", async ({ page }) => {
  await page.getByLabel("CSV files").setInputFiles(csv("clean.csv", "id,name\n1,a\n2,b\n"));
  await expect(page.getByText("Nothing flagged: no outliers or duplicate rows were found.")).toBeVisible();
  await expect(graph(page).getByRole("button", { name: "clean, 2 rows", exact: true })).toBeVisible();
});

test("a starter question is sent like a typed one and produces a Turn", async ({ page }) => {
  await loadSample(page);
  const starters = page.getByRole("region", { name: "Start with a question" }).getByRole("button");
  await expect(starters).toHaveCount(4);
  const card = page.getByRole("button", { name: /^Which customers have the most orders\?/ });
  await expect(card).toContainText("orders and customers");
  await card.click();
  await expect(transcript(page).getByLabel("Question: Which customers have the most orders?")).toBeVisible();
  await expect(page.getByText("Revenue grew")).toBeVisible();
  await expect(starters).toHaveCount(0); // the Turn replaced the empty state
  await expect(question(page)).toBeEnabled();
});

test("a running Turn replaces the starter questions at once, so none can be sent twice", async ({ page }) => {
  await loadSample(page);
  let release!: () => void;
  await page.route("**/api/chats/*/messages", async (route) => {
    await new Promise<void>((r) => (release = r)); // hold the request: the Turn stays running
    await route.continue();
  });
  const starters = page.getByRole("region", { name: "Start with a question" }).getByRole("button");
  await starters.first().click();
  await expect(page.getByRole("button", { name: "Working…" })).toBeDisabled();
  await expect(starters).toHaveCount(0);
  release();
  await expect(question(page)).toBeEnabled();
});

test("keyboard focus on a starter question survives the Turn replacing it", async ({ page }) => {
  await loadSample(page);
  let release!: () => void;
  await page.route("**/api/chats/*/messages", async (route) => {
    await new Promise<void>((r) => (release = r)); // hold the request: the Turn stays running
    await route.continue();
  });
  await page.getByRole("region", { name: "Start with a question" }).getByRole("button").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "CSVChat conversation" })).toBeFocused(); // not <body>: the message box is disabled meanwhile
  release();
  await expect(question(page)).toBeFocused(); // the composer's return-after-busy takes over
});

test("phone width: the graph scrolls inside its card, not the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await transcript(page).getByRole("button", { name: "Load sample dataset" }).click(); // no Tables: the main pane's
  await expect(graph(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
