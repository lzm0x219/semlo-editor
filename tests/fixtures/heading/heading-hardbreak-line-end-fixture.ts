import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";

interface HardBreakFixture {
  controller: EditorController;
  armReject(effect?: "reenter-selection" | "reenter-doc" | "destroy" | "blur"): void;
  rejected(): number;
  focusCalls(): number;
  settle(): Promise<void>;
}
declare global {
  interface Window {
    mountHardBreakLineEnd?(content: EditorContent, order: "early" | "late", widget?: "src" | "size"): void;
    hardBreakLineEnd?: HardBreakFixture;
    hardBreakEndEvents?: KeyboardEvent[];
  }
}
window.mountHardBreakLineEnd = (content, order, widget) => {
  const host = document.createElement("div");
  host.id = "heading-hardbreak-line-end";
  host.style.width = "850px";
  document.body.replaceChildren(host);
  let armed = false;
  let rejected = 0;
  let effect: "reenter-selection" | "reenter-doc" | "destroy" | "blur" | undefined;
  let focusCalls = 0;
  const extension = Extension.create({
    name: "hardBreakLineEndHost",
    priority: order === "early" ? 2000 : 1,
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          filterTransaction(tr, state) {
            if (
              armed &&
              !tr.docChanged &&
              tr.selectionSet &&
              tr.selection instanceof TextSelection &&
              tr.selection.empty
            ) {
              rejected += 1;
              if (effect) {
                const action = effect;
                effect = undefined;
                armed = false;
                if (action === "reenter-selection")
                  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 3)));
                else if (action === "reenter-doc")
                  editor.view.dispatch(state.tr.insertText("!", state.doc.content.size - 1));
                else if (action === "destroy") editor.destroy();
                else {
                  const outside = document.createElement("button");
                  outside.id = "hardbreak-outside-focus";
                  document.body.append(outside);
                  outside.focus();
                }
              }
              return false;
            }
            return true;
          },
        }),
      ];
    },
  });
  const hostWidget = Extension.create({
    name: "hardBreakHostWidget",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              if (!widget) return DecorationSet.empty;
              return DecorationSet.create(state.doc, [
                Decoration.widget(
                  1,
                  () => {
                    const image = document.createElement("img");
                    image.className = "ProseMirror-separator";
                    image.alt = "";
                    if (widget === "src")
                      image.src =
                        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'/%3E";
                    else {
                      image.width = 16;
                      image.height = 16;
                    }
                    return image;
                  },
                  { key: "hardBreak-host-widget" },
                ),
              ]);
            },
          },
        }),
      ];
    },
  });
  const controller = createEditor({
    element: host,
    content,
    toolbar: false,
    outline: false,
    extensions: [extension, hostWidget],
  });
  const events: KeyboardEvent[] = [];
  const originalFocus = controller.editor.view.focus.bind(controller.editor.view);
  controller.editor.view.focus = () => {
    focusCalls += 1;
    originalFocus();
  };
  window.hardBreakEndEvents = events;
  controller.editor.view.dom.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "End" && event.shiftKey) events.push(event);
    },
    true,
  );
  window.hardBreakLineEnd = {
    controller,
    armReject: (nextEffect) => {
      armed = true;
      effect = nextEffect;
      focusCalls = 0;
    },
    rejected: () => rejected,
    focusCalls: () => focusCalls,
    settle: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  };
};
