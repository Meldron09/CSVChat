import { test, expect, type Page } from "@playwright/test";
import { loadSample, openChat, question } from "./helpers";

const ask = async (page: Page, text: string) => {
  await openChat(page);
  await loadSample(page);
  await question(page).fill(text);
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("Revenue grew")).toBeVisible();
};
const paint = (page: Page, selector: string, prop: "fill" | "stroke") =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
const SERIES = ".recharts-bar-rectangle path";
const TICK = ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value";
const GRID = ".recharts-cartesian-grid-horizontal line";

test("a Chart follows the theme and switching updates it live", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await ask(page, "multi series chart");
  await expect(page.locator(SERIES).first()).toBeVisible();
  const light = { tick: await paint(page, TICK, "fill"), grid: await paint(page, GRID, "stroke") };
  expect(await paint(page, SERIES, "fill")).toBe("rgb(37, 99, 235)"); // --chart-1, light

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => paint(page, SERIES, "fill")).toBe("rgb(96, 165, 250)"); // --chart-1, dark
  expect(await paint(page, TICK, "fill")).not.toBe(light.tick);
  expect(await paint(page, GRID, "stroke")).not.toBe(light.grid);
});

test("axes and tooltips use compact numbers, tooltips with locale separators", async ({ page }) => {
  await ask(page, "multi series chart");
  const chart = page.getByLabel("Chart: Revenue by region");
  const ticks = chart.locator(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value");
  await expect(ticks.filter({ hasText: /^\d+(\.\d)?[KM]$/ }).first()).toBeVisible();
  for (const t of await ticks.allTextContents()) expect(t).not.toMatch(/\d{4}/);
  await chart.locator(SERIES).nth(2).hover(); // the third bar: revenue 1,234,567
  await expect(chart.locator(".recharts-tooltip-wrapper")).toContainText("1,234,567");
});

test("a numeric X value such as a year is shown as-is, not compacted", async ({ page }) => {
  await ask(page, "revenue by years");
  const chart = page.getByLabel("Chart: Revenue by year");
  await expect(chart.locator(TICK)).toHaveText(["2021", "2022", "2023"]);
  await expect(chart.locator(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value").filter({ hasText: /^\d+K$/ }).first()).toBeVisible(); // value axis stays compact
});

test("the legend appears only for more than one series", async ({ page }) => {
  await ask(page, "multi series chart");
  await expect(page.getByLabel("Chart: Revenue by region").locator(".recharts-legend-wrapper")).toContainText("Cost");
  await question(page).fill("Show monthly revenue as a chart");
  await page.getByRole("button", { name: "Ask" }).click();
  const single = page.getByLabel("Chart: Monthly revenue");
  await expect(single.locator(".recharts-line")).toBeVisible();
  await expect(single.locator(".recharts-legend-wrapper")).toHaveCount(0);
});

test("a malformed Chart Spec shows a notice and the rest of the Answer renders", async ({ page }) => {
  await ask(page, "malformed chart");
  await expect(page.getByText("A chart could not be displayed.")).toBeVisible();
  await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
});
