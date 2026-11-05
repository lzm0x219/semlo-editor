import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";

export type Mode = "reject" | "append-selection" | "append-doc" | "destroy" | "throw" | "observe";
export type Order = "early" | "late";
interface Probe {
  controller: EditorController;
  trace: string[];
  changes: number;
  endEvent(): KeyboardEvent | undefined;
  settle(): Promise<void>;
}
declare global {
  interface Window {
    mountHeadingMultilineHost(mode: Mode, order: Order): void;
    headingMultilineHost: Probe;
  }
}
function isTarget(tr: Transaction): boolean {
  const sel = tr.selection;
  return (
    !tr.docChanged &&
    tr.selectionSet &&
    sel instanceof TextSelection &&
    !sel.empty &&
    sel.$anchor.sameParent(sel.$head) &&
    sel.$anchor.parent.type.name === "heading" &&
    sel.$anchor.parentOffset === 0 &&
    sel.$head.parentOffset < sel.$head.parent.content.size
  );
}
window.mountHeadingMultilineHost = (mode, order) => {
  const element = document.createElement("div");
  element.id = "heading-multiline-host";
  element.style.width = "260px";
  document.body.replaceChildren(element);
  const trace: string[] = [];
  let changes = 0;
  let end: KeyboardEvent | undefined;
  const extension = Extension.create({
    name: "multilineHostProbe",
    priority: order === "early" ? 2000 : 1,
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: new PluginKey("multilineHostProbe"),
          filterTransaction(tr) {
            if (!isTarget(tr)) return true;
            trace.push("filter");
            if (mode === "reject") return false;
            if (mode === "throw") throw new Error("multiline-host-filter-error");
            return true;
          },
          appendTransaction(transactions, _old, state) {
            if (!transactions.some(isTarget) || transactions.some((tr) => tr.getMeta("multilineHostProbe")))
              return null;
            trace.push("append");
            if (mode === "destroy") {
              editor.destroy();
              return null;
            }
            if (mode === "append-selection")
              return state.tr
                .setSelection(TextSelection.create(state.doc, state.selection.anchor))
                .setMeta("multilineHostProbe", true)
                .setMeta("addToHistory", false);
            if (mode === "append-doc")
              return state.tr
                .insertText("!", state.doc.content.size - 1)
                .setMeta("multilineHostProbe", true)
                .setMeta("addToHistory", false);
            return null;
          },
        }),
      ];
    },
  });
  const controller = createEditor({
    element,
    toolbar: false,
    outline: false,
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "test ".repeat(25) }] },
        { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
      ],
    },
    extensions: [extension],
    onChange: () => {
      changes++;
    },
  });
  controller.editor.view.dom.addEventListener("keydown", (event) => {
    if (event.key === "End") end = event;
  });
  window.headingMultilineHost = {
    controller,
    trace,
    get changes() {
      return changes;
    },
    endEvent: () => end,
    settle: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  };
};
