import { test, expect, type Page } from "@playwright/test";
import { FAKE_URL, ask as askQuestion, openChat, question, transcript } from "./helpers";

// The two-pane shell: layout at wide and phone widths, the pinned composer, scrolling, and the sidebar drawer.
test.beforeEach(async ({ page }) => {
  await openChat(page);
  // the message box is disabled until a Table exists: give the fake Chat the sample dataset, then reload
  const id = new URL(page.url()).pathname.split("/").pop();
  await fetch(`${FAKE_URL}/chats/${id}/sample`, { method: "POST" });
  await page.reload();
});

const scrollInfo = (page: Page) =>
  transcript(page).evaluate((el) => ({ top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight, scrollable: el.scrollHeight > el.clientHeight }));

async function ask(page: Page, text: string) {
  await askQuestion(page, text); // the Turn is done
  await expect(page.getByText("Revenue grew").last()).toBeVisible();
}

test.describe("wide screen", () => {
  test("shows the sidebar beside the chat pane", async ({ page }) => {
    const sidebar = page.getByRole("dialog", { name: "Dataset" });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Load sample dataset" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dataset", exact: true })).toBeHidden(); // no drawer button
    await expect(page.getByRole("banner").getByText("CSVChat")).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: /^Switch to (light|dark) theme$/ })).toBeVisible();
    const [s, t] = await Promise.all([sidebar.boundingBox(), transcript(page).boundingBox()]);
    expect(s!.x + s!.width).toBeLessThanOrEqual(t!.x + 1);
    expect(Math.abs(s!.y - t!.y)).toBeLessThan(2);
  });
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 700 } });

  test("shows the chat pane, with the sidebar reachable from the header", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Load sample dataset" })).toBeHidden();
    await expect(question(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Dataset", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Dataset", exact: true }).click();
    await expect(page.getByRole("button", { name: "Load sample dataset" })).toBeVisible();
    await page.getByRole("button", { name: "Load sample dataset" }).click();
    await expect(page.getByRole("button", { name: /^orders\b/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("drawer traps focus, closes on Escape and restores focus", async ({ page }) => {
    const opener = page.getByRole("button", { name: "Dataset", exact: true });
    const drawer = page.getByRole("dialog", { name: "Dataset" });
    const focusInDrawer = () => page.evaluate(() => !!document.activeElement?.closest("dialog"));
    // Tabbing past the last control may hand focus to the browser itself (activeElement is then <body>), but never to the page behind.
    const focusBehindDrawer = () => page.evaluate(() => document.activeElement !== document.body && !document.activeElement?.closest("dialog"));
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(drawer).toBeVisible();
    expect(await focusInDrawer()).toBe(true);
    for (let i = 0; i < 12; i++) { // more Tabs than the drawer has controls: focus must not reach the chat pane
      await page.keyboard.press("Tab");
      expect(await focusBehindDrawer()).toBe(false);
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("drawer closes with its Close button and when the window grows to the wide layout", async ({ page }) => {
    const drawer = page.getByRole("dialog", { name: "Dataset" });
    await page.getByRole("button", { name: "Dataset", exact: true }).click();
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toBeHidden();
    await page.getByRole("button", { name: "Dataset", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 700 });
    await expect(drawer).toBeVisible(); // now the static sidebar...
    await question(page).click(); // ...and no longer modal: the chat pane is usable
    await expect(question(page)).toBeFocused();
  });
});

test.describe("composer", () => {
  test("Enter sends, Shift+Enter adds a newline", async ({ page }) => {
    await question(page).fill("first line");
    await question(page).press("Shift+Enter");
    await question(page).pressSequentially("second line");
    await expect(question(page)).toHaveValue("first line\nsecond line");
    await expect(page.getByLabel(/^Question: /)).toHaveCount(0); // nothing sent yet
    await question(page).press("Enter");
    await expect(page.locator("article", { hasText: "second line" })).toBeVisible();
    await expect(question(page)).toHaveValue("");
    await expect(page.getByText("Revenue grew")).toBeVisible();
  });

  test("Enter on an empty box sends nothing", async ({ page }) => {
    await question(page).press("Enter");
    await question(page).fill("   ");
    await question(page).press("Enter");
    await expect(page.getByLabel(/^Question: /)).toHaveCount(0);
  });

  test("grows with longer input, up to a limit", async ({ page }) => {
    const height = () => question(page).evaluate((el) => el.getBoundingClientRect().height);
    const one = await height();
    await question(page).fill("a\nb\nc");
    const three = await height();
    expect(three).toBeGreaterThan(one + 20);
    await question(page).fill(Array(40).fill("line").join("\n"));
    const many = await height();
    expect(many).toBeGreaterThan(three);
    expect(many).toBeLessThan(260); // capped (scrolls inside) rather than taking over the pane
    await question(page).fill("");
    expect(await height()).toBe(one);
  });

  test("is disabled while a Turn is running, then ready again", async ({ page }) => {
    await question(page).fill("slow question");
    await question(page).press("Enter");
    await expect(question(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Working…" })).toBeDisabled();
    await expect(page.getByText("Revenue grew")).toBeVisible();
    await expect(question(page)).toBeEnabled({ timeout: 15_000 });
    await expect(question(page)).toBeFocused(); // ready to type the next question
  });
});

test.describe("scrolling", () => {
  test.use({ viewport: { width: 1280, height: 520 } });

  test("the composer stays pinned while the Transcript scrolls", async ({ page }) => {
    const bottomGap = async () => {
      const box = (await page.getByRole("button", { name: "Ask" }).boundingBox())!;
      return (await page.viewportSize())!.height - (box.y + box.height);
    };
    const before = await bottomGap();
    for (const q of ["one", "two", "three", "four"]) await ask(page, q);
    expect((await scrollInfo(page)).scrollable).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true); // the page itself doesn't scroll
    expect(await bottomGap()).toBe(before);
    await transcript(page).evaluate((el) => (el.scrollTop = 0));
    expect(await bottomGap()).toBe(before);
    await expect(question(page)).toBeInViewport();
  });

  test("follows new Turns, but not once the user has scrolled up", async ({ page }) => {
    for (const q of ["one", "two", "three", "four"]) await ask(page, q);
    await expect.poll(async () => (await scrollInfo(page)).gap).toBeLessThan(2); // followed the newest Turn

    await transcript(page).evaluate((el) => (el.scrollTop = 0)); // the user scrolls up to read
    await question(page).fill("slow question");
    await question(page).press("Enter");
    await expect(page.getByLabel("Question: slow question")).toBeInViewport(); // sending jumps to the new Turn
    await transcript(page).evaluate((el) => (el.scrollTop = 0)); // scrolls up again while it streams
    await expect(question(page)).toBeEnabled({ timeout: 15_000 }); // the Turn finished
    await expect.poll(async () => (await scrollInfo(page)).top).toBeLessThan(2); // not yanked down by the streamed Answer

    await transcript(page).evaluate((el) => (el.scrollTop = el.scrollHeight)); // back at the bottom: following resumes
    await ask(page, "five");
    await expect.poll(async () => (await scrollInfo(page)).gap).toBeLessThan(2);
  });
});
