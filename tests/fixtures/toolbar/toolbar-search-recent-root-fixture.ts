import { createEditor } from "../../../packages/core/src/editor/create-editor";

import "../../../packages/core/src/styles/style.css";
import "../../../packages/core/src/features/insertion/recent.css";

const host = document.createElement("div");
host.id = "search-recent-root-fixture";
document.body.append(host);
createEditor({
  element: host,
  outline: false,
  content: { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph" }] },
});
