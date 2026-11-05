import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    observedLineHeightEditor?: EditorController;
    observedLineHeightChanges?: number;
    observedLineHeightErrors?: string[];
  }
}

const paragraph = (text: string, height: string | null = null): JSONContent => ({
  type: "paragraph",
  attrs: { semloEditorLineHeight: height },
  content: [{ type: "text", text }],
});
const heading = (text: string, level: number, height: string | null = null): JSONContent => ({
  type: "heading",
  attrs: { level, semloEditorLineHeight: height },
  content: [{ type: "text", text }],
});
const item = (text: string, height: string | null = null): JSONContent => ({
  type: "listItem",
  content: [paragraph(text, height)],
});
const bullet = (...content: JSONContent[]): JSONContent => ({ type: "bulletList", content });
const quote = (...content: JSONContent[]): JSONContent => ({ type: "blockquote", content });
const details = (...body: JSONContent[]): JSONContent => ({
  type: "details",
  attrs: { open: true },
  content: [
    { type: "detailsSummary", content: [{ type: "text", text: "折叠标题" }] },
    { type: "detailsContent", content: body },
  ],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'observed-line-height-test'
      document.body.append(host)
      window.observedLineHeightChanges = 0
      window.observedLineHeightErrors = []
      window.observedLineHeightEditor = createEditor({
        element: host, outline: false, content: '<p>初始内容</p>',
        onChange: () => { window.observedLineHeightChanges++ },
        onError: (error) => { window.observedLineHeightErrors.push(error.message) },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.observedLineHeightEditor));
  return page.locator("#observed-line-height-test");
}

async function setContent(page: Page, content: JSONContent) {
  await page.evaluate((value) => {
    const controller = window.observedLineHeightEditor;
    if (!controller) throw new Error("Editor not mounted");
    controller.setContent(value);
  }, content);
}

async function focusText(page: Page, text: string, selected = false, backward = false) {
  await page.evaluate(
    ({ text, selected, backward }) => {
      const controller = window.observedLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      const editor = controller.editor;
      let start = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === text) start = pos + 1;
      });
      if (start < 0) throw new Error(`Missing textblock: ${text}`);
      editor.view.focus();
      editor.commands.setTextSelection(
        selected
          ? backward
            ? { from: start + text.length, to: start }
            : { from: start, to: start + text.length }
          : start + 1,
      );
    },
    { text, selected, backward },
  );
}

async function focusAcross(page: Page, first: string, last: string, backward = false) {
  await page.evaluate(
    ({ first, last, backward }) => {
      const controller = window.observedLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      const editor = controller.editor;
      let start = -1;
      let end = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === first) start = pos + 1;
        if (node.isTextblock && node.textContent === last) end = pos + 1 + node.content.size;
      });
      if (start < 0 || end < 0) throw new Error("Missing selection boundaries");
      editor.view.focus();
      editor.commands.setTextSelection(backward ? { from: end, to: start } : { from: start, to: end });
    },
    { first, last, backward },
  );
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const controller = window.observedLineHeightEditor;
    if (!controller) throw new Error("Editor not mounted");
    const editor = controller.editor;
    const blocks: Array<{ text: string; height: string | null }> = [];
    editor.state.doc.descendants((node) => {
      if (node.isTextblock) blocks.push({ text: node.textContent, height: node.attrs.semloEditorLineHeight ?? null });
    });
    return {
      ...controller.getSnapshot(),
      blocks,
      selection: { anchor: editor.state.selection.anchor, head: editor.state.selection.head },
      selectedText: window.getSelection()?.toString() ?? "",
      focused: editor.view.hasFocus(),
      changes: window.observedLineHeightChanges ?? 0,
    };
  });
}

function withoutLineHeight(json: JSONContent): JSONContent {
  const copy = structuredClone(json);
  const clear = (node: JSONContent) => {
    if (node.attrs) delete node.attrs.semloEditorLineHeight;
    node.content?.forEach(clear);
  };
  clear(copy);
  return copy;
}

async function resetFromMenu(page: Page) {
  await page.locator("#observed-line-height-test").getByRole("button", { name: "行高调整" }).click();
  await page.getByRole("menuitem", { name: "默认", exact: true }).click();
}

const down = "ControlOrMeta+Alt+BracketLeft";
const up = "ControlOrMeta+Alt+BracketRight";

const observed = [
  ...Array.from({ length: 6 }, (_, index) => ({
    label: `H${index + 1}`,
    node: heading("目标标题", index + 1, "2"),
    text: "目标标题",
    selector: `.semlo-editor-prose > h${index + 1}`,
  })),
  {
    label: "bullet item",
    node: bullet(item("前一项"), item("目标列表项", "2")),
    text: "目标列表项",
    selector: ".semlo-editor-prose > ul > li:nth-child(2) > p",
  },
  {
    label: "quote",
    node: quote(paragraph("目标引用", "2")),
    text: "目标引用",
    selector: ".semlo-editor-prose > blockquote > p",
  },
  {
    label: "details body",
    node: details(paragraph("目标折叠正文", "2")),
    text: "目标折叠正文",
    selector: '.semlo-editor-prose > [data-type="details"] [data-type="detailsContent"] > p',
  },
] as const;

test("observed caret contexts step down after menu reset with one undo and HTML/JSON roundtrip", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const host = await mount(page);
  for (const fixture of observed) {
    await setContent(page, doc(paragraph("前文"), fixture.node, paragraph("后文")));
    await focusText(page, fixture.text);
    await resetFromMenu(page);
    const before = await inspect(page);
    expect(before.blocks.find((block) => block.text === fixture.text)?.height, fixture.label).toBeNull();
    expect(before.selection.anchor, fixture.label).toBe(before.selection.head);
    expect(before.focused, fixture.label).toBe(true);
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks.find((block) => block.text === fixture.text)?.height, fixture.label).toBe("1.5");
    expect(
      after.blocks.filter((block) => block.text !== fixture.text),
      fixture.label,
    ).toEqual(before.blocks.filter((block) => block.text !== fixture.text));
    expect(withoutLineHeight(after.json), fixture.label).toEqual(withoutLineHeight(before.json));
    expect(after.selection, fixture.label).toEqual(before.selection);
    expect(after.focused, fixture.label).toBe(true);
    expect(after.changes - before.changes, fixture.label).toBe(1);
    await expect(host.locator(fixture.selector), fixture.label).toHaveAttribute("data-semlo-editor-line-height", "1.5");
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.json, fixture.label).toEqual(before.json);
    expect(undone.selection, fixture.label).toEqual(before.selection);
    expect(undone.focused, fixture.label).toBe(true);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    const redone = await inspect(page);
    expect(redone.json, fixture.label).toEqual(after.json);
    expect(redone.selection, fixture.label).toEqual(before.selection);
    expect(redone.focused, fixture.label).toBe(true);
    for (const content of [after.json, after.html]) {
      const restored = await page.evaluate((value) => {
        const controller = window.observedLineHeightEditor;
        if (!controller) throw new Error("Editor not mounted");
        controller.setContent("<p>临时内容</p>");
        controller.setContent(value);
        return controller.getSnapshot();
      }, content);
      expect(restored.json, fixture.label).toEqual(after.json);
      expect(restored.text, fixture.label).toBe(after.text);
      await expect(host.locator(fixture.selector), fixture.label).toHaveAttribute(
        "data-semlo-editor-line-height",
        "1.5",
      );
    }
  }
  expect(await page.evaluate(() => window.observedLineHeightErrors)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("fully selected H1–H6 step down from default and keep both selection directions", async ({ page }) => {
  await mount(page);
  for (const [level, backward] of Array.from({ length: 6 }, (_, index) => index + 1).flatMap((level) => [
    [level, false] as const,
    [level, true] as const,
  ])) {
    await setContent(page, doc(heading("一级标题", level, "2"), paragraph("后文")));
    await focusText(page, "一级标题", true, backward);
    await resetFromMenu(page);
    const before = await inspect(page);
    expect(before.selection.anchor > before.selection.head).toBe(backward);
    expect(before.selectedText).toBe("一级标题");
    expect(before.blocks[0].height).toBeNull();
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks.map((block) => block.height)).toEqual(["1.5", null]);
    expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
    expect(after.selection).toEqual(before.selection);
    expect(after.selectedText).toBe(before.selectedText);
    expect(after.focused).toBe(true);
    expect(after.changes - before.changes).toBe(1);
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.json).toEqual(before.json);
    expect(undone.selection).toEqual(before.selection);
    expect(undone.focused).toBe(true);
  }
});

test("two adjacent root paragraphs step down together and retain forward or backward selections", async ({ page }) => {
  await mount(page);
  for (const backward of [false, true]) {
    await setContent(
      page,
      doc(paragraph("前文"), paragraph("第一段", "2"), paragraph("第二段", "2"), paragraph("后文")),
    );
    await focusAcross(page, "第一段", "第二段", backward);
    await resetFromMenu(page);
    const before = await inspect(page);
    expect(before.selection.anchor > before.selection.head).toBe(backward);
    expect(before.selectedText).toContain("第一段");
    expect(before.selectedText).toContain("第二段");
    expect(before.blocks.map((block) => block.height)).toEqual([null, null, null, null]);
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks.map((block) => block.height)).toEqual([null, "1.5", "1.5", null]);
    expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
    expect(after.selection).toEqual(before.selection);
    expect(after.selectedText).toBe(before.selectedText);
    expect(after.focused).toBe(true);
    expect(after.changes - before.changes).toBe(1);
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.json).toEqual(before.json);
    expect(undone.selection).toEqual(before.selection);
    expect(undone.focused).toBe(true);
  }
});

test("two adjacent flat bullet items step down together and retain forward or backward selections", async ({
  page,
}) => {
  await mount(page);
  for (const backward of [false, true]) {
    await setContent(page, doc(bullet(item("前一项"), item("第一项", "2"), item("第二项", "2")), paragraph("后文")));
    await focusAcross(page, "第一项", "第二项", backward);
    await resetFromMenu(page);
    const before = await inspect(page);
    expect(before.selection.anchor > before.selection.head).toBe(backward);
    expect(before.selectedText).toContain("第一项");
    expect(before.selectedText).toContain("第二项");
    expect(before.blocks.map((block) => block.height)).toEqual([null, null, null, null]);
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks.map((block) => block.height)).toEqual([null, "1.5", "1.5", null]);
    expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
    expect(after.selection).toEqual(before.selection);
    expect(after.selectedText).toBe(before.selectedText);
    expect(after.focused).toBe(true);
    expect(after.changes - before.changes).toBe(1);
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.json).toEqual(before.json);
    expect(undone.selection).toEqual(before.selection);
    expect(undone.focused).toBe(true);
  }
});

test("three or more consecutive paragraphs or flat bullet items step down together", async ({ page }) => {
  await mount(page);
  const cases = [
    { content: doc(paragraph("甲"), paragraph("乙"), paragraph("丙"), paragraph("后文")), last: "丙", count: 3 },
    { content: doc(bullet(item("甲"), item("乙"), item("丙")), paragraph("后文")), last: "丙", count: 3 },
    {
      content: doc(paragraph("甲"), paragraph("乙"), paragraph("丙"), paragraph("丁"), paragraph("后文")),
      last: "丁",
      count: 4,
    },
    { content: doc(bullet(item("甲"), item("乙"), item("丙"), item("丁")), paragraph("后文")), last: "丁", count: 4 },
  ];
  for (const fixture of cases) {
    await setContent(page, fixture.content);
    await focusAcross(page, "甲", fixture.last, fixture.count === 4);
    const before = await inspect(page);
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks.map((block) => block.height)).toEqual([...Array(fixture.count).fill("1.5"), null]);
    expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
    expect(after.selection).toEqual(before.selection);
    expect(after.focused).toBe(true);
    expect(after.changes - before.changes).toBe(1);
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.json).toEqual(before.json);
    expect(undone.selection).toEqual(before.selection);
    expect(undone.focused).toBe(true);
  }
});

test("root selections containing another block type or mixed heights keep their previous behavior", async ({
  page,
}) => {
  await mount(page);
  await setContent(page, doc(paragraph("甲"), heading("标题", 2), paragraph("乙"), paragraph("后文")));
  await focusAcross(page, "甲", "乙");
  let before = await inspect(page);
  await page.keyboard.press(down);
  let after = await inspect(page);
  expect(after.blocks.map((block) => block.height)).toEqual(["1.15", "1.15", "1.15", null]);
  expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
  expect(after.selection).toEqual(before.selection);
  expect(after.focused).toBe(true);
  await setContent(page, doc(paragraph("甲"), paragraph("乙", "2"), paragraph("丙"), paragraph("后文")));
  await focusAcross(page, "甲", "丙");
  before = await inspect(page);
  await page.keyboard.press(down);
  after = await inspect(page);
  expect(after.json).toEqual(before.json);
  expect(after.selection).toEqual(before.selection);
  expect(after.focused).toBe(true);
  expect(after.changes - before.changes).toBe(0);
});

test("partially selected H1–H6 step down and keep the single-character selection", async ({ page }) => {
  await mount(page);
  for (let level = 1; level <= 6; level++) {
    await setContent(page, doc(heading("目标", level), paragraph("后文")));
    await focusText(page, "目标");
    await page.evaluate(() => {
      const controller = window.observedLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      const editor = controller.editor;
      const from = editor.state.selection.from;
      editor.commands.setTextSelection({ from, to: from + 1 });
    });
    const partial = await inspect(page);
    expect(partial.selectedText).toBe("标");
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks[0].height).toBe("1.5");
    expect(after.selection).toEqual(partial.selection);
    expect(after.focused).toBe(true);
    expect(after.changes - partial.changes).toBe(1);
  }
});

test("unobserved container selections retain their old step", async ({ page }) => {
  await mount(page);
  for (const node of [quote(paragraph("目标")), details(paragraph("目标"))]) {
    await setContent(page, doc(node, paragraph("后文")));
    await focusText(page, "目标", true);
    const before = await inspect(page);
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks.find((block) => block.text === "目标")?.height).toBe("1.15");
    expect(after.selection).toEqual(before.selection);
    expect(after.selectedText).toBe("目标");
    expect(after.focused).toBe(true);
  }
});

test("nested lists and complex quote or details bodies keep the previous step", async ({ page }) => {
  await mount(page);
  const cases = [
    { type: "orderedList", content: [{ type: "listItem", content: [paragraph("父项"), bullet(item("目标"))] }] },
    bullet(item("目标"), { type: "listItem", content: [paragraph("父项"), bullet(item("子项"))] }),
    quote(paragraph("目标"), paragraph("引用次段")),
    quote(quote(paragraph("目标"))),
    details(paragraph("目标"), paragraph("卡片次段")),
    details(quote(paragraph("目标"))),
  ] satisfies JSONContent[];
  for (const node of cases) {
    await setContent(page, doc(node, paragraph("后文")));
    await focusText(page, "目标");
    const before = await inspect(page);
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks.find((block) => block.text === "目标")?.height).toBe("1.15");
    expect(after.blocks.filter((block) => block.text !== "目标")).toEqual(
      before.blocks.filter((block) => block.text !== "目标"),
    );
    expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
    expect(after.selection).toEqual(before.selection);
    expect(after.focused).toBe(true);
  }
});

test("details summary shortcut leaves both title and existing body height untouched", async ({ page }) => {
  await mount(page);
  await setContent(page, doc(details(paragraph("折叠正文", "1.5")), paragraph("后文")));
  await focusText(page, "折叠标题");
  const before = await inspect(page);
  await page.keyboard.press(down);
  const after = await inspect(page);
  expect(after.json).toEqual(before.json);
  expect(after.blocks.find((block) => block.text === "折叠正文")?.height).toBe("1.5");
  expect(after.selection).toEqual(before.selection);
  expect(after.focused).toBe(true);
  expect(after.changes - before.changes).toBe(0);
});

test("existing explicit steps, default upward step and lower boundary remain unchanged", async ({ page }) => {
  await mount(page);
  for (const nodeForHeight of [
    (height: string | null) => heading("目标", 1, height),
    (height: string | null) => bullet(item("目标", height)),
    (height: string | null) => quote(paragraph("目标", height)),
    (height: string | null) => details(paragraph("目标", height)),
  ]) {
    for (const [height, key, expected, changes] of [
      ["1.5", down, "1.15", 1],
      ["1", down, "1", 0],
      [null, up, "2", 1],
    ] as const) {
      await setContent(page, doc(nodeForHeight(height), paragraph("后文")));
      await focusText(page, "目标");
      const before = await inspect(page);
      await page.keyboard.press(key);
      const after = await inspect(page);
      expect(after.blocks.find((block) => block.text === "目标")?.height).toBe(expected);
      expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
      expect(after.selection).toEqual(before.selection);
      expect(after.focused).toBe(true);
      expect(after.changes - before.changes).toBe(changes);
    }
  }
});
