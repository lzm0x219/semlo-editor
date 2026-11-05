import { expect, test, type Page } from "@rstest/playwright";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    ancestorHeadingEditor?: EditorController;
    ancestorHeadingChanges?: number;
  }
}

const paragraph = (text: string, mark?: string) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(mark ? { marks: [{ type: mark }] } : {}) }],
});
const item = (text: string, indent: number, mark?: string) => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text, mark)],
});
const fixture = (attrs: Record<string, unknown> = {}, levels = [0, 1, 0, 1, 0]): EditorContent => ({
  type: "doc",
  content: [
    {
      type: "orderedList",
      attrs,
      content: levels.map((indent, index) =>
        item(["甲甲", "乙乙", "丙丙", "丁丁", "戊戊"][index], indent, index === 1 ? "italic" : undefined),
      ),
    },
    paragraph("尾段", "bold"),
  ],
});

async function mount(page: Page, content: EditorContent) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'ancestor-heading-test'
      document.body.append(host)
      window.ancestorHeadingChanges = 0
      window.ancestorHeadingEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        onChange: () => { window.ancestorHeadingChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.ancestorHeadingEditor));
}

async function select(page: Page, text: string, anchor = 1, head = anchor) {
  await page.evaluate(
    ({ text, anchor, head }) => {
      const editor = window.__semloRequireFixture("ancestorHeadingEditor").editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === text) position = pos + 1;
      });
      if (position < 0) throw new Error(`Missing ${text}`);
      editor.view.focus();
      editor.commands.setTextSelection({ from: position + anchor, to: position + head });
    },
    { text, anchor, head },
  );
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const controller = window.__semloRequireFixture("ancestorHeadingEditor");
    const editor = controller.editor;
    const blocks: Array<{ text: string; node: unknown }> = [];
    editor.state.doc.descendants((node) => {
      if (node.isTextblock) blocks.push({ text: node.textContent, node: node.toJSON() });
    });
    const { $anchor, $head } = editor.state.selection;
    return {
      ...controller.getSnapshot(),
      raw: editor.getJSON(),
      blocks,
      selection: {
        anchor: $anchor.parent.textContent,
        anchorOffset: $anchor.parentOffset,
        head: $head.parent.textContent,
        headOffset: $head.parentOffset,
      },
      changes: window.__semloRequireFixture("ancestorHeadingChanges"),
    };
  });
}

const lists = (snapshot: Awaited<ReturnType<typeof inspect>>) =>
  snapshot.json.content?.filter((node) => node.type === "orderedList") ?? [];

async function markers(page: Page) {
  return page.locator("#ancestor-heading-test .semlo-editor-prose li").evaluateAll((items) =>
    items.map((element) => ({
      text: Array.from(element.children).find((child) => child.tagName === "P")?.textContent,
      marker: getComputedStyle(element).listStyleType,
    })),
  );
}

async function convert(page: Page, label: string, anchor = 1, head = anchor) {
  await select(page, label, anchor, head);
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(after.changes - before.changes).toBe(1);
  expect(after.json).not.toEqual(before.json);
  expect(after.blocks.map((block) => block.text)).toEqual(before.blocks.map((block) => block.text));
  expect(after.blocks.filter((block) => block.text !== label)).toEqual(
    before.blocks.filter((block) => block.text !== label),
  );
  expect(after.blocks.find((block) => block.text === label)?.node).toMatchObject({
    type: "heading",
    attrs: { level: 3, semloEditorHeadingNumbering: "mixed" },
  });
  expect(after.selection).toEqual(before.selection);
  return { before, after };
}

async function undoRedo(
  page: Page,
  before: Awaited<ReturnType<typeof inspect>>,
  after: Awaited<ReturnType<typeof inspect>>,
) {
  expect(await page.evaluate(() => window.__semloRequireFixture("ancestorHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await inspect(page)).json).toEqual(before.json);
  expect((await inspect(page)).selection).toEqual(before.selection);
  expect(await page.evaluate(() => window.__semloRequireFixture("ancestorHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await inspect(page)).json).toEqual(after.json);
  expect((await inspect(page)).selection).toEqual(after.selection);
}

for (const type of [null, "A"]) {
  for (const start of [1, 7]) {
    test(`decimal split preserves ancestors, start ${start}, type ${String(type)}, history and round trips`, async ({
      page,
    }) => {
      const attrs = {
        start,
        type,
        semloEditorOrderedStyle: "decimal",
        ...(start === 7 ? { semloEditorListLevelStarts: { 1: 3 } } : {}),
      };
      await mount(page, fixture(attrs));
      const { before, after } = await convert(page, "丙丙", 2, 0);
      const expected = start === 7 ? ["7.", "7.3.", "7.4.", "8."] : ["1.", "1.1.", "1.2.", "2."];
      const expectedMarkers = expected.map((marker) => `"${marker} "`);
      expect(await markers(page)).toEqual(
        ["甲甲", "乙乙", "丁丁", "戊戊"].map((text, index) => ({ text, marker: expectedMarkers[index] })),
      );
      expect(lists(after)).toHaveLength(2);
      expect(lists(after).map((list) => list.attrs?.type)).toEqual([type, type]);
      expect(lists(after).map((list) => list.attrs?.semloEditorOrderedAncestorPath)).toEqual([undefined, [start]]);
      expect(after.html).toContain("data-semlo-editor-ordered-ancestor-path");
      await undoRedo(page, before, after);
      for (const saved of [after.json, after.html]) {
        await page.evaluate(
          (content) => window.__semloRequireFixture("ancestorHeadingEditor").setContent(content),
          saved,
        );
        expect((await inspect(page)).json).toEqual(after.json);
        expect((await markers(page)).map(({ marker }) => marker)).toEqual(expectedMarkers);
      }
    });
  }
}

test("an existing ancestor path and level seeds survive a second split", async ({ page }) => {
  await mount(
    page,
    fixture(
      {
        start: 4,
        semloEditorOrderedStyle: "decimal",
        semloEditorOrderedAncestorPath: [7],
        semloEditorListLevelStarts: { 0: 8, 2: 3 },
      },
      [1, 2, 1, 2, 0],
    ),
  );
  const first = await convert(page, "丙丙");
  expect((await markers(page)).map(({ marker }) => marker)).toEqual(['"7.4. "', '"7.4.3. "', '"7.4.4. "', '"8. "']);
  expect(lists(first.after).map((list) => list.attrs?.semloEditorOrderedAncestorPath)).toEqual([[7], [7, 4]]);
  await undoRedo(page, first.before, first.after);
  const second = await convert(page, "丁丁");
  expect((await markers(page)).map(({ marker }) => marker)).toEqual(['"7.4. "', '"7.4.3. "', '"8. "']);
  expect(lists(second.after).map((list) => list.attrs?.semloEditorOrderedAncestorPath)).toEqual([[7], undefined]);
  expect(lists(second.after).at(-1)?.attrs?.start).toBe(8);
  await undoRedo(page, second.before, second.after);
  for (const saved of [second.after.json, second.after.html]) {
    await page.evaluate((content) => window.__semloRequireFixture("ancestorHeadingEditor").setContent(content), saved);
    expect((await inspect(page)).json).toEqual(second.after.json);
  }
});

test("an independent indented list does not acquire another list's ancestor", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [
      { type: "orderedList", attrs: { start: 7, semloEditorOrderedStyle: "decimal" }, content: [item("先前", 0)] },
      paragraph("隔断"),
      {
        type: "orderedList",
        attrs: { start: 4, semloEditorOrderedStyle: "decimal" },
        content: [item("甲甲", 1), item("乙乙", 1), item("丙丙", 1)],
      },
    ],
  });
  const { before, after } = await convert(page, "乙乙");
  expect(lists(after).map((list) => list.attrs?.semloEditorOrderedAncestorPath)).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect((await markers(page)).map(({ marker }) => marker)).toEqual(['"7. "', '"1.4. "', '"1.5. "']);
  await undoRedo(page, before, after);
});

test("converting a range of items recalculates the remaining decimal path in one history step", async ({ page }) => {
  await mount(page, fixture({ semloEditorOrderedStyle: "decimal" }));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("ancestorHeadingEditor").editor;
    const positions: Record<string, number> = {};
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock) positions[node.textContent] = pos + 1;
    });
    editor.view.focus();
    editor.commands.setTextSelection({ from: positions.乙乙, to: positions.丙丙 + 2 });
  });
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(after.changes - before.changes).toBe(1);
  expect(after.blocks.map((block) => block.text)).toEqual(before.blocks.map((block) => block.text));
  expect(after.blocks.filter((block) => !["乙乙", "丙丙"].includes(block.text))).toEqual(
    before.blocks.filter((block) => !["乙乙", "丙丙"].includes(block.text)),
  );
  expect(after.blocks.filter((block) => ["乙乙", "丙丙"].includes(block.text)).map((block) => block.node)).toEqual([
    expect.objectContaining({ type: "heading", attrs: expect.objectContaining({ level: 3 }) }),
    expect.objectContaining({ type: "heading", attrs: expect.objectContaining({ level: 3 }) }),
  ]);
  expect(after.selection).toEqual(before.selection);
  expect(await markers(page)).toEqual([
    { text: "甲甲", marker: '"1. "' },
    { text: "丁丁", marker: '"1.1. "' },
    { text: "戊戊", marker: '"2. "' },
  ]);
  expect(lists(after).map((list) => list.attrs?.semloEditorOrderedAncestorPath)).toEqual([undefined, [1]]);
  await undoRedo(page, before, after);
});

for (const path of [null, [7]]) {
  test(`mixed style ${path ? "retains an existing path" : "does not invent a path"}`, async ({ page }) => {
    await mount(
      page,
      fixture({ start: 4, semloEditorOrderedStyle: "mixed", semloEditorOrderedAncestorPath: path }, [1, 2, 1, 2, 0]),
    );
    const { before, after } = await convert(page, "丙丙");
    expect(lists(after).map((list) => list.attrs?.semloEditorOrderedAncestorPath)).toEqual(
      path ? [[7], [7, 4]] : [undefined, undefined],
    );
    await undoRedo(page, before, after);
  });
}

test("malformed ancestor metadata is rejected without changing the document or selection", async ({ page }) => {
  for (const path of ["invalid", [], [7, 8], [2147483648]]) {
    await mount(page, fixture({ semloEditorOrderedStyle: "decimal", semloEditorOrderedAncestorPath: path }, [1, 2, 1]));
    await select(page, "乙乙");
    const before = await inspect(page);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await inspect(page);
    expect(after.json).toEqual(before.json);
    expect(after.raw).toEqual(before.raw);
    expect(after.selection).toEqual(before.selection);
    expect(after.changes).toBe(before.changes);
  }
});

test("an ambiguous first-level change keeps its source intact until the numbering rule is verified", async ({
  page,
}) => {
  await mount(
    page,
    fixture({ start: 4, semloEditorOrderedStyle: "decimal", semloEditorOrderedAncestorPath: [7] }, [1, 0]),
  );
  expect(await markers(page)).toEqual([
    { text: "甲甲", marker: '"7.4. "' },
    { text: "乙乙", marker: '"1. "' },
  ]);
  // The existing block-delete path currently reuses start=4 at the new level.
  // That observed Semlo result does not establish the intended Yuque rule.
  await page.locator("#ancestor-heading-test").getByText("甲甲", { exact: true }).hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  await handle.waitFor({ state: "visible" });
  await handle.click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  expect(await markers(page)).toEqual([{ text: "乙乙", marker: '"4. "' }]);
  expect(await page.evaluate(() => window.__semloRequireFixture("ancestorHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  await select(page, "甲甲");
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(after.raw).toEqual(before.raw);
  expect(after.selection).toEqual(before.selection);
  expect(after.changes).toBe(before.changes);
});

test("a physically nested list with an explicit flat ancestor path is left unchanged", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { semloEditorOrderedStyle: "decimal", semloEditorOrderedAncestorPath: [7] },
        content: [
          {
            type: "listItem",
            attrs: { semloEditorListIndent: 1 },
            content: [paragraph("甲甲"), { type: "bulletList", content: [item("保留子项", 0)] }],
          },
          item("乙乙", 1),
        ],
      },
    ],
  });
  await select(page, "甲甲");
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(after.raw).toEqual(before.raw);
  expect(after.selection).toEqual(before.selection);
  expect(after.changes).toBe(before.changes);
});
