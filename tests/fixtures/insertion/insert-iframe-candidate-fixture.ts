import "../../../packages/core/src/styles/style.css";
import { createEditor } from "../../../packages/core/src/editor/create-editor";
const frame = document.createElement("iframe");
frame.style.cssText = "width:1100px;height:800px;border:0";
document.body.append(frame);
for (const style of document.querySelectorAll('style,link[rel="stylesheet"]'))
  frame.contentDocument!.head.append(style.cloneNode(true));
const host = frame.contentDocument!.createElement("div");
host.id = "iframe-insert-host";
frame.contentDocument!.body.append(host);
const controller = createEditor({ element: host, outline: false, content: "<p></p>" });
Object.assign(window, { iframeInsert: controller });
