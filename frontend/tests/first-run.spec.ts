import { test, expect, type Page } from "@playwright/test";
import { csv, openChat, question, tables } from "./helpers";

// First run: the empty Chat, uploading (chooser and drag-and-drop), upload feedback, rejection, replacement, sample, Dataset summary.
// With no Tables the drop zone and the sample option are in the main pane (the only ones on the page); then they move to the sidebar.
test.beforeEach(({ page }) => openChat(page));

const table = (page: Page, name: string) => tables(page).getByRole("button", { name: new RegExp(`^${name}\\b`) });
const summary = (page: Page) => page.getByText(/ tables?, .* rows? and .* relationships?, loaded and cleaned\./);

test("an empty Chat shows the drop zone, the sample option and a disabled composer with a hint", async ({ page }) => {
  await expect(page.getByText("Drop CSV files here, or")).toBeVisible();
  await expect(page.getByLabel("CSV files")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Load sample dataset" })).toBeEnabled();
  await expect(question(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ask" })).toBeDisabled();
  expect(await page.getByRole("button", { name: "Ask" }).evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px"); // R3: the white-on-red label is 16px+ semibold
  await expect(page.getByText("Add data to start asking")).toBeVisible();
  await expect(question(page)).toHaveAccessibleDescription(/Add data to start asking/);
  await expect(summary(page)).toHaveCount(0); // nothing loaded yet
  await expect(page.getByRole("button", { name: /suggest/i })).toHaveCount(0);
});

test("choosing files uploads them at once, then enables the composer and shows the Dataset summary", async ({ page }) => {
  await page.getByLabel("CSV files").setInputFiles([csv("customers.csv", "id,name\n1,a\n2,b\n"), csv("orders.csv", "id,customer_id\n1,1\n2,1\n3,2\n")]);
  await expect(table(page, "customers")).toContainText("2 rows");
  await expect(table(page, "orders")).toContainText("3 rows");
  await expect(page.getByText("2 tables, 5 rows and 1 relationship, loaded and cleaned. Outliers are flagged, not removed.", { exact: true })).toBeVisible();
  await expect(question(page)).toBeEnabled();
  await expect(page.getByText("Add data to start asking")).toHaveCount(0);
});

test("dropping files on the drop zone uploads them", async ({ page }) => {
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["id,name\n1,a\n"], "dropped.csv", { type: "text/csv" }));
    return dt;
  });
  await page.getByText("Drop CSV files here, or").dispatchEvent("dragover", { dataTransfer });
  await page.getByText("Drop CSV files here, or").dispatchEvent("drop", { dataTransfer });
  await expect(table(page, "dropped")).toContainText("1 rows");
  await expect(question(page)).toBeEnabled();
});

test("while uploading, a spinner shows the names of the files being processed", async ({ page }) => {
  await page.getByLabel("CSV files").setInputFiles([csv("a.csv", "id\n1\n"), csv("slow-b.csv", "id\n1\n")]);
  const status = page.getByRole("status").filter({ hasText: "Cleaning and loading" });
  await expect(status).toContainText("a.csv, slow-b.csv");
  await expect(page.getByLabel("CSV files")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Load sample dataset" })).toBeDisabled();
  await expect(table(page, "slow_b")).toBeVisible();
  await expect(status).toHaveCount(0);
  await expect(page.getByLabel("CSV files")).toBeEnabled();
});

test("a rejected upload shows an inline error in the sidebar and keeps the earlier files and their note", async ({ page }) => {
  await page.getByLabel("CSV files").setInputFiles([csv("good.csv", "id,name\n1,a\n2,b\n"), csv("bad.csv", "x")]);
  const error = page.getByRole("dialog", { name: "Dataset" }).getByText("bad.csv: could not parse as CSV");
  await expect(error).toBeVisible();
  await expect(error).toContainText("1 earlier file(s) were loaded");
  await expect(table(page, "good")).toBeVisible();
  await expect(question(page)).toBeEnabled(); // a Table exists
  await page.getByLabel("CSV files").setInputFiles(csv("fine.csv", "id\n1\n")); // the next attempt clears the error
  await expect(table(page, "fine")).toBeVisible();
  await expect(page.getByText("bad.csv: could not parse as CSV")).toHaveCount(0);
});

test("a non-CSV file is rejected with an error and no Tables", async ({ page }) => {
  await page.getByLabel("CSV files").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await expect(page.getByText("Not a CSV file: notes.txt")).toBeVisible();
  await expect(tables(page)).toContainText("No Tables yet");
  await expect(question(page)).toBeDisabled();
});

test("re-uploading a Table name shows a replaced badge in the Tables list", async ({ page }) => {
  await page.getByLabel("CSV files").setInputFiles(csv("sales.csv", "id\n1\n"));
  await expect(table(page, "sales")).toContainText("1 rows");
  await expect(tables(page).getByText("replaced", { exact: true })).toHaveCount(0);
  await page.getByLabel("CSV files").setInputFiles(csv("sales.csv", "id\n1\n2\n3\n"));
  await expect(table(page, "sales")).toContainText("3 rows");
  await expect(table(page, "sales").getByText("replaced", { exact: true })).toBeVisible();
  await expect(tables(page).getByRole("button")).toHaveCount(1); // replaced, not duplicated
});

test("loading the sample dataset shows the Dataset summary and enables the composer", async ({ page }) => {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(table(page, "orders")).toBeVisible();
  await expect(page.getByText("8 tables, 797 rows and 1 relationship, loaded and cleaned. Outliers are flagged, not removed.", { exact: true })).toBeVisible();
  await expect(question(page)).toBeEnabled();
});

test("the Dataset summary goes away once a Turn exists and stays away after a reload", async ({ page }) => {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(summary(page)).toBeVisible();
  await question(page).fill("hello");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByLabel("Question: hello")).toBeVisible();
  await expect(summary(page)).toHaveCount(0);
  await expect(question(page)).toBeEnabled(); // the Turn finished, so it is saved
  await page.reload();
  await expect(page.getByLabel("Question: hello")).toBeVisible();
  await expect(summary(page)).toHaveCount(0);
});

test("a resumed Chat with data and no Turns shows the summary at once", async ({ page }) => {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(summary(page)).toBeVisible();
  await page.reload();
  await expect(summary(page)).toBeVisible();
  await expect(question(page)).toBeEnabled();
});

test("the drop zone and sample option sit in the main pane until there are Tables, then only in the sidebar", async ({ page }) => {
  const sidebar = page.getByRole("dialog", { name: "Dataset" });
  const main = page.getByRole("region", { name: "Transcript" });
  await expect(main.getByLabel("CSV files")).toBeAttached();
  await expect(main.getByRole("button", { name: "Load sample dataset" })).toBeVisible();
  await expect(sidebar.getByRole("heading", { name: "Data" })).toHaveCount(0);
  await page.getByLabel("CSV files").setInputFiles(csv("one.csv", "id,amount\n1,5\n2,7\n"));
  await expect(table(page, "one")).toContainText("2 rows");
  await expect(page.getByText("1 table, 2 rows and 0 relationships, loaded and cleaned. Outliers are flagged, not removed.", { exact: true })).toBeVisible();
  await expect(sidebar.getByLabel("CSV files")).toBeAttached();
  await expect(page.getByLabel("CSV files")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Load sample dataset" })).toHaveCount(1);
  await sidebar.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(table(page, "orders")).toBeVisible();
  await expect(summary(page)).toContainText("9 tables, 799 rows and 1 relationship");
});

test("the page has exactly one h1: the empty state's, then a hidden one once there are Turns", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask anything about your data.");
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask anything about your data.");
  await question(page).fill("hello");
  await question(page).press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("CSVChat conversation");
  await expect(page.getByRole("heading", { name: "How your tables connect" })).toHaveCount(0); // the first Turn replaced the empty state
});
