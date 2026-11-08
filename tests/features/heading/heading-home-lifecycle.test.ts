import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-home-lifecycle-fixture";
let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-home-lifecycle-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
async function point(page: Page, id: string) {
  return page.evaluate((id) => {
    const heading = document.querySelector(`#${id} h3`)!;
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && node.parentElement?.closest('[contenteditable="false"]')) node = walker.nextNode();
    if (!node?.textContent) throw new Error("Missing text");
    const rows: DOMRect[][] = [];
    for (let offset = 0; offset < node.textContent.length; offset++) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      let row = rows.find((values) => Math.abs(values[0].top - r.top) < 1);
      if (!row) rows.push((row = []));
      row.push(r);
      if (rows.length > 2) break;
    }
    const line = rows[1];
    if (!line?.length) throw new Error("Missing second visual line");
    const r = line[Math.floor(line.length / 2)];
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  }, id);
}
async function metrics(page: Page) {
  return page.evaluate(() => window.__semloRequireFixture("homeLifecycle").metrics());
}
async function home(page: Page, id: string) {
  const target = await point(page, id);
  await page.mouse.click(target.x, target.y);
  await page.evaluate(() => window.__semloRequireFixture("homeLifecycle").settle());
  const before = await metrics(page);
  await page.keyboard.press("Home");
  await page.evaluate(() => window.__semloRequireFixture("homeLifecycle").settle());
  return before;
}

test("listeners exist only while a Home hint is live, then are removed on consume, blur and destroy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 2400 });
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHomeLifecycle === "function");
  await page.evaluate(() => window.__semloRequireFixture("mountHomeLifecycle")());
  await page.evaluate(() => window.__semloRequireFixture("homeLifecycle").settle());
  const initial = await metrics(page);
  expect(initial.headObservers).toBe(0);
  const before = await home(page, "heading-home-life-a");
  const during = await metrics(page);
  expect(during.headObservers).toBe(before.headObservers + 1);
  expect(during.selection).toBe(before.selection + 1);
  expect(during.scroll).toBe(before.scroll + 1);
  await page.keyboard.press("Shift+End");
  const consumed = await metrics(page);
  expect(consumed.headObservers).toBe(before.headObservers);
  expect(consumed.selection).toBe(before.selection);
  expect(consumed.scroll).toBe(before.scroll);
  await home(page, "heading-home-life-a");
  expect((await metrics(page)).headObservers).toBe(1);
  await page.locator("#heading-home-life-b h3").scrollIntoViewIfNeeded();
  const b = await point(page, "heading-home-life-b");
  expect((await metrics(page)).headObservers).toBe(1);
  await page.mouse.click(b.x, b.y);
  await page.evaluate(() => window.__semloRequireFixture("homeLifecycle").settle());
  expect((await metrics(page)).headObservers).toBe(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("homeLifecycle").second.editor.view.hasFocus())).toBe(
    true,
  );
  await page.keyboard.press("Home");
  await page.evaluate(() => window.__semloRequireFixture("homeLifecycle").settle());
  expect((await metrics(page)).headObservers).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("homeLifecycle").second.destroy());
  expect((await metrics(page)).headObservers).toBe(0);
  await page.evaluate(() => window.__semloRequireFixture("homeLifecycle").first.destroy());
  expect(await metrics(page)).toEqual({ headObservers: 0, selection: 0, scroll: 0 });
});
