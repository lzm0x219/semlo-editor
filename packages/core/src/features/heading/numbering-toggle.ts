import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection, type EditorState } from "@tiptap/pm/state";

import { headingNumberingStyle, inheritedHeadingNumbering, type HeadingNumberingStyle } from "./numbering";

/** 当前选区仅覆盖同一个根级标题时，返回标题位置。 */
export function selectedHeadingPosition(state: EditorState): number | null {
  const selection = state.selection;
  if (
    !(selection instanceof TextSelection) ||
    selection.$from.depth !== 1 ||
    !selection.$from.sameParent(selection.$to) ||
    selection.$from.parent.type.name !== "heading"
  )
    return null;
  return selection.$from.before(1);
}

export function canToggleHeadingNumbering(state: EditorState, pos: number): boolean {
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.content.size || state.doc.resolve(pos).depth !== 0)
    return false;
  const heading = state.doc.nodeAt(pos);
  if (heading?.type.name !== "heading") return false;
  const value = heading.attrs.semloEditorHeadingNumbering;
  return value == null || !!headingNumberingStyle(value);
}

/** 样式菜单同时更新已有编号标题，并可为当前无编号标题启用编号。 */
export function setHeadingNumberingStyle(editor: Editor, style: HeadingNumberingStyle, selected?: number): boolean {
  if (editor.isDestroyed || !editor.isEditable || !headingNumberingStyle(style)) return false;
  const state = editor.state;
  if (selected !== undefined && !canToggleHeadingNumbering(state, selected)) return false;
  const tr = closeHistory(state.tr);
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    if (
      (pos === selected || headingNumberingStyle(node.attrs.semloEditorHeadingNumbering)) &&
      node.attrs.semloEditorHeadingNumbering !== style
    )
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, semloEditorHeadingNumbering: style });
    return false;
  });
  if (!tr.docChanged) return true;
  editor.view.dispatch(tr);
  if (editor.isDestroyed || editor.state.doc.eq(state.doc)) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  return true;
}

/** 有序列表入口在标题中切换标题编号，不改变标题类型或正文。 */
export function toggleHeadingNumbering(editor: Editor, position?: number): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const state = editor.state;
  const pos = position ?? selectedHeadingPosition(state);
  if (pos === null || !canToggleHeadingNumbering(state, pos)) return false;
  const heading = state.doc.nodeAt(pos)!;
  const current = headingNumberingStyle(heading.attrs.semloEditorHeadingNumbering);
  const next = current ? null : (inheritedHeadingNumbering(state.doc, pos, Number(heading.attrs.level)) ?? "mixed");
  const tr = closeHistory(state.tr).setNodeMarkup(pos, undefined, {
    ...heading.attrs,
    semloEditorHeadingNumbering: next,
  });
  if (position !== undefined) tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  editor.view.dispatch(tr);
  if (editor.isDestroyed || editor.state.doc.eq(state.doc)) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  editor.view.focus();
  return true;
}
