import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { serializeHeadingNumbersHTML } from "../../features/heading/numbering";
import { serializeOrderedListStyles } from "../../features/list/ordered-style";
import { serializeOrderedListOrdinals } from "../../features/list/ordinals";
import { serializeDocumentHTML } from "../../features/text/document-font";

export function serializeEditorHTML(
  editor: Editor,
  doc: Document,
  content: ProseMirrorNode = editor.state.doc,
): string {
  return serializeHeadingNumbersHTML(
    serializeOrderedListStyles(
      serializeOrderedListOrdinals(serializeDocumentHTML(editor, doc, content), doc, content),
      doc,
      content,
    ),
    doc,
    content,
  );
}
