import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection, type EditorState, type Transaction } from "@tiptap/pm/state";

import { planSequenceContinuation } from "../../list/numbering-sequence-continuation";
import {
  assertNumberingSequenceDocument,
  parseSequenceLink,
  resolveListNumbering,
  sequenceLeaf,
  sequenceLinkAttribute,
  sequenceMemberAttribute,
  sequenceRegistryAttribute,
} from "../../list/numbering-sequence-document";
import { markSequenceOperation } from "../../list/numbering-sequence-transactions";

/** 只处理实测的两段续接：后段首个子项移到前段子项前，并提升为根项。 */
export function linkedSequenceDrag(
  state: EditorState,
  sourcePos: number,
  targetPos: number,
  before: boolean,
): Transaction | null {
  try {
    const source = state.doc.resolve(sourcePos),
      target = state.doc.resolve(targetPos);
    if (!before || source.depth !== 1 || target.depth !== 1) return null;
    const tail = source.parent,
      head = target.parent,
      tailPos = source.before(1),
      headPos = target.before(1);
    if (
      tailPos <= headPos ||
      tail.type.name !== "orderedList" ||
      tail.type !== head.type ||
      head.childCount < 2 ||
      tail.childCount < 2 ||
      source.index() !== 0 ||
      target.index() !== 1
    )
      return null;
    const headIndex = state.doc.resolve(headPos).index(),
      tailIndex = state.doc.resolve(tailPos).index();
    if (tailIndex <= headIndex + 1) return null;
    for (let index = headIndex + 1; index < tailIndex; index++)
      if (state.doc.child(index).type.name !== "paragraph") return null;
    const leftLink = parseSequenceLink(head.attrs[sequenceLinkAttribute]),
      rightLink = parseSequenceLink(tail.attrs[sequenceLinkAttribute]);
    if (!leftLink?.next || leftLink.previous || rightLink?.previous !== leftLink.next || rightLink.next) return null;
    const attrs = (node: ProseMirrorNode) => {
      const { [sequenceRegistryAttribute]: _registry, [sequenceLinkAttribute]: _link, ...rest } = node.attrs;
      return rest;
    };
    if (JSON.stringify(attrs(head)) !== JSON.stringify(attrs(tail))) return null;
    const left = resolveListNumbering(head),
      right = resolveListNumbering(tail);
    if (!left.ok || left.value.kind !== "v1" || !right.ok || right.value.kind !== "v1") return null;
    const [rootId, childId] = left.value.sequenceIds;
    const definitions = left.value.registry.sequences;
    const tailDefinitions = right.value.registry.sequences;
    if (
      rootId === childId ||
      definitions.length !== 2 ||
      definitions.some((entry) => entry.origin !== "initial" || entry.start !== 1) ||
      tailDefinitions.length !== 2 ||
      tailDefinitions.some(
        (entry) =>
          entry.origin !== "initial" ||
          (entry.id === rootId ? entry.start !== 1 : entry.id !== childId || entry.start !== head.childCount),
      ) ||
      left.value.values[0] !== 1 ||
      left.value.sequenceIds.slice(1).some((id) => id !== childId) ||
      left.value.values.slice(1).some((value, index) => value !== index + 1) ||
      right.value.sequenceIds.some((id) => id !== childId) ||
      right.value.values.some((value, index) => value !== head.childCount + index) ||
      Number(head.child(0).attrs.semloEditorListIndent ?? 0) !== 0 ||
      head.child(0).attrs.semloEditorListRestart === true
    )
      return null;
    for (let index = 1; index < head.childCount; index++)
      if (
        Number(head.child(index).attrs.semloEditorListIndent ?? 0) !== 1 ||
        head.child(index).attrs.semloEditorListRestart === true ||
        !sequenceLeaf(head, index)
      )
        return null;
    for (let index = 0; index < tail.childCount; index++)
      if (
        Number(tail.child(index).attrs.semloEditorListIndent ?? 0) !== 1 ||
        tail.child(index).attrs.semloEditorListRestart === true ||
        !sequenceLeaf(tail, index)
      )
        return null;
    const item = tail.child(0);
    const moved = item.type.create(
      { ...item.attrs, semloEditorListIndent: 0, semloEditorListRestart: false, [sequenceMemberAttribute]: rootId },
      item.content,
      item.marks,
    );
    const remainingHead: ProseMirrorNode[] = [],
      remainingTail: ProseMirrorNode[] = [];
    head.forEach((node, _offset, index) => {
      if (index > 0) remainingHead.push(node);
    });
    tail.forEach((node, _offset, index) => {
      if (index > 0) remainingTail.push(node);
    });
    const newHead = head.copy(Fragment.fromArray([head.child(0), moved, ...remainingHead]));
    const newTail = tail.copy(Fragment.fromArray(remainingTail));
    const tr = state.tr.replaceWith(tailPos, tailPos + tail.nodeSize, newTail);
    tr.replaceWith(headPos, headPos + head.nodeSize, newHead);
    const updates = planSequenceContinuation(tr.doc, state.doc);
    if (!updates) return null;
    for (const update of updates) tr.setNodeMarkup(update.pos, undefined, update.node.attrs, update.node.marks);
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
    return markSequenceOperation(
      tr.setSelection(Selection.near(tr.doc.resolve(headPos + 1 + head.child(0).nodeSize + 2))).scrollIntoView(),
    );
  } catch {
    return null;
  }
}
