import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    lineHeightSyncEditor?: EditorController;
    lineHeightSyncChanges?: number;
  }
}

async function mount(page: Page, platform: "MacIntel" | "Win32", html = "<p>目标文字</p><p>后文</p>") {
  await page.addInitScript(
    (value) => Object.defineProperty(navigator, "platform", { configurable: true, get: () => value }),
    platform,
  );
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      document.body.replaceChildren(host)
      window.lineHeightSyncChanges = 0
      window.lineHeightSyncEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(html)},
        onChange: () => { window.lineHeightSyncChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.lineHeightSyncEditor));
}

for (const platform of ["MacIntel", "Win32"] as const) {
  for (const direction of ["caret", "forward", "backward"] as const) {
    for (const key of ["[", "]"] as const) {
      for (const shifted of [false, true]) {
        test(`${platform} ${shifted ? "Shift+" : ""}${key} uses a newer DOM ${direction} selection`, async ({
          page,
        }) => {
          await mount(page, platform);
          const result = await page.evaluate(
            ({ platform, direction, key, shifted }) => {
              const controller = window.lineHeightSyncEditor;
              if (!controller) throw new Error("Editor not mounted");
              const editor = controller.editor;
              const view = editor.view;
              view.focus();
              editor.commands.setTextSelection(editor.state.doc.content.size - 2);
              const target = Array.from(view.dom.querySelectorAll("p")).find((p) => p.textContent === "目标文字");
              if (!target?.firstChild) throw new Error("Missing target text");
              const selection = document.getSelection()!;
              const [anchor, head] = direction === "caret" ? [2, 2] : direction === "forward" ? [0, 4] : [4, 0];
              selection.setBaseAndExtent(target.firstChild, anchor, target.firstChild, head);
              const before = controller.getSnapshot().json;
              const beforeSelection = editor.state.selection.$from.parent.textContent;
              const event = new KeyboardEvent("keydown", {
                key,
                code: key === "[" ? "BracketLeft" : "BracketRight",
                keyCode: key === "[" ? 219 : 221,
                metaKey: platform === "MacIntel",
                ctrlKey: platform === "Win32",
                altKey: true,
                shiftKey: shifted,
                bubbles: true,
                cancelable: true,
              });
              const changes = window.lineHeightSyncChanges ?? 0;
              view.dom.dispatchEvent(event);
              const after = controller.getSnapshot().json;
              const blocks: Array<{ text: string; height: string | null }> = [];
              editor.state.doc.descendants((node) => {
                if (node.isTextblock)
                  blocks.push({ text: node.textContent, height: node.attrs.semloEditorLineHeight ?? null });
              });
              const afterSelection = {
                anchor: editor.state.selection.$anchor.parent.textContent,
                anchorOffset: editor.state.selection.$anchor.parentOffset,
                head: editor.state.selection.$head.parent.textContent,
                headOffset: editor.state.selection.$head.parentOffset,
              };
              const changed = (window.lineHeightSyncChanges ?? 0) - changes;
              const prevented = event.defaultPrevented;
              const undo = editor.commands.undo();
              return {
                before,
                beforeSelection,
                after,
                blocks,
                afterSelection,
                changed,
                prevented,
                undo,
                undone: controller.getSnapshot().json,
              };
            },
            { platform, direction, key, shifted },
          );
          expect(result.beforeSelection).toBe("后文");
          expect(result.blocks).toEqual([
            { text: "目标文字", height: key === "[" ? "1.5" : "2" },
            { text: "后文", height: null },
          ]);
          const [anchorOffset, headOffset] = direction === "caret" ? [2, 2] : direction === "forward" ? [0, 4] : [4, 0];
          expect(result.afterSelection).toEqual({ anchor: "目标文字", anchorOffset, head: "目标文字", headOffset });
          expect(result.changed).toBe(1);
          expect(result.prevented).toBe(true);
          expect(result.undo).toBe(true);
          expect(result.undone).toEqual(result.before);
        });
      }
    }
  }
}

for (const fixture of [
  { platform: "MacIntel", key: "“", expected: true },
  { platform: "Win32", key: "“", expected: false },
  { platform: "MacIntel", key: "Unidentified", expected: true },
  { platform: "Win32", key: "Unidentified", expected: true },
] as const) {
  test(`${fixture.platform} ${fixture.key} follows keymap bracket fallback`, async ({ page }) => {
    await mount(page, fixture.platform);
    const result = await page.evaluate(({ platform, key }) => {
      const controller = window.lineHeightSyncEditor;
      if (!controller) throw new Error("Editor not mounted");
      const editor = controller.editor;
      const view = editor.view;
      view.focus();
      editor.commands.setTextSelection(editor.state.doc.content.size - 2);
      const target = Array.from(view.dom.querySelectorAll("p")).find((p) => p.textContent === "目标文字");
      if (!target?.firstChild) throw new Error("Missing target text");
      document.getSelection()!.setBaseAndExtent(target.firstChild, 0, target.firstChild, 4);
      const before = controller.getSnapshot().json;
      const beforeSelection = editor.state.selection.toJSON();
      const event = new KeyboardEvent("keydown", {
        key,
        code: "BracketLeft",
        keyCode: 219,
        metaKey: platform === "MacIntel",
        ctrlKey: platform === "Win32",
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.dom.dispatchEvent(event);
      const blocks: Array<{ text: string; height: string | null }> = [];
      editor.state.doc.descendants((node) => {
        if (node.isTextblock) blocks.push({ text: node.textContent, height: node.attrs.semloEditorLineHeight ?? null });
      });
      return {
        before,
        after: controller.getSnapshot().json,
        beforeSelection,
        afterSelection: editor.state.selection.toJSON(),
        blocks,
        prevented: event.defaultPrevented,
      };
    }, fixture);
    expect(result.blocks).toEqual([
      { text: "目标文字", height: fixture.expected ? "1.5" : null },
      { text: "后文", height: null },
    ]);
    expect(result.prevented).toBe(fixture.expected);
    if (!fixture.expected) {
      expect(result.after).toEqual(result.before);
      expect(result.afterSelection).toEqual(result.beforeSelection);
    }
  });
}

for (const kind of [
  "isComposing",
  "keyCode229",
  "activeComposition",
  "readOnly",
  "altGraph",
  "defaultPrevented",
  "wrongMod",
  "shiftOther",
  "shiftUnidentified",
  "codeOnly",
  "otherKey",
] as const) {
  test(`line-height shortcut preserves stale selection during ${kind}`, async ({ page }) => {
    const platform = kind === "altGraph" ? "Win32" : "MacIntel";
    await mount(page, platform);
    const result = await page.evaluate(
      ({ kind, platform }) => {
        const controller = window.lineHeightSyncEditor;
        if (!controller) throw new Error("Editor not mounted");
        const editor = controller.editor;
        const view = editor.view;
        view.focus();
        editor.commands.setTextSelection(editor.state.doc.content.size - 2);
        if (kind === "readOnly") controller.setEditable(false);
        if (kind === "activeComposition")
          view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        const target = Array.from(view.dom.querySelectorAll("p")).find((p) => p.textContent === "目标文字");
        if (!target?.firstChild) throw new Error("Missing target text");
        document.getSelection()!.setBaseAndExtent(target.firstChild, 0, target.firstChild, 4);
        const before = controller.getSnapshot().json;
        const beforeSelection = editor.state.selection.toJSON();
        const event = new KeyboardEvent("keydown", {
          key:
            kind === "otherKey"
              ? "x"
              : kind === "shiftOther"
                ? "{"
                : kind === "shiftUnidentified"
                  ? "Unidentified"
                  : kind === "codeOnly"
                    ? "F1"
                    : "[",
          code: kind === "otherKey" ? "KeyX" : "BracketLeft",
          keyCode: kind === "keyCode229" ? 229 : kind === "otherKey" ? 88 : kind === "codeOnly" ? 112 : 219,
          metaKey: platform === "MacIntel" && kind !== "wrongMod",
          ctrlKey: platform === "Win32" || kind === "wrongMod",
          altKey: true,
          shiftKey: kind === "shiftOther" || kind === "shiftUnidentified",
          isComposing: kind === "isComposing",
          modifierAltGraph: kind === "altGraph",
          bubbles: true,
          cancelable: true,
        });
        if (kind === "defaultPrevented") {
          event.preventDefault();
          const handler = editor.options.editorProps.handleDOMEvents?.keydown;
          if (!handler) throw new Error("Missing editor keydown handler");
          handler(view, event);
        }
        const changes = window.lineHeightSyncChanges ?? 0;
        view.dom.dispatchEvent(event);
        return {
          before,
          after: controller.getSnapshot().json,
          beforeSelection,
          afterSelection: editor.state.selection.toJSON(),
          changed: (window.lineHeightSyncChanges ?? 0) - changes,
          prevented: event.defaultPrevented,
          altGraph: event.getModifierState("AltGraph"),
          composing: view.composing,
        };
      },
      { kind, platform },
    );
    expect(result.after).toEqual(result.before);
    expect(result.afterSelection).toEqual(result.beforeSelection);
    expect(result.changed).toBe(0);
    if (["isComposing", "keyCode229", "activeComposition", "altGraph"].includes(kind))
      expect(result.prevented).toBe(false);
    if (kind === "altGraph") expect(result.altGraph).toBe(true);
    if (kind === "activeComposition") expect(result.composing).toBe(true);
  });
}

for (const kind of ["node", "cell"] as const) {
  test(`line-height shortcut does not replace ${kind} selection with a stale DOM range`, async ({ page }) => {
    const html =
      kind === "node"
        ? "<p>目标文字</p><hr><p>结束</p>"
        : "<p>目标文字</p><table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td></tr></tbody></table><p>结束</p>";
    await mount(page, "MacIntel", html);
    const result = await page.evaluate((kind) => {
      const controller = window.lineHeightSyncEditor;
      if (!controller) throw new Error("Editor not mounted");
      const editor = controller.editor;
      const view = editor.view;
      view.focus();
      const positions: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === (kind === "node" ? "horizontalRule" : "tableCell")) positions.push(pos);
      });
      const selected =
        kind === "node"
          ? editor.commands.setNodeSelection(positions[0])
          : editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
      if (!selected) throw new Error("Failed to select node or cells");
      const target = Array.from(view.dom.querySelectorAll("p")).find((p) => p.textContent === "目标文字");
      if (!target?.firstChild) throw new Error("Missing target text");
      document.getSelection()!.setBaseAndExtent(target.firstChild, 0, target.firstChild, 4);
      const before = controller.getSnapshot().json;
      const beforeSelection = editor.state.selection.toJSON();
      const changes = window.lineHeightSyncChanges ?? 0;
      view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "[",
          code: "BracketLeft",
          keyCode: 219,
          metaKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      const blocks: Array<{ text: string; height: string | null }> = [];
      editor.state.doc.descendants((node) => {
        if (node.isTextblock) blocks.push({ text: node.textContent, height: node.attrs.semloEditorLineHeight ?? null });
      });
      return {
        before,
        after: controller.getSnapshot().json,
        beforeSelection,
        afterSelection: editor.state.selection.toJSON(),
        blocks,
        changed: (window.lineHeightSyncChanges ?? 0) - changes,
      };
    }, kind);
    expect(result.beforeSelection.type).toBe(kind);
    expect(result.afterSelection).toEqual(result.beforeSelection);
    expect(result.blocks[0]).toEqual({ text: "目标文字", height: null });
    if (kind === "node") {
      expect(result.after).toEqual(result.before);
      expect(result.changed).toBe(0);
    } else {
      expect(result.blocks.slice(1, 3)).toEqual([
        { text: "甲", height: "1.15" },
        { text: "乙", height: "1.15" },
      ]);
      expect(result.changed).toBe(1);
    }
  });
}
