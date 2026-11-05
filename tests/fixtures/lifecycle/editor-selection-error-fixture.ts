import { createEditor } from "../../../packages/core/src/editor/create-editor";
import type { EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";

declare global {
  interface Window {
    selectionErrorFixture: { controller: EditorController; element: HTMLDivElement };
  }
}

const element = document.createElement("div");
document.body.append(element);
const controller = createEditor({ element, content: "<p>abcd</p>", outline: false });
window.selectionErrorFixture = { controller, element };
