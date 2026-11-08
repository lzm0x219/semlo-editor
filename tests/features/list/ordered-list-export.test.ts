import { expect, test, type Page } from "@rstest/playwright";
import type { Editor } from "@tiptap/core";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    listExportEditor?: EditorController;
    listExportIndent?: (editor: Editor, direction: -1 | 1) => boolean;
  }
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (text: string, indent = 0, extra: object[] = []) => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text), ...extra],
});
const content = {
  type: "doc",
  attrs: { semloEditorDocumentFontFamily: "Arial" },
  content: [
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        item("甲"),
        item("乙", 1),
        item("丙", 1),
        item("丁", 0, [
          {
            type: "orderedList",
            attrs: { start: 5 },
            content: [item("内甲"), item("内乙", 1), item("内丙")],
          },
        ]),
        item("戊", 1),
        item("己", 2),
        item("庚", 1),
        item("辛"),
      ],
    },
    paragraph("分隔"),
    {
      type: "orderedList",
      attrs: { start: 7 },
      content: [item("外甲"), item("外乙", 1), item("外丙")],
    },
    paragraph("再次分隔"),
    { type: "orderedList", attrs: { start: 4 }, content: [item("普通甲"), item("普通乙")] },
  ],
};

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, adjustParagraphIndent } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'list-export-test'
      document.body.prepend(host)
      window.listExportEditor = createEditor({ element: host, outline: false, content: ${JSON.stringify(content)} })
      window.listExportIndent = adjustParagraphIndent
    `,
  });
  await page.waitForFunction(() => Boolean(window.listExportEditor && window.listExportIndent));
}

const snapshot = (page: Page) => page.evaluate(() => window.__semloRequireFixture("listExportEditor").getSnapshot());

async function htmlValues(page: Page, html: string) {
  return page.evaluate((value) => {
    const template = document.createElement("template");
    template.innerHTML = value;
    return [...template.content.querySelectorAll("ol")].map((list) =>
      [...list.children].filter((child) => child.localName === "li").map((child) => child.getAttribute("value")),
    );
  }, html);
}

test("exported lists retain their visible ordinals without persisting derived numbers in JSON", async ({ page }) => {
  await mount(page);
  const before = await snapshot(page);
  expect(await htmlValues(page, before.html)).toEqual([
    ["3", "1", "2", "4", "1", "1", "2", "5"],
    ["1", "1", "2"],
    ["7", "1", "8"],
    [null, null],
  ]);
  expect(before.html).toContain('data-semlo-editor-document-font="Arial"');
  expect(JSON.stringify(before.json)).not.toContain("semloEditorListOrdinal");

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("listExportEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "乙") position = pos;
    });
    if (position < 0) throw new Error("Missing list item");
    editor.commands.setTextSelection(position);
    if (!window.__semloRequireFixture("listExportIndent").bind(window)(editor, 1))
      throw new Error("Indent did not apply");
  });
  const changed = await snapshot(page);
  expect((await htmlValues(page, changed.html))[0]).toEqual(["3", "1", "1", "4", "1", "1", "2", "5"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("listExportEditor").editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect((await htmlValues(page, (await snapshot(page)).html))[0]).toEqual(["3", "1", "2", "4", "1", "1", "2", "5"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("listExportEditor").editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(changed.json);

  await page.evaluate((html) => window.__semloRequireFixture("listExportEditor").setContent(html), before.html);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("standalone exported HTML displays and exposes the same list markers", async ({ page }) => {
  await mount(page);
  const html = (await snapshot(page)).html;
  await page.evaluate((value) => {
    const reader = document.createElement("article");
    reader.id = "list-export-reader";
    reader.innerHTML = value;
    document.body.append(reader);
  }, html);
  const reader = page.locator("#list-export-reader");
  const levels = await reader
    .locator("ol")
    .first()
    .locator(":scope > li")
    .evaluateAll((items) => items.map((item) => getComputedStyle(item).listStyleType));
  expect(levels).toEqual([
    "decimal",
    "lower-alpha",
    "lower-alpha",
    "decimal",
    "lower-alpha",
    "semlo-mixed-roman",
    "lower-alpha",
    "decimal",
  ]);

  const session = await page.context().newCDPSession(page);
  const { root } = await session.send("DOM.getDocument");
  const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#list-export-reader" });
  const { node: readerNode } = await session.send("DOM.describeNode", { nodeId });
  const { nodeId: editorId } = await session.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#list-export-test",
  });
  const { node: editorNode } = await session.send("DOM.describeNode", { nodeId: editorId });
  const { nodes } = await session.send("Accessibility.getFullAXTree");
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const readMarkers = (backendId: number) => {
    const first = nodes.find((node) => node.backendDOMNodeId === backendId);
    if (!first) throw new Error("List container is absent from the accessibility tree");
    const markers: string[] = [];
    const visit = (id: string) => {
      const node = byId.get(id);
      if (!node) return;
      if (node.role?.value === "ListMarker") markers.push(String(node.name?.value ?? "").trim());
      node.childIds?.forEach(visit);
    };
    visit(first.nodeId);
    return markers;
  };
  const markers = readMarkers(readerNode.backendNodeId);
  const editorMarkers = readMarkers(editorNode.backendNodeId);
  expect(markers).toEqual(editorMarkers);
  expect(markers.slice(0, 4)).toEqual(["3.", "a.", "b.", "4."]);
  // Yuque shows alphabetic markers for an ordered list nested in another one;
  // a directly tested nested start=7 is reset while the parent remains ordered.
  await expect(reader.locator("ol ol > li").first()).toHaveCSS("list-style-type", "lower-alpha");
  expect(markers.slice(7)).toEqual(["a.", "ⅰ.", "b.", "5.", "7.", "a.", "8.", "4.", "5."]);
  await session.detach();
});
