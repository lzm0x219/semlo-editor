import { createEditor } from "../../../packages/core/src/editor/create-editor";

import "../../../demo/editor.css";

const host = document.createElement("div");
document.body.append(host);
const controller = createEditor({ element: host, outline: false, content: "<p>背景测试</p>" });
Object.assign(window, {
  colorShortcutFixture: {
    select: () => controller.editor.commands.setTextSelection({ from: 1, to: 5 }),
    setEditable: (value: boolean) => controller.setEditable(value),
    paint: () => controller.editor.commands.setHighlight({ color: "#117cee" }),
    snapshot: () => controller.getSnapshot().html,
    destroy: () => controller.destroy(),
  },
});
