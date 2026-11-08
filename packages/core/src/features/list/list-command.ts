import type { Editor } from "@tiptap/core";

import { detailsToolbarSelection } from "../blocks/details-selection";
import { headingNumberingStyle } from "../heading/numbering";
import { selectedHeadingPosition, toggleHeadingNumbering } from "../heading/numbering-toggle";
import { canConvertMixedSequenceSelection } from "./mixed-sequence-conversion";
import { canConvertSequenceChain } from "./numbering-sequence-continuation";
import { selectionHasNumberingSequences, sequenceConvertibleSelection } from "./numbering-sequence-document";
import {
  toggleBulletListPreservingTaskIndent,
  toggleOrderedListPreservingTaskIndent,
  toggleTaskListPreservingListItems,
} from "./task-list-conversion";

export type ListKind = "bulletList" | "orderedList" | "taskList";

export interface ListState {
  /** 当前选区是否处于该类型的列表。 */
  active: boolean;
  /** 工具栏是否允许尝试；复杂结构可能无法安全转换。 */
  enabled: boolean;
}

/** 读取列表工具栏状态，沿用默认工具栏对折叠卡片标题的限制。 */
export function getListState(editor: Editor, kind: ListKind): ListState {
  if (editor.isDestroyed || (kind !== "bulletList" && kind !== "orderedList" && kind !== "taskList"))
    return { active: false, enabled: false };
  const headingPos = kind === "orderedList" ? selectedHeadingPosition(editor.state) : null;
  if (headingPos !== null) {
    const value = editor.state.doc.nodeAt(headingPos)?.attrs.semloEditorHeadingNumbering;
    const style = headingNumberingStyle(value);
    return { active: !!style, enabled: editor.isEditable && (value == null || !!style) };
  }
  return {
    active: editor.isActive(kind),
    enabled:
      editor.isEditable &&
      (!selectionHasNumberingSequences(editor.state) ||
        (kind !== "orderedList" &&
          ((sequenceConvertibleSelection(editor.state) &&
            canConvertSequenceChain(editor.state.doc, editor.state.selection.$from.before(1))) ||
            canConvertMixedSequenceSelection(editor.state)))) &&
      (kind === "taskList" || detailsToolbarSelection(editor.state.selection) === "other"),
  };
}

/** 按默认工具栏规则切换列表，不能安全转换时保持文档不变。 */
export function toggleList(editor: Editor, kind: ListKind): boolean {
  if (!getListState(editor, kind).enabled) return false;
  switch (kind) {
    case "bulletList":
      return toggleBulletListPreservingTaskIndent(editor);
    case "orderedList":
      return selectedHeadingPosition(editor.state) !== null
        ? toggleHeadingNumbering(editor)
        : toggleOrderedListPreservingTaskIndent(editor);
    case "taskList":
      return toggleTaskListPreservingListItems(editor);
    default:
      return false;
  }
}
