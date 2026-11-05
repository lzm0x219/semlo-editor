import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/editor/create-editor";

import "../../../demo/editor.css";
const host = document.createElement("div");
const errors: string[] = [];
let synchronousDispatches = 0;
window.addEventListener("error", (event) => {
  errors.push(event.message);
  event.preventDefault();
});
host.id = "host";
document.body.append(host);
const hostExtension = Extension.create({
  name: "mountFailureProbe",
  priority: 1,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view(view) {
          if (!synchronousDispatches++)
            view.dom.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, bubbles: true }));
          return {};
        },
      }),
    ];
  },
});
const controller = createEditor({
  element: host,
  content: "<p>目标文字</p><hr><p>正文</p>",
  outline: false,
  extensions: [hostExtension],
});
Object.assign(window, {
  pointerProbe: {
    controller,
    host,
    errors,
    getSynchronousDispatches: () => synchronousDispatches,
    reconfigure: () => controller.editor.registerPlugin(new Plugin({})),
  },
});
