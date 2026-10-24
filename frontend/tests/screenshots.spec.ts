import { test, expect } from "@playwright/test";
import { loadSample, openChat, question, shoot } from "./helpers";

// Visual review harness, not a regression test: SHOTS=1 SHOTS_DIR=/some/dir npx playwright test screenshots
// Later redesign stages add states here and bump STAGE.
test.skip(!process.env.SHOTS, "set SHOTS=1 and SHOTS_DIR to write screenshots");
const STAGE = process.env.SHOTS_STAGE ?? "stage-2";

test("empty chat", async ({ page }) => {
  await openChat(page);
  await shoot(page, STAGE, "empty");
});

test("sample dataset loaded", async ({ page }) => {
  await openChat(page);
  await loadSample(page);
  await question(page).fill("Revenue by month over the past year"); // enables the Ask button
  await shoot(page, STAGE, "sample");
});

test.describe("header", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copy-link toast", async ({ page }) => {
    await openChat(page);
    await shoot(page, STAGE, "header-toast", async () => {
      await page.getByRole("button", { name: "Copy chat link" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
    });
  });

  test("new chat dialog", async ({ page }) => {
    await openChat(page);
    await loadSample(page);
    await page.getByRole("link", { name: "New chat" }).first().click();
    await shoot(page, STAGE, "new-chat-dialog");
  });
});
