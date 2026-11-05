import "../../../packages/core/src/styles/style.css";
import { createEditor } from "../../../packages/core/src/index";
const frame = document.createElement("iframe");
frame.style.cssText = "width:900px;height:700px;border:0";
document.body.append(frame);
for (const stylesheet of document.querySelectorAll('style, link[rel="stylesheet"]'))
  frame.contentDocument!.head.append(stylesheet.cloneNode(true));
const host = frame.contentDocument!.createElement("div");
frame.contentDocument!.body.append(host);
const controller = createEditor({
  element: host,
  outline: false,
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "semloEditorStatus", attrs: { label: "状态", color: 0 } },
          { type: "text", text: " " },
          { type: "semloEditorFormula", attrs: { id: "formula", latex: "x" } },
          { type: "text", text: " " },
          { type: "semloEditorDate", attrs: { id: "date", date: "2026-11-03" } },
        ],
      },
      {
        type: "semloEditorCalendar",
        attrs: {
          events: [{ id: "event", title: "日程", start: "2026-11-05", end: "2026-11-05", description: "", color: 0 }],
        },
      },
    ],
  },
});
Reflect.set(window, "iframeCardController", controller);
