import { createEditor } from "../../../packages/core/src/editor/create-editor";

import "../../../packages/core/src/styles/style.css";
import "../../../packages/core/src/features/insertion/recent.css";

const host = document.createElement("div");
host.id = "unavailable-slash-fixture";
document.body.append(host);
const controller = createEditor({
  element: host,
  outline: false,
  content: { type: "doc", content: [{ type: "paragraph" }] },
});
Object.assign(window, { unavailableSetEditable: (editable: boolean) => controller.setEditable(editable) });
