import { expect, test, type Page } from "@rstest/playwright";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    ancestorIndentEditor?: EditorController;
    ancestorIndentChanges?: number;
  }
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (text: string, indent: number) => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text)],
});
const original: EditorContent = {
  type: "doc",
  content: [
    {
      type: "orderedList",
      attrs: { semloEditorOrderedStyle: "decimal" },
      content: [item("甲", 0), item("乙", 1), item("丙", 0), item("丁", 1), item("戊", 0)],
    },
    paragraph("末尾"),
  ],
};

async function mount(page: Page, content: EditorContent = original) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'ancestor-indent-test'
      document.body.append(host)
      window.ancestorIndentChanges = 0
      window.ancestorIndentEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        onChange: () => { window.ancestorIndentChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.ancestorIndentEditor));
  return page.locator("#ancestor-indent-test");
}

async function select(page: Page, first: string, last = first, backward = false, all = false) {
  await page.evaluate(
    ({ first, last, backward, all }) => {
      const editor = window.__semloRequireFixture("ancestorIndentEditor").editor;
      const positions = new Map<string, { from: number; to: number }>();
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock) positions.set(node.textContent, { from: pos + 1, to: pos + node.nodeSize - 1 });
      });
      const start = positions.get(first);
      const end = positions.get(last);
      if (!start || !end) throw new Error("Missing selected item");
      const anchor = start.from;
      const head = all ? end.to : start.from;
      editor.view.focus();
      editor.commands.setTextSelection({ from: backward ? head : anchor, to: backward ? anchor : head });
    },
    { first, last, backward, all },
  );
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const controller = window.__semloRequireFixture("ancestorIndentEditor");
    const editor = controller.editor;
    return {
      ...controller.getSnapshot(),
      raw: editor.getJSON(),
      selection: { anchor: editor.state.selection.anchor, head: editor.state.selection.head },
      focused: editor.view.hasFocus(),
      changes: window.__semloRequireFixture("ancestorIndentChanges"),
    };
  });
}

async function markers(page: Page) {
  return page.locator("#ancestor-indent-test .semlo-editor-prose li").evaluateAll((items) =>
    items.map((element) => ({
      text: Array.from(element.children).find((child) => child.tagName === "P")?.textContent,
      marker: getComputedStyle(element).listStyleType,
    })),
  );
}

for (const [key, labels, path, indents] of [
  ["Tab", ["1.", "1.1.", "1.1.1.", "2."], [1, 1], [2, 0]],
  ["Shift+Tab", ["1.", "1.1.", "2.", "3."], null, [0, 0]],
] as const) {
  test(`${key} migrates the first item's ancestor path after converting a list item to H3`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const host = await mount(page);
    await select(page, "丙");
    await page.keyboard.press("ControlOrMeta+Alt+3");
    await expect(host.locator(".semlo-editor-prose > h3")).toContainText("丙");
    expect((await markers(page)).map((entry) => entry.marker)).toEqual(
      ["1.", "1.1.", "1.2.", "2."].map((label) => `"${label} "`),
    );
    await select(page, "丁");
    const before = await inspect(page);
    expect(
      before.json.content?.filter((node) => node.type === "orderedList").at(-1)?.attrs?.semloEditorOrderedAncestorPath,
    ).toEqual([1]);
    await page.keyboard.press(key);
    const after = await inspect(page);
    expect(after.focused).toBe(true);
    expect(after.selection).toEqual(before.selection);
    expect(after.changes - before.changes).toBe(1);
    const right = after.json.content?.filter((node) => node.type === "orderedList").at(-1);
    expect(right?.attrs?.semloEditorOrderedAncestorPath ?? null).toEqual(path);
    expect(right?.content?.map((node) => node.attrs?.semloEditorListIndent)).toEqual([...indents]);
    expect((await markers(page)).map((entry) => entry.marker)).toEqual(labels.map((label) => `"${label} "`));
    expect(await page.evaluate(() => window.__semloRequireFixture("ancestorIndentEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await inspect(page)).json).toEqual(before.json);
    expect((await inspect(page)).selection).toEqual(before.selection);
    expect(await page.evaluate(() => window.__semloRequireFixture("ancestorIndentEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await inspect(page)).json).toEqual(after.json);
    expect((await inspect(page)).selection).toEqual(after.selection);
    for (const value of [after.json, after.html]) {
      const restored = await page.evaluate((content) => {
        const controller = window.__semloRequireFixture("ancestorIndentEditor");
        controller.setContent("<p>临时内容</p>");
        controller.setContent(content);
        return controller.getSnapshot();
      }, value);
      expect(restored.json).toEqual(after.json);
      expect((await markers(page)).map((entry) => entry.marker)).toEqual(labels.map((label) => `"${label} "`));
    }
    expect(errors).toEqual([]);
  });
}

for (const backward of [false, true]) {
  test(`a ${backward ? "backward" : "forward"} multi-item indentation retains path and level seeds`, async ({
    page,
  }) => {
    await mount(page);
    await select(page, "丙");
    await page.keyboard.press("ControlOrMeta+Alt+3");
    await select(page, "丁", "戊", backward, true);
    const before = await inspect(page);
    await page.keyboard.press("Tab");
    const after = await inspect(page);
    expect(after.focused).toBe(true);
    expect(after.selection).toEqual(before.selection);
    expect(after.changes - before.changes).toBe(1);
    const right = after.json.content?.filter((node) => node.type === "orderedList").at(-1);
    expect(right?.attrs?.semloEditorOrderedAncestorPath).toEqual([1, 1]);
    expect(right?.attrs?.start).toBe(1);
    expect(right?.attrs?.semloEditorListLevelStarts).toEqual({ 0: 2, 1: 2 });
    expect(right?.content?.map((node) => node.attrs?.semloEditorListIndent)).toEqual([2, 1]);
    expect((await markers(page)).map((entry) => entry.marker)).toEqual(
      ["1.", "1.1.", "1.1.1.", "1.2."].map((label) => `"${label} "`),
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("ancestorIndentEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await inspect(page)).json).toEqual(before.json);
    expect((await inspect(page)).selection).toEqual(before.selection);
    expect(await page.evaluate(() => window.__semloRequireFixture("ancestorIndentEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await inspect(page)).json).toEqual(after.json);
  });
}

test("indenting only a later item leaves the first item's path unchanged", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: {
          start: 2,
          semloEditorOrderedStyle: "decimal",
          semloEditorOrderedAncestorPath: [1],
          semloEditorListLevelStarts: { 0: 2 },
        },
        content: [item("丁", 1), item("戊", 0)],
      },
    ],
  });
  await select(page, "戊");
  const before = await inspect(page);
  await page.keyboard.press("Tab");
  const after = await inspect(page);
  const list = after.json.content?.[0];
  expect(list?.attrs?.semloEditorOrderedAncestorPath).toEqual([1]);
  expect(list?.attrs?.start).toBe(2);
  expect(list?.attrs?.semloEditorListLevelStarts).toEqual({ 0: 2 });
  expect(list?.content?.map((node) => node.attrs?.semloEditorListIndent)).toEqual([1, 1]);
  expect((await markers(page)).map((entry) => entry.marker)).toEqual(['"1.2. "', '"1.3. "']);
  expect(after.selection).toEqual(before.selection);
  expect(after.changes - before.changes).toBe(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("ancestorIndentEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await inspect(page)).json).toEqual(before.json);
});

test("a multi-item Tab at the maximum first level leaves its path intact", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: {
          start: 2,
          semloEditorOrderedStyle: "decimal",
          semloEditorOrderedAncestorPath: Array(8).fill(1),
          semloEditorListLevelStarts: { 7: 2 },
        },
        content: [item("丁", 8), item("戊", 7)],
      },
    ],
  });
  await select(page, "丁", "戊", false, true);
  const before = await inspect(page);
  await page.keyboard.press("Tab");
  const after = await inspect(page);
  expect(after.focused).toBe(true);
  expect(after.selection).toEqual(before.selection);
  expect(after.changes - before.changes).toBe(1);
  expect(after.json.content?.[0].attrs?.semloEditorOrderedAncestorPath).toEqual(Array(8).fill(1));
  expect(after.json.content?.[0].content?.map((node) => node.attrs?.semloEditorListIndent)).toEqual([8, 8]);
  expect(await page.evaluate(() => window.__semloRequireFixture("ancestorIndentEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await inspect(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("ancestorIndentEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await inspect(page)).json).toEqual(after.json);
});

for (const [name, attrs] of [
  ["invalid path", { semloEditorOrderedAncestorPath: "invalid", semloEditorListLevelStarts: { 0: 2 }, start: 2 }],
  ["empty path", { semloEditorOrderedAncestorPath: [], semloEditorListLevelStarts: { 0: 2 }, start: 2 }],
  ["mismatched path", { semloEditorOrderedAncestorPath: [7, 8], semloEditorListLevelStarts: { 0: 2 }, start: 2 }],
  [
    "out-of-range path",
    { semloEditorOrderedAncestorPath: [2147483648], semloEditorListLevelStarts: { 0: 2 }, start: 2 },
  ],
  ["invalid level seeds", { semloEditorOrderedAncestorPath: [1], semloEditorListLevelStarts: { 9: 2 }, start: 2 }],
  ["ambiguous start", { semloEditorOrderedAncestorPath: [7], start: 4 }],
] as const) {
  test(`an ${name} leaves the list, focus, selection and history intact`, async ({ page }) => {
    await mount(page, {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { ...attrs, semloEditorOrderedStyle: "decimal" },
          content: [item("丁", 1), item("戊", 0)],
        },
      ],
    });
    await select(page, "丁");
    const before = await inspect(page);
    await page.keyboard.press("Tab");
    const after = await inspect(page);
    expect(after.raw).toEqual(before.raw);
    expect(after.selection).toEqual(before.selection);
    expect(after.focused).toBe(true);
    expect(after.changes).toBe(before.changes);
    expect(await page.evaluate(() => window.__semloRequireFixture("ancestorIndentEditor").editor.commands.undo())).toBe(
      false,
    );
  });
}

test("a mismatched path also prevents changes when only a later item is selected", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: {
          start: 2,
          semloEditorOrderedStyle: "decimal",
          semloEditorOrderedAncestorPath: [7, 8],
          semloEditorListLevelStarts: { 0: 2 },
        },
        content: [item("丁", 1), item("戊", 0)],
      },
    ],
  });
  await select(page, "戊");
  const before = await inspect(page);
  await page.keyboard.press("Tab");
  const after = await inspect(page);
  expect(after.raw).toEqual(before.raw);
  expect(after.selection).toEqual(before.selection);
  expect(after.focused).toBe(true);
  expect(after.changes).toBe(before.changes);
  expect(await page.evaluate(() => window.__semloRequireFixture("ancestorIndentEditor").editor.commands.undo())).toBe(
    false,
  );
});

test("a list without an ancestor path retains existing start and seed behavior", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [{ type: "orderedList", attrs: { start: 7 }, content: [item("甲", 1), item("乙", 1), item("丙", 1)] }],
  });
  await select(page, "甲", "乙", false, true);
  await page.keyboard.press("Tab");
  const after = await inspect(page);
  const list = after.json.content?.[0];
  expect(list?.attrs?.start).toBe(7);
  expect(list?.attrs?.semloEditorOrderedAncestorPath).toBeUndefined();
  expect(list?.content?.map((node) => node.attrs?.semloEditorListIndent)).toEqual([2, 2, 1]);
  const values = await page
    .locator("#ancestor-indent-test .semlo-editor-prose > ol > li")
    .evaluateAll((items) => items.map((element) => Number(element.getAttribute("value"))));
  expect(values).toEqual([7, 8, 1]);
});
