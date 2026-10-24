import { test } from "@playwright/test";
import { loadSample, openChat, question, shoot } from "./helpers";

// Visual review harness, not a regression test: SHOTS=1 SHOTS_DIR=/some/dir npx playwright test screenshots
// Later redesign stages add states here and bump STAGE.
test.skip(!process.env.SHOTS, "set SHOTS=1 and SHOTS_DIR to write screenshots");
const STAGE = process.env.SHOTS_STAGE ?? "stage-1";

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
