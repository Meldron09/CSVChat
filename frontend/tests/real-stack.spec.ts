import { test, expect } from "@playwright/test";
import { question } from "./helpers";

// Calls the real language model through the real compose stack: skipped unless E2E_REAL_STACK=1
// (use `npm run test:e2e:real`, see tests/README.md).
test.skip(!process.env.E2E_REAL_STACK, "real-stack smoke test: set E2E_REAL_STACK=1 (and BACKEND_URL)");

test("loads the sample dataset and gets an Answer", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(page.getByLabel("As-of Date")).toHaveValue("2024-11-04", { timeout: 60_000 });

  await question(page).fill("How many orders are there?");
  await page.getByRole("button", { name: "Ask" }).click();

  // The wording is up to the model, so assert only that the Turn finished with some Answer text and did not fail. (The backend's
  // "(As-of Date used: ...)" line is appended only when the Answer does not already mention the date: not reliable.)
  const turn = page.getByRole("article");
  await expect(turn.getByText("How this was answered")).toBeVisible({ timeout: 240_000 }); // only shown once the Turn has left the running state
  await expect(question(page)).toBeEnabled();
  await expect(turn.getByText("This question failed")).toHaveCount(0);
  const rest = (await turn.innerText()).replace("How this was answered", "").replace("How many orders are there?", "");
  expect(rest.trim()).not.toBe("");
});
