import { createDocument, type Editor } from "@tiptap/core";

import { extractDocumentFontHTML, withDocumentFontAttrs } from "../../features/text/document-font";
import type { EditorContent } from "../../types";
import { cloneContentValue } from "./clone-value";
import { assertSupportedContent, createCheckedJSONDocument } from "./parse";

export function initializeEditorContent(
  editor: Editor,
  initialContent: EditorContent | undefined,
  initialFont: ReturnType<typeof extractDocumentFontHTML>,
): void {
  if (initialContent == null) return;
  // 初始化和后续替换使用同一所有权约定。
  const ownedContent = typeof initialContent === "string" ? initialContent : cloneContentValue(initialContent);
  assertSupportedContent(ownedContent, editor);
  let parsed =
    typeof ownedContent === "string"
      ? createDocument(initialFont?.html ?? ownedContent, editor.schema, {}, { errorOnInvalidContent: false })
      : createCheckedJSONDocument(ownedContent, editor.schema);
  if (initialFont)
    parsed = parsed.type.create(withDocumentFontAttrs(parsed.attrs, initialFont.font), parsed.content, parsed.marks);
  if (!parsed.eq(editor.state.doc)) {
    const tr = editor.state.tr;
    if (!parsed.content.eq(tr.doc.content)) tr.replaceWith(0, tr.doc.content.size, parsed.content);
    for (const [name, value] of Object.entries(parsed.attrs)) tr.setDocAttribute(name, value);
    editor.view.dispatch(tr.setMeta("preventUpdate", true).setMeta("addToHistory", false));
  }
}
