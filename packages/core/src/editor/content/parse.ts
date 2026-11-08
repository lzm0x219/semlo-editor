import { createDocument, type Editor, type JSONContent } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";

import { assertNumberingSequenceDocument } from "../../features/list/numbering-sequence-document";
import { tableValidationRules } from "../../features/table/schema";
import { extractDocumentFontHTML, readDocumentFont, withDocumentFontAttrs } from "../../features/text/document-font";
import { ContentValidationError } from "../../shared/content-error";
import type { EditorContent } from "../../types";
import { cloneContentValue } from "./clone-value";

export function assertSupportedContent(content: EditorContent, editor: Editor): void {
  if (typeof content === "string") {
    if (/data-semlo-editor-list-sequence/i.test(content)) {
      const template = editor.view.dom.ownerDocument.createElement("template");
      template.innerHTML = content;
      for (const element of template.content.querySelectorAll(
        "[data-semlo-editor-list-sequences], [data-semlo-editor-list-sequence], [data-semlo-editor-list-sequence-link]",
      )) {
        if (
          (element.hasAttribute("data-semlo-editor-list-sequences") && element.localName !== "ol") ||
          (element.hasAttribute("data-semlo-editor-list-sequence") && element.localName !== "li") ||
          (element.hasAttribute("data-semlo-editor-list-sequence-link") && element.localName !== "ol")
        )
          throw new ContentValidationError("编号序列 HTML 属性位于不支持的元素");
      }
      assertNumberingSequenceDocument(createDocument(content, editor.schema, {}, { errorOnInvalidContent: false }));
    }
    return;
  }

  // ProseMirror 解析 JSON 时会静默丢弃未声明的属性；必须在解析前检查。
  const pending: JSONContent[] = [content];
  const seen = new Set<JSONContent>();
  while (pending.length) {
    const node = pending.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const checkAttributes = (
      value: { type?: string; attrs?: Record<string, unknown> },
      definition: { spec: { attrs?: Record<string, unknown> } } | undefined,
    ) => {
      if (!definition || value.attrs == null) return;
      for (const attribute of Object.keys(value.attrs))
        if (!Object.hasOwn(definition.spec.attrs ?? {}, attribute))
          throw new Error(`内容包含当前编辑器未声明的 ${value.type ?? "unknown"} 属性 ${attribute}`);
    };
    checkAttributes(node, node.type ? editor.schema.nodes[node.type] : undefined);
    if (Array.isArray(node.marks))
      for (const mark of node.marks) checkAttributes(mark, mark.type ? editor.schema.marks[mark.type] : undefined);
    if (Array.isArray(node.content)) pending.push(...node.content);
  }
}

export function createCheckedJSONDocument(content: JSONContent, schema: Schema) {
  try {
    const parsed = createDocument(content, schema, {}, { errorOnInvalidContent: true });
    assertNumberingSequenceDocument(parsed);
    return parsed;
  } catch (error) {
    // Tiptap 会包装 schema 校验异常，保留功能提供的可恢复错误信息。
    if (error instanceof Error && error.cause instanceof ContentValidationError) throw error.cause;
    throw error;
  }
}

export function createContentParser(editor: Editor, doc: Document) {
  let htmlValidationSchema: Schema | undefined;
  return function parseContent(content: EditorContent) {
    // 解析前复制 JSON，使外部对象的后续修改不能绕过编辑器事务。
    const ownedContent = typeof content === "string" ? content : cloneContentValue(content);
    assertSupportedContent(ownedContent, editor);
    // Compare normalized documents, so omitted default attributes do not reset a controlled editor.
    let parsed;
    if (typeof ownedContent === "string") {
      const fontContent = extractDocumentFontHTML(ownedContent, doc);
      const html = fontContent?.html ?? ownedContent;
      // TextStyle deliberately uses a non-consuming span rule so other marks can
      // parse the same element. Tiptap's strict catch-all otherwise rejects that
      // valid span. Make the rule consuming only in the validation schema.
      if (!htmlValidationSchema) {
        const schema = editor.schema,
          textStyle = schema.spec.marks.get("textStyle");
        const marks = textStyle
          ? schema.spec.marks.update("textStyle", {
              ...textStyle,
              parseDOM: [
                ...(textStyle.parseDOM ?? []).map((rule) => ({ ...rule, consuming: true })),
                // 有些宿主标记不输出属性，导出的空 span 应按中性容器校验；内部仍需逐项校验。
                {
                  tag: "span:not([style])",
                  consuming: true,
                  getAttrs: (element: HTMLElement | string) =>
                    typeof element !== "string" && element.attributes.length === 0 ? null : false,
                },
              ],
            })
          : schema.spec.marks;
        const table = schema.spec.nodes.get("table");
        const nodes = table
          ? schema.spec.nodes.update("table", {
              ...table,
              parseDOM: [...(table.parseDOM ?? []), ...tableValidationRules],
            })
          : schema.spec.nodes;
        htmlValidationSchema = new Schema({ nodes, marks, topNode: schema.spec.topNode });
      }
      createDocument(html, htmlValidationSchema, {}, { errorOnInvalidContent: true });
      parsed = createDocument(html, editor.schema, {}, { errorOnInvalidContent: false });
      assertNumberingSequenceDocument(parsed);
      if (fontContent)
        parsed = parsed.type.create(
          withDocumentFontAttrs(parsed.attrs, fontContent.font),
          parsed.content,
          parsed.marks,
        );
    } else {
      parsed = createCheckedJSONDocument(ownedContent, editor.schema);
    }
    const font = readDocumentFont(parsed.attrs);
    parsed = parsed.type.create(withDocumentFontAttrs(parsed.attrs, font), parsed.content, parsed.marks);
    return { parsed, font };
  };
}
