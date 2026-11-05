import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";
interface KeyTrace {
  key: string;
  trusted: boolean;
  anchor: number | null;
  head: number | null;
  pmAnchor: number;
  pmHead: number;
  text: string;
  expected: unknown;
}
interface Fixture {
  controller: EditorController;
  keys: KeyTrace[];
  events: KeyboardEvent[];
  reject(): void;
  rejections(): number;
  settle(): Promise<void>;
}
declare global {
  interface Window {
    mountLineInterior?(content: EditorContent, order: "early" | "late"): void;
    lineInterior?: Fixture;
  }
}
window.mountLineInterior = (content, order) => {
  const host = document.createElement("div");
  host.id = "heading-line-interior";
  host.style.width = "260px";
  document.body.replaceChildren(host);
  let reject = false,
    rejections = 0;
  const extension = Extension.create({
    name: "lineInteriorHost",
    priority: order === "early" ? 2000 : 1,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction(tr) {
            if (reject && !tr.docChanged && tr.selectionSet && tr.getMeta("addToHistory") === false) {
              rejections++;
              return false;
            }
            return true;
          },
        }),
      ];
    },
  });
  const controller = createEditor({ element: host, content, toolbar: false, outline: false, extensions: [extension] }),
    editor = controller.editor,
    view = editor.view;
  const keys: KeyTrace[] = [],
    events: KeyboardEvent[] = [];
  view.dom.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "End" && event.key !== "Backspace" && event.key !== "Home") return;
      const selection = document.getSelection(),
        range = selection?.rangeCount ? selection.getRangeAt(0) : null,
        fragment = range?.cloneContents();
      fragment?.querySelectorAll('[contenteditable="false"]').forEach((n) => n.remove());
      const anchor = selection?.anchorNode ? view.posAtDOM(selection.anchorNode, selection.anchorOffset) : null;
      const head = selection?.focusNode ? view.posAtDOM(selection.focusNode, selection.focusOffset) : null;
      let expected: unknown = null;
      if (event.key === "Backspace" && anchor !== null && head !== null && anchor !== head)
        expected = view.state.tr.delete(Math.min(anchor, head), Math.max(anchor, head)).doc.toJSON();
      keys.push({
        key: event.key,
        trusted: event.isTrusted,
        anchor,
        head,
        pmAnchor: view.state.selection.anchor,
        pmHead: view.state.selection.head,
        text: fragment?.textContent ?? "",
        expected,
      });
      if (event.key === "End" && event.shiftKey) events.push(event);
    },
    true,
  );
  window.lineInterior = {
    controller,
    keys,
    events,
    reject: () => {
      reject = true;
    },
    rejections: () => rejections,
    settle: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  };
};
