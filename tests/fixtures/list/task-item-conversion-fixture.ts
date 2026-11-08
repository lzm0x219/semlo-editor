import { Plugin } from "@tiptap/pm/state";

import { toggleOrderedListPreservingTaskIndent } from "../../../packages/core/src/features/list/task-list-conversion";
import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";

declare global {
  interface Window {
    taskConversionCreate?: typeof createEditor;
    taskConversionEditor?: EditorController;
    taskConversionOrdered?: typeof toggleOrderedListPreservingTaskIndent;
    taskConversionRejectHeading?: () => void;
    taskConversionRejectSelection?: () => void;
    taskConversionRejectConvertedList?: () => void;
  }
}

Object.assign(window, {
  taskConversionCreate: createEditor,
  taskConversionOrdered: toggleOrderedListPreservingTaskIndent,
  taskConversionRejectHeading: () => {
    window.taskConversionEditor?.editor.registerPlugin(
      new Plugin({
        filterTransaction(tr) {
          let heading = false;
          if (tr.docChanged)
            tr.doc.descendants((node) => {
              if (node.type.name === "heading") heading = true;
              return !heading;
            });
          return !heading;
        },
      }),
    );
  },
  taskConversionRejectSelection: () => {
    window.taskConversionEditor?.editor.registerPlugin(
      new Plugin({ filterTransaction: (tr) => tr.docChanged || !tr.selectionSet }),
    );
  },
  taskConversionRejectConvertedList: () => {
    window.taskConversionEditor?.editor.registerPlugin(
      new Plugin({
        filterTransaction(tr) {
          let converted = false;
          if (tr.docChanged)
            tr.doc.descendants((node) => {
              if (node.type.name === "taskList" || node.type.name === "bulletList") converted = true;
              return !converted;
            });
          return !converted;
        },
      }),
    );
  },
});
