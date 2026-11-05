import { createEditor } from "../../../packages/core/src/editor/create-editor";

import "../../../packages/core/src/styles/style.css";
import "../../../packages/core/src/features/insertion/recent.css";

const host = document.createElement("div");
host.id = "table-insert-fixture";
document.body.append(host);
const style = document.createElement("style");
style.textContent = "#table-insert-fixture .semlo-editor-prose table { width: 600px; min-width: 600px; }";
document.head.append(style);
const controller = createEditor({
  element: host,
  outline: false,
  content: {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph" }] },
              { type: "tableCell", content: [{ type: "paragraph" }] },
              { type: "tableCell", content: [{ type: "paragraph" }] },
            ],
          },
        ],
      },
    ],
  },
});
Object.assign(window, { tableInsertSnapshot: () => controller.editor.getJSON() });
