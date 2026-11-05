import "../../../packages/core/src/styles/style.css";
import { closeHistory } from "@tiptap/pm/history";

import { createEditor } from "../../../packages/core/src/index";

const host = document.createElement("div");
document.body.append(host);
Object.assign(window, {
  closeStatusHistory: closeHistory,
  statusSyncEditor: createEditor({
    element: host,
    outline: false,
    onChange() {
      if (Reflect.get(window, "destroyStatusEditor")) {
        const controller = Reflect.get(window, "statusSyncEditor");
        if (!controller) throw new Error("Status fixture is not initialized");
        controller.destroy();
      }
    },
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "semloEditorStatus", attrs: { label: "待办", color: 0 } }] }],
    },
  }),
});
