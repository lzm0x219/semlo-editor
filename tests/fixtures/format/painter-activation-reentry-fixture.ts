import { createEditor } from "../../../packages/core/src/editor/create-editor";
import { mountFormatPainter } from "../../../packages/core/src/ui/format-painter/format-painter";

const host = document.createElement("div");
host.id = "painter-activation-reentry";
document.body.append(host);
const api = createEditor({ element: host, outline: false, content: "<p><strong>来源</strong></p><p>目标</p>" });
const button = document.createElement("button");
button.textContent = "自定义格式刷";
document.body.append(button);
let reentry: "sync" | "before" | undefined;
const remount = () => {
  api.editor.unmount();
  const target = document.createElement("div");
  host.querySelector(".semlo-editor-content")!.append(target);
  api.editor.mount(target);
};
const dispose = mountFormatPainter(api.editor, button, {
  syncSelection() {
    if (reentry === "sync") remount();
  },
  beforeActivate() {
    if (reentry === "before") remount();
  },
});
Object.assign(window, {
  painterActivationReentry: {
    api,
    arm(value: "sync" | "before") {
      reentry = value;
    },
    dispose() {
      dispose();
      api.destroy();
      button.remove();
    },
  },
});
