import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    taskLineHeightEditor?: EditorController;
    taskLineHeightChanges?: number;
    taskLineHeightErrors?: string[];
  }
}

const paragraph = (text: string, height: string | null = null): JSONContent => ({
  type: "paragraph",
  attrs: { semloEditorLineHeight: height },
  content: [{ type: "text", text }],
});
const taskItem = (text: string, height: string | null = null, indent = 0, checked = false): JSONContent => ({
  type: "taskItem",
  attrs: { checked, semloEditorListIndent: indent },
  content: [paragraph(text, height)],
});
const bulletItem = (text: string, height: string | null = null, indent = 0): JSONContent => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text, height)],
});
const list = (type: "taskList" | "bulletList", ...content: JSONContent[]): JSONContent => ({ type, content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'task-line-height-test'
      document.body.append(host)
      window.taskLineHeightChanges = 0
      window.taskLineHeightErrors = []
      window.taskLineHeightEditor = createEditor({
        element: host, outline: false, content: '<p>初始内容</p>',
        onChange: () => { window.taskLineHeightChanges++ },
        onError: (error) => { window.taskLineHeightErrors.push(error.message) },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.taskLineHeightEditor));
  return page.locator("#task-line-height-test");
}

async function setContent(page: Page, content: JSONContent) {
  await page.evaluate((value) => {
    const controller = window.taskLineHeightEditor;
    if (!controller) throw new Error("Editor not mounted");
    controller.setContent(value);
  }, content);
}

async function focusText(page: Page, text: string, selection: "caret" | "forward" | "backward" | "partial" = "caret") {
  await page.evaluate(
    ({ text, selection }) => {
      const controller = window.taskLineHeightEditor;
      if (!controller) throw new Error("Editor not mounted");
      const editor = controller.editor;
      let start = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === text) start = pos + 1;
      });
      if (start < 0) throw new Error(`Missing textblock: ${text}`);
      editor.view.focus();
      editor.commands.setTextSelection(
        selection === "caret"
          ? start + 1
          : selection === "partial"
            ? { from: start + 1, to: start + 2 }
            : selection === "backward"
              ? { from: start + text.length, to: start }
              : { from: start, to: start + text.length },
      );
    },
    { text, selection },
  );
}

async function focusAcross(page: Page, first: string, last: string) {
  await page.evaluate(
    ({ first, last }) => {
      const controller = window.taskLineHeightEditor;
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
      editor.commands.setTextSelection({ from: start, to: end });
    },
    { first, last },
  );
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const controller = window.taskLineHeightEditor;
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
      changes: window.taskLineHeightChanges ?? 0,
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
  await page.locator("#task-line-height-test").getByRole("button", { name: "行高调整" }).click();
  await page.getByRole("menuitem", { name: "默认", exact: true }).click();
}
const down = "ControlOrMeta+Alt+BracketLeft";

test("task item caret and full selection, plus indented task and bullet items, step from default", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const host = await mount(page);
  const cases = [
    { type: "taskList", selection: "caret", indent: 0, checked: false },
    { type: "taskList", selection: "forward", indent: 0, checked: false },
    { type: "taskList", selection: "backward", indent: 0, checked: true },
    { type: "taskList", selection: "caret", indent: 1, checked: true },
    { type: "bulletList", selection: "forward", indent: 0, checked: false },
    { type: "bulletList", selection: "caret", indent: 1, checked: false },
  ] as const;
  for (const fixture of cases) {
    const target =
      fixture.type === "taskList"
        ? taskItem("待办目标", "2", fixture.indent, fixture.checked)
        : bulletItem("待办目标", "2", fixture.indent);
    const sibling = fixture.type === "taskList" ? taskItem("前一项") : bulletItem("前一项");
    await setContent(page, doc(paragraph("前文"), list(fixture.type, sibling, target), paragraph("后文")));
    await focusText(page, "待办目标", fixture.selection);
    await resetFromMenu(page);
    const before = await inspect(page);
    expect(before.blocks.map((block) => block.height)).toEqual([null, null, null, null]);
    expect(before.selectedText).toBe(fixture.selection === "caret" ? "" : "待办目标");
    expect(before.selection.anchor === before.selection.head).toBe(fixture.selection === "caret");
    if (fixture.selection === "backward") expect(before.selection.anchor).toBeGreaterThan(before.selection.head);
    expect(before.focused).toBe(true);
    const element = host.locator(".semlo-editor-prose p").filter({ hasText: "待办目标" });
    if (fixture.indent)
      await expect(element.locator("xpath=ancestor::li[1]")).toHaveAttribute("data-semlo-editor-list-indent", "1");
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks.map((block) => block.height)).toEqual([null, null, "1.5", null]);
    expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
    expect(after.selection).toEqual(before.selection);
    expect(after.selectedText).toBe(before.selectedText);
    expect(after.focused).toBe(true);
    expect(after.changes - before.changes).toBe(1);
    await expect(element).toHaveAttribute("data-semlo-editor-line-height", "1.5");
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
    for (const content of [after.json, after.html]) {
      const restored = await page.evaluate((value) => {
        const controller = window.taskLineHeightEditor;
        if (!controller) throw new Error("Editor not mounted");
        controller.setContent("<p>临时内容</p>");
        controller.setContent(value);
        return controller.getSnapshot();
      }, content);
      expect(restored.json).toEqual(after.json);
      expect(restored.text).toBe(after.text);
      await expect(element).toHaveAttribute("data-semlo-editor-line-height", "1.5");
    }
  }
  expect(await page.evaluate(() => window.taskLineHeightErrors)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("partial selections, multiple task items and physical nesting retain previous behavior", async ({ page }) => {
  await mount(page);
  await setContent(page, doc(list("taskList", taskItem("待办目标")), paragraph("后文")));
  await focusText(page, "待办目标", "partial");
  const partial = await inspect(page);
  expect(partial.selectedText).toBe("办");
  await page.keyboard.press(down);
  const partialAfter = await inspect(page);
  expect(partialAfter.blocks[0].height).toBe("1.15");
  expect(partialAfter.selection).toEqual(partial.selection);
  expect(partialAfter.focused).toBe(true);

  await setContent(page, doc(list("taskList", taskItem("第一项"), taskItem("第二项")), paragraph("后文")));
  await focusAcross(page, "第一项", "第二项");
  const multi = await inspect(page);
  await page.keyboard.press(down);
  const multiAfter = await inspect(page);
  expect(multiAfter.blocks.map((block) => block.height)).toEqual(["1.15", "1.15", null]);
  expect(withoutLineHeight(multiAfter.json)).toEqual(withoutLineHeight(multi.json));
  expect(multiAfter.selection).toEqual(multi.selection);
  expect(multiAfter.focused).toBe(true);

  const nestedTask: JSONContent = {
    type: "taskItem",
    attrs: { checked: false },
    content: [paragraph("父项"), list("taskList", taskItem("待办目标"))],
  };
  for (const content of [
    doc(list("taskList", nestedTask), paragraph("后文")),
    doc(
      list("taskList", taskItem("待办目标"), {
        type: "taskItem",
        attrs: { checked: false },
        content: [paragraph("父项"), list("taskList", taskItem("子任务"))],
      }),
      paragraph("后文"),
    ),
  ]) {
    await setContent(page, content);
    await focusText(page, "待办目标");
    const before = await inspect(page);
    await page.keyboard.press(down);
    const after = await inspect(page);
    expect(after.blocks.find((block) => block.text === "待办目标")?.height).toBe("1.15");
    expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(before.json));
    expect(after.selection).toEqual(before.selection);
    expect(after.focused).toBe(true);
  }
});

test("immediate shortcuts use the selection created by real mouse and keyboard input", async ({ page }) => {
  const host = await mount(page);
  await setContent(page, doc(paragraph("甲乙丙丁"), paragraph("子丑寅卯"), paragraph("后文")));
  const original = await inspect(page);
  const bounds = async (index: number) =>
    host
      .locator(".semlo-editor-prose > p")
      .nth(index)
      .evaluate((element) => {
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        const rect = range.getBoundingClientRect();
        return { left: rect.left, right: rect.right, middle: (rect.top + rect.bottom) / 2 };
      });
  const first = await bounds(0);
  const second = await bounds(1);
  await page.mouse.move(first.left + 0.5, first.middle);
  await page.mouse.down();
  await page.mouse.move(second.right - 0.5, second.middle, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press(down);
  const after = await inspect(page);
  const selected = await page.evaluate(() => {
    const editor = window.taskLineHeightEditor?.editor;
    if (!editor) throw new Error("Editor not mounted");
    const { $from, $to } = editor.state.selection;
    return {
      first: $from.parent.textContent,
      last: $to.parent.textContent,
      firstOffset: $from.parentOffset,
      lastOffset: $to.parentOffset,
    };
  });
  expect(after.blocks.map((block) => block.height)).toEqual(["1.5", "1.5", null]);
  expect(after.selectedText).toContain("甲乙丙丁");
  expect(after.selectedText).toContain("子丑寅卯");
  expect(selected).toEqual({ first: "甲乙丙丁", last: "子丑寅卯", firstOffset: 0, lastOffset: 4 });
  expect(withoutLineHeight(after.json)).toEqual(withoutLineHeight(original.json));
  expect(after.changes - original.changes).toBe(1);
  expect(after.focused).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await inspect(page);
  expect(undone.json).toEqual(original.json);
  expect(undone.selection).toEqual(after.selection);
  expect(undone.focused).toBe(true);

  await setContent(page, doc(list("taskList", taskItem("前一项"), taskItem("待办目标")), paragraph("后文")));
  const taskOriginal = await inspect(page);
  const taskText = host.locator(".semlo-editor-prose p").filter({ hasText: "待办目标" });
  await taskText.scrollIntoViewIfNeeded();
  const taskBounds = await taskText.evaluate((element) => {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    return { left: rect.left, middle: (rect.top + rect.bottom) / 2 };
  });
  await page.mouse.click(taskBounds.left + 0.5, taskBounds.middle);
  await page.keyboard.down("Shift");
  for (let index = 0; index < "待办目标".length; index++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await page.keyboard.press(down);
  const taskAfter = await inspect(page);
  expect(taskAfter.blocks.map((block) => block.height)).toEqual([null, "1.5", null]);
  expect(taskAfter.selectedText).toBe("待办目标");
  expect(withoutLineHeight(taskAfter.json)).toEqual(withoutLineHeight(taskOriginal.json));
  expect(taskAfter.changes - taskOriginal.changes).toBe(1);
  expect(taskAfter.focused).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  const taskUndone = await inspect(page);
  expect(taskUndone.json).toEqual(taskOriginal.json);
  expect(taskUndone.selection).toEqual(taskAfter.selection);
  expect(taskUndone.focused).toBe(true);
});
