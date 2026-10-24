import { test, expect, type Page } from "@playwright/test";
import { FAKE_URL, openChat, question } from "./helpers";

test.beforeEach(({ page }) => openChat(page));

/** What the fake backend has saved for this Chat (the fake exposes the real GET /chats/{id}). */
async function saved(page: Page) {
  const id = new URL(page.url()).pathname.split("/").pop();
  return (await (await fetch(`${FAKE_URL}/chats/${id}`)).json()) as { as_of_date: string | null; dataset_notes: string | null };
}

const dateField = (page: Page) => page.getByLabel("As-of Date");
const notes = (page: Page) => page.getByLabel("Dataset Notes");
/** The message box stays disabled until a Table exists: upload a tiny CSV (the sample would also set the As-of Date). */
async function addData(page: Page) {
  await page.getByLabel("CSV files").setInputFiles({ name: "t.csv", mimeType: "text/csv", buffer: Buffer.from("id\n1\n") });
  await expect(page.getByRole("button", { name: /^t\b/ })).toBeVisible();
}

test("As-of Date defaults to the browser's local today and shows in the composer", async ({ page }) => {
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await expect(dateField(page)).toHaveValue(today);
  await expect(page.locator("form").getByText(`as of ${today}`, { exact: true })).toBeVisible();
  await expect(page.getByText("counted back from this date")).toBeVisible(); // helper text: "past year" etc. resolve against it
});

test("editing the As-of Date updates the composer label, is saved, and is sent with the next question", async ({ page }) => {
  await dateField(page).fill("2024-03-15");
  await expect(page.locator("form").getByText("as of 2024-03-15", { exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page)).as_of_date).toBe("2024-03-15");

  await addData(page);
  await question(page).fill("How many orders?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("(As-of Date used: 2024-03-15)")).toBeVisible(); // the fake echoes the date it was sent

  await page.reload(); // restored when the Chat is resumed
  await expect(dateField(page)).toHaveValue("2024-03-15");
  await expect(page.locator("form").getByText("as of 2024-03-15", { exact: true })).toBeVisible();
});

test("a blank As-of Date is allowed", async ({ page }) => {
  await dateField(page).fill("2024-03-15");
  await expect.poll(async () => (await saved(page)).as_of_date).toBe("2024-03-15");
  await dateField(page).clear();
  await expect(dateField(page)).toHaveValue("");
  await expect(page.getByText("no as-of date", { exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page)).as_of_date).toBeNull();

  await addData(page);
  await question(page).fill("hello");
  await page.getByRole("button", { name: "Ask" }).click(); // still allowed to ask
  await expect(page.getByRole("button", { name: "Ask" })).toBeVisible();
  await expect(page.getByText("This question failed")).toHaveCount(0);
});

test("Dataset Notes save when the field loses focus and are restored on resume", async ({ page }) => {
  await notes(page).fill("Revenue excludes refunds");
  await expect(page.getByText("Notes saved")).toHaveCount(0); // not saved while typing
  await page.getByLabel("As-of Date").focus(); // leave the field
  await expect(page.getByText("Notes saved. Applies to your next question.")).toBeVisible();
  expect((await saved(page)).dataset_notes).toBe("Revenue excludes refunds");
  await expect(page.getByRole("button", { name: "Save notes" })).toHaveCount(0);

  await page.reload();
  await expect(notes(page)).toHaveValue("Revenue excludes refunds");
});

test("a failed Dataset Notes save shows a visible failure and retries on the next blur", async ({ page }) => {
  await notes(page).fill("FAIL_SAVE please");
  await dateField(page).focus();
  await expect(page.getByText("Notes not saved: Save failed (500)")).toBeVisible();
  await expect(page.getByText("Notes saved")).toHaveCount(0);

  await notes(page).fill("Revenue excludes refunds");
  await dateField(page).focus();
  await expect(page.getByText("Notes saved. Applies to your next question.")).toBeVisible();
  await expect(page.getByText("Notes not saved")).toHaveCount(0);
});
