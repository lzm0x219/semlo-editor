import { createEditor } from "../../../packages/core/src/editor/create-editor";

import "../../../demo/editor.css";

for (const id of ["first", "second"]) {
  const host = document.createElement("div");
  host.id = id;
  host.style.width = "1600px";
  document.body.append(host);
  createEditor({ element: host, outline: false, content: `<p>${id} text</p>` });
}
