import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

import { connectedSequenceLists, planSequenceContinuation } from "./numbering-sequence-continuation";
import {
  assertNumberingSequenceDocument,
  hasNumberingSequences,
  numberingSequenceInput,
  resolveListNumbering,
  sequenceLinkAttribute,
  sequenceMemberAttribute,
  sequenceRegistryAttribute,
} from "./numbering-sequence-document";
import { markSequenceOperation } from "./numbering-sequence-transactions";
import { indentNumberingSequenceItems } from "./numbering-sequences";

/** 单个根级列表的层级及编号在同一事务内调整。 */
export function indentNumberedList(
  editor: Editor,
  targets: readonly { node: ProseMirrorNode; pos: number }[],
  direction: -1 | 1,
): boolean {
  const state = editor.state;
  if (!(state.selection instanceof TextSelection) || !targets.length) return false;
  let listPos = -1;
  let list: ProseMirrorNode | undefined;
  const indices: number[] = [];
  for (const target of targets) {
    const position = state.doc.resolve(target.pos);
    if (position.depth !== 1 || target.node.type.name !== "listItem") return false;
    const parent = position.parent;
    const currentPos = position.before(1);
    if (
      parent.type.name !== "orderedList" ||
      !hasNumberingSequences(parent) ||
      (listPos !== -1 && currentPos !== listPos)
    )
      return false;
    list = parent;
    listPos = currentPos;
    indices.push(position.index());
  }
  if (!list || state.selection.from < listPos + 1 || state.selection.to > listPos + list.nodeSize - 1) return false;
  const linked = list.attrs[sequenceLinkAttribute] != null;
  const chain = linked ? connectedSequenceLists(state.doc, listPos) : null;
  if (linked && !chain) return false;
  const reservedIds = new Set<string>();
  const externalMembers = new Set<string>();
  for (const segment of chain ?? []) {
    if (segment.pos === listPos) continue;
    const numbering = resolveListNumbering(segment.node);
    if (!numbering.ok || numbering.value.kind !== "v1") return false;
    numbering.value.registry.sequences.forEach((entry) => reservedIds.add(entry.id));
    numbering.value.sequenceIds.forEach((id) => externalMembers.add(id));
  }
  const numbering = resolveListNumbering(list);
  if (!numbering.ok || numbering.value.kind !== "v1") return false;
  const plan = indentNumberingSequenceItems(numberingSequenceInput(list), indices, direction, reservedIds);
  if (!plan.ok) return false;
  if (linked) {
    const selected = new Set(indices);
    const originalIds = numbering.value.sequenceIds;
    const retained = new Set(
      originalIds.filter((id, index) => !selected.has(index) || plan.value.sequenceIds[index] === id),
    );
    if (
      indices.some(
        (index) =>
          plan.value.sequenceIds[index] !== originalIds[index] &&
          externalMembers.has(originalIds[index]) &&
          !retained.has(originalIds[index]),
      )
    )
      return false;
  }
  const tr = closeHistory(state.tr).setNodeMarkup(listPos, undefined, {
    ...list.attrs,
    [sequenceRegistryAttribute]: plan.value.registry,
  });
  const selected = new Set(indices);
  try {
    list.forEach((item, offset, index) => {
      const levelChanged =
        selected.has(index) && Number(item.attrs.semloEditorListIndent ?? 0) !== plan.value.levels[index];
      if (levelChanged || item.attrs[sequenceMemberAttribute] !== plan.value.sequenceIds[index])
        tr.setNodeMarkup(listPos + 1 + offset, undefined, {
          ...item.attrs,
          ...(levelChanged ? { semloEditorListIndent: plan.value.levels[index] } : {}),
          [sequenceMemberAttribute]: plan.value.sequenceIds[index],
        });
    });
    if (chain) {
      const updates = planSequenceContinuation(tr.doc, state.doc);
      if (!updates) return false;
      const original = new Map(chain.map((segment) => [segment.pos, segment.node]));
      for (const { pos, node } of updates) {
        const previous = original.get(pos);
        if (!previous || previous.attrs[sequenceLinkAttribute] !== node.attrs[sequenceLinkAttribute]) return false;
        tr.setNodeMarkup(pos, undefined, node.attrs, node.marks);
      }
    }
    assertNumberingSequenceDocument(tr.doc);
  } catch {
    return false;
  }
  markSequenceOperation(tr);
  editor.view.dispatch(tr);
  if (!editor.isDestroyed && editor.state.doc.eq(tr.doc))
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  return true;
}
