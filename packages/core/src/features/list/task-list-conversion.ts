import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import { convertMixedSequenceList } from "./mixed-sequence-conversion";
import { rejoinSequenceBridge, rejoinSequenceParagraphs, rejoinSequenceTail } from "./numbering-sequence-bridge";
import {
  bridgeRemovedSequenceSegment,
  canConvertSequenceChain,
  newSequenceLinkId,
  upgradeSequenceChain,
} from "./numbering-sequence-continuation";
import { formatSequenceConversionHint, sequenceConversionHintAttribute } from "./numbering-sequence-conversion-hint";
import {
  assertNumberingSequenceDocument,
  formatSequenceLink,
  hasNumberingSequences,
  parseSequenceLink,
  resolveListNumbering,
  selectionHasNumberingSequences,
  sequenceConvertible,
  sequenceLinkAttribute,
  sequenceMemberAttribute,
} from "./numbering-sequence-document";
import { markSequenceOperation } from "./numbering-sequence-transactions";
import { orderedListSuffixAttrs } from "./ordered-fragment";
import { preferredOrderedStyle } from "./ordered-preference";

/** Convert selected flat list items without changing their unselected neighbours. */
export function convertOneTask(
  editor: Editor,
  listType: "bulletList" | "orderedList" | "taskList" | "paragraph",
  listAttrs: Record<string, unknown> | null = null,
  range?: { from: number; to: number },
): boolean | null {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const current = editor.state;
  const state = range
    ? EditorState.create({ doc: current.doc, selection: TextSelection.create(current.doc, range.from, range.to) })
    : current;
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.$from.depth !== 3 || selection.$to.depth !== 3) return null;
  const position = selection.$from;
  const list = position.node(1);
  const item = position.node(2);
  const sourceIsTask = listType !== "taskList" && list.type.name === "taskList" && item.type.name === "taskItem";
  const sourceIsBullet =
    listType !== "bulletList" &&
    listType !== "paragraph" &&
    list.type.name === "bulletList" &&
    item.type.name === "listItem";
  const sourceIsOrdered =
    listType !== "orderedList" &&
    listType !== "paragraph" &&
    list.type.name === "orderedList" &&
    item.type.name === "listItem";
  if ((!sourceIsTask && !sourceIsBullet && !sourceIsOrdered) || item.firstChild !== position.parent) return null;
  if (selection.$to.node(1) !== list || selection.$to.node(2).type !== item.type) return null;
  if (listType === "orderedList" && (sourceIsTask || sourceIsBullet)) {
    const rejoin =
      rejoinSequenceBridge(state, listAttrs, Boolean(range)) ?? rejoinSequenceTail(state, listAttrs, Boolean(range));
    if (rejoin === false) return false;
    if (rejoin) {
      editor.view.dispatch(rejoin);
      if (!editor.isDestroyed) {
        editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
        editor.view.focus();
      }
      return true;
    }
    for (let index = position.index(1); index <= selection.$to.index(1); index++) {
      // 不将无法确认续接位置的转换项当成新的普通编号项。
      if (list.child(index).attrs[sequenceConversionHintAttribute] != null) return false;
    }
  }
  const targetList = listType === "paragraph" ? null : state.schema.nodes[listType];
  const targetItem = state.schema.nodes[listType === "taskList" ? "taskItem" : "listItem"];
  if ((!targetList && listType !== "paragraph") || !targetItem) return null;
  const first = position.index(1);
  const last = selection.$to.index(1);
  const sequence = hasNumberingSequences(list);
  if (
    sequence &&
    (!sourceIsOrdered ||
      !sequenceConvertible(list, first, last) ||
      !canConvertSequenceChain(state.doc, position.before(1)) ||
      (listType !== "bulletList" && listType !== "taskList"))
  )
    return false;
  if (sequence) {
    for (let index = first; index <= last; index++) {
      const selectedItem = list.child(index);
      for (const [name, value] of Object.entries(selectedItem.attrs)) {
        if (name === sequenceMemberAttribute || name === "semloEditorListRestart") continue;
        if (Object.hasOwn(targetItem.spec.attrs ?? {}, name)) continue;
        const original = selectedItem.type.spec.attrs?.[name];
        if (!original || !Object.is(value, original.default)) return false;
      }
    }
  }
  const children: ProseMirrorNode[] = [];
  list.forEach((child) => children.push(child));
  if (sourceIsOrdered && list.attrs.semloEditorListFirstContinue === true) {
    const observedFlat =
      (list.attrs.semloEditorOrderedStyle == null || list.attrs.semloEditorOrderedStyle === "mixed") &&
      Number(list.attrs.start ?? 1) === 1 &&
      children.every((child) => Number(child.attrs.semloEditorListIndent ?? 0) === 0);
    const firstToList = first === 0 && last === 0 && (listType === "bulletList" || listType === "taskList");
    const lastToList =
      first === last && first === children.length - 1 && (listType === "bulletList" || listType === "taskList");
    const middleToList =
      first > 0 &&
      first === last &&
      last < children.length - 1 &&
      (listType === "bulletList" || listType === "taskList");
    // Other fragments' continuation modes have not yet been observed.
    if (!observedFlat || (!firstToList && !middleToList && !lastToList)) return null;
  }
  // The remaining numbered siblings are renumbered after conversion. Mixed
  // levels are supported for the observed default style, without saved seeds.
  const originalStart = Number(list.attrs.start ?? 1);
  const observedRestartToTask =
    sourceIsOrdered &&
    !sequence &&
    listType === "taskList" &&
    list.attrs.semloEditorOrderedStyle === "decimal" &&
    list.attrs.semloEditorListTaskChain == null &&
    list.attrs.semloEditorListQuoteChain == null &&
    originalStart === 1 &&
    first === last &&
    (last === children.length - 1 || last === children.length - 2) &&
    last >= 2 &&
    children.every(
      (child, index) =>
        Number(child.attrs.semloEditorListIndent ?? 0) === (index === 0 ? 0 : 1) &&
        (child.attrs.semloEditorListRestart === true) === (index === last),
    );
  if (
    sourceIsOrdered &&
    !sequence &&
    (!Number.isSafeInteger(originalStart) ||
      originalStart < -2147483648 ||
      originalStart > 2147483647 ||
      list.attrs.semloEditorListLevelStarts != null ||
      list.attrs.semloEditorOrderedAncestorPath != null ||
      (children.some((child) => child.attrs.semloEditorListRestart === true) && !observedRestartToTask) ||
      children.some((child) => child.childCount !== 1 || !child.firstChild?.isTextblock) ||
      (children.some((child) => Number(child.attrs.semloEditorListIndent ?? 0) !== 0) &&
        list.attrs.semloEditorOrderedStyle === "chinese"))
  )
    return null;
  const selected = children.slice(first, last + 1);
  if (
    selected.some((child) => {
      const onItem = child.attrs[sequenceConversionHintAttribute];
      const onParagraph = child.firstChild?.attrs[sequenceConversionHintAttribute];
      return onItem != null && onParagraph != null && onItem !== onParagraph;
    })
  )
    return false;
  const numbered = sequence ? resolveListNumbering(list) : null;
  if (numbered && (!numbered.ok || numbered.value.kind !== "v1")) return false;
  const sequenceEdge = sequence && first > 0 && last + 1 < children.length ? newSequenceLinkId(state.doc) : null;
  const ids = numbered?.ok && numbered.value.kind === "v1" ? numbered.value.sequenceIds : [];
  const needsIdentity = Boolean(sequenceEdge && ids.some((id) => id !== ids[first]));
  if (needsIdentity && !Object.hasOwn(targetItem.spec.attrs ?? {}, sequenceConversionHintAttribute)) return false;
  // Nested structures and multi-paragraph items have not been observed here.
  if (
    selected.some(
      (child) => child.childCount !== 1 || !child.firstChild?.isTextblock || !targetItem.validContent(child.content),
    )
  )
    return null;
  if (
    listType === "paragraph" &&
    selected.some((child) => {
      const values = [
        Number(child.attrs.semloEditorListIndent ?? 0),
        Number(child.firstChild?.attrs.semloEditorIndent ?? 0),
      ];
      return values.some((value) => !Number.isInteger(value) || value < 0 || value > 8);
    })
  )
    return null;
  const converted = selected.map((child, offset) => {
    if (listType === "paragraph") {
      const paragraph = child.firstChild!;
      const conversion =
        child.attrs[sequenceConversionHintAttribute] ?? paragraph.attrs[sequenceConversionHintAttribute];
      const paragraphIndent = Number(paragraph.attrs.semloEditorIndent ?? 0);
      const itemIndent = Number(child.attrs.semloEditorListIndent ?? 0);
      return paragraph.type.create(
        {
          ...paragraph.attrs,
          semloEditorIndent: Math.min(8, paragraphIndent + itemIndent),
          [sequenceConversionHintAttribute]: conversion ?? null,
        },
        paragraph.content,
        paragraph.marks,
      );
    }
    return targetItem.create(
      {
        ...child.attrs,
        ...(sequence ? { [sequenceMemberAttribute]: null, semloEditorListRestart: false } : {}),
        ...(needsIdentity
          ? { [sequenceConversionHintAttribute]: formatSequenceConversionHint(sequenceEdge!, ids[first + offset]) }
          : {}),
        ...(listType === "taskList" ? { checked: false } : {}),
      },
      child.content,
      child.marks,
    );
  });
  if (targetList && !targetList.validContent(Fragment.fromArray(converted))) return null;
  const before = children.slice(0, first);
  const after = children.slice(last + 1);
  if (observedRestartToTask && after.length === 1) {
    const successor = after[0];
    after[0] = successor.type.create(
      { ...successor.attrs, semloEditorListRestart: true },
      successor.content,
      successor.marks,
    );
  }
  const retained = [...before, ...after];
  const retainedList = sourceIsOrdered && retained.length ? list.type.create(list.attrs, retained, list.marks) : null;
  const suffixAttrs =
    !sequence && retainedList && after.length
      ? orderedListSuffixAttrs(retainedList, retained, before.length)
      : list.attrs;
  let taskChain: string | null = null;
  if (observedRestartToTask && after.length === 1) {
    try {
      taskChain = globalThis.crypto?.randomUUID?.() ?? null;
    } catch {
      return null;
    }
    if (!taskChain) return null;
  }
  const existingSequenceLink = sequence ? parseSequenceLink(list.attrs[sequenceLinkAttribute]) : null;
  const sequenceLinkVersion = existingSequenceLink?.version === 3 ? 3 : 2;
  const upgraded = existingSequenceLink?.version === 1 ? upgradeSequenceChain(state.doc, position.before(1)) : [];
  if (!upgraded) return false;
  const bridged =
    existingSequenceLink && !before.length && !after.length
      ? bridgeRemovedSequenceSegment(state.doc, position.before(1), sequenceLinkVersion)
      : [];
  if (!bridged) return false;
  const upgradedAttrs =
    existingSequenceLink?.version === 1
      ? {
          ...list.attrs,
          [sequenceLinkAttribute]: formatSequenceLink(existingSequenceLink.previous, existingSequenceLink.next, 2),
        }
      : list.attrs;
  const prefixAttrs = sequenceEdge
    ? {
        ...upgradedAttrs,
        [sequenceLinkAttribute]: formatSequenceLink(
          existingSequenceLink?.previous ?? null,
          sequenceEdge,
          sequenceLinkVersion,
        ),
      }
    : taskChain
      ? { ...list.attrs, semloEditorListTaskChain: taskChain }
      : upgradedAttrs;
  const targetAttrs = taskChain ? { ...listAttrs, semloEditorListTaskChain: taskChain } : listAttrs;
  const linkedSuffixAttrs = sequenceEdge
    ? {
        ...suffixAttrs,
        [sequenceLinkAttribute]: formatSequenceLink(
          sequenceEdge,
          existingSequenceLink?.next ?? null,
          sequenceLinkVersion,
        ),
      }
    : taskChain
      ? { ...suffixAttrs, semloEditorListTaskChain: taskChain }
      : existingSequenceLink?.version === 1
        ? { ...suffixAttrs, [sequenceLinkAttribute]: upgradedAttrs[sequenceLinkAttribute] }
        : suffixAttrs;
  const nodes = [
    ...(before.length ? [list.type.create(prefixAttrs, before, list.marks)] : []),
    ...(targetList ? [targetList.create(targetAttrs, converted)] : converted),
    ...(after.length ? [list.type.create(linkedSuffixAttrs, after, list.marks)] : []),
  ];
  const replacement = Fragment.fromArray(nodes);
  const listPos = position.before(1);
  const listPosition = state.doc.resolve(listPos);
  if (!listPosition.parent.canReplace(listPosition.index(), listPosition.index() + 1, replacement)) return null;
  const beforeSize = before.length ? nodes[0].nodeSize : 0;
  const oldFirstItem = listPos + 1 + before.reduce((sum, child) => sum + child.nodeSize, 0);
  const newFirstItem = listPos + beforeSize + 1;
  const delta = newFirstItem - oldFirstItem;
  const tr = closeHistory(state.tr);
  const updates = new Map([...upgraded, ...bridged].map((entry) => [entry.pos, entry.node]));
  for (const [pos, node] of updates) if (pos !== listPos) tr.setNodeMarkup(pos, undefined, node.attrs);
  tr.replaceWith(listPos, listPos + list.nodeSize, replacement);
  const mapPosition = (anchor: boolean) => {
    if (targetList) return (anchor ? selection.anchor : selection.head) + delta;
    const resolved = anchor ? selection.$anchor : selection.$head;
    const index = resolved.index(1) - first;
    return (
      listPos +
      beforeSize +
      converted.slice(0, index).reduce((sum, node) => sum + node.nodeSize, 0) +
      1 +
      resolved.parentOffset
    );
  };
  tr.setSelection(
    TextSelection.create(tr.doc, mapPosition(true), range ? mapPosition(true) : mapPosition(false)),
  ).scrollIntoView();
  if (sequence) {
    try {
      assertNumberingSequenceDocument(tr.doc);
    } catch {
      return false;
    }
    markSequenceOperation(tr);
  }
  editor.view.dispatch(tr);
  if (!editor.isDestroyed) {
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    editor.view.focus();
  }
  return true;
}

/** Unsupported task selections must not fall back to whole-list conversion. */
export function hasTaskSelection(editor: Editor, includeBulletList = false, includeOrderedList = false): boolean {
  const { selection, doc } = editor.state;
  for (let depth = selection.$from.depth; depth > 0; depth--)
    if (
      selection.$from.node(depth).type.name === "taskItem" ||
      (includeBulletList && selection.$from.node(depth).type.name === "bulletList") ||
      (includeOrderedList && selection.$from.node(depth).type.name === "orderedList")
    )
      return true;
  if (selection.empty) return false;
  let found = false;
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (
      node.type.name === "taskItem" ||
      (includeBulletList && node.type.name === "bulletList") ||
      (includeOrderedList && node.type.name === "orderedList")
    )
      found = true;
    return !found;
  });
  return found;
}

/** Preserve task-item indentation when the toolbar changes a task list to bullets. */
export function toggleBulletListPreservingTaskIndent(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const single = convertOneTask(editor, "bulletList");
  if (single !== null) return single;
  if (selectionHasNumberingSequences(editor.state)) return convertMixedSequenceList(editor, "bulletList");
  if (hasTaskSelection(editor, false, true)) return false;
  return editor.chain().focus().toggleBulletList().run();
}

/** Match the same task-item boundary when the ordered-list button is used. */
export function toggleOrderedListPreservingTaskIndent(editor: Editor): boolean {
  if (selectionHasNumberingSequences(editor.state)) return false;
  if (editor.isDestroyed || !editor.isEditable) return false;
  const style = preferredOrderedStyle(editor);
  const rejoin = rejoinSequenceParagraphs(editor.state, style ? { semloEditorOrderedStyle: style } : null);
  if (rejoin === false) return false;
  if (rejoin) {
    const before = editor.state.doc;
    editor.view.dispatch(rejoin);
    if (editor.isDestroyed || editor.state.doc.eq(before)) return false;
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    editor.view.focus();
    return true;
  }
  const converted = convertOneTask(editor, "orderedList", style ? { semloEditorOrderedStyle: style } : null);
  if (converted !== null) return converted;
  if (hasTaskSelection(editor, true)) return false;
  if (style && !editor.isActive("orderedList")) {
    return editor
      .chain()
      .focus()
      .toggleOrderedList()
      .command(({ tr }) => {
        const { $from } = tr.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          const list = $from.node(depth);
          if (list.type.name !== "orderedList") continue;
          tr.setNodeMarkup($from.before(depth), undefined, { ...list.attrs, semloEditorOrderedStyle: style });
          return true;
        }
        return false;
      })
      .run();
  }
  return editor.chain().focus().toggleOrderedList().run();
}

/** Convert selected flat ordinary list items to tasks without changing siblings. */
export function toggleTaskListPreservingListItems(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  if (editor.isActive("taskList")) {
    const converted = convertOneTask(editor, "paragraph");
    if (converted !== null) return converted;
    return hasTaskSelection(editor, true, true) ? false : editor.chain().focus().toggleTaskList().run();
  }
  const converted = convertOneTask(editor, "taskList");
  if (converted !== null) return converted;
  if (selectionHasNumberingSequences(editor.state)) return convertMixedSequenceList(editor, "taskList");
  if (hasTaskSelection(editor, true, true)) return false;
  return editor.chain().focus().toggleTaskList().run();
}
