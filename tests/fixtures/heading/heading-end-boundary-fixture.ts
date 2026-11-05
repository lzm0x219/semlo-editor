import { TextSelection } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";

interface Probe {
  controller: EditorController;
  select(text: string, anchor: number, head: number): void;
  settle(): Promise<void>;
}
declare global {
  interface Window {
    mountHeadingEndBoundary?(content: EditorContent, width?: number, native?: boolean): void;
    headingEndBoundary?: Probe;
  }
}

window.mountHeadingEndBoundary = (content, width = 850, native = false) => {
  const host = document.createElement("div");
  host.id = "heading-end-boundary";
  host.style.width = `${width}px`;
  document.body.replaceChildren(host);
  const controller = createEditor({ element: host, content, toolbar: false, outline: false });
  if (native) {
    const plugin = controller.editor.state.plugins.find((item) =>
      (item as unknown as { key: string }).key.startsWith("semloEditorHeadingEndSelection$"),
    );
    if (!plugin) throw new Error("Missing heading-end plugin");
    plugin.props.handleKeyDown = () => false;
  }
  window.headingEndBoundary = {
    controller,
    select(text, anchor, head) {
      const { editor } = controller;
      let start = -1;
      editor.state.doc.descendants((node, position) => {
        if (node.isTextblock && node.textContent === text) start = position + 1;
      });
      if (start < 0) throw new Error(`No text block ${text}`);
      editor.view.focus();
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start + anchor, start + head)),
      );
    },
    settle: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  };
};
