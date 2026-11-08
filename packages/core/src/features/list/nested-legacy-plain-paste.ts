import { Fragment, type Node as ProseMirrorNode, type Slice } from "@tiptap/pm/model";
import { EditorState, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";

import {
  assertNumberingSequenceDocument,
  numberingSequenceInput,
  sequenceMemberAttribute,
  sequenceRegistryAttribute,
} from "./numbering-sequence-document";
import { planNumberingSequencePlainPaste } from "./numbering-sequence-paste";
import { materializeNumberingSequences } from "./numbering-sequences";

/** 将实测的旧嵌套列表连同粘贴一次转换；其他形态沿用原有处理。 */
export function planNestedLegacyPlainPaste(state: EditorState, slice: Slice): Transaction | null {
  try {
    const selection = state.selection;
    if (
      !(selection instanceof TextSelection) ||
      selection.$from.depth !== 5 ||
      selection.$to.depth !== 5 ||
      selection.$from.before(1) !== selection.$to.before(1) ||
      selection.$from.before(3) !== selection.$to.before(3) ||
      selection.$from.index(3) >= selection.$to.index(3)
    )
      return null;
    const { $from, $to } = selection;
    const outer = $from.node(1),
      parent = $from.node(2),
      inner = $from.node(3),
      outerPos = $from.before(1);
    const defaultAttrs = (node: ProseMirrorNode) =>
      JSON.stringify(node.attrs) === JSON.stringify(node.type.create().attrs);
    if (
      outer.type.name !== "orderedList" ||
      inner.type !== outer.type ||
      outer.childCount !== 1 ||
      outer.firstChild !== parent ||
      parent.type.name !== "listItem" ||
      parent.childCount !== 2 ||
      parent.firstChild?.type.name !== "paragraph" ||
      parent.lastChild !== inner ||
      inner.childCount < 2 ||
      !defaultAttrs(outer) ||
      !defaultAttrs(inner) ||
      !defaultAttrs(parent) ||
      outer.marks.length ||
      inner.marks.length ||
      parent.marks.length
    )
      return null;
    const children: ProseMirrorNode[] = [parent.type.create(parent.attrs, parent.firstChild, parent.marks)];
    inner.forEach((item) => {
      if (
        item.type !== parent.type ||
        item.childCount !== 1 ||
        item.firstChild?.type.name !== "paragraph" ||
        !defaultAttrs(item) ||
        item.marks.length
      )
        throw new Error("不支持的嵌套列表项");
      children.push(item.type.create({ ...item.attrs, semloEditorListIndent: 1 }, item.content, item.marks));
    });
    const flat = outer.copy(Fragment.fromArray(children));
    const materialized = materializeNumberingSequences(numberingSequenceInput(flat));
    if (!materialized.ok) return null;
    const items = children.map((item, index) =>
      item.type.create(
        { ...item.attrs, [sequenceMemberAttribute]: materialized.value.sequenceIds[index] },
        item.content,
        item.marks,
      ),
    );
    const versioned = outer.type.create(
      { ...outer.attrs, [sequenceRegistryAttribute]: materialized.value.registry },
      Fragment.fromArray(items),
      outer.marks,
    );
    const tr = state.tr.replaceWith(outerPos, outerPos + outer.nodeSize, versioned);
    const itemPosition = (index: number) =>
      outerPos + 1 + items.slice(0, index + 1).reduce((size, item) => size + item.nodeSize, 0);
    const first = itemPosition($from.index(3)) + 2 + $from.parentOffset;
    const last = itemPosition($to.index(3)) + 2 + $to.parentOffset;
    const provisional = EditorState.create({ doc: tr.doc, selection: TextSelection.create(tr.doc, first, last) });
    const plan = planNumberingSequencePlainPaste(provisional, slice);
    if (plan.kind !== "apply") return null;
    for (const step of plan.transaction.steps) tr.step(step);
    tr.setSelection(Selection.fromJSON(tr.doc, plan.transaction.selection.toJSON()));
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
    return tr;
  } catch {
    return null;
  }
}
