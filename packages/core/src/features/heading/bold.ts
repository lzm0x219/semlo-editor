import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";

import { dispatchFormattingWithHistory } from "../../runtime/format-history";
import { getHeadingSelection } from "./selection";

/** 混合选区只切换非标题内容；返回 false 时交给普通加粗命令。 */
export function toggleBoldOutsideHeadings(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const { state } = editor;
  const { selection } = state;
  if (getHeadingSelection(state).headingsOnly) return true;
  const bold = state.schema.marks.bold;
  if (selection.empty || !bold) return false;
  let hasHeading = false;
  let total = 0;
  let marked = 0;
  let excluded = 0;
  const runs: Array<{ from: number; to: number; isBold: boolean }> = [];
  for (const { $from, $to } of selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name === "heading") {
        hasHeading = true;
        return false;
      }
      if (node.inlineContent && !node.type.allowsMarkType(bold)) return false;
      if (!node.isInline || (!node.isText && !node.marks.length)) return true;
      const from = Math.max(pos, $from.pos);
      const to = Math.min(pos + node.nodeSize, $to.pos);
      if (from >= to) return true;
      const length = to - from;
      const isBold = node.marks.some((mark) => mark.type === bold);
      total += length;
      if (isBold) marked += length;
      for (const mark of node.marks) if (mark.type !== bold && mark.type.excludes(bold)) excluded += length;
      runs.push({ from, to, isBold });
      return true;
    });
  }
  if (!hasHeading) return false;
  if (!total) return true;
  const remove = marked > 0 && marked + excluded >= total;
  const transaction = closeHistory(state.tr);
  for (const run of runs) {
    if (remove && run.isBold) transaction.removeMark(run.from, run.to, bold);
    else if (!remove && !run.isBold) transaction.addMark(run.from, run.to, bold.create());
  }
  if (remove) transaction.removeStoredMark(bold);
  if (transaction.docChanged || transaction.storedMarksSet) dispatchFormattingWithHistory(editor, transaction);
  return true;
}
