import { test, expect } from "@playwright/test";
import { csv, openChat, question } from "./helpers";

// Each test opens "/", which creates a fresh Chat on the fake backend, so tests are independent.
test.beforeEach(({ page }) => openChat(page));

test("loads the sample dataset", async ({ page }) => {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(page.getByRole("button", { name: /^orders\b/ })).toBeVisible();
  await expect(page.getByLabel("Relationships")).toBeVisible();
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
  await expect(page.getByRole("button", { name: /^good\b/ })).toBeVisible();
});
