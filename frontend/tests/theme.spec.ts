import { test, expect, type Page } from "@playwright/test";
import { openChat } from "./helpers";

const LIGHT_BG = "rgb(255, 255, 255)";
const DARK_BG = "rgb(22, 11, 38)";

const html = (page: Page) => page.locator("html");
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const open = async (page: Page, os: "light" | "dark") => {
  await page.emulateMedia({ colorScheme: os });
  await openChat(page);
};
const toggle = (page: Page) => page.getByRole("banner").getByRole("button", { name: /^Switch to (light|dark) theme$/ });
const toDark = (page: Page) => page.getByRole("button", { name: "Switch to dark theme", exact: true });
const toLight = (page: Page) => page.getByRole("button", { name: "Switch to light theme", exact: true });

test("with no choice made the app follows the OS", async ({ page }) => {
  await open(page, "dark");
  await expect(html(page)).not.toHaveAttribute("data-theme", /.*/);
  expect(await background(page)).toBe(DARK_BG);
  await expect(toLight(page)).toBeVisible(); // the label names the action, so it says how to leave dark
  await page.emulateMedia({ colorScheme: "light" });
  expect(await background(page)).toBe(LIGHT_BG);
  await expect(toDark(page)).toBeVisible(); // and follows the OS while nothing is stored
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
});

test("the toggle switches between light and dark", async ({ page }) => {
  await open(page, "light");
  const button = toggle(page);
  expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await toDark(page).click();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).toBe(DARK_BG);
  await expect(toLight(page)).toBeVisible();

  await page.emulateMedia({ colorScheme: "dark" }); // an explicit choice beats the OS either way
  await toLight(page).click();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  expect(await background(page)).toBe(LIGHT_BG);
  await expect(toDark(page)).toBeVisible();
});

test("the choice survives a reload and is applied before first paint", async ({ page }) => {
  await open(page, "light");
  await toDark(page).click();
  await page.reload();
  await expect(toLight(page)).toBeVisible();

  // With every framework script blocked nothing can hydrate, so only the inline <head> script can have set the theme:
  // the first paint is already dark.
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).toBe(DARK_BG);
  await expect(page.getByRole("banner").getByRole("button", { name: "Switch theme", exact: true })).toBeVisible(); // the React toggle did not run
});

test("a stored choice beats the OS", async ({ page }) => {
  await open(page, "dark");
  await toLight(page).click();
  await page.reload();
  expect(await background(page)).toBe(LIGHT_BG);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
});

test("every interactive control shows a focus ring", async ({ page }) => {
  await open(page, "light");
  await page.getByRole("button", { name: "Load sample dataset" }).click();
  await expect(page.getByRole("button", { name: /^orders\b/ })).toBeVisible(); // the message box is disabled until a Table exists
  await page.reload();
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      if (el === document.body) return null; // tabbed past the last control
      const s = getComputedStyle(el);
      return { name: el.getAttribute("aria-label") || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || el.textContent?.trim() || el.outerHTML.slice(0, 80), style: s.outlineStyle, width: s.outlineWidth };
    });
    if (!ring) break;
    expect(ring.style, `focus ring on "${ring.name}"`).not.toBe("none");
    expect(ring.width, `focus ring on "${ring.name}"`).not.toBe("0px");
    seen.push(ring.name);
  }
  // theme toggle (its aria-label), As-of Date, drop zone, sample option, message box (the disabled Ask button is skipped)
  expect(seen).toEqual(expect.arrayContaining(["Switch to dark theme", "Copy chat link", "New chat", "CSV files", "Business definitions", "Load sample dataset", "Question"]));
});

test("reduced motion disables transitions", async ({ page }) => {
  await open(page, "light");
  const duration = () => page.getByRole("button", { name: "Load sample dataset" }).evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(await duration()).not.toBe("0s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await duration()).toBe("0s");
});
