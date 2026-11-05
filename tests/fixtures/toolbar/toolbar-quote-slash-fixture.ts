import { createEditor } from "../../../packages/core/src/editor/create-editor";

const host = document.createElement("div");
host.id = "quote-slash-fixture";
document.body.append(host);
createEditor({
  element: host,
  outline: false,
  content: { type: "doc", content: [{ type: "blockquote", content: [{ type: "paragraph" }] }] },
});
