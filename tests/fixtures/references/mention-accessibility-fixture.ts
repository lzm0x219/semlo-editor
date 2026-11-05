import "../../../packages/core/src/styles/bundle.css";
import { createEditor } from "../../../packages/core/src/index";

const firstHost = document.createElement("div");
const secondHost = document.createElement("div");
firstHost.id = "mention-accessibility-first";
secondHost.id = "mention-accessibility-second";
document.body.append(firstHost, secondHost);

const searchMentions = (query: string) =>
  query === "empty"
    ? []
    : [
        { id: "person", label: "明夷", kind: "person" as const },
        { id: "document", label: "设计文档", kind: "document" as const },
      ];
const first = createEditor({ element: firstHost, outline: false, searchMentions });
const second = createEditor({ element: secondHost, outline: false, searchMentions });
first.editor.view.dom.setAttribute("aria-controls", "host-control");
first.editor.view.dom.setAttribute("aria-activedescendant", "host-option");

Object.assign(window, { mentionAccessibilityFirst: first, mentionAccessibilitySecond: second });
