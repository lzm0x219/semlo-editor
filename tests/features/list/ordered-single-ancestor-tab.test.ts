import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    singleAncestorEditor?: EditorController;
    singleAncestorChanges?: number;
    singleAncestorErrors?: string[];
  }
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (text: string, indent: number) => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text)],
});

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'single-ancestor-test'
      document.body.append(host)
      window.singleAncestorChanges = 0
      window.singleAncestorErrors = []
      window.singleAncestorEditor = createEditor({
        element: host,
        outline: false,
        content: ${JSON.stringify({
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: { semloEditorOrderedStyle: "decimal" },
              content: [item("甲", 0), item("乙", 1), item("丙", 0), item("丁", 1), item("戊", 0)],
            },
            paragraph("末尾"),
          ],
        })},
        onChange: () => { window.singleAncestorChanges++ },
        onError: (error) => { window.singleAncestorErrors.push(error.message) },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.singleAncestorEditor));
  return page.locator("#single-ancestor-test");
}

async function selectStart(page: Page, text: string) {
  await page.evaluate((text) => {
    const editor = window.__semloRequireFixture("singleAncestorEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === text) position = pos + 1;
    });
    if (position < 0) throw new Error(`Missing ${text}`);
    editor.view.focus();
    editor.commands.setTextSelection(position);
  }, text);
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const controller = window.__semloRequireFixture("singleAncestorEditor");
    const editor = controller.editor;
    return {
      ...controller.getSnapshot(),
      selection: {
        anchor: editor.state.selection.anchor,
        head: editor.state.selection.head,
        parent: editor.state.selection.$from.parent.textContent,
        offset: editor.state.selection.$from.parentOffset,
      },
      focused: editor.view.hasFocus(),
      changes: window.__semloRequireFixture("singleAncestorChanges"),
    };
  });
}

async function markers(page: Page) {
  return page.locator("#single-ancestor-test .semlo-editor-prose li").evaluateAll((items) =>
    items.map((element) => ({
      text: Array.from(element.children).find((child) => child.tagName === "P")?.textContent,
      marker: getComputedStyle(element).listStyleType,
    })),
  );
}

test("deleting the last sibling keeps a single item's ancestor through Tab and Shift+Tab", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const host = await mount(page);
  const prose = host.locator(".semlo-editor-prose");

  await selectStart(page, "丙");
  await page.keyboard.press("ControlOrMeta+Alt+3");
  await expect(prose.locator(":scope > h3")).toContainText("丙");
  expect(await markers(page)).toEqual([
    { text: "甲", marker: '"1. "' },
    { text: "乙", marker: '"1.1. "' },
    { text: "丁", marker: '"1.2. "' },
    { text: "戊", marker: '"2. "' },
  ]);

  await host.getByText("戊", { exact: true }).hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  await handle.waitFor({ state: "visible" });
  await handle.click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(host.getByText("戊", { exact: true })).toHaveCount(0);
  expect(await markers(page)).toEqual([
    { text: "甲", marker: '"1. "' },
    { text: "乙", marker: '"1.1. "' },
    { text: "丁", marker: '"1.2. "' },
  ]);
  const afterDelete = await inspect(page);
  const remaining = afterDelete.json.content?.filter((node) => node.type === "orderedList").at(-1);
  expect(remaining?.content).toHaveLength(1);
  expect(remaining?.attrs?.start).toBe(2);
  expect(remaining?.attrs?.semloEditorListLevelStarts).toEqual({ 0: 2 });
  expect(remaining?.attrs?.semloEditorOrderedAncestorPath).toEqual([1]);

  await selectStart(page, "丁");
  const before = await inspect(page);
  expect(before.focused).toBe(true);
  expect(before.selection).toMatchObject({ parent: "丁", offset: 0 });
  const results = [];
  for (const [key, marker, path, level, start, starts] of [
    ["Tab", '"1.1.1. "', [1, 1], 2, 1, { 0: 2, 1: 2 }],
    ["Shift+Tab", '"2. "', null, 0, 2, { 1: 2 }],
  ] as const) {
    const changesBefore = (await inspect(page)).changes;
    await page.keyboard.press(key);
    const after = await inspect(page);
    expect(after.focused).toBe(true);
    expect(after.selection).toEqual(before.selection);
    expect(after.changes - changesBefore).toBe(1);
    const list = after.json.content?.filter((node) => node.type === "orderedList").at(-1);
    expect(list?.attrs?.semloEditorOrderedAncestorPath ?? null).toEqual(path);
    expect(list?.attrs?.start).toBe(start);
    expect(list?.attrs?.semloEditorListLevelStarts).toEqual(starts);
    expect(list?.content?.[0].attrs?.semloEditorListIndent).toBe(level);
    expect((await markers(page)).at(-1)).toEqual({ text: "丁", marker });
    results.push({ snapshot: after, marker });

    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.json).toEqual(before.json);
    expect(undone.selection).toEqual(before.selection);
    expect(undone.focused).toBe(true);
    expect((await markers(page)).at(-1)).toEqual({ text: "丁", marker: '"1.2. "' });
  }

  for (const { snapshot, marker } of results) {
    for (const value of [snapshot.json, snapshot.html]) {
      const restored = await page.evaluate((content) => {
        const controller = window.__semloRequireFixture("singleAncestorEditor");
        controller.setContent("<p>临时内容</p>");
        controller.setContent(content);
        return controller.getSnapshot();
      }, value);
      expect(restored.json).toEqual(snapshot.json);
      expect(restored.text).toBe(snapshot.text);
      expect((await markers(page)).at(-1)).toEqual({ text: "丁", marker });
    }
  }
  expect(await page.evaluate(() => window.singleAncestorErrors)).toEqual([]);
  expect(pageErrors).toEqual([]);
});
