import { expect, test, type Page } from "@rstest/playwright";
import type { Locator } from "playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    listDragEditor?: EditorController;
  }
}

async function setup(page: Page, content: string) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'list-drag-test'
      document.body.prepend(host)
      window.listDragEditor = createEditor({ element: host, content: '<p></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.listDragEditor));
  await page.evaluate((html) => window.__semloRequireFixture("listDragEditor").setContent(html), content);
  return page.locator("#list-drag-test .semlo-editor-prose");
}

async function drag(page: Page, source: Locator, target: Locator, position: "before" | "after") {
  await source.hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  await handle.waitFor({ state: "visible" });
  const from = await handle.boundingBox(),
    to = await target.boundingBox();
  if (!from || !to) throw new Error("Drag source or target has no visible bounds");
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x + 5, position === "before" ? to.y + 2 : to.y + to.height - 2, { steps: 10 });
  await page.mouse.up();
}

const snapshot = (page: Page) => page.evaluate(() => window.__semloRequireFixture("listDragEditor").getSnapshot().json);

async function expectUndo(page: Page, before: Awaited<ReturnType<typeof snapshot>>) {
  expect(await page.evaluate(() => window.__semloRequireFixture("listDragEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("moving an item between lists preserves both lists and supports undo", async ({ page }) => {
  const prose = await setup(
    page,
    "<ul><li><p>甲</p></li><li><p>乙</p></li></ul><p>中间</p><ul><li><p>丙</p></li><li><p>丁</p></li></ul>",
  );
  const before = await snapshot(page);
  await drag(page, prose.getByText("乙", { exact: true }), prose.getByText("丁", { exact: true }), "before");
  const lists = prose.locator(":scope > ul");
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0).locator(":scope > li")).toHaveText(["甲"]);
  await expect(lists.nth(1).locator(":scope > li")).toHaveText(["丙", "乙", "丁"]);
  await expectUndo(page, before);
});

test("moving the sole item removes its now-empty source list", async ({ page }) => {
  const prose = await setup(
    page,
    "<ul><li><p>唯一</p></li></ul><p>中间</p><ul><li><p>目标甲</p></li><li><p>目标乙</p></li></ul>",
  );
  const before = await snapshot(page);
  await drag(page, prose.getByText("唯一", { exact: true }), prose.getByText("目标甲", { exact: true }), "after");
  const lists = prose.locator(":scope > ul");
  await expect(lists).toHaveCount(1);
  await expect(lists.locator(":scope > li")).toHaveText(["目标甲", "唯一", "目标乙"]);
  await expect(prose.locator(":scope > p")).toHaveText(["中间"]);
  await expectUndo(page, before);
});

test("dragging a paragraph between items splits the list without converting the paragraph", async ({ page }) => {
  const prose = await setup(page, "<p>段落</p><ul><li><p>列表甲</p></li><li><p>列表乙</p></li></ul>");
  const before = await snapshot(page);
  await drag(page, prose.getByText("段落", { exact: true }), prose.getByText("列表乙", { exact: true }), "before");
  await expect(prose.locator(":scope > *")).toHaveCount(3);
  await expect(prose.locator(":scope > ul").nth(0).locator(":scope > li")).toHaveText(["列表甲"]);
  await expect(prose.locator(":scope > p")).toHaveText(["段落"]);
  await expect(prose.locator(":scope > ul").nth(1).locator(":scope > li")).toHaveText(["列表乙"]);
  expect(await prose.locator(":scope > *").evaluateAll((nodes) => nodes.map((node) => node.tagName))).toEqual([
    "UL",
    "P",
    "UL",
  ]);
  await expectUndo(page, before);
});

test("an ordered item stays ordered when dropped into a bullet list", async ({ page }) => {
  const prose = await setup(
    page,
    "<ol><li><p>有序</p></li></ol><p>中间</p><ul><li><p>无序甲</p></li><li><p>无序乙</p></li></ul>",
  );
  const before = await snapshot(page);
  await drag(page, prose.getByText("有序", { exact: true }), prose.getByText("无序乙", { exact: true }), "before");
  expect(await prose.locator(":scope > *").evaluateAll((nodes) => nodes.map((node) => node.tagName))).toEqual([
    "P",
    "UL",
    "OL",
    "UL",
  ]);
  await expect(prose.locator(":scope > ul").nth(0).locator(":scope > li")).toHaveText(["无序甲"]);
  await expect(prose.locator(":scope > ol > li")).toHaveText(["有序"]);
  await expect(prose.locator(":scope > ul").nth(1).locator(":scope > li")).toHaveText(["无序乙"]);
  await expectUndo(page, before);
});

test("a list item cannot be dropped into its own descendant", async ({ page }) => {
  const prose = await setup(
    page,
    "<ul><li><p>父级</p><ul><li><p>子级</p></li><li><p>另一子级</p></li></ul></li><li><p>同级</p></li></ul>",
  );
  const before = await snapshot(page);
  await drag(page, prose.getByText("父级", { exact: true }), prose.getByText("子级", { exact: true }), "after");
  expect(await snapshot(page)).toEqual(before);
});
