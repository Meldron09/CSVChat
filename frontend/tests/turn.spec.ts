import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
});

const transcript = (page: Page) => page.getByRole("region", { name: "Transcript" });
const box = (page: Page) => page.getByRole("textbox", { name: "Question", exact: true });

/** Asks a question and waits until the Turn has finished (the message box is enabled again). */
async function ask(page: Page, question: string) {
  await box(page).fill(question);
  await box(page).press("Enter");
  await expect(box(page)).toBeEnabled();
}

test("a running Turn shows one status line and streaming text; the live region skips the streamed tokens", async ({ page }) => {
  await box(page).fill("slow question");
  await box(page).press("Enter");
  const t = transcript(page);
  await expect(t).toHaveAttribute("aria-live", "polite");
  await expect(t.getByText("Planning the analysis…")).toBeVisible();
  await expect(t.getByText("Task 1: writing SQL for: slow question…")).toBeVisible();
  await expect(t.getByText("Planning the analysis")).toHaveCount(0); // a single line: the latest step replaces the earlier ones
  await expect(t.getByText("Writing the answer…")).toBeVisible();
  const streaming = t.locator('[aria-hidden="true"]').getByText("Revenue");
  await expect(streaming).toBeVisible(); // text streams in while still running...
  await expect(t.getByText("Writing the answer…")).toBeVisible(); // ...and is not final yet
  await expect(box(page)).toBeEnabled({ timeout: 15_000 });
  await expect(t.getByText("Writing the answer…")).toHaveCount(0); // status line is gone when done
  await expect(t.locator('[aria-hidden="true"]').getByText("Revenue")).toHaveCount(0); // the finished Answer is announced
  await expect(t.getByText("Revenue grew")).toBeVisible();
});

test("a finished Turn shows the Answer, its Chart and a closed disclosure grouped by task", async ({ page }) => {
  await ask(page, "Show monthly revenue as a chart, tasks");
  const turn = page.getByRole("article");
  await expect(turn.getByText("Revenue grew")).toBeVisible();
  await expect(turn.getByLabel("Chart: Monthly revenue")).toBeVisible();

  const disclosure = turn.locator("details");
  await expect(disclosure.getByText("How this was answered")).toBeVisible();
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(turn.getByText("SELECT region")).toBeHidden(); // SQL is collapsed

  await disclosure.getByText("How this was answered").click();
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(disclosure.getByText("Planning the analysis")).toBeVisible();
  const task1 = disclosure.getByRole("region", { name: "Task 1" });
  const task2 = disclosure.getByRole("region", { name: "Task 2" });
  await expect(task1.getByText("SELECT date_trunc")).toBeVisible();
  await expect(task1.getByText("SELECT region")).toHaveCount(0);
  await expect(task2.getByText("orders per region").first()).toBeVisible();
  await expect(task2.getByText("SELECT region")).toBeVisible();
});

test("a failed Turn offers Retry, which asks again as a new Turn and keeps the failed one", async ({ page }) => {
  await ask(page, "this will fail");
  const turns = page.getByRole("article");
  await expect(turns).toHaveCount(1);
  await expect(turns.getByText("This question failed: SQL guard rejected the query")).toBeVisible();

  await turns.getByRole("button", { name: "Retry" }).click();
  await expect(turns).toHaveCount(2);
  await expect(box(page)).toBeEnabled();
  await expect(turns.getByText("This question failed:")).toHaveCount(2); // the failed Turn stays, and the retry failed too
  await expect(turns.nth(0)).toHaveAccessibleName("Question: this will fail");
  await expect(turns.nth(1)).toHaveAccessibleName("Question: this will fail");
});

test("Retry is disabled while another Turn is running", async ({ page }) => {
  await ask(page, "this will fail");
  await box(page).fill("slow question");
  await box(page).press("Enter");
  await expect(page.getByRole("button", { name: "Retry" })).toBeDisabled();
  await expect(box(page)).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();
});

test("the As-of Date chip shows only when the date differs from the previous Turn's", async ({ page }) => {
  const date = page.getByLabel("As-of Date");
  await date.fill("2024-11-04");
  await ask(page, "first");
  await ask(page, "second"); // same date: no chip
  await date.fill("2024-12-01");
  await ask(page, "third"); // changed: chip
  await ask(page, "fourth"); // same again: no chip
  const t = transcript(page);
  await expect(page.getByRole("article")).toHaveCount(4);
  await expect(t.getByText("as of 2024-11-04")).toHaveCount(1);
  await expect(t.getByText("as of 2024-12-01")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Question: first" }).getByText("as of 2024-11-04")).toBeVisible();
  await expect(page.getByRole("article", { name: "Question: second" }).getByText(/^as of/)).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Question: third" }).getByText("as of 2024-12-01")).toBeVisible();
  await expect(page.getByRole("article", { name: "Question: fourth" }).getByText(/^as of/)).toHaveCount(0);
});

test("renders Markdown: bold, lists and GFM tables, but never raw HTML", async ({ page }) => {
  await ask(page, "markdown please");
  const turn = page.getByRole("article");
  await expect(turn.locator("strong", { hasText: "12%" })).toBeVisible();
  await expect(turn.getByRole("listitem")).toHaveText(["North led", "South trailed"]);
  const table = turn.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText(["Region", "Revenue"]);
  await expect(table.getByRole("cell")).toHaveText(["North", "120", "South", "80"]);
  await expect(turn.getByText("<b>raw html</b>")).toBeVisible(); // shown as text, not rendered
  await expect(turn.locator("b")).toHaveCount(0);
});

test("plain-text Answers pass through unchanged", async ({ page }) => {
  await ask(page, "plain please");
  const answer = page.getByRole("article").getByText("Revenue was flat.");
  await expect(answer).toHaveText("Revenue was flat.\nNo growth at all.\n(As-of Date used: " + (await page.getByLabel("As-of Date").inputValue()) + ")");
  await expect(page.getByRole("article").locator("table, ul, strong")).toHaveCount(0);
});

test("a resumed Chat renders saved Turns the same way, failed ones still failed", async ({ page }) => {
  await page.getByLabel("As-of Date").fill("2024-11-04");
  await ask(page, "markdown please");
  await ask(page, "this will fail");
  await ask(page, "tasks please");
  await page.reload();

  const turns = page.getByRole("article");
  await expect(turns).toHaveCount(3);
  await expect(turns.nth(0).getByRole("table")).toBeVisible();
  await expect(turns.nth(0).locator("details")).not.toHaveAttribute("open", "");
  await expect(turns.nth(1).getByText("This question failed: SQL guard rejected the query")).toBeVisible();
  await expect(turns.nth(1).getByRole("button", { name: "Retry" })).toBeEnabled();
  await expect(turns.nth(2).getByText("Revenue grew")).toBeVisible();
  await expect(turns.nth(0).getByText("This question failed")).toHaveCount(0);
  await expect(transcript(page).getByText("as of 2024-11-04")).toHaveCount(1); // chip rule holds for saved Turns

  await turns.nth(2).locator("details").getByText("How this was answered").click(); // saved Turns keep their SQL, grouped by task
  await expect(turns.nth(2).getByRole("region", { name: "Task 2" }).getByText("SELECT region")).toBeVisible();

  await turns.nth(1).getByRole("button", { name: "Retry" }).click(); // Retry works on a resumed failed Turn
  await expect(turns).toHaveCount(4);
  await expect(box(page)).toBeEnabled();
});
