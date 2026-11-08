import type { JSONContent } from "@tiptap/core";

import type { WritingResult } from "../../features/writing-assistant/types";

/** 只投影白名单结构；不调用宿主 renderHTML、NodeView 或任何外部资源。 */
export function renderWritingPreview(root: HTMLElement, result: WritingResult | null, fallback: string) {
  const doc = root.ownerDocument;
  const plain = (node: JSONContent): string => node.text ?? node.content?.map(plain).join("") ?? "";
  const node = (value: JSONContent): globalThis.Node => {
    if (value.type === "text") {
      let text: globalThis.Node = doc.createTextNode(value.text ?? "");
      const marks = new Map([
        ["bold", "strong"],
        ["italic", "em"],
        ["underline", "u"],
        ["strike", "s"],
        ["code", "code"],
      ]);
      for (const mark of value.marks ?? []) {
        const tag = marks.get(mark.type);
        if (tag) {
          const wrapper = doc.createElement(tag);
          wrapper.append(text);
          text = wrapper;
        }
      }
      return text;
    }
    if (value.type === "hardBreak") return doc.createElement("br");
    if (value.type === "codeBlock") {
      const pre = doc.createElement("pre"),
        code = doc.createElement("code");
      code.textContent = plain(value);
      pre.append(code);
      return pre;
    }
    const tags: Record<string, string> = {
      paragraph: "p",
      table: "table",
      tableRow: "tr",
      tableCell: "td",
      tableHeader: "th",
    };
    const tag = Object.hasOwn(tags, value.type ?? "") ? tags[value.type!] : undefined;
    if (!tag) {
      const fallback = doc.createElement("span");
      fallback.textContent = plain(value) || `[${value.type ?? "内容"}]`;
      return fallback;
    }
    const element = doc.createElement(tag);
    if (tag === "td" || tag === "th") {
      for (const attr of ["colspan", "rowspan"]) {
        const span = value.attrs?.[attr];
        if (Number.isInteger(span) && span > 0 && span <= 1000) element.setAttribute(attr, String(span));
      }
    }
    for (const child of value.content ?? []) element.append(node(child));
    return element;
  };
  const nodes: globalThis.Node[] = [];
  if (result?.format === "json") {
    for (const child of result.content.content ?? []) {
      nodes.push(node(child));
      nodes.push(doc.createTextNode("\n"));
    }
    nodes.pop();
  } else {
    const text = result?.format === "text" ? result.text : fallback;
    for (const line of text.split(/\r\n?|\n/)) {
      const p = doc.createElement("p");
      p.textContent = line;
      nodes.push(p, doc.createTextNode("\n"));
    }
    nodes.pop();
  }
  root.replaceChildren(...nodes);
}
