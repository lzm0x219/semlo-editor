import type { Editor } from "@tiptap/core";

import { toggleBoldOutsideHeadings } from "../heading/bold";
import { getHeadingSelection } from "../heading/selection";

/** 加粗控件使用的当前选区状态。 */
export interface BoldState {
  active: boolean;
  enabled: boolean;
}

/** 读取加粗状态；视图卸载或实例销毁后返回不可用状态。 */
export function getBoldState(editor: Editor): BoldState {
  if (editor.isDestroyed) return { active: false, enabled: false };
  return {
    active: editor.isActive("bold"),
    enabled: editor.isEditable && !getHeadingSelection(editor.state).headingsOnly,
  };
}

/** 执行加粗；混合选区只修改非标题内容。 */
export function toggleBold(editor: Editor, options?: { focus?: boolean }): boolean {
  if (!getBoldState(editor).enabled) return false;
  const focus = options?.focus !== false;
  if (toggleBoldOutsideHeadings(editor)) {
    if (focus && !editor.isDestroyed) editor.view.focus();
    return true;
  }
  return focus ? editor.chain().focus().toggleBold().run() : editor.commands.toggleBold();
}
