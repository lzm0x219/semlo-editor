import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { toggleList, type ListKind } from "./list-command";

export function listShortcut(view: EditorView, event: KeyboardEvent): ListKind | null {
  const platform = view.dom.ownerDocument.defaultView?.navigator.platform ?? "";
  const mac = /Mac|iPhone|iPad|iPod/i.test(platform);
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  if (event.shiftKey && !event.altKey && (event.code === "Digit8" || event.key === "8" || event.key === "*"))
    return "bulletList";
  if (event.altKey && !event.shiftKey && (event.code === "KeyT" || event.key.toLowerCase() === "t")) return "taskList";
  return null;
}

/** 快捷键与工具栏共用转换规则，并避免组合输入触发结构修改。 */
export const ListKeyboard = Extension.create({
  name: "semloEditorListKeyboard",
  priority: 1001,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            keydown(view, event) {
              if (!view.editable || event.defaultPrevented || !listShortcut(view, event)) return false;
              const mac = /Mac|iPhone|iPad|iPod/i.test(view.dom.ownerDocument.defaultView?.navigator.platform ?? "");
              if (
                (!mac && event.getModifierState("AltGraph")) ||
                event.isComposing ||
                event.keyCode === 229 ||
                view.composing
              )
                return true;
              return false;
            },
          },
          handleKeyDown(view, event) {
            if (
              event.defaultPrevented ||
              event.isComposing ||
              event.keyCode === 229 ||
              view.composing ||
              !view.editable
            )
              return false;
            const kind = listShortcut(view, event);
            if (!kind) return false;
            try {
              toggleList(editor, kind);
            } catch (error) {
              event.preventDefault();
              throw error;
            }
            return true;
          },
        },
      }),
    ];
  },
});
