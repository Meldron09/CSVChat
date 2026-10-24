import { test, expect, type Page } from "@playwright/test";
import { CHAT_URL, ask, loadSample, openChat } from "./helpers";

// Header actions: Copy chat link and New chat (with its guard). Opening `/` creates a Chat, so these tests also
// watch that nothing but an explicit New chat ever requests it.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const header = (page: Page) => page.getByRole("banner");
const newChat = (page: Page) => header(page).getByRole("link", { name: "New chat" });
const confirm = (page: Page) => page.getByRole("dialog", { name: "Start a new chat?" });
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/** Requests the browser makes for the root address (the one that creates a Chat). */
function watchRootRequests(page: Page) {
  const hits: string[] = [];
  page.on("request", (r) => new URL(r.url()).pathname === "/" && hits.push(`${r.method()} ${r.url()}`));
  return hits;
}

test.beforeEach(({ page }) => openChat(page));

test("Copy chat link puts the Chat URL on the clipboard and confirms it", async ({ page }) => {
  await header(page).getByRole("button", { name: "Copy chat link" }).click();
  await expect(header(page).getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
  expect(await clipboard(page)).toBe(page.url());
});

test("New chat on an empty Chat navigates without a confirmation", async ({ page }) => {
  const first = page.url();
  await newChat(page).click();
  await expect(page).toHaveURL(CHAT_URL);
  expect(page.url()).not.toBe(first);
  await expect(confirm(page)).toBeHidden();
});

test.describe("a Chat with Tables", () => {
  test.beforeEach(async ({ page }) => {
    await loadSample(page); // no reload: the header learns it live
    await newChat(page).click();
    await expect(confirm(page)).toBeVisible();
  });

  test("Cancel stays on the Chat", async ({ page }) => {
    const url = page.url();
    await confirm(page).getByRole("button", { name: "Cancel" }).click();
    await expect(confirm(page)).toBeHidden();
    expect(page.url()).toBe(url);
  });

  test("New chat goes to a new Chat", async ({ page }) => {
    const first = page.url();
    await confirm(page).getByRole("link", { name: "New chat" }).click();
    await expect(page).toHaveURL(CHAT_URL);
    expect(page.url()).not.toBe(first);
    await expect(page.getByRole("button", { name: "Load sample dataset" })).toBeVisible(); // empty again
  });

  test("Copy link copies the Chat URL and keeps the dialog open", async ({ page }) => {
    await confirm(page).getByRole("button", { name: "Copy link" }).click();
    await expect(confirm(page).getByText("Link copied")).toBeVisible();
    expect(await clipboard(page)).toBe(page.url());
    await expect(confirm(page)).toBeVisible();
  });

  test("traps focus, closes on Escape and restores focus", async ({ page }) => {
    await expect(confirm(page).getByRole("button", { name: "Cancel" })).toBeFocused();
    // Tabbing past the last control may hand focus to the browser itself (activeElement is then <body>), but never to the page behind.
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement !== document.body && !document.activeElement?.closest("dialog"))).toBe(false);
    }
    await page.keyboard.press("Escape");
    await expect(confirm(page)).toBeHidden();
    await expect(newChat(page)).toBeFocused();
  });
});

test("New chat on a Chat with a Turn asks for confirmation", async ({ page }) => {
  // the composer is disabled until a Table is loaded, so a Chat with Turns always has Tables too
  await loadSample(page);
  await ask(page, "How is revenue?");
  await expect(page.getByText("Revenue grew").last()).toBeVisible();
  await newChat(page).click();
  await expect(confirm(page)).toBeVisible();
});

test("a saved Chat with Tables asks for confirmation straight after loading", async ({ page }) => {
  await loadSample(page);
  await page.reload();
  await newChat(page).click();
  await expect(confirm(page)).toBeVisible();
});

test("loading a Chat page or hovering New chat never requests the root address", async ({ page }) => {
  const root = watchRootRequests(page); // created after the beforeEach navigation, so only later requests count
  await loadSample(page);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await newChat(page).hover();
  await page.mouse.move(0, 400);
  await newChat(page).hover();
  await page.waitForTimeout(1000); // a prefetch would have fired by now
  expect(root).toEqual([]);
});
