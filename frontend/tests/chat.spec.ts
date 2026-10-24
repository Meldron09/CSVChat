import { test, expect } from "@playwright/test";

// Each test opens "/", which creates a fresh Chat on the fake backend, so tests are independent.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
});

test("loads the sample dataset", async ({ page }) => {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(page.getByLabel("Cleaning Report for orders")).toBeVisible();
  await expect(page.getByLabel("Relationships")).toBeVisible();
  await expect(page.getByLabel("As-of Date")).toHaveValue("2024-11-04");
});

test("streams an Answer with a Chart", async ({ page }) => {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await page.getByLabel("Question").fill("Show monthly revenue as a chart");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("Revenue grew")).toBeVisible();
  await expect(page.getByLabel("Chart: Monthly revenue")).toBeVisible();
  await page.reload(); // the finished Turn is read back from the Transcript
  await expect(page.getByText("Revenue grew")).toBeVisible();
  await expect(page.getByLabel("Chart: Monthly revenue")).toBeVisible();
});

test("shows a failed Turn's error", async ({ page }) => {
  await page.getByLabel("Question").fill("This will fail");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("This question failed: SQL guard rejected the query")).toBeVisible();
});

test("shows partial Cleaning Reports when an upload is rejected", async ({ page }) => {
  const csv = (name: string, body: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(body) });
  await page.getByLabel("CSV files").setInputFiles([csv("good.csv", "id,name\n1,a\n2,b\n"), csv("bad.csv", "x")]);
  await page.getByRole("button", { name: "Upload CSVs" }).click();
  await expect(page.getByText("bad.csv: could not parse as CSV")).toBeVisible();
  await expect(page.getByText("1 earlier file(s) were loaded")).toBeVisible();
  await expect(page.getByLabel("Cleaning Report for good")).toBeVisible();
});
