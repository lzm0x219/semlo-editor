import { toggleOrderedListPreservingTaskIndent } from "../../../packages/core/src/features/list/task-list-conversion";
import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";

declare global {
  interface Window {
    taskConversionCreate?: typeof createEditor;
    taskConversionEditor?: EditorController;
    taskConversionOrdered?: typeof toggleOrderedListPreservingTaskIndent;
  }
}

Object.assign(window, {
  taskConversionCreate: createEditor,
  taskConversionOrdered: toggleOrderedListPreservingTaskIndent,
});
