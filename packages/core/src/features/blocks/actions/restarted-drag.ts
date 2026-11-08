import { type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection, type EditorState, type Transaction } from "@tiptap/pm/state";

import {
  numberingSequenceInput,
  sequenceMemberAttribute,
  sequenceRegistryAttribute,
} from "../../list/numbering-sequence-document";
import { markSequenceOperation, sequenceLeaf } from "../../list/numbering-sequence-transactions";
import { reorderNumberingSequenceItems } from "../../list/numbering-sequences";
import { linkedSequenceDrag } from "./linked-sequence-drag";

/** 结构守卫与纯重排分开；只开放同一物理列表、同父同层的叶项。 */
export function restartedDrag(
  state: EditorState,
  sourcePos: number,
  targetPos: number,
  before: boolean,
): Transaction | null {
  const source = state.doc.resolve(sourcePos),
    target = state.doc.resolve(targetPos);
  if (source.depth === 1 && target.depth === 1 && source.before(1) !== target.before(1))
    return linkedSequenceDrag(state, sourcePos, targetPos, before);
  const list = source.parent;
  if (
    source.depth !== 1 ||
    target.depth !== source.depth ||
    target.parent !== list ||
    source.before(source.depth) !== target.before(target.depth) ||
    list.type.name !== "orderedList" ||
    list.attrs.semloEditorListFirstContinue === true ||
    list.attrs.semloEditorListQuoteChain != null ||
    list.attrs.semloEditorListTaskChain != null ||
    list.attrs.semloEditorOrderedAncestorPath != null ||
    Number(source.nodeAfter?.attrs.semloEditorListIndent ?? 0) === 0
  )
    return null;
  const from = source.index(),
    over = target.index();
  const levelAt = (index: number) => Number(list.child(index).attrs.semloEditorListIndent ?? 0);
  const parentAt = (index: number) => {
    for (let previous = index - 1; previous >= 0; previous--) if (levelAt(previous) < levelAt(index)) return previous;
    return -1;
  };
  // 几何锚点和最终数组位置不同，不能拿最终序号代替真实目标的结构资格。
  if (
    levelAt(from) !== levelAt(over) ||
    parentAt(from) !== parentAt(over) ||
    !sequenceLeaf(list, from) ||
    !sequenceLeaf(list, over)
  )
    return null;
  const destination = over + (before ? 0 : 1) - (from < over + (before ? 0 : 1) ? 1 : 0);
  const plan = reorderNumberingSequenceItems(numberingSequenceInput(list), from, destination);
  if (!plan.ok) return null;
  const children: ProseMirrorNode[] = plan.value.order.map((index, position) => {
    const item = list.child(index);
    return item.type.create(
      { ...item.attrs, [sequenceMemberAttribute]: plan.value.sequenceIds[position] },
      item.content,
      item.marks,
    );
  });
  const moved = list.type.create(
    { ...list.attrs, [sequenceRegistryAttribute]: plan.value.registry },
    children,
    list.marks,
  );
  const listPos = source.before(source.depth);
  const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, moved);
  const itemPos = listPos + 1 + children.slice(0, destination).reduce((sum, item) => sum + item.nodeSize, 0);
  return markSequenceOperation(tr.setSelection(Selection.near(tr.doc.resolve(itemPos + 2))).scrollIntoView());
}
