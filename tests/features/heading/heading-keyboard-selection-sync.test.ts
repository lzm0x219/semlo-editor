import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    headingSelectionSyncEditor?: EditorController;
    headingSelectionSyncChanges?: number;
  }
}

const content =
  "<ul><li><p><strong>筹备写作</strong></p><ul><li><p>编辑提纲</p><ul><li><p><em>梳理段落内容</em></p></li></ul></li><li><p>安排发布时间</p></li></ul></li></ul><p></p>";

async function mount(page: Page, html = content) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      document.body.prepend(host)
      window.headingSelectionSyncChanges = 0
      window.headingSelectionSyncEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(html)},
        onChange: () => { window.headingSelectionSyncChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.headingSelectionSyncEditor));
}

for (const direction of ["caret", "forward", "backward"] as const) {
  test(`heading shortcut uses a newer DOM ${direction} selection before delayed selectionchange`, async ({ page }) => {
    await mount(page);
    const result = await page.evaluate((direction) => {
      const controller = window.__semloRequireFixture("headingSelectionSyncEditor");
      const editor = controller.editor;
      const view = editor.view;
      view.focus();
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      const before = controller.getSnapshot().json;
      const retained = () => {
        const nodes: unknown[] = [];
        editor.state.doc.descendants((node) => {
          if (node.isTextblock && ["梳理段落内容", "安排发布时间"].includes(node.textContent))
            nodes.push(node.toJSON());
        });
        return nodes;
      };
      const beforeRetained = retained();
      const find = (text: string) => {
        const paragraph = Array.from(view.dom.querySelectorAll("p")).find((node) => node.textContent === text);
        if (!paragraph) throw new Error(`Missing ${text}`);
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        const node = walker.nextNode();
        if (!node) throw new Error(`Missing text node for ${text}`);
        return node;
      };
      const grandparent = find("筹备写作");
      const parent = find("编辑提纲");
      const browserSelection = document.getSelection()!;
      if (direction === "caret") browserSelection.setBaseAndExtent(parent, 4, parent, 4);
      else if (direction === "forward") browserSelection.setBaseAndExtent(grandparent, 0, parent, 4);
      else browserSelection.setBaseAndExtent(parent, 4, grandparent, 0);
      const selection = () => {
        const { $anchor, $head } = editor.state.selection;
        return {
          anchor: $anchor.parent.textContent,
          anchorOffset: $anchor.parentOffset,
          head: $head.parent.textContent,
          headOffset: $head.parentOffset,
        };
      };
      const beforeSelection = selection();
      const browserBefore = {
        anchor: browserSelection.anchorNode?.textContent,
        anchorOffset: browserSelection.anchorOffset,
        head: browserSelection.focusNode?.textContent,
        headOffset: browserSelection.focusOffset,
      };
      const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      const event = new KeyboardEvent("keydown", {
        key: "3",
        code: "Digit3",
        keyCode: 51,
        metaKey: mac,
        ctrlKey: !mac,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.dom.dispatchEvent(event);
      const blocks: Array<{ type: string; text: string; level: number | null }> = [];
      editor.state.doc.descendants((node) => {
        if (node.isTextblock)
          blocks.push({
            type: node.type.name,
            text: node.textContent,
            level: node.type.name === "heading" ? node.attrs.level : null,
          });
      });
      return {
        before,
        beforeSelection,
        browserBefore,
        after: controller.getSnapshot().json,
        afterSelection: selection(),
        beforeRetained,
        afterRetained: retained(),
        blocks,
        prevented: event.defaultPrevented,
        changes: window.__semloRequireFixture("headingSelectionSyncChanges"),
      };
    }, direction);
    expect(result.beforeSelection).toEqual({ anchor: "", anchorOffset: 0, head: "", headOffset: 0 });
    expect(result.browserBefore).toEqual(
      direction === "caret"
        ? { anchor: "编辑提纲", anchorOffset: 4, head: "编辑提纲", headOffset: 4 }
        : direction === "forward"
          ? { anchor: "筹备写作", anchorOffset: 0, head: "编辑提纲", headOffset: 4 }
          : { anchor: "编辑提纲", anchorOffset: 4, head: "筹备写作", headOffset: 0 },
    );
    expect(result.prevented).toBe(true);
    expect(result.blocks).toEqual([
      {
        type: direction === "caret" ? "paragraph" : "heading",
        text: "筹备写作",
        level: direction === "caret" ? null : 3,
      },
      { type: "heading", text: "编辑提纲", level: 3 },
      { type: "paragraph", text: "梳理段落内容", level: null },
      { type: "paragraph", text: "安排发布时间", level: null },
      { type: "paragraph", text: "", level: null },
    ]);
    expect(result.afterSelection).toEqual(result.browserBefore);
    expect(result.afterRetained).toEqual(result.beforeRetained);
    expect(result.changes).toBe(1);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingSelectionSyncEditor").editor.commands.undo()),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingSelectionSyncEditor").getSnapshot().json),
    ).toEqual(result.before);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingSelectionSyncEditor").editor.commands.redo()),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingSelectionSyncEditor").getSnapshot().json),
    ).toEqual(result.after);
  });
}

for (const level of [0, 6] as const) {
  test(`heading shortcut ${level} synchronizes a stale caret before converting the target`, async ({ page }) => {
    await mount(page, level === 0 ? "<h3>目标</h3><p></p>" : "<p>目标</p><p></p>");
    const result = await page.evaluate((level) => {
      const controller = window.__semloRequireFixture("headingSelectionSyncEditor");
      const editor = controller.editor;
      const view = editor.view;
      view.focus();
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      const before = controller.getSnapshot().json;
      const beforeSelection = editor.state.selection.$anchor.parent.textContent;
      const target = Array.from(view.dom.querySelectorAll("h3, p")).find((node) => node.textContent === "目标");
      if (!target) throw new Error("Missing target");
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      if (!text) throw new Error("Missing target text");
      document.getSelection()!.setBaseAndExtent(text, 2, text, 2);
      const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      const event = new KeyboardEvent("keydown", {
        key: level === 6 ? "§" : "0",
        code: `Digit${level}`,
        keyCode: 48 + level,
        metaKey: mac,
        ctrlKey: !mac,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.dom.dispatchEvent(event);
      const { $anchor } = editor.state.selection;
      return {
        before,
        beforeSelection,
        after: controller.getSnapshot().json,
        blocks: Array.from({ length: editor.state.doc.childCount }, (_, index) => {
          const node = editor.state.doc.child(index);
          return { type: node.type.name, text: node.textContent, level: node.attrs.level ?? null };
        }),
        selection: { text: $anchor.parent.textContent, offset: $anchor.parentOffset },
        prevented: event.defaultPrevented,
      };
    }, level);
    expect(result.beforeSelection).toBe("");
    expect(result.prevented).toBe(true);
    expect(result.blocks).toEqual([
      { type: level === 0 ? "paragraph" : "heading", text: "目标", level: level || null },
      { type: "paragraph", text: "", level: null },
    ]);
    expect(result.selection).toEqual({ text: "目标", offset: 2 });
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingSelectionSyncEditor").editor.commands.undo()),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingSelectionSyncEditor").getSnapshot().json),
    ).toEqual(result.before);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingSelectionSyncEditor").editor.commands.redo()),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingSelectionSyncEditor").getSnapshot().json),
    ).toEqual(result.after);
  });
}

for (const kind of [
  "isComposing",
  "keyCode229",
  "activeComposition",
  "readOnly",
  "altGraph",
  "defaultPrevented",
] as const) {
  test(`heading shortcut does not synchronize a stale selection during ${kind}`, async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "platform", { configurable: true, get: () => "Win32" }),
    );
    await mount(page);
    const result = await page.evaluate((kind) => {
      const controller = window.__semloRequireFixture("headingSelectionSyncEditor");
      const editor = controller.editor;
      const view = editor.view;
      view.focus();
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      if (kind === "readOnly") controller.setEditable(false);
      if (kind === "activeComposition")
        view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const target = Array.from(view.dom.querySelectorAll("p")).find((node) => node.textContent === "编辑提纲");
      if (!target?.firstChild) throw new Error("Missing target text");
      document.getSelection()!.setBaseAndExtent(target.firstChild, 2, target.firstChild, 2);
      const before = controller.getSnapshot().json;
      const beforeSelection = editor.state.selection.toJSON();
      const event = new KeyboardEvent("keydown", {
        key: "3",
        code: "Digit3",
        keyCode: kind === "keyCode229" ? 229 : 51,
        ctrlKey: true,
        altKey: true,
        isComposing: kind === "isComposing",
        modifierAltGraph: kind === "altGraph",
        bubbles: true,
        cancelable: true,
      });
      if (kind === "defaultPrevented") {
        event.preventDefault();
        const handler = editor.options.editorProps.handleDOMEvents?.keydown;
        if (!handler) throw new Error("Missing editor keydown handler");
        // ProseMirror normally filters already-prevented native events first;
        // invoke the host hook too so its own guard is tested independently.
        handler(view, event);
      }
      view.dom.dispatchEvent(event);
      return {
        before,
        after: controller.getSnapshot().json,
        beforeSelection,
        afterSelection: editor.state.selection.toJSON(),
        altGraph: event.getModifierState("AltGraph"),
        composing: view.composing,
        changes: window.__semloRequireFixture("headingSelectionSyncChanges"),
      };
    }, kind);
    expect(result.after).toEqual(result.before);
    expect(result.afterSelection).toEqual(result.beforeSelection);
    expect(result.changes).toBe(0);
    if (kind === "altGraph") expect(result.altGraph).toBe(true);
    if (kind === "activeComposition") expect(result.composing).toBe(true);
  });
}

for (const kind of ["node", "cell"] as const) {
  test(`heading shortcut does not replace an existing ${kind} selection with a stale DOM caret`, async ({ page }) => {
    await mount(
      page,
      kind === "node"
        ? "<p>目标文字</p><hr><p>结束</p>"
        : "<p>目标文字</p><table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td></tr></tbody></table><p>结束</p>",
    );
    const result = await page.evaluate((kind) => {
      const controller = window.__semloRequireFixture("headingSelectionSyncEditor");
      const editor = controller.editor;
      const view = editor.view;
      view.focus();
      const positions: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === (kind === "node" ? "horizontalRule" : "tableCell")) positions.push(position);
      });
      if (!positions.length || (kind === "cell" && positions.length < 2)) throw new Error("Missing selected node");
      const selected =
        kind === "node"
          ? editor.commands.setNodeSelection(positions[0])
          : editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
      if (!selected) throw new Error("Failed to select node or cells");
      const target = Array.from(view.dom.querySelectorAll("p")).find((node) => node.textContent === "目标文字");
      if (!target?.firstChild) throw new Error("Missing target text");
      document.getSelection()!.setBaseAndExtent(target.firstChild, 2, target.firstChild, 2);
      const before = controller.getSnapshot().json;
      const beforeSelection = editor.state.selection.toJSON();
      const blocks = () => {
        const result: Array<{ type: string; text: string }> = [];
        editor.state.doc.descendants((node) => {
          if (node.isTextblock) result.push({ type: node.type.name, text: node.textContent });
        });
        return result;
      };
      const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      const event = new KeyboardEvent("keydown", {
        key: "3",
        code: "Digit3",
        keyCode: 51,
        metaKey: mac,
        ctrlKey: !mac,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.dom.dispatchEvent(event);
      return {
        before,
        after: controller.getSnapshot().json,
        beforeSelection,
        afterSelection: editor.state.selection.toJSON(),
        blocks: blocks(),
        changes: window.__semloRequireFixture("headingSelectionSyncChanges"),
      };
    }, kind);
    expect(result.beforeSelection.type).toBe(kind);
    expect(result.afterSelection).toEqual(result.beforeSelection);
    if (kind === "node") {
      expect(result.after).toEqual(result.before);
      expect(result.changes).toBe(0);
    } else {
      // Tiptap's existing fallback applies the shortcut to selected table cells.
      expect(result.blocks).toEqual([
        { type: "paragraph", text: "目标文字" },
        { type: "heading", text: "甲" },
        { type: "heading", text: "乙" },
        { type: "paragraph", text: "结束" },
      ]);
      expect(result.changes).toBe(1);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("headingSelectionSyncEditor").editor.commands.undo()),
      ).toBe(true);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("headingSelectionSyncEditor").getSnapshot().json),
      ).toEqual(result.before);
    }
  });
}
