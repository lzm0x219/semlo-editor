import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";

import { MAX_INDENT } from "../../shared/indent";
import {
  assertNumberingSequenceDocument,
  numberingSequenceInput,
  sequenceMemberAttribute,
  sequenceRegistryAttribute,
} from "./numbering-sequence-document";
import { materializeNumberingSequences } from "./numbering-sequences";

export function legacyCrossParentSelectionTouchesCustomStart(state: EditorState): boolean {
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return false;
  const { $from, $to } = selection;
  if (
    $from.depth < 5 ||
    $to.depth < 5 ||
    $from.before(1) !== $to.before(1) ||
    $from.node(1).type.name !== "orderedList" ||
    $from.index(1) === $to.index(1) ||
    $from.node(-2).type.name !== "orderedList" ||
    $to.node(-2).type.name !== "orderedList"
  )
    return false;

  let customStart = false;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.type.name === "orderedList" && node.attrs.start !== 1) customStart = true;
    return !customStart;
  });
  return customStart;
}

/** 为受支持的操作准备编号视图；读取或复制旧列表时不写入原文。 */
export function projectLegacyNumberingSelection(state: EditorState) {
  try {
    return projectLegacySelection(state);
  } catch {
    return null;
  }
}

function projectLegacySelection(state: EditorState) {
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return null;
  const { $from, $to } = selection;
  if ($from.depth < 3 || $to.depth < 3 || $from.before(1) !== $to.before(1)) return null;
  const root = $from.node(1);
  const rootPos = $from.before(1);
  const style = root.attrs.semloEditorOrderedStyle;
  if (
    root.type.name !== "orderedList" ||
    (style != null && style !== "mixed") ||
    !root.sameMarkup(root.type.create({ semloEditorOrderedStyle: style })) ||
    !Object.hasOwn(root.type.spec.attrs ?? {}, sequenceRegistryAttribute)
  )
    return null;

  const physicallyNested = root.content.content.some((item) => item.childCount > 1);
  if (!physicallyNested && !root.content.content.some((item) => item.attrs.semloEditorListIndent > 0)) return null;
  const entries: { item: ProseMirrorNode; paragraphPos: number }[] = [];
  let previousLevel = -1;
  const collect = (list: ProseMirrorNode, listPos: number, depth: number): boolean => {
    if (depth > MAX_INDENT || (depth && (list.type !== root.type || !list.sameMarkup(list.type.create()))))
      return false;
    let itemPos = listPos + 1;
    for (const item of list.content.content) {
      const paragraph = item.firstChild;
      const level = physicallyNested ? depth : item.attrs.semloEditorListIndent;
      if (
        item.type.name !== "listItem" ||
        !Object.hasOwn(item.type.spec.attrs ?? {}, sequenceMemberAttribute) ||
        !item.sameMarkup(item.type.create(physicallyNested ? null : { semloEditorListIndent: level })) ||
        !Number.isInteger(level) ||
        level < 0 ||
        level > MAX_INDENT ||
        level > previousLevel + 1 ||
        paragraph?.type.name !== "paragraph" ||
        item.childCount > 2
      )
        return false;
      const flattened = item.type.create({ ...item.attrs, semloEditorListIndent: level }, paragraph);
      entries.push({ item: flattened, paragraphPos: itemPos + 1 });
      previousLevel = level;
      if (
        item.childCount === 2 &&
        (!physicallyNested || !collect(item.lastChild!, itemPos + 1 + paragraph.nodeSize, depth + 1))
      )
        return false;
      itemPos += item.nodeSize;
    }
    return true;
  };
  if (!collect(root, rootPos, 0)) return null;
  const flat = root.copy(Fragment.fromArray(entries.map(({ item }) => item)));
  const plan = materializeNumberingSequences(numberingSequenceInput(flat));
  if (!plan.ok) return null;
  const items = entries.map(({ item }, index) =>
    item.type.create({ ...item.attrs, [sequenceMemberAttribute]: plan.value.sequenceIds[index] }, item.content),
  );
  const versioned = root.type.create({ ...root.attrs, [sequenceRegistryAttribute]: plan.value.registry }, items);
  const anchorParagraph = selection.$anchor.before(selection.$anchor.depth);
  const headParagraph = selection.$head.before(selection.$head.depth);
  let position = rootPos + 3;
  let anchor: number | undefined, head: number | undefined;
  for (const { item, paragraphPos } of entries) {
    if (paragraphPos === anchorParagraph) anchor = position + selection.$anchor.parentOffset;
    if (paragraphPos === headParagraph) head = position + selection.$head.parentOffset;
    position += item.nodeSize;
  }
  if (anchor === undefined || head === undefined) return null;
  const replaceRoot = () => state.tr.replaceWith(rootPos, rootPos + root.nodeSize, versioned);
  const doc = replaceRoot().doc;
  const projected = EditorState.create({ doc, selection: TextSelection.create(doc, anchor, head) });
  return {
    state: projected,
    apply(operation: Transaction): Transaction {
      const transaction = replaceRoot();
      for (const step of operation.steps) transaction.step(step);
      transaction.setSelection(Selection.fromJSON(transaction.doc, operation.selection.toJSON()));
      transaction.doc.check();
      assertNumberingSequenceDocument(transaction.doc);
      return transaction;
    },
  };
}
