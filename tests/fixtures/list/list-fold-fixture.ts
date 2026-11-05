import { Editor } from "@tiptap/core";

import { createStarterKitWithCodeFonts } from "../../../packages/core/src/editor/starter-kit";
import { ListFold } from "../../../packages/core/src/features/list/list-fold";
import { OrderedListNumbering } from "../../../packages/core/src/features/list/ordered-numbering";
import { OrderedListStyles } from "../../../packages/core/src/features/list/ordered-style";

import "../../../packages/core/src/features/list/ordered-style-menu.css";
import { ParagraphLayout } from "../../../packages/core/src/features/text/paragraph-layout";

import "../../../packages/core/src/features/list/ordered-numbering.css";
import "../../../packages/core/src/features/list/list-fold.css";

declare global {
  interface Window {
    listFoldEditor?: Editor;
    createListFoldEditor?: (content: object | string) => void;
  }
}
window.createListFoldEditor = (content) => {
  window.listFoldEditor?.destroy();
  document.body.innerHTML = '<div class="semlo-editor-prose" id="editor"></div>';
  window.listFoldEditor = new Editor({
    element: document.querySelector("#editor")!,
    extensions: [createStarterKitWithCodeFonts([]), ParagraphLayout, ListFold, OrderedListStyles, OrderedListNumbering],
    content,
  });
};
