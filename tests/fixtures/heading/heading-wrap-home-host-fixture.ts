import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";

type Mode = "normal" | "reject" | "reject-range" | "append-meta" | "append-selection" | "append-doc";
interface Fixture {
  controller: EditorController;
  arm(): void;
  trace: string[];
  events: KeyboardEvent[];
  settle(): Promise<void>;
  closeHistory(): void;
}
declare global {
  interface Window {
    mountWrapHome?(numbered: boolean, mode: Mode, order: "early" | "late"): void;
    wrapHome?: Fixture;
  }
}
window.mountWrapHome = (numbered, mode, order) => {
  const host = document.createElement("div");
  host.id = "heading-wrap-home-test";
  host.style.width = "260px";
  document.body.replaceChildren(host);
  let armed = false;
  const trace: string[] = [];
  function target(tr: Transaction) {
    return (
      armed &&
      !tr.docChanged &&
      tr.selectionSet &&
      tr.selection instanceof TextSelection &&
      (mode === "reject-range" ? !tr.selection.empty : tr.selection.empty) &&
      tr.getMeta("addToHistory") === false &&
      !tr.getMeta("wrap-home-append")
    );
  }
  const extension = Extension.create({
    name: "wrapHomeHost",
    priority: order === "early" ? 2000 : 1,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction(tr) {
            if (!target(tr)) return true;
            trace.push("filter");
            return mode !== "reject" && mode !== "reject-range";
          },
          appendTransaction(transactions, _old, state) {
            if (
              !transactions.some(target) ||
              !mode.startsWith("append-") ||
              transactions.some((tr) => tr.getMeta("wrap-home-append"))
            )
              return null;
            trace.push("append");
            const tr = state.tr.setMeta("wrap-home-append", true).setMeta("addToHistory", false);
            if (mode === "append-selection")
              tr.setSelection(TextSelection.create(state.doc, state.selection.anchor + 1));
            if (mode === "append-doc") tr.insertText("!", state.doc.content.size - 1);
            return tr;
          },
        }),
      ];
    },
  });
  const text = "alpha beta gamma delta epsilon zeta eta theta ".repeat(8);
  const controller = createEditor({
    element: host,
    toolbar: false,
    outline: false,
    extensions: [extension],
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
          content: [{ type: "text", text }],
        },
        { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
      ],
    },
  });
  const events: KeyboardEvent[] = [];
  controller.editor.view.dom.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Home" || (event.key === "End" && event.shiftKey)) events.push(event);
    },
    true,
  );
  window.wrapHome = {
    controller,
    arm: () => {
      armed = true;
      trace.length = 0;
    },
    trace,
    events,
    closeHistory: () => controller.editor.view.dispatch(closeHistory(controller.editor.state.tr)),
    settle: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  };
};
