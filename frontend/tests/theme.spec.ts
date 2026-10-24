import { test, expect, type Page } from "@playwright/test";
import { openChat } from "./helpers";

const LIGHT_BG = "rgb(255, 255, 255)";
const DARK_BG = "rgb(10, 10, 10)";

const html = (page: Page) => page.locator("html");
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const open = async (page: Page, os: "light" | "dark") => {
  await page.emulateMedia({ colorScheme: os });
  await openChat(page);
};
const theme = (page: Page, name: string) => page.getByRole("group", { name: "Theme" }).getByRole("button", { name });

test("with no choice made the app follows the OS", async ({ page }) => {
  await open(page, "dark");
  await expect(html(page)).not.toHaveAttribute("data-theme", /.*/);
  expect(await background(page)).toBe(DARK_BG);
  await expect(theme(page, "System")).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "light" });
  expect(await background(page)).toBe(LIGHT_BG);
});

test("the toggle switches light, dark and system", async ({ page }) => {
  await open(page, "light");
  await theme(page, "Dark").click();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).toBe(DARK_BG);
  await expect(theme(page, "Dark")).toHaveAttribute("aria-pressed", "true");

  await page.emulateMedia({ colorScheme: "dark" });
  await theme(page, "Light").click();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  expect(await background(page)).toBe(LIGHT_BG);

  await theme(page, "System").click();
  await expect(html(page)).not.toHaveAttribute("data-theme", /.*/);
  expect(await background(page)).toBe(DARK_BG); // the OS is dark
  await expect(theme(page, "System")).toHaveAttribute("aria-pressed", "true");
});

test("the choice survives a reload and is applied before first paint", async ({ page }) => {
  await open(page, "light");
  await theme(page, "Dark").click();
  await page.reload();
  await expect(theme(page, "Dark")).toHaveAttribute("aria-pressed", "true");

  // With every framework script blocked nothing can hydrate, so only the inline <head> script can have set the theme:
  // the first paint is already dark.
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).toBe(DARK_BG);
  await expect(theme(page, "Dark")).toHaveAttribute("aria-pressed", "false"); // the React toggle did not run
});

test("a stored choice beats the OS, and System clears it", async ({ page }) => {
  await open(page, "dark");
  await theme(page, "Light").click();
  await page.reload();
  expect(await background(page)).toBe(LIGHT_BG);
  await theme(page, "System").click();
  await page.reload();
  expect(await background(page)).toBe(DARK_BG);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
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
      return { name: el.getAttribute("aria-label") || el.textContent?.trim() || el.outerHTML.slice(0, 80), style: s.outlineStyle, width: s.outlineWidth };
    });
    if (!ring) break;
    expect(ring.style, `focus ring on "${ring.name}"`).not.toBe("none");
    expect(ring.width, `focus ring on "${ring.name}"`).not.toBe("0px");
    seen.push(ring.name);
  }
  // theme toggle (text is lowercase, capitalised by CSS), As-of Date, drop zone, sample option, message box (the disabled Ask button is skipped)
  expect(seen).toEqual(expect.arrayContaining(["light", "dark", "system", "CSV files", "Dataset Notes", "Load sample dataset", "Question"]));
});

test("reduced motion disables transitions", async ({ page }) => {
  await open(page, "light");
  const duration = () => page.getByRole("button", { name: "Load sample dataset" }).evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(await duration()).not.toBe("0s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await duration()).toBe("0s");
});
