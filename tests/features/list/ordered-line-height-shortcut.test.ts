import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    orderedLineHeightEditor?: EditorController;
    orderedLineHeightChanges?: number;
    orderedLineHeightErrors?: string[];
  }
}

const paragraph = (text: string, height: string | null = null): JSONContent => ({
  type: "paragraph",
  attrs: { semloEditorLineHeight: height },
  content: [{ type: "text", text }],
});
const item = (text: string, height: string | null = null): JSONContent => ({
  type: "listItem",
  content: [paragraph(text, height)],
});
const ordered = (...content: JSONContent[]): JSONContent => ({ type: "orderedList", content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const initial = (height: string | null = null) =>
  doc(paragraph("上方正文"), ordered(item("第一项"), item("第二项", height), item("第三项")), paragraph("下方正文"));

async function mount(page: Page, content: JSONContent) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'ordered-line-height-test'
      document.body.append(host)
      window.orderedLineHeightChanges = 0
      window.orderedLineHeightErrors = []
      window.orderedLineHeightEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        onChange: () => { window.orderedLineHeightChanges++ },
        onError: (error) => { window.orderedLineHeightErrors.push(error.message) },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.orderedLineHeightEditor));
  return page.locator("#ordered-line-height-test");
}

async function selectText(page: Page, text: string, kind: "all" | "backward" | "caret" = "all") {
  await page.evaluate(
    ({ text, kind }) => {
      const controller = window.orderedLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      const editor = controller.editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === text) position = pos + 1;
      });
      if (position < 0) throw new Error(`Missing textblock: ${text}`);
      const start = position;
      const end = start + text.length;
      editor.view.focus();
      editor.commands.setTextSelection(
        kind === "caret" ? start + 1 : kind === "backward" ? { from: end, to: start } : { from: start, to: end },
      );
    },
    { text, kind },
  );
}

async function selectAcross(page: Page, first: string, last: string, backward = false) {
  await page.evaluate(
    ({ first, last, backward }) => {
      const controller = window.orderedLineHeightEditor;
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
    const controller = window.orderedLineHeightEditor;
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
      changes: window.orderedLineHeightChanges ?? 0,
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

const down = "ControlOrMeta+Alt+BracketLeft";
const up = "ControlOrMeta+Alt+BracketRight";

async function resetFromMenu(page: Page) {
  await page.locator("#ordered-line-height-test").getByRole("button", { name: "行高调整" }).click();
  await page.getByRole("menuitem", { name: "默认", exact: true }).click();
}

async function pressAndCheck(page: Page, key: string, expected: string | null, expectedChanges = 1, target = "第二项") {
  const before = await inspect(page);
  await page.keyboard.press(key);
  const after = await inspect(page);
  expect(after.blocks.find((block) => block.text === target)?.height).toBe(expected);
  expect(after.blocks.filter((block) => block.text !== target)).toEqual(
    before.blocks.filter((block) => block.text !== target),
  );
  expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
  expect(after.selection).toEqual(before.selection);
  expect(after.selectedText).toBe(before.selectedText);
  expect(after.focused).toBe(true);
  expect(after.changes - before.changes).toBe(expectedChanges);
  return { before, after };
}

test("selected ordered item steps from default, survives menu reset, undo, and serialization", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const host = await mount(page, initial());
  await selectText(page, "第二项", "backward");
  const original = await inspect(page);
  expect(original.selection.anchor).toBeGreaterThan(original.selection.head);
  expect(original.selectedText).toBe("第二项");
  const { after: decreased } = await pressAndCheck(page, down, "1.5");
  await expect(host.locator(".semlo-editor-prose > ol > li").nth(1).locator("p").first()).toHaveAttribute(
    "data-semlo-editor-line-height",
    "1.5",
  );
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await inspect(page);
  expect(undone.json).toEqual(original.json);
  expect(undone.selection).toEqual(original.selection);
  expect(undone.focused).toBe(true);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  const redone = await inspect(page);
  expect(redone.json).toEqual(decreased.json);
  expect(redone.selection).toEqual(original.selection);
  expect(redone.focused).toBe(true);

  await resetFromMenu(page);
  expect((await inspect(page)).blocks.find((block) => block.text === "第二项")?.height).toBeNull();
  await pressAndCheck(page, up, "2");
  await pressAndCheck(page, up, "2.5");
  await resetFromMenu(page);
  expect((await inspect(page)).blocks.find((block) => block.text === "第二项")?.height).toBeNull();
  const { after } = await pressAndCheck(page, down, "1.5");

  for (const content of [after.json, after.html]) {
    const restored = await page.evaluate((value) => {
      const controller = window.orderedLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent("<p>临时内容</p>");
      controller.setContent(value);
      return controller.getSnapshot();
    }, content);
    expect(restored.json).toEqual(after.json);
    expect(restored.text).toBe(after.text);
    await expect(host.locator(".semlo-editor-prose > ol > li").nth(1).locator("p").first()).toHaveAttribute(
      "data-semlo-editor-line-height",
      "1.5",
    );
  }
  expect(await page.evaluate(() => window.orderedLineHeightErrors)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("ordered item caret remains collapsed after default reset and one undo step", async ({ page }) => {
  await mount(page, initial("2"));
  await selectText(page, "第二项", "caret");
  await resetFromMenu(page);
  const { before } = await pressAndCheck(page, down, "1.5");
  expect(before.selection.anchor).toBe(before.selection.head);
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await inspect(page);
  expect(undone.json).toEqual(before.json);
  expect(undone.selection).toEqual(before.selection);
  expect(undone.focused).toBe(true);
});

test("root paragraph selection or caret steps down after the default menu reset", async ({ page }) => {
  const content = doc(paragraph("前段"), paragraph("普通正文", "2"), paragraph("后段"));
  const host = await mount(page, content);
  for (const kind of ["all", "caret"] as const) {
    await page.evaluate((value) => {
      const controller = window.orderedLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent(value);
    }, content);
    await selectText(page, "普通正文", kind);
    await resetFromMenu(page);
    const reset = await inspect(page);
    expect(reset.blocks.find((block) => block.text === "普通正文")?.height).toBeNull();
    expect(reset.selectedText).toBe(kind === "all" ? "普通正文" : "");
    const { before, after } = await pressAndCheck(page, down, "1.5", 1, "普通正文");
    await expect(host.locator(".semlo-editor-prose > p").nth(1)).toHaveAttribute(
      "data-semlo-editor-line-height",
      "1.5",
    );
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.json).toEqual(before.json);
    expect(undone.selection).toEqual(before.selection);
    expect(undone.focused).toBe(true);
    for (const value of [after.json, after.html]) {
      const restored = await page.evaluate((snapshot) => {
        const controller = window.orderedLineHeightEditor;
        if (!controller) throw new Error("Editor not mounted");
        controller.setContent("<p>临时内容</p>");
        controller.setContent(snapshot);
        return controller.getSnapshot();
      }, value);
      expect(restored.json).toEqual(after.json);
      expect(restored.text).toBe(after.text);
    }
  }
});

test("contiguous ordered items step together after default reset for forward and backward selections", async ({
  page,
}) => {
  const content = doc(ordered(item("第一项"), item("第二项", "2"), item("第三项", "2")), paragraph("末尾"));
  await mount(page, content);
  for (const backward of [false, true]) {
    await page.evaluate((value) => {
      const controller = window.orderedLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent(value);
    }, content);
    await selectAcross(page, "第二项", "第三项", backward);
    const selected = await inspect(page);
    expect(selected.selection.anchor > selected.selection.head).toBe(backward);
    expect(selected.selectedText).toContain("第二项");
    expect(selected.selectedText).toContain("第三项");
    await resetFromMenu(page);
    const before = await inspect(page);
    expect(before.selection).toEqual(selected.selection);
    expect(before.focused).toBe(true);
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
    await page.keyboard.press("ControlOrMeta+Shift+z");
    const redone = await inspect(page);
    expect(redone.json).toEqual(after.json);
    expect(redone.selection).toEqual(before.selection);
    expect(redone.focused).toBe(true);
  }
});

test("mixed values, different lists, and multi-paragraph items keep their existing behavior", async ({ page }) => {
  const fixtures = [
    {
      content: doc(ordered(item("甲"), item("乙", "2")), paragraph("末尾")),
      heights: [null, "2", null],
      changes: 0,
    },
    {
      content: doc(ordered(item("甲")), paragraph("夹段"), ordered(item("乙")), paragraph("末尾")),
      heights: ["1.15", "1.15", "1.15", null],
      changes: 1,
    },
    {
      content: doc(
        ordered({ type: "listItem", content: [paragraph("甲"), paragraph("甲后")] }, item("乙")),
        paragraph("末尾"),
      ),
      heights: ["1.15", "1.15", "1.15", null],
      changes: 1,
    },
  ];
  await mount(page, fixtures[0].content);
  for (const fixture of fixtures) {
    await page.evaluate((value) => {
      const controller = window.orderedLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent(value);
    }, fixture.content);
    await selectAcross(page, "甲", "乙");
    const before = await inspect(page);
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks.map((block) => block.height)).toEqual(fixture.heights);
    expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
    expect(after.selection).toEqual(before.selection);
    expect(after.focused).toBe(true);
    expect(after.changes - before.changes).toBe(fixture.changes);
  }
});

test("explicit old values and end stops preserve the existing step sequence", async ({ page }) => {
  await mount(page, initial());
  const cases = [
    ["1", down, "1"],
    ["1.15", down, "1"],
    ["1.5", down, "1.15"],
    ["2", down, "1.5"],
    ["2.5", down, "2"],
    ["3", down, "2.5"],
    ["1", up, "1.15"],
    ["1.15", up, "1.5"],
    ["1.5", up, "2"],
    ["2", up, "2.5"],
    ["2.5", up, "3"],
    ["3", up, "3"],
  ] as const;
  for (const [old, key, next] of cases) {
    await page.evaluate((content) => {
      const controller = window.orderedLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent(content);
    }, initial(old));
    await selectText(page, "第二项");
    const { before, after } = await pressAndCheck(page, key, next, old === next ? 0 : 1);
    if (old === next) expect(after.json).toEqual(before.json);
  }
});

test("paragraph, heading, other lists, containers, and mixed selections retain their previous behavior", async ({
  page,
}) => {
  const content = doc(
    paragraph("正文"),
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题" }] },
    {
      type: "bulletList",
      content: [item("无序项"), { type: "listItem", content: [paragraph("外层"), ordered(item("嵌套项"))] }],
    },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [paragraph("待办项")] }] },
    { type: "blockquote", content: [ordered(item("引用项"))] },
    paragraph("隔开"),
    ordered({ type: "listItem", content: [paragraph("首段"), paragraph("后段")] }),
    paragraph("再隔开"),
    ordered(item("平铺项"), {
      type: "listItem",
      content: [paragraph("旁支父项"), { type: "bulletList", content: [item("旁支嵌套")] }],
    }),
    paragraph("末尾"),
  );
  await mount(page, content);
  for (const text of ["无序项", "嵌套项", "引用项", "后段", "平铺项"]) {
    await page.evaluate((value) => {
      const controller = window.orderedLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent(value);
    }, content);
    await selectText(page, text);
    const before = await inspect(page);
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks).toEqual(
      before.blocks.map((block) => (block.text === text ? { ...block, height: "1.15" } : block)),
    );
    expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
    expect(after.selection).toEqual(before.selection);
    expect(after.focused).toBe(true);
    expect(after.changes - before.changes).toBe(1);
  }
  await page.evaluate((value) => {
    const controller = window.orderedLineHeightEditor;
    if (!controller) throw new Error("Editor not mounted");
    controller.setContent(value);
  }, content);
  await selectAcross(page, "正文", "标题");
  const before = await inspect(page);
  await page.keyboard.press(down);
  const after = await inspect(page);
  expect(after.blocks).toEqual(
    before.blocks.map((block) => (["正文", "标题"].includes(block.text) ? { ...block, height: "1.15" } : block)),
  );
  expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
  expect(after.selection).toEqual(before.selection);
  expect(after.focused).toBe(true);
  expect(after.changes - before.changes).toBe(1);
});
