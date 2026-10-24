import { test, expect, type Page } from "@playwright/test";

// The Tables list, compact Relationships list and the Table slide-over. The sample dataset has 8 Tables; `orders`
// (97 rows after 3 duplicate rows) has an IQR outlier flag, so it shows "2 flagged".
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
});

const tables = (page: Page) => page.getByRole("region", { name: "Tables" });
const orders = (page: Page) => tables(page).getByRole("button", { name: /^orders\b/ });
const slideOver = (page: Page) => page.getByRole("dialog", { name: "Table orders" });
const csv = (name: string, body: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(body) });

async function loadSample(page: Page) {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(orders(page)).toBeVisible();
}

test("lists Tables with row counts and a flagged badge only where there is something flagged", async ({ page }) => {
  await expect(tables(page)).toContainText("No Tables yet");
  await loadSample(page);
  await expect(tables(page).getByRole("button")).toHaveCount(8);
  await expect(orders(page)).toContainText("97 rows");
  await expect(orders(page)).toContainText("2 flagged");
  await expect(tables(page).getByRole("button", { name: /^customers\b/ })).toContainText("100 rows");
  await expect(tables(page).getByText(/flagged/)).toHaveCount(1);
});

test("counts removed duplicate rows as flagged", async ({ page }) => {
  await page.getByLabel("CSV files").setInputFiles(csv("dupes.csv", "id,name\n1,a\n1,a\n2,b\n"));
  await expect(tables(page).getByRole("button", { name: /^dupes\b/ })).toContainText("1 flagged");
});

test("shows a compact Relationships list, or an empty message", async ({ page }) => {
  await page.getByLabel("CSV files").setInputFiles(csv("good.csv", "id,name\n1,a\n2,b\n"));
  await expect(page.getByRole("region", { name: "Relationships" })).toContainText("No relationships found between the 1 table(s).");
  await loadSample(page);
  await expect(page.getByRole("region", { name: "Relationships" })).toContainText("orders.customer_id → customers.id");
});

test("opens a Table's Cleaning Report and columns, and closes it", async ({ page }) => {
  await loadSample(page);
  await expect(slideOver(page)).toBeHidden();
  await orders(page).click();
  await expect(slideOver(page)).toBeVisible();
  const report = slideOver(page).getByLabel("Cleaning Report for orders");
  await expect(report).toContainText("97 rows loaded of 100 read");
  await expect(report).toContainText("3 duplicate rows removed");
  await expect(report).toContainText("Flagged, not removed");
  await expect(report.getByRole("cell", { name: "id", exact: true })).toBeVisible();
  // the Schema Profile disclosure lives here now, with this Table's columns
  await expect(page.getByText("Schema Profile (what the agents see)")).toHaveCount(1);
  await slideOver(page).getByText("Schema Profile (what the agents see)").click();
  await expect(slideOver(page).getByText("e.g. a | b").first()).toBeVisible();
  await slideOver(page).getByRole("button", { name: "Close" }).click();
  await expect(slideOver(page)).toBeHidden();
  await expect(page.getByText("Schema Profile (what the agents see)")).toHaveCount(0);
  await expect(page.getByLabel("Cleaning Report for orders")).toHaveCount(0); // no inline reports any more
});

test("slides in from the right beside the chat pane on a wide screen", async ({ page }) => {
  await loadSample(page);
  await orders(page).click();
  const box = (await slideOver(page).boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(Math.abs(box.x + box.width - vw)).toBeLessThan(2);
  expect(box.width).toBeLessThan(vw);
});

test("a click on the backdrop closes it", async ({ page }) => {
  await loadSample(page);
  await orders(page).click();
  await page.mouse.click(50, 300);
  await expect(slideOver(page)).toBeHidden();
});

test("traps focus, closes on Escape and restores focus to the Table", async ({ page }) => {
  await loadSample(page);
  await orders(page).focus();
  await page.keyboard.press("Enter");
  await expect(slideOver(page)).toBeVisible();
  const focusInSlideOver = () => page.evaluate(() => !!document.activeElement?.closest("dialog[aria-label='Table orders']"));
  // Tabbing may hand focus to the browser itself (<body>), but never to the page behind.
  const focusBehind = () => page.evaluate(() => document.activeElement !== document.body && !document.activeElement?.closest("dialog[aria-label='Table orders']"));
  expect(await focusInSlideOver()).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await focusBehind()).toBe(false);
  }
  await page.keyboard.press("Escape");
  await expect(slideOver(page)).toBeHidden();
  await expect(orders(page)).toBeFocused();
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 700 } });

  test("opens as a full-screen sheet from the drawer and returns focus to the Table", async ({ page }) => {
    await page.getByRole("button", { name: "Dataset", exact: true }).click();
    await loadSample(page);
    await orders(page).click();
    await expect(slideOver(page)).toBeVisible();
    expect(await slideOver(page).boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(slideOver(page)).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Dataset" })).toBeVisible(); // only the sheet closed, not the drawer
    await expect(orders(page)).toBeFocused();
  });
});
