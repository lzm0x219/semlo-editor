import type { Editor } from "@tiptap/core";

import { detailsToolbarSelection, type DetailsToolbarSelection } from "../blocks/details-selection";
import { setHeadingStyle as convertHeadingStyle } from "./conversion";
import { getHeadingSelection, type HeadingStyleLevel } from "./selection";

/** 当前选区的正文或标题样式，以及默认工具栏是否允许操作。 */
export interface HeadingStyleState {
  /** 0 是菜单的正文显示值，1–6 是标题级别，null 表示无统一样式或视图不可用。 */
  level: HeadingStyleLevel | null;
  enabled: boolean;
}

/** 复用工具栏已计算的选区分类，避免一次刷新重复遍历选区。 */
export function headingStyleStateFromSelection(
  editor: Editor,
  selection: ReturnType<typeof getHeadingSelection>,
  detailsSelection: DetailsToolbarSelection,
): HeadingStyleState {
  if (editor.isDestroyed) return { level: null, enabled: false };
  return { level: selection.level, enabled: editor.isEditable && detailsSelection === "other" };
}

/** 读取与默认标题菜单一致的状态；只读时仍保留选中的样式。 */
export function getHeadingStyleState(editor: Editor): HeadingStyleState {
  if (editor.isDestroyed) return { level: null, enabled: false };
  return headingStyleStateFromSelection(
    editor,
    getHeadingSelection(editor.state),
    detailsToolbarSelection(editor.state.selection),
  );
}

function isHeadingStyleLevel(level: HeadingStyleLevel): boolean {
  return Number.isInteger(level) && level >= 0 && level <= 6;
}

/** 显式设置正文或标题样式，与默认菜单保持一致。 */
export function setHeadingStyle(editor: Editor, level: HeadingStyleLevel): boolean {
  return isHeadingStyleLevel(level) && convertHeadingStyle(editor, level);
}

/** 再次选择相同标题时切回正文，与快捷键保持一致。 */
export function toggleHeadingStyle(editor: Editor, level: HeadingStyleLevel): boolean {
  return isHeadingStyleLevel(level) && convertHeadingStyle(editor, level, { toggle: true });
}
