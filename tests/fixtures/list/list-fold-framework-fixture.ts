import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h } from "vue";

import { createEditor, type EditorController } from "../../../packages/core/src/index";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

import "../../../demo/editor.css";

const item = (text: string, indent: number) => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const content = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题" }] },
    {
      type: "orderedList",
      attrs: { start: 7, semloEditorOrderedStyle: "decimal" },
      content: [item("甲", 0), item("乙", 1), item("丙", 0)],
    },
  ],
};
let controller: EditorController | undefined;
type Kind = "core" | "react" | "vue" | "solid";
function mount(kind: Kind) {
  const host = document.createElement("div");
  host.id = "list-fold-framework";
  document.body.append(host);
  const props = {
    content,
    outline: false,
    onReady: (instance: EditorController) => {
      controller = instance;
    },
  };
  if (kind === "core") controller = createEditor({ element: host, content, outline: false });
  else if (kind === "react") createRoot(host).render(createElement(ReactEditor, props));
  else if (kind === "vue") createApp({ render: () => h(VueEditor, props) }).mount(host);
  else render(() => createComponent(SolidEditor, props), host);
}
declare global {
  interface Window {
    listFoldFramework?: { mount: (kind: Kind) => void; readonly controller: EditorController | undefined };
  }
}
window.listFoldFramework = {
  mount,
  get controller() {
    return controller;
  },
};
