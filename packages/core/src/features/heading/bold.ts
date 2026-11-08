import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { MarkType } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

import { dispatchFormattingWithHistory } from "../../runtime/format-history";
import { getHeadingSelection } from "./selection";

type BoldRun = { from: number; to: number; isBold: boolean };
type MixedBoldSelection = { bold: MarkType; runs: BoldRun[]; active: boolean };

/** 混合选区的状态与命令都只计算允许加粗的非标题内容。 */
export function getMixedHeadingBold(state: EditorState): MixedBoldSelection | null {
  const { selection } = state;
  const bold = state.schema.marks.bold;
  if (selection.empty || !bold) return null;
  let hasHeading = false;
  let total = 0;
  let marked = 0;
  let excluded = 0;
  const runs: BoldRun[] = [];
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
  return hasHeading ? { bold, runs, active: marked > 0 && marked + excluded >= total } : null;
}

/** 混合选区只切换非标题内容；返回 false 时交给普通加粗命令。 */
export function toggleBoldOutsideHeadings(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const { state } = editor;
  if (getHeadingSelection(state).headingsOnly) return true;
  const mixed = getMixedHeadingBold(state);
  if (!mixed) return false;
  const { bold, runs, active: remove } = mixed;
  const transaction = closeHistory(state.tr);
  for (const run of runs) {
    if (remove && run.isBold) transaction.removeMark(run.from, run.to, bold);
    else if (!remove && !run.isBold) transaction.addMark(run.from, run.to, bold.create());
  }
  if (remove) transaction.removeStoredMark(bold);
  if (transaction.docChanged || transaction.storedMarksSet) dispatchFormattingWithHistory(editor, transaction);
  return true;
}
