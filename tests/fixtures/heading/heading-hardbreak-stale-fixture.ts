import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";
interface Fixture {
  controller: EditorController;
  arm(mode: "special" | "all"): void;
  trace: Array<{ docChanged: boolean; selectionSet: boolean; preventHistory: boolean; rejected: boolean }>;
  keys: Array<{ key: string; native: number | null; pm: number; trusted: boolean }>;
  events: KeyboardEvent[];
  focusCalls(): number;
  settle(): Promise<void>;
}
declare global {
  interface Window {
    mountHardBreakStale?(content: EditorContent, order: "early" | "late"): void;
    hardBreakStale?: Fixture;
  }
}
window.mountHardBreakStale = (content, order) => {
  const host = document.createElement("div");
  host.id = "hardbreak-stale";
  host.style.width = "850px";
  document.body.replaceChildren(host);
  let mode: "special" | "all" | null = null,
    focusCalls = 0;
  const trace: Fixture["trace"] = [];
  const extension = Extension.create({
    name: "hardBreakStaleHost",
    priority: order === "early" ? 2000 : 1,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction(tr) {
            if (!mode) return true;
            const rejected =
              tr.selectionSet && (mode === "all" || (!tr.docChanged && tr.getMeta("addToHistory") === false));
            trace.push({
              docChanged: tr.docChanged,
              selectionSet: tr.selectionSet,
              preventHistory: tr.getMeta("addToHistory") === false,
              rejected,
            });
            return !rejected;
          },
        }),
      ];
    },
  });
  const controller = createEditor({ element: host, content, toolbar: false, outline: false, extensions: [extension] });
  const editor = controller.editor,
    view = editor.view;
  const originalFocus = view.focus.bind(view);
  view.focus = () => {
    focusCalls++;
    originalFocus();
  };
  const keys: Fixture["keys"] = [],
    events: KeyboardEvent[] = [];
  view.dom.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "End" && event.key !== "X") return;
      const selection = document.getSelection();
      keys.push({
        key: event.key,
        native: selection?.anchorNode ? view.posAtDOM(selection.anchorNode, selection.anchorOffset) : null,
        pm: view.state.selection.anchor,
        trusted: event.isTrusted,
      });
      if (event.key === "End") events.push(event);
    },
    true,
  );
  window.hardBreakStale = {
    controller,
    arm: (value) => {
      mode = value;
      trace.length = 0;
      focusCalls = 0;
    },
    trace,
    keys,
    events,
    focusCalls: () => focusCalls,
    settle: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  };
};
