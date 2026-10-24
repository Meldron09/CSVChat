import { expect, type Page } from "@playwright/test";

/** The fake backend's port (env FAKE_BACKEND_PORT, default 4010) and base URL; playwright.config.ts uses the same. */
export const FAKE_PORT = Number(process.env.FAKE_BACKEND_PORT ?? 4010);
export const FAKE_URL = `http://127.0.0.1:${FAKE_PORT}`;

export const CHAT_URL = /\/chat\/[0-9a-f-]{36}$/;

/** Opens "/", which creates a fresh Chat on the fake backend, and waits for its address. Call from `beforeEach`. */
export async function openChat(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(CHAT_URL);
}

export const question = (page: Page) => page.getByRole("textbox", { name: "Question", exact: true });
export const transcript = (page: Page) => page.getByRole("region", { name: "Transcript" });
export const tables = (page: Page) => page.getByRole("region", { name: "Tables" });
export const orders = (page: Page) => tables(page).getByRole("button", { name: /^orders\b/ });

export const csv = (name: string, body: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(body) });

/** Loads the sample dataset and waits until its `orders` Table is listed. */
export async function loadSample(page: Page) {
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(orders(page)).toBeVisible();
}

/** Asks a question and waits until the Turn has finished (the message box is enabled again). */
export async function ask(page: Page, text: string) {
  await question(page).fill(text);
  await question(page).press("Enter");
  await expect(question(page)).toBeEnabled();
}

/**
 * Screenshot harness (spec `screenshots.spec.ts`, run with SHOTS=1 SHOTS_DIR=...): saves `<SHOTS_DIR>/<stage>/<name>-<theme>-<width>.png`
 * for light/dark x 1440/390 of whatever the page currently shows (`before` runs just before each shot). Screenshots are never committed.
 */
export async function shoot(page: Page, stage: string, name: string, before?: () => Promise<void>) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) throw new Error("SHOTS_DIR is not set");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400); // let colour transitions settle
      await before?.(); // e.g. re-trigger a toast that would have expired
      await page.screenshot({ path: `${dir}/${stage}/${name}-${scheme}-${width}.png` });
    }
  }
}
