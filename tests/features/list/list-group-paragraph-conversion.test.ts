import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    listParagraphEditor?: EditorController;
    listParagraphChanges?: number;
    listParagraphErrors?: string[];
  }
}

const paragraph = (text: string, mark?: "bold" | "italic"): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(mark ? { marks: [{ type: mark }] } : {}) }],
});
const item = (text: string, indent: number, mark?: "bold" | "italic"): JSONContent => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text, mark)],
});
const documentFor = (start: number): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "orderedList",
      attrs: { start, semloEditorOrderedStyle: "decimal" },
      content: [item("乙", 0, "bold"), item("丙", 1, "italic"), item("丁", 0), item("戊", 0)],
    },
    paragraph("末尾"),
  ],
});

async function mount(page: Page, content: JSONContent, withHostAttributes = false) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'list-paragraph-test'
      document.body.append(host)
      window.listParagraphChanges = 0
      window.listParagraphErrors = []
      const hostAttributes = Extension.create({ name: 'host-list-attributes', addGlobalAttributes() {
        return [
          { types: ['listItem'], attributes: {
            hostKey: {
              default: 'baseline', parseHTML: element => element.getAttribute('data-host-key') ?? 'baseline',
              renderHTML: attrs => attrs.hostKey === 'baseline' ? {} : { 'data-host-key': attrs.hostKey },
            },
            hostFlag: { default: false },
            hostPayload: { default: null },
          } },
          { types: ['orderedList'], attributes: {
            hostListKey: {
              default: null, parseHTML: element => element.getAttribute('data-host-list-key'),
              renderHTML: attrs => attrs.hostListKey == null ? {} : { 'data-host-list-key': attrs.hostListKey },
            },
          } },
        ]
      } })
      window.listParagraphEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        extensions: ${withHostAttributes ? "[hostAttributes]" : "[]"},
        onChange: () => { window.listParagraphChanges++ },
        onError: (error) => { window.listParagraphErrors.push(error.message) },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.listParagraphEditor));
  return page.locator("#list-paragraph-test");
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const controller = window.listParagraphEditor;
    if (!controller) throw new Error("Editor not mounted");
    const { selection } = controller.editor.state;
    const textBlocks: Array<{ text: string; content: unknown }> = [];
    controller.editor.state.doc.descendants((node) => {
      if (node.isTextblock) textBlocks.push({ text: node.textContent, content: node.content.toJSON() });
    });
    return {
      ...controller.getSnapshot(),
      textBlocks,
      changes: window.listParagraphChanges ?? 0,
      focused: controller.editor.view.hasFocus(),
      selection: {
        anchor: selection.anchor,
        head: selection.head,
        parent: selection.$from.parent.textContent,
        offset: selection.$from.parentOffset,
      },
    };
  });
}

async function markers(page: Page) {
  return page.locator("#list-paragraph-test .semlo-editor-prose > ol > li").evaluateAll((items) =>
    items.map((element) => ({
      text: Array.from(element.children).find((child) => child.tagName === "P")?.textContent,
      marker: getComputedStyle(element).listStyleType,
      indent: element.getAttribute("data-semlo-editor-list-indent"),
    })),
  );
}

async function convertParent(page: Page) {
  const host = page.locator("#list-paragraph-test");
  await host.getByText("乙", { exact: true }).hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  await handle.waitFor({ state: "visible" });
  await handle.click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "正文", exact: true }).click();
}

async function selectBackward(page: Page, text: string) {
  await page.evaluate((text) => {
    const controller = window.listParagraphEditor;
    if (!controller) throw new Error("Editor not mounted");
    const editor = controller.editor;
    let start = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === text) start = pos + 1;
    });
    if (start < 0) throw new Error(`Missing textblock ${text}`);
    editor.view.focus();
    editor.commands.setTextSelection({ from: start + text.length, to: start });
  }, text);
}

for (const { start, folded } of [
  { start: 1, folded: false },
  { start: 1, folded: true },
  { start: 7, folded: false },
] as const) {
  test(`a ${folded ? "folded " : ""}flat parent and child become paragraphs while remaining items use start ${start}`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const host = await mount(page, documentFor(start));
    if (folded) {
      await host.getByText("乙", { exact: true }).hover();
      await host.getByRole("button", { name: "折叠列表项：乙" }).click();
      await expect(host.getByText("丙", { exact: true })).toBeHidden();
    }
    const before = await inspect(page);
    await convertParent(page);
    const after = await inspect(page);
    const nodes = after.json.content ?? [];
    expect(nodes.map((node) => node.type)).toEqual(["paragraph", "paragraph", "orderedList", "paragraph"]);
    expect(nodes[0].content?.[0].text).toBe("乙");
    expect(nodes[1].content?.[0].text).toBe("丙");
    expect(nodes[0].content?.[0].marks).toEqual([{ type: "bold" }]);
    expect(nodes[1].content?.[0].marks).toEqual([{ type: "italic" }]);
    expect(nodes[0].attrs?.semloEditorIndent).toBe(0);
    expect(nodes[1].attrs?.semloEditorIndent).toBe(1);
    expect(nodes[2].attrs?.start).toBe(start);
    expect(nodes[2].content?.map((node) => node.content?.[0].content?.[0].text)).toEqual(["丁", "戊"]);
    expect(await markers(page)).toEqual([
      { text: "丁", marker: `"${start}. "`, indent: null },
      { text: "戊", marker: `"${start + 1}. "`, indent: null },
    ]);
    await expect(host.locator(".semlo-editor-prose > p").nth(1)).toHaveAttribute("data-semlo-editor-indent", "1");
    await expect(host.getByText("丙", { exact: true })).toBeVisible();
    expect(after.textBlocks).toEqual(before.textBlocks);
    expect(after.changes - before.changes).toBe(1);
    expect(after.focused).toBe(true);
    expect(after.selection.anchor).toBe(after.selection.head);
    expect(after.selection).toMatchObject({ parent: "乙", offset: 0 });

    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.json).toEqual(before.json);
    if (folded) await expect(host.getByText("丙", { exact: true })).toBeHidden();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    const redone = await inspect(page);
    expect(redone.json).toEqual(after.json);
    for (const value of [after.json, after.html]) {
      const restored = await page.evaluate((content) => {
        const controller = window.listParagraphEditor;
        if (!controller) throw new Error("Editor not mounted");
        controller.setContent("<p>临时内容</p>");
        controller.setContent(content);
        return controller.getSnapshot();
      }, value);
      expect(restored.json).toEqual(after.json);
      expect(restored.text).toBe(after.text);
      expect(await markers(page)).toEqual([
        { text: "丁", marker: `"${start}. "`, indent: null },
        { text: "戊", marker: `"${start + 1}. "`, indent: null },
      ]);
    }
    expect(await page.evaluate(() => window.listParagraphErrors)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test("the toolbar's existing paragraph conversion keeps its original format-clearing behavior", async ({ page }) => {
  const host = await mount(page, documentFor(1));
  const before = await inspect(page);
  await page.evaluate(() => {
    const controller = window.listParagraphEditor;
    if (!controller) throw new Error("Editor not mounted");
    const editor = controller.editor;
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "乙") from = pos + 1;
      if (node.isTextblock && node.textContent === "丙") to = pos + node.nodeSize - 1;
    });
    if (from < 0 || to < 0) throw new Error("Missing group selection");
    editor.view.focus();
    editor.commands.setTextSelection({ from, to });
  });
  await host.getByRole("button", { name: "段落样式" }).click();
  await page.getByRole("menu", { name: "段落样式" }).getByRole("menuitemradio", { name: "正文", exact: true }).click();
  const after = await inspect(page);
  expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", "paragraph"]);
  await expect(host.locator(".semlo-editor-prose > ol > li strong")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose > ol > li em")).toHaveCount(0);
  expect(after.changes - before.changes).toBe(1);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
});

test("a list group with existing paragraph indentation is left unchanged", async ({ page }) => {
  const content = documentFor(1);
  const child = content.content?.[0].content?.[1].content?.[0];
  if (!child) throw new Error("Missing child paragraph");
  child.attrs = { ...child.attrs, semloEditorIndent: 1 };
  await mount(page, content);
  const before = await inspect(page);
  await convertParent(page);
  const after = await inspect(page);
  expect(after.json).toEqual(before.json);
  expect(after.changes - before.changes).toBe(0);
  expect(after.focused).toBe(true);
});

test("non-default host attributes on either selected item cancel conversion without changing selection", async ({
  page,
}) => {
  const base = documentFor(1);
  await mount(page, base, true);
  for (const fixture of [
    { index: 0, name: "hostKey", value: "parent-specific" },
    { index: 1, name: "hostFlag", value: true },
    { index: 1, name: "hostPayload", value: { owner: "child" } },
  ]) {
    const content = documentFor(1);
    const selected = content.content?.[0].content?.[fixture.index];
    const unselected = content.content?.[0].content?.[2];
    if (!selected || !unselected) throw new Error("Missing list item");
    selected.attrs = { ...selected.attrs, [fixture.name]: fixture.value };
    unselected.attrs = { ...unselected.attrs, hostKey: "retain-unselected" };
    await page.evaluate((value) => {
      const controller = window.listParagraphEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent(value);
    }, content);
    await selectBackward(page, "戊");
    const before = await inspect(page);
    expect(before.selection.anchor).toBeGreaterThan(before.selection.head);
    await convertParent(page);
    const after = await inspect(page);
    expect(after.json).toEqual(before.json);
    expect(after.selection).toEqual(before.selection);
    expect(after.focused).toBe(true);
    expect(after.changes - before.changes).toBe(0);
    expect(after.json.content?.[0].content?.[fixture.index].attrs?.[fixture.name]).toEqual(fixture.value);
    expect(after.json.content?.[0].content?.[2].attrs?.hostKey).toBe("retain-unselected");
  }
});

test("default selected item attributes are allowed and custom unselected data survives conversion", async ({
  page,
}) => {
  const content = documentFor(1);
  const list = content.content?.[0];
  const unselected = list?.content?.[2];
  if (!list || !unselected) throw new Error("Missing list item");
  list.attrs = { ...list.attrs, hostListKey: "retain-list" };
  unselected.attrs = { ...unselected.attrs, hostKey: "retain-unselected" };
  await mount(page, content, true);
  const before = await inspect(page);
  await convertParent(page);
  const after = await inspect(page);
  expect(after.json.content?.map((node) => node.type)).toEqual(["paragraph", "paragraph", "orderedList", "paragraph"]);
  expect(after.json.content?.[2].attrs?.hostListKey).toBe("retain-list");
  expect(after.json.content?.[2].content?.[0].attrs?.hostKey).toBe("retain-unselected");
  expect(after.textBlocks).toEqual(before.textBlocks);
  expect(after.changes - before.changes).toBe(1);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect((await inspect(page)).json).toEqual(after.json);
  for (const content of [after.json, after.html]) {
    const restored = await page.evaluate((value) => {
      const controller = window.listParagraphEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent("<p>临时内容</p>");
      controller.setContent(value);
      return controller.getSnapshot();
    }, content);
    expect(restored.json).toEqual(after.json);
  }
});

test("custom attributes on a fully removed list cancel conversion; default list attributes do not", async ({
  page,
}) => {
  const content = documentFor(1);
  const list = content.content?.[0];
  if (!list?.content) throw new Error("Missing list");
  list.content = list.content.slice(0, 2);
  list.attrs = { ...list.attrs, hostListKey: "retain-list" };
  await mount(page, content, true);
  await selectBackward(page, "末尾");
  const before = await inspect(page);
  await convertParent(page);
  const after = await inspect(page);
  expect(after.json).toEqual(before.json);
  expect(after.selection).toEqual(before.selection);
  expect(after.focused).toBe(true);
  expect(after.changes - before.changes).toBe(0);
  expect(after.json.content?.[0].attrs?.hostListKey).toBe("retain-list");

  list.attrs = { ...list.attrs, hostListKey: null };
  await page.evaluate((value) => {
    const controller = window.listParagraphEditor;
    if (!controller) throw new Error("Editor not mounted");
    controller.setContent(value);
  }, content);
  const defaultBefore = await inspect(page);
  await convertParent(page);
  const converted = await inspect(page);
  expect(converted.json.content?.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
  expect(converted.textBlocks).toEqual(defaultBefore.textBlocks);
  expect(converted.changes - defaultBefore.changes).toBe(1);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(defaultBefore.json);
});

test("middle extraction rejects a non-default list attribute without losing unselected items or selection", async ({
  page,
}) => {
  const content = documentFor(1);
  const list = content.content?.[0];
  if (!list?.content) throw new Error("Missing ordered list");
  list.content.unshift(item("甲", 0));
  list.attrs = { ...list.attrs, hostListKey: "unique-list-id" };
  list.content[0].attrs = { ...list.content[0].attrs, hostKey: "left-metadata" };
  list.content[3].attrs = { ...list.content[3].attrs, hostKey: "right-metadata" };
  const host = await mount(page, content, true);
  await selectBackward(page, "戊");
  const before = await inspect(page);
  expect(before.selection.anchor).toBeGreaterThan(before.selection.head);
  await convertParent(page);
  const after = await inspect(page);
  expect(after.json).toEqual(before.json);
  expect(after.selection).toEqual(before.selection);
  expect(after.focused).toBe(true);
  expect(after.changes - before.changes).toBe(0);
  await expect(host.locator(".semlo-editor-prose > ol")).toHaveCount(1);
  expect(after.json.content?.[0].attrs?.hostListKey).toBe("unique-list-id");
  expect(after.json.content?.[0].content?.[0].attrs?.hostKey).toBe("left-metadata");
  expect(after.json.content?.[0].content?.[3].attrs?.hostKey).toBe("right-metadata");
});

test("middle extraction with default list attributes preserves both remaining fragments", async ({ page }) => {
  const content = documentFor(1);
  const list = content.content?.[0];
  if (!list?.content) throw new Error("Missing ordered list");
  list.content.unshift(item("甲", 0));
  list.content[0].attrs = { ...list.content[0].attrs, hostKey: "left-metadata" };
  list.content[3].attrs = { ...list.content[3].attrs, hostKey: "right-metadata" };
  await mount(page, content, true);
  const before = await inspect(page);
  await convertParent(page);
  const after = await inspect(page);
  const nodes = after.json.content ?? [];
  expect(nodes.map((node) => node.type)).toEqual(["orderedList", "paragraph", "paragraph", "orderedList", "paragraph"]);
  expect(nodes[0].attrs?.hostListKey).toBeNull();
  expect(nodes[3].attrs?.hostListKey).toBeNull();
  expect(nodes[0].content?.[0].attrs?.hostKey).toBe("left-metadata");
  expect(nodes[3].content?.[0].attrs?.hostKey).toBe("right-metadata");
  expect(nodes[1].content?.[0].marks).toEqual([{ type: "bold" }]);
  expect(nodes[2].content?.[0].marks).toEqual([{ type: "italic" }]);
  expect(nodes[2].attrs?.semloEditorIndent).toBe(1);
  expect(after.textBlocks).toEqual(before.textBlocks);
  expect(after.changes - before.changes).toBe(1);
  expect(after.focused).toBe(true);
  expect(after.selection.anchor).toBe(after.selection.head);
  expect(after.selection).toMatchObject({ parent: "乙", offset: 0 });
  expect(await markers(page)).toEqual([
    { text: "甲", marker: '"1. "', indent: null },
    { text: "丁", marker: '"2. "', indent: null },
    { text: "戊", marker: '"3. "', indent: null },
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect((await inspect(page)).json).toEqual(after.json);
  for (const value of [after.json, after.html]) {
    const restored = await page.evaluate((input) => {
      const controller = window.listParagraphEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent("<p>临时内容</p>");
      controller.setContent(input);
      return controller.getSnapshot();
    }, value);
    expect(restored.json).toEqual(after.json);
  }
});

test("end extraction may retain a non-default list attribute in its single remaining fragment", async ({ page }) => {
  const content = documentFor(1);
  const list = content.content?.[0];
  if (!list) throw new Error("Missing ordered list");
  list.attrs = { ...list.attrs, hostListKey: "unique-list-id" };
  list.content = [item("甲", 0), item("丁", 0), item("乙", 0, "bold"), item("丙", 1, "italic")];
  list.content[0].attrs = { ...list.content[0].attrs, hostKey: "first-retained" };
  list.content[1].attrs = { ...list.content[1].attrs, hostKey: "second-retained" };
  await mount(page, content, true);
  const before = await inspect(page);
  await convertParent(page);
  const after = await inspect(page);
  const nodes = after.json.content ?? [];
  expect(nodes.map((node) => node.type)).toEqual(["orderedList", "paragraph", "paragraph", "paragraph"]);
  expect(nodes[0].attrs?.hostListKey).toBe("unique-list-id");
  expect(nodes[0].content?.map((node) => node.attrs?.hostKey)).toEqual(["first-retained", "second-retained"]);
  expect(nodes[1].content?.[0].marks).toEqual([{ type: "bold" }]);
  expect(nodes[2].content?.[0].marks).toEqual([{ type: "italic" }]);
  expect(nodes[2].attrs?.semloEditorIndent).toBe(1);
  expect(after.textBlocks).toEqual(before.textBlocks);
  expect(after.changes - before.changes).toBe(1);
  expect(after.focused).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
});
