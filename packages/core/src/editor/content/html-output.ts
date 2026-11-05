import type { Editor } from "@tiptap/core";

import { serializeHeadingNumbersHTML } from "../../features/heading/numbering";
import { serializeOrderedListStyles } from "../../features/list/ordered-style";
import { serializeOrderedListOrdinals } from "../../features/list/ordinals";
import { serializeDocumentHTML } from "../../features/text/document-font";

export function serializeEditorHTML(editor: Editor, doc: Document): string {
  return serializeHeadingNumbersHTML(
    serializeOrderedListStyles(
      serializeOrderedListOrdinals(serializeDocumentHTML(editor, doc), doc, editor.state.doc),
      doc,
      editor.state.doc,
    ),
    doc,
    editor.state.doc,
  );
}
