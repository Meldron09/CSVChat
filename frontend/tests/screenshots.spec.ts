import { test, expect } from "@playwright/test";
import { csv, loadSample, openChat, question, shoot } from "./helpers";

// Visual review harness, not a regression test: SHOTS=1 SHOTS_DIR=/some/dir npx playwright test screenshots
// Later redesign stages add states here and bump STAGE.
test.skip(!process.env.SHOTS, "set SHOTS=1 and SHOTS_DIR to write screenshots");
const STAGE = process.env.SHOTS_STAGE ?? "stage-3";

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

// Below `lg` the sidebar is a drawer; open it for the narrow shots (the wide layout shows it in flow).
const openDrawer = async (page: import("@playwright/test").Page) => {
  const button = page.getByRole("button", { name: "Dataset", exact: true });
  if (await button.isVisible()) await button.click();
};

test.describe("sidebar", () => {
  test("empty chat, drawer open", async ({ page }) => {
    await openChat(page);
    await shoot(page, STAGE, "sidebar-empty", () => openDrawer(page));
  });

  test("sample loaded, drawer open", async ({ page }) => {
    await openChat(page);
    await loadSample(page);
    await shoot(page, STAGE, "sidebar-sample", () => openDrawer(page));
  });

  test("upload in progress", async ({ page }) => {
    await openChat(page);
    await page.route("**/api/chats/*/files", () => {}); // never answers: the spinner stays
    await page.getByLabel("CSV files").setInputFiles(csv("orders.csv", "id\n1\n"));
    await expect(page.getByText("Cleaning and loading")).toBeAttached();
    await shoot(page, STAGE, "sidebar-uploading", () => openDrawer(page));
  });

  test("upload error", async ({ page }) => {
    await openChat(page);
    await page.getByLabel("CSV files").setInputFiles(csv("bad.csv", "x"));
    await expect(page.getByRole("alert").filter({ hasText: "bad.csv" })).toBeVisible();
    await shoot(page, STAGE, "sidebar-error", () => openDrawer(page));
  });
});
