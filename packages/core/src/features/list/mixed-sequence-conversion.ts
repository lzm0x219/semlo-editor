import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

import {
  assertNumberingSequenceDocument,
  hasNumberingSequences,
  resolveListNumbering,
  sequenceLinkAttribute,
  sequenceMemberAttribute,
} from "./numbering-sequence-document";
import { markSequenceOperation } from "./numbering-sequence-transactions";

type MixedSelection = {
  selection: TextSelection;
  firstRoot: number;
  lastRoot: number;
  listIndex: number;
  list: ProseMirrorNode;
  firstItem: number;
  lastItem: number;
};

/** 编号列表与相邻根级正文可以共同转为另一种列表。 */
function mixedSelection(state: EditorState): MixedSelection | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const { $from, $to } = selection;
  if (
    $from.parent.type.name !== "paragraph" ||
    $to.parent.type.name !== "paragraph" ||
    ![1, 3].includes($from.depth) ||
    ![1, 3].includes($to.depth) ||
    $from.index(0) === $to.index(0) ||
    $to.parentOffset === 0
  )
    return null;
  const firstRoot = $from.index(0),
    lastRoot = $to.index(0);
  let listIndex = -1;
  let list: ProseMirrorNode | null = null;
  for (let index = firstRoot; index <= lastRoot; index++) {
    const node = state.doc.child(index);
    if (node.type.name === "paragraph") {
      if ((index === firstRoot && $from.depth !== 1) || (index === lastRoot && $to.depth !== 1)) return null;
      continue;
    }
    if (list || !hasNumberingSequences(node) || node.attrs[sequenceLinkAttribute] != null) return null;
    if (
      (index === firstRoot && ($from.depth !== 3 || $from.node(2).firstChild !== $from.parent)) ||
      (index === lastRoot && ($to.depth !== 3 || $to.node(2).firstChild !== $to.parent))
    )
      return null;
    let flat = true;
    node.forEach((item) => {
      if (
        item.type.name !== "listItem" ||
        Number(item.attrs.semloEditorListIndent ?? 0) !== 0 ||
        item.childCount !== 1 ||
        item.firstChild?.type.name !== "paragraph"
      )
        flat = false;
    });
    const resolved = resolveListNumbering(node);
    if (!flat || !resolved.ok || resolved.value.kind !== "v1") return null;
    listIndex = index;
    list = node;
  }
  if (!list) return null;
  const firstItem = listIndex === firstRoot ? $from.index(1) : 0;
  const lastItem = listIndex === lastRoot ? $to.index(1) : list.childCount - 1;
  if (firstItem < 0 || lastItem < firstItem || lastItem >= list.childCount) return null;
  return { selection, firstRoot, lastRoot, listIndex, list, firstItem, lastItem };
}

export function canConvertMixedSequenceSelection(state: EditorState): boolean {
  return mixedSelection(state) !== null;
}

/** 不丢弃宿主属性；无法确定转换语义的内容保持原样。 */
function planMixedSequenceConversion(state: EditorState, kind: "bulletList" | "taskList"): Transaction | null {
  const candidate = mixedSelection(state);
  const targetList = state.schema.nodes[kind];
  const targetItem = state.schema.nodes[kind === "taskList" ? "taskItem" : "listItem"];
  if (!candidate || !targetList || !targetItem) return null;
  const { selection, firstRoot, lastRoot, listIndex, list, firstItem, lastItem } = candidate;
  const allowedListAttrs = new Set(["start", "type", "semloEditorOrderedStyle", "semloEditorListSequences"]);
  try {
    if (list.marks.length || Object.getOwnPropertySymbols(list.attrs).length) return null;
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(list.attrs))) {
      if (!("value" in descriptor)) return null;
      if (!allowedListAttrs.has(name) && !Object.is(descriptor.value, list.type.spec.attrs?.[name]?.default))
        return null;
    }
    const before: ProseMirrorNode[] = [],
      after: ProseMirrorNode[] = [];
    list.forEach((item, _offset, index) => {
      if (index < firstItem) before.push(item);
      else if (index > lastItem) after.push(item);
    });
    if (before.length && after.length) return null;
    const prefix = before.length ? list.type.createChecked(list.attrs, Fragment.fromArray(before), list.marks) : null;
    const suffix = after.length ? list.type.createChecked(list.attrs, Fragment.fromArray(after), list.marks) : null;
    const selected: Array<{ node: ProseMirrorNode; source: number }> = [];
    let rootPos = selection.$from.before(1);
    for (let index = firstRoot; index <= lastRoot; index++) {
      const root = state.doc.child(index);
      if (index !== listIndex) selected.push({ node: targetItem.createChecked(null, root), source: rootPos });
      else {
        let itemPos = rootPos + 1;
        list.forEach((item, _offset, itemIndex) => {
          if (itemIndex >= firstItem && itemIndex <= lastItem) {
            if (Object.getOwnPropertySymbols(item.attrs).length) throw new Error("列表项属性无法转换");
            const attrs: Record<string, unknown> = {};
            for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item.attrs))) {
              if (!("value" in descriptor)) throw new Error("列表项属性无法转换");
              if (name === sequenceMemberAttribute || name === "semloEditorListRestart") continue;
              const original = item.type.spec.attrs?.[name];
              if (kind === "taskList" && name === "checked") {
                if (!original || !Object.is(descriptor.value, original.default)) throw new Error("列表项属性无法转换");
              } else if (Object.hasOwn(targetItem.spec.attrs ?? {}, name)) attrs[name] = descriptor.value;
              else if (!original || !Object.is(descriptor.value, original.default))
                throw new Error("列表项属性无法转换");
            }
            selected.push({ node: targetItem.createChecked(attrs, item.content, item.marks), source: itemPos + 1 });
          }
          itemPos += item.nodeSize;
        });
      }
      rootPos += root.nodeSize;
    }
    const target = targetList.createChecked(null, Fragment.fromArray(selected.map(({ node }) => node)));
    const replacement = Fragment.fromArray([...(prefix ? [prefix] : []), target, ...(suffix ? [suffix] : [])]);
    if (!state.doc.canReplace(firstRoot, lastRoot + 1, replacement)) return null;
    const start = selection.$from.before(1),
      end = selection.$to.after(1);
    const tr = closeHistory(state.tr).replaceWith(start, end, replacement);
    const mapped = new Map<number, number>();
    let position = start + (prefix?.nodeSize ?? 0) + 2;
    for (const item of selected) {
      mapped.set(item.source, position);
      position += item.node.nodeSize;
    }
    const endpoint = (point: typeof selection.$from) => {
      const newPosition = mapped.get(point.before(point.depth));
      if (newPosition === undefined) throw new Error("列表选区无法映射");
      return newPosition + 1 + point.parentOffset;
    };
    tr.setSelection(TextSelection.create(tr.doc, endpoint(selection.$anchor), endpoint(selection.$head)));
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
    return markSequenceOperation(tr.scrollIntoView());
  } catch {
    return null;
  }
}

export function convertMixedSequenceList(editor: Editor, kind: "bulletList" | "taskList"): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const transaction = planMixedSequenceConversion(editor.state, kind);
  if (!transaction) return false;
  const intended = transaction.doc;
  editor.view.dispatch(transaction);
  if (editor.isDestroyed || !editor.state.doc.eq(intended)) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  editor.view.focus();
  return true;
}
