import { test, expect } from "@playwright/test";
import { csv, openChat, orders, question } from "./helpers";

// Each test opens "/", which creates a fresh Chat on the fake backend, so tests are independent.
test.beforeEach(({ page }) => openChat(page));

test("loads the sample dataset", async ({ page }) => {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(orders(page)).toBeVisible();
  await expect(page.getByRole("list", { name: "Relationships" })).toContainText("orders.customer_id to customers.id"); // the schema graph's text alternative
  await expect(page.getByLabel("As-of Date")).toHaveValue("2024-11-04");
});

test("streams an Answer with a Chart", async ({ page }) => {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await question(page).fill("Show monthly revenue as a chart");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("Revenue grew")).toBeVisible();
  await expect(page.getByLabel("Chart: Monthly revenue")).toBeVisible();
  await page.reload(); // the finished Turn is read back from the Transcript
  await expect(page.getByText("Revenue grew")).toBeVisible();
  await expect(page.getByLabel("Chart: Monthly revenue")).toBeVisible();
});

test("shows a failed Turn's error", async ({ page }) => {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await question(page).fill("This will fail");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("This question failed: SQL guard rejected the query")).toBeVisible();
});

test("shows partial Cleaning Reports when an upload is rejected", async ({ page }) => {
  await page.getByLabel("CSV files").setInputFiles([csv("good.csv", "id,name\n1,a\n2,b\n"), csv("bad.csv", "x")]);
  await expect(page.getByText("bad.csv: could not parse as CSV")).toBeVisible();
  await expect(page.getByText("1 earlier file(s) were loaded")).toBeVisible();
  await expect(page.getByRole("region", { name: "Tables" }).getByRole("button", { name: /^good\b/ })).toBeVisible();
});

test("phone width: a first upload's partial failure shows its error in the main pane, without opening the drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("CSV files").setInputFiles([csv("good.csv", "id,name\n1,a\n2,b\n"), csv("bad.csv", "x")]); // no Tables yet: the main pane's drop zone
  const alert = page.getByRole("alert").filter({ hasText: "bad.csv: could not parse as CSV" });
  await expect(alert).toBeVisible(); // the good file's Table now exists, so the main drop zone is gone; the drawer is closed
  await expect(alert).toContainText("their Tables are listed below");
  await expect(page.getByRole("alert").filter({ hasText: "bad.csv" })).toHaveCount(1); // not also in the (closed) sidebar strip
  await expect(page.getByRole("dialog", { name: "Dataset" })).toBeHidden();
});

test("wide screen: the same partial failure shows its error once", async ({ page }) => {
  await page.getByLabel("CSV files").setInputFiles([csv("good.csv", "id,name\n1,a\n2,b\n"), csv("bad.csv", "x")]);
  const alerts = page.getByRole("alert").filter({ hasText: "bad.csv" });
  await expect(alerts).toHaveCount(1);
  await expect(alerts).toContainText("bad.csv: could not parse as CSV");
});
