import { expect, test, type Page } from "@rstest/playwright";
import type { Locator } from "playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    headingListDragEditor?: EditorController;
  }
}

const nestedList = "<ul><li><p>父列表</p><ul><li><p>子列表一</p></li><li><p>子列表二</p></li></ul></li></ul>";

async function mount(page: Page, content = nestedList) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'heading-list-drag-test'
      document.body.prepend(host)
      window.headingListDragEditor = createEditor({
        element: host,
        outline: false,
        content: ${JSON.stringify(content)},
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.headingListDragEditor));
  return page.locator("#heading-list-drag-test");
}

// Match the native mouse-driven block drag used by tests/features/list/list-drag.test.ts.
async function dragAfter(page: Page, source: Locator, target: Locator) {
  await source.hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  await handle.waitFor({ state: "visible" });
  const from = await handle.boundingBox(),
    to = await target.boundingBox();
  if (!from || !to) throw new Error("Drag source or target has no visible bounds");
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x + 5, to.y + to.height - 2, { steps: 10 });
  await page.mouse.up();
}

async function textBlocks(page: Page) {
  return page.evaluate(() => {
    const result: Array<{ type: string; text: string }> = [];
    window.__semloRequireFixture("headingListDragEditor").editor.state.doc.descendants((node) => {
      if (node.isTextblock && ["父列表", "子列表一", "子列表二"].includes(node.textContent)) {
        result.push({ type: node.type.name, text: node.textContent });
      }
    });
    return result;
  });
}

async function listAppearance(paragraph: Locator) {
  return paragraph.evaluate((element) => {
    const item = element.closest("li");
    if (!item) return null;
    let level = 0;
    let current: Element | null = item;
    while (current) {
      level += Number(current.getAttribute("data-semlo-editor-list-indent") || 0);
      const ancestor: Element | null = current.parentElement?.closest("li") ?? null;
      if (ancestor) level += 1;
      current = ancestor;
    }
    return { list: item.parentElement?.tagName, level, marker: getComputedStyle(item).listStyleType };
  });
}

const snapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("headingListDragEditor").getSnapshot().json);

async function expectUndoRedo(page: Page, before: unknown, after: unknown) {
  expect(await page.evaluate(() => window.__semloRequireFixture("headingListDragEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.__semloRequireFixture("headingListDragEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(after);
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("a parent dragged after its remaining child adopts the child's second-level bullet after heading conversion", async ({
  page,
}) => {
  const host = await mount(page);
  const prose = host.locator(".semlo-editor-prose");
  await prose.getByText("子列表一", { exact: true }).click();
  await host.getByRole("button", { name: "段落样式" }).click();
  await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();

  await expect(prose.locator("h3").filter({ hasText: "子列表一" })).toHaveCount(1);
  expect(await textBlocks(page)).toEqual([
    { type: "paragraph", text: "父列表" },
    { type: "heading", text: "子列表一" },
    { type: "paragraph", text: "子列表二" },
  ]);
  const remainingChild = prose.getByText("子列表二", { exact: true });
  expect(await listAppearance(remainingChild)).toEqual({ list: "UL", level: 1, marker: "circle" });

  const beforeDrag = await snapshot(page);
  await dragAfter(page, prose.getByText("父列表", { exact: true }), remainingChild);
  const afterDrag = await snapshot(page);
  expect(afterDrag).not.toEqual(beforeDrag);
  expect(await textBlocks(page)).toEqual([
    { type: "heading", text: "子列表一" },
    { type: "paragraph", text: "子列表二" },
    { type: "paragraph", text: "父列表" },
  ]);
  expect(await listAppearance(prose.getByText("父列表", { exact: true }))).toEqual({
    list: "UL",
    level: 1,
    marker: "circle",
  });
  expect(await listAppearance(prose.getByText("子列表二", { exact: true }))).toEqual({
    list: "UL",
    level: 1,
    marker: "circle",
  });
  await expectUndoRedo(page, beforeDrag, afterDrag);
});

test("a same-list move from an indented item to a top-level item uses the destination level", async ({ page }) => {
  const host = await mount(
    page,
    '<ul><li data-semlo-editor-list-indent="1"><p>原二级</p></li><li><p>一级目标</p></li></ul>',
  );
  const prose = host.locator(".semlo-editor-prose");
  const before = await snapshot(page);
  await dragAfter(page, prose.getByText("原二级", { exact: true }), prose.getByText("一级目标", { exact: true }));
  const after = await snapshot(page);
  expect(after).not.toEqual(before);
  await expect(prose.locator(":scope > ul > li > p")).toHaveText(["一级目标", "原二级"]);
  expect(await listAppearance(prose.getByText("原二级", { exact: true }))).toEqual({
    list: "UL",
    level: 0,
    marker: "disc",
  });
  await expectUndoRedo(page, before, after);
});

test("a nested destination keeps the source indent and subtree", async ({ page }) => {
  const host = await mount(
    page,
    "<ul><li><p><strong>移动项</strong></p><ul><li><p>移动子项</p></li></ul></li>" +
      '<li data-semlo-editor-list-indent="1"><p>目标容器</p><ul><li data-semlo-editor-list-indent="1"><p>嵌套目标</p></li></ul></li></ul>',
  );
  const prose = host.locator(".semlo-editor-prose");
  const before = await snapshot(page);
  await dragAfter(page, prose.getByText("移动项", { exact: true }), prose.getByText("嵌套目标", { exact: true }));
  const after = await snapshot(page);
  expect(after).not.toEqual(before);
  await expect(prose.locator("p")).toHaveText(["目标容器", "嵌套目标", "移动项", "移动子项"]);
  const moved = prose.getByText("移动项", { exact: true });
  await expect(moved).toHaveJSProperty("tagName", "STRONG");
  expect((await listAppearance(moved))?.level).toBe(2);
  expect((await listAppearance(prose.getByText("嵌套目标", { exact: true })))?.level).toBe(3);
  expect((await listAppearance(prose.getByText("移动子项", { exact: true })))?.level).toBe(3);
  await expectUndoRedo(page, before, after);
});

test("a top-level source with a nested subtree keeps its indent and content", async ({ page }) => {
  const host = await mount(
    page,
    "<ul><li><p><strong>根源</strong></p><ul><li><p>根子</p></li></ul></li></ul><p>间隔</p>" +
      '<ul><li data-semlo-editor-list-indent="1"><p>平铺目标</p></li></ul>',
  );
  const prose = host.locator(".semlo-editor-prose");
  const before = await snapshot(page);
  await dragAfter(page, prose.getByText("根源", { exact: true }), prose.getByText("平铺目标", { exact: true }));
  const after = await snapshot(page);
  expect(after).not.toEqual(before);
  await expect(prose.locator("p")).toHaveText(["间隔", "平铺目标", "根源", "根子"]);
  const moved = prose.getByText("根源", { exact: true });
  await expect(moved).toHaveJSProperty("tagName", "STRONG");
  expect((await listAppearance(moved))?.level).toBe(0);
  expect((await listAppearance(prose.getByText("平铺目标", { exact: true })))?.level).toBe(1);
  expect((await listAppearance(prose.getByText("根子", { exact: true })))?.level).toBe(1);
  await expectUndoRedo(page, before, after);
});

test("a top-level target list containing a nested subtree keeps the source indent", async ({ page }) => {
  const host = await mount(
    page,
    "<ul><li><p>平铺源</p></li></ul><p>间隔</p>" +
      '<ul><li data-semlo-editor-list-indent="1"><p>带子树目标</p></li>' +
      "<li><p>保留父项</p><ul><li><p>保留子项</p></li></ul></li></ul>",
  );
  const prose = host.locator(".semlo-editor-prose");
  const before = await snapshot(page);
  await dragAfter(page, prose.getByText("平铺源", { exact: true }), prose.getByText("带子树目标", { exact: true }));
  const after = await snapshot(page);
  expect(after).not.toEqual(before);
  await expect(prose.locator("p")).toHaveText(["间隔", "带子树目标", "平铺源", "保留父项", "保留子项"]);
  expect((await listAppearance(prose.getByText("平铺源", { exact: true })))?.level).toBe(0);
  expect((await listAppearance(prose.getByText("带子树目标", { exact: true })))?.level).toBe(1);
  expect((await listAppearance(prose.getByText("保留子项", { exact: true })))?.level).toBe(1);
  await expectUndoRedo(page, before, after);
});

test("same-type ordered list moves keep source indent, list starts and formatting", async ({ page }) => {
  const host = await mount(
    page,
    '<ol start="7"><li><p><strong>有序源</strong></p></li><li><p>有序保留</p></li></ol><p>中间</p>' +
      '<ol start="15"><li data-semlo-editor-list-indent="1"><p>有序目标</p></li></ol><p>分隔</p>' +
      '<ol start="25"><li><p>旁支</p></li></ol>',
  );
  const prose = host.locator(".semlo-editor-prose");
  const before = await snapshot(page);
  await dragAfter(page, prose.getByText("有序源", { exact: true }), prose.getByText("有序目标", { exact: true }));
  const after = await snapshot(page);
  expect(after).not.toEqual(before);
  const lists = prose.locator(":scope > ol");
  await expect(lists).toHaveCount(3);
  expect(await lists.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("start")))).toEqual([
    "7",
    "15",
    "25",
  ]);
  await expect(lists.nth(0).locator(":scope > li > p")).toHaveText(["有序保留"]);
  await expect(lists.nth(1).locator(":scope > li > p")).toHaveText(["有序目标", "有序源"]);
  await expect(lists.nth(1).locator("strong")).toHaveText("有序源");
  expect((await listAppearance(prose.getByText("有序源", { exact: true })))?.level).toBe(0);
  await expectUndoRedo(page, before, after);
});

test("same-type task moves preserve the checked state and source indent", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("headingListDragEditor").setContent({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "已完成任务" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "保留任务" }] }],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "中间" }] },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false, semloEditorListIndent: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "目标任务" }] }],
            },
          ],
        },
      ],
    }),
  );
  const prose = host.locator(".semlo-editor-prose");
  const before = await snapshot(page);
  await dragAfter(page, prose.getByText("已完成任务", { exact: true }), prose.getByText("目标任务", { exact: true }));
  const after = await snapshot(page);
  expect(after).not.toEqual(before);
  const tasks = await page.evaluate(() => {
    const values: Array<{ text: string; checked: unknown; indent: unknown }> = [];
    window.__semloRequireFixture("headingListDragEditor").editor.state.doc.descendants((node) => {
      if (node.type.name === "taskItem")
        values.push({ text: node.textContent, checked: node.attrs.checked, indent: node.attrs.semloEditorListIndent });
    });
    return values;
  });
  expect(tasks).toEqual([
    { text: "保留任务", checked: false, indent: 0 },
    { text: "目标任务", checked: false, indent: 1 },
    { text: "已完成任务", checked: true, indent: 0 },
  ]);
  await expectUndoRedo(page, before, after);
});

test("a cross-type move keeps its ordered list separate and preserves unrelated starts", async ({ page }) => {
  const host = await mount(
    page,
    '<ol start="7"><li><p>跨类型源</p></li></ol><p>中间</p>' +
      '<ul><li data-semlo-editor-list-indent="1"><p>无序目标</p></li><li><p>后续</p></li></ul><p>分隔</p>' +
      '<ol start="25"><li><p>旁支</p></li></ol>',
  );
  const prose = host.locator(".semlo-editor-prose");
  const before = await snapshot(page);
  await dragAfter(page, prose.getByText("跨类型源", { exact: true }), prose.getByText("无序目标", { exact: true }));
  const after = await snapshot(page);
  expect(after).not.toEqual(before);
  expect(await prose.locator(":scope > *").evaluateAll((nodes) => nodes.map((node) => node.tagName))).toEqual([
    "P",
    "UL",
    "OL",
    "UL",
    "P",
    "OL",
  ]);
  expect(
    await prose.locator(":scope > ol").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("start"))),
  ).toEqual(["7", "25"]);
  await expect(prose.locator(":scope > ol").first().locator("li")).toHaveText("跨类型源");
  expect((await listAppearance(prose.getByText("跨类型源", { exact: true })))?.level).toBe(0);
  expect((await listAppearance(prose.getByText("无序目标", { exact: true })))?.level).toBe(1);
  await expectUndoRedo(page, before, after);
});
