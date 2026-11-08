import type { Editor, JSONContent } from "@tiptap/core";

import { createContentParser } from "../../editor/content/parse";
import type { WritingResult } from "./types";

/** JSON 边界拒绝不可保存的值，而不让 stringify 静默丢掉函数或非有限数。 */
function ownResult(value: unknown): WritingResult {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (
      typeof item === "function" ||
      typeof item === "symbol" ||
      typeof item === "bigint" ||
      typeof item === "undefined" ||
      (typeof item === "number" && !Number.isFinite(item))
    )
      throw new Error("写作服务返回了不可保存的值");
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const prototype = Object.getPrototypeOf(item);
    if (
      (!Array.isArray(item) && prototype !== null && Object.getPrototypeOf(prototype) !== null) ||
      Object.getOwnPropertySymbols(item).length
    )
      throw new Error("写作结果必须是普通 JSON 数据");
    pending.push(...Object.values(item));
  }
  const json = JSON.stringify(value);
  if (!json) throw new Error("写作服务未返回内容");
  const result = JSON.parse(json) as WritingResult;
  if (!result || typeof result !== "object") throw new Error("写作服务返回了无效结果");
  if (result.feedbackId !== undefined && typeof result.feedbackId !== "string")
    throw new Error("写作结果的反馈标识必须是字符串");
  if (result.format === "text") {
    if (typeof result.text !== "string" || !result.text.trim()) throw new Error("写作服务返回了空文本");
    if (Object.keys(result).some((key) => key !== "format" && key !== "text" && key !== "feedbackId"))
      throw new Error("文本结果包含未声明的字段");
  } else if (result.format === "json") {
    if (!result.content || result.content.type !== "doc") throw new Error("结构化结果必须是 doc JSON");
    if (result.content.attrs || result.content.marks || result.content.text)
      throw new Error("写作结果只插入文档内容，不接纳 doc 根节点的属性、标记或文字");
    if (Object.keys(result).some((key) => key !== "format" && key !== "content" && key !== "feedbackId"))
      throw new Error("结构化结果包含未声明的字段");
  } else throw new Error("写作结果只支持 text 或 json，不接受 HTML");
  return result;
}

export function parseWritingResult(editor: Editor, value: unknown) {
  const result = ownResult(value);
  const content: JSONContent =
    result.format === "json"
      ? result.content
      : {
          type: "doc",
          content: result.text.split(/\r\n?|\n/).map((text) => ({
            type: "paragraph",
            ...(text ? { content: [{ type: "text", text }] } : {}),
          })),
        };
  const nodes: JSONContent[] = [content];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (!node || Object.keys(node).some((key) => !["type", "attrs", "content", "marks", "text"].includes(key)))
      throw new Error("写作节点包含未声明的字段");
    if (Array.isArray(node.content)) nodes.push(...node.content);
    if (Array.isArray(node.marks))
      for (const mark of node.marks)
        if (!mark || Object.keys(mark).some((key) => key !== "type" && key !== "attrs"))
          throw new Error("写作标记包含未声明的字段");
  }
  const { parsed } = createContentParser(editor, editor.view.dom.ownerDocument)(content);
  parsed.check();
  if (!parsed.content.size) throw new Error("写作服务返回了空内容");
  const text = parsed.textBetween(0, parsed.content.size, "\n");
  let structural = false;
  parsed.descendants((node) => {
    if (!node.isText && node.type.name !== "paragraph") structural = true;
  });
  if (!text.trim() && !structural) throw new Error("写作服务返回了空内容");
  return {
    result,
    parsed,
    text: result.format === "text" ? result.text : text || JSON.stringify(result.content, null, 2),
  };
}
