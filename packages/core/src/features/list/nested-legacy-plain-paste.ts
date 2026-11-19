import type { Slice } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { projectLegacyNumberingSelection } from "./legacy-numbering-selection";
import { planNumberingSequencePlainPaste } from "./numbering-sequence-paste";

/** 多行纯文本跨同父直接子项时，拆分与旧结构转换进入同一次历史。 */
export function planNestedLegacyPlainPaste(state: EditorState, slice: Slice): Transaction | null {
  if (state.selection.empty || state.selection.$from.sameParent(state.selection.$to)) return null;
  const projection = projectLegacyNumberingSelection(state);
  if (!projection) return null;
  const { $from, $to } = projection.state.selection;
  const list = $from.node(1);
  for (let index = $from.index(1); index <= $to.index(1); index++)
    if (list.child(index).attrs.semloEditorListIndent !== 1) return null;
  const plan = planNumberingSequencePlainPaste(projection.state, slice);
  return plan.kind === "apply" ? projection.apply(plan.transaction) : null;
}
