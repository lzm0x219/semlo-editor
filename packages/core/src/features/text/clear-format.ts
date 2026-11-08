import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";

import { dispatchFormattingWithHistory } from "../../runtime/format-history";

// 只清理编辑器内置文字格式；链接及宿主新增的语义 mark 不属于格式清理范围。
const formatMarks = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "highlight",
  "subscript",
  "superscript",
  "textStyle",
];

/** 工具栏和快捷键共享。返回是否处理操作，宿主拒绝后也不继续原生清理。 */
export function clearTextFormatting(editor: Editor, options?: { focus?: boolean }): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const view = editor.view;
  if (view.isDestroyed || !view.editable || view.composing) return false;
  const state = editor.state;
  const selection = state.selection;
  const active = view.dom.ownerDocument.activeElement;
  const tr = state.tr;
  for (const name of formatMarks) {
    const type = state.schema.marks[name];
    if (!type) continue;
    // 与 Tiptap unsetMark 保持相同的范围语义，包含 CellSelection 的独立单元格范围。
    for (const range of selection.ranges)
      if (range.$from.pos < range.$to.pos) tr.removeMark(range.$from.pos, range.$to.pos, type);
    tr.removeStoredMark(type);
  }
  const changed = tr.docChanged || tr.storedMarksSet;
  if (changed) dispatchFormattingWithHistory(editor, closeHistory(tr));
  if (
    options?.focus !== false &&
    !editor.isDestroyed &&
    editor.isEditable &&
    editor.view === view &&
    (!changed || view.state !== state) &&
    view.state.doc === tr.doc &&
    view.state.selection.eq(selection) &&
    view.dom.ownerDocument.activeElement === active &&
    !view.hasFocus()
  )
    view.focus();
  return true;
}
