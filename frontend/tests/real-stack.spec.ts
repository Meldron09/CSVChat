import { test, expect } from "@playwright/test";

// Calls the real language model through the real compose stack: skipped unless E2E_REAL_STACK=1
// (use `npm run test:e2e:real`, see tests/README.md).
test.skip(!process.env.E2E_REAL_STACK, "real-stack smoke test: set E2E_REAL_STACK=1 (and BACKEND_URL)");

test("loads the sample dataset and gets an Answer", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(page.getByLabel("As-of Date")).toHaveValue("2024-11-04", { timeout: 60_000 });

  await page.getByLabel("Question").fill("How many orders are there?");
  await page.getByRole("button", { name: "Ask" }).click();

  // The wording is up to the model; the backend always ends an Answer with this line.
  await expect(page.getByText("(As-of Date used: 2024-11-04.)")).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText("This question failed")).toHaveCount(0);
});
