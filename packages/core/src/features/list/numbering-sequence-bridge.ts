import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode, type NodeType } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";

import { newSequenceLinkId } from "./numbering-sequence-continuation";
import { parseSequenceConversionHint, sequenceConversionHintAttribute } from "./numbering-sequence-conversion-hint";
import {
  assertNumberingSequenceDocument,
  formatSequenceLink,
  hasNumberingSequences,
  parseSequenceLink,
  resolveListNumbering,
  sequenceLinkAttribute,
  sequenceMemberAttribute,
  sequenceRegistryAttribute,
} from "./numbering-sequence-document";
import { markSequenceOperation } from "./numbering-sequence-transactions";

function discardedAttributes(node: ProseMirrorNode, target: NodeType, ignored: ReadonlySet<string>): boolean {
  return Object.entries(node.attrs).some(([name, value]) => {
    if (ignored.has(name) || Object.hasOwn(target.spec.attrs ?? {}, name)) return false;
    const original = node.type.spec.attrs?.[name];
    return !original || !Object.is(value, original.default);
  });
}

function listAttributesLost(source: ProseMirrorNode, retained: ProseMirrorNode): boolean {
  return Object.entries(source.attrs).some(([name, value]) => {
    if (Object.is(value, source.type.spec.attrs?.[name]?.default)) return false;
    return !Object.hasOwn(retained.attrs, name) || JSON.stringify(value) !== JSON.stringify(retained.attrs[name]);
  });
}

/** 将完整选中的根级正文间隔接回原编号序列。 */
export function rejoinSequenceParagraphs(
  state: EditorState,
  requestedAttrs: Record<string, unknown> | null,
): Transaction | false | null {
  const selection = state.selection;
  if (
    !(selection instanceof TextSelection) ||
    selection.$from.depth !== 1 ||
    selection.$to.depth !== 1 ||
    selection.$from.parent.type.name !== "paragraph" ||
    selection.$to.parent.type.name !== "paragraph"
  )
    return null;
  const doc = state.doc;
  const first = selection.$from.index(0),
    last = selection.$to.index(0);
  const selectedHint = parseSequenceConversionHint(doc.child(first).attrs[sequenceConversionHintAttribute]);
  let start = first,
    end = last;
  const belongsToGap = (node: ProseMirrorNode) =>
    node.type.name === "paragraph" &&
    (!selectedHint ||
      parseSequenceConversionHint(node.attrs[sequenceConversionHintAttribute])?.edge === selectedHint.edge);
  while (start > 0 && belongsToGap(doc.child(start - 1))) start--;
  while (end + 1 < doc.childCount && belongsToGap(doc.child(end + 1))) end++;
  let leftIndex = start - 1,
    rightIndex = end + 1;
  if (selectedHint) {
    while (leftIndex >= 0 && ["paragraph", "heading"].includes(doc.child(leftIndex).type.name)) {
      if (doc.child(leftIndex).attrs[sequenceConversionHintAttribute] != null) return false;
      leftIndex--;
    }
    while (rightIndex < doc.childCount && ["paragraph", "heading"].includes(doc.child(rightIndex).type.name)) {
      if (doc.child(rightIndex).attrs[sequenceConversionHintAttribute] != null) return false;
      rightIndex++;
    }
  }
  if (leftIndex < 0 || rightIndex >= doc.childCount) return null;
  const left = doc.child(leftIndex),
    right = doc.child(rightIndex);
  const leftLink = parseSequenceLink(left.attrs[sequenceLinkAttribute]),
    rightLink = parseSequenceLink(right.attrs[sequenceLinkAttribute]);
  if (!leftLink?.next && !rightLink?.previous) return null;
  if (
    first !== start ||
    last !== end ||
    !hasNumberingSequences(left) ||
    !hasNumberingSequences(right) ||
    !leftLink ||
    !rightLink ||
    leftLink.version !== rightLink.version ||
    !leftLink.next ||
    leftLink.next !== rightLink.previous ||
    left.marks.length ||
    right.marks.length
  )
    return false;
  const strip = (node: ProseMirrorNode) => {
    const { [sequenceLinkAttribute]: _link, [sequenceRegistryAttribute]: _registry, ...attrs } = node.attrs;
    return attrs;
  };
  if (JSON.stringify(strip(left)) !== JSON.stringify(strip(right))) return false;
  const style = requestedAttrs?.semloEditorOrderedStyle;
  if (style != null && style !== (left.attrs.semloEditorOrderedStyle ?? "mixed")) return false;
  const before = resolveListNumbering(left),
    after = resolveListNumbering(right);
  if (!before.ok || before.value.kind !== "v1" || !after.ok || after.value.kind !== "v1") return false;
  const flat = (list: ProseMirrorNode) => {
    let valid = true;
    list.forEach((item) => {
      if (
        item.type.name !== "listItem" ||
        item.childCount !== 1 ||
        item.firstChild?.type.name !== "paragraph" ||
        Number(item.attrs.semloEditorListIndent ?? 0) !== 0 ||
        item.attrs.semloEditorListRestart === true
      )
        valid = false;
    });
    return valid;
  };
  if (!flat(left) || !flat(right)) return false;
  const id = before.value.sequenceIds[0];
  const paragraphs = Array.from({ length: end - start + 1 }, (_, offset) => doc.child(start + offset));
  const hints = paragraphs.map((paragraph) =>
    parseSequenceConversionHint(paragraph.attrs[sequenceConversionHintAttribute]),
  );
  const hasHints = paragraphs.some((paragraph) => paragraph.attrs[sequenceConversionHintAttribute] != null);
  if (hasHints && hints.some((hint) => !hint || hint.edge !== leftLink.next)) return false;
  if (
    !hasHints &&
    (before.value.sequenceIds.some((value) => value !== id) || after.value.sequenceIds.some((value) => value !== id))
  )
    return false;
  const ids = hasHints ? hints.map((hint) => hint!.sequenceId) : paragraphs.map(() => id);
  const leftDefinitions = new Map(before.value.registry.sequences.map((entry) => [entry.id, entry]));
  const rightDefinitions = new Map(after.value.registry.sequences.map((entry) => [entry.id, entry]));
  if (
    leftDefinitions.size !== rightDefinitions.size ||
    [...leftDefinitions].some(([key, entry]) => rightDefinitions.get(key)?.origin !== entry.origin) ||
    ids.some((key) => !leftDefinitions.has(key))
  )
    return false;
  const counts = new Map<string, number>();
  for (const key of before.value.sequenceIds) counts.set(key, (counts.get(key) ?? 0) + 1);
  const rightUsed = new Set(after.value.sequenceIds);
  for (const [key, firstDefinition] of leftDefinitions) {
    const lastDefinition = rightDefinitions.get(key)!;
    const advanced = firstDefinition.start + (counts.get(key) ?? 0);
    if (
      rightUsed.has(key)
        ? lastDefinition.start !== advanced
        : lastDefinition.start !== firstDefinition.start && lastDefinition.start !== advanced
    )
      return false;
  }
  if (leftLink.version !== 3) {
    for (let index = leftIndex + 1; index < rightIndex; index++)
      if ((index < start || index > end) && doc.child(index).type.name !== "paragraph") return false;
  }
  const itemType = state.schema.nodes.listItem;
  if (!itemType) return false;
  const items: ProseMirrorNode[] = [];
  for (let index = start; index <= end; index++) {
    const original = doc.child(index);
    const paragraph =
      original.attrs[sequenceConversionHintAttribute] == null
        ? original
        : original.type.create(
            { ...original.attrs, [sequenceConversionHintAttribute]: null },
            original.content,
            original.marks,
          );
    if (paragraph.type.name !== "paragraph" || !itemType.validContent(Fragment.from(paragraph))) return false;
    try {
      const item = itemType.create({ [sequenceMemberAttribute]: ids[index - start] }, paragraph);
      if (Number(item.attrs.semloEditorListIndent ?? 0) !== 0 || item.attrs.semloEditorListRestart === true)
        return false;
      items.push(item);
    } catch {
      return false;
    }
  }
  if (leftIndex !== start - 1 || rightIndex !== end + 1) {
    const nextLink = newSequenceLinkId(doc);
    const needed = new Set([...ids, ...after.value.sequenceIds]);
    const registry = {
      version: 1,
      sequences: before.value.registry.sequences.map((entry) =>
        needed.has(entry.id) ? { ...entry, start: entry.start + (counts.get(entry.id) ?? 0) } : entry,
      ),
    };
    const middle = left.type.create(
      {
        ...left.attrs,
        [sequenceRegistryAttribute]: registry,
        [sequenceLinkAttribute]: formatSequenceLink(leftLink.next, nextLink, leftLink.version),
      },
      Fragment.fromArray(items),
      left.marks,
    );
    let rightPos = 0;
    for (let index = 0; index < rightIndex; index++) rightPos += doc.child(index).nodeSize;
    const startPos = selection.$from.before(1);
    const positions: number[] = [];
    let itemPos = startPos + 1;
    for (const item of items) {
      positions.push(itemPos + 1);
      itemPos += item.nodeSize;
    }
    const anchor = positions[selection.$anchor.index(0) - start] + selection.$anchor.parentOffset;
    const head = positions[selection.$head.index(0) - start] + selection.$head.parentOffset;
    const tr = closeHistory(state.tr);
    tr.setNodeMarkup(rightPos, undefined, {
      ...right.attrs,
      [sequenceLinkAttribute]: formatSequenceLink(nextLink, rightLink.next, rightLink.version),
    });
    tr.replaceWith(startPos, selection.$to.after(1), middle);
    try {
      tr.doc.check();
      assertNumberingSequenceDocument(tr.doc);
      tr.setSelection(TextSelection.create(tr.doc, anchor, head)).scrollIntoView();
    } catch {
      return false;
    }
    return markSequenceOperation(tr);
  }
  const children: ProseMirrorNode[] = [];
  left.forEach((child) => children.push(child));
  children.push(...items);
  right.forEach((child) => children.push(child));
  const merged = left.type.create(
    { ...left.attrs, [sequenceLinkAttribute]: formatSequenceLink(leftLink.previous, rightLink.next, leftLink.version) },
    Fragment.fromArray(children),
    left.marks,
  );
  if (!doc.canReplace(start - 1, end + 2, Fragment.from(merged))) return false;
  const leftPos = selection.$from.before(1) - left.nodeSize;
  const positions: number[] = [];
  let itemPos = leftPos + 1 + left.content.size;
  for (const item of items) {
    positions.push(itemPos + 2);
    itemPos += item.nodeSize;
  }
  const anchor = positions[selection.$anchor.index(0) - start] + selection.$anchor.parentOffset;
  const head = positions[selection.$head.index(0) - start] + selection.$head.parentOffset;
  const tr = closeHistory(state.tr).replaceWith(leftPos, selection.$to.after(1) + right.nodeSize, merged);
  try {
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
    tr.setSelection(TextSelection.create(tr.doc, anchor, head)).scrollIntoView();
  } catch {
    return false;
  }
  return markSequenceOperation(tr);
}

/** 块菜单以目标正文为准，不借用用户此前的选区。 */
export function rejoinSequenceParagraphTarget(
  state: EditorState,
  pos: number,
  requestedAttrs: Record<string, unknown> | null,
): Transaction | false | null {
  if (state.doc.nodeAt(pos)?.type.name !== "paragraph" || state.doc.resolve(pos).depth !== 0) return null;
  const selection = TextSelection.create(state.doc, pos + 1);
  return rejoinSequenceParagraphs(EditorState.create({ doc: state.doc, selection }), requestedAttrs);
}

/** 将末尾直接子项接回相邻有序列表的同一序列。 */
export function rejoinSequenceTail(
  state: EditorState,
  requestedAttrs: Record<string, unknown> | null,
  collapseSelection: boolean,
): Transaction | false | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.$from.depth !== 3 || selection.$to.depth !== 3) return null;
  const source = selection.$from.node(1);
  if (
    !["taskList", "bulletList"].includes(source.type.name) ||
    source.childCount !== 1 ||
    selection.$to.node(1) !== source
  )
    return null;
  const sourcePos = selection.$from.before(1),
    rootPos = state.doc.resolve(sourcePos),
    index = rootPos.index();
  if (rootPos.depth !== 0 || index === 0) return null;
  const left = state.doc.child(index - 1),
    previous = left.lastChild,
    item = source.firstChild!;
  if (
    !hasNumberingSequences(left) ||
    left.attrs[sequenceLinkAttribute] != null ||
    Number(previous?.attrs.semloEditorListIndent ?? 0) !== 1 ||
    Number(item.attrs.semloEditorListIndent ?? 0) !== 1
  )
    return null;
  const targetItem = state.schema.nodes.listItem,
    numbering = resolveListNumbering(left);
  if (
    !targetItem ||
    !numbering.ok ||
    numbering.value.kind !== "v1" ||
    (left.attrs.semloEditorOrderedStyle != null && left.attrs.semloEditorOrderedStyle !== "mixed") ||
    (requestedAttrs?.semloEditorOrderedStyle != null && requestedAttrs.semloEditorOrderedStyle !== "mixed") ||
    item.childCount !== 1 ||
    item.firstChild?.type.name !== "paragraph" ||
    item.attrs.semloEditorListRestart === true ||
    !targetItem.validContent(item.content) ||
    source.marks.length ||
    left.marks.length ||
    listAttributesLost(source, left) ||
    discardedAttributes(item, targetItem, new Set(["checked"]))
  )
    return false;
  const id = numbering.value.sequenceIds[numbering.value.sequenceIds.length - 1];
  const replacement = targetItem.create(
    { ...item.attrs, [sequenceMemberAttribute]: id, semloEditorListRestart: false },
    item.content,
    item.marks,
  );
  const children: ProseMirrorNode[] = [];
  left.forEach((child) => children.push(child));
  children.push(replacement);
  const merged = left.type.create(left.attrs, Fragment.fromArray(children), left.marks);
  if (!state.doc.canReplace(index - 1, index + 1, Fragment.from(merged))) return false;
  const leftPos = sourcePos - left.nodeSize;
  const delta = leftPos + 1 + left.content.size - (sourcePos + 1);
  const tr = closeHistory(state.tr).replaceWith(leftPos, sourcePos + source.nodeSize, merged);
  const anchor = selection.anchor + delta,
    head = collapseSelection ? anchor : selection.head + delta;
  try {
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
    tr.setSelection(TextSelection.create(tr.doc, anchor, head)).scrollIntoView();
  } catch {
    return false;
  }
  return markSequenceOperation(tr);
}

/** 将单序列中间的全部待办或无序项转回有序列表，无法确认身份时保护原内容。 */
export function rejoinSequenceBridge(
  state: EditorState,
  requestedAttrs: Record<string, unknown> | null,
  collapseSelection: boolean,
): Transaction | false | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.$from.depth !== 3 || selection.$to.depth !== 3) return null;
  const source = selection.$from.node(1);
  if (!["taskList", "bulletList"].includes(source.type.name) || selection.$to.node(1) !== source) return null;
  const sourcePos = selection.$from.before(1),
    rootPos = state.doc.resolve(sourcePos),
    index = rootPos.index();
  if (rootPos.depth !== 0 || index === 0 || index + 1 >= state.doc.childCount) return null;
  let leftIndex = index - 1,
    rightIndex = index + 1;
  while (leftIndex >= 0 && ["paragraph", "heading"].includes(state.doc.child(leftIndex).type.name)) leftIndex--;
  while (rightIndex < state.doc.childCount && ["paragraph", "heading"].includes(state.doc.child(rightIndex).type.name))
    rightIndex++;
  if (leftIndex < 0 || rightIndex >= state.doc.childCount) return null;
  const left = state.doc.child(leftIndex),
    right = state.doc.child(rightIndex);
  const leftLink = parseSequenceLink(left.attrs[sequenceLinkAttribute]);
  const rightLink = parseSequenceLink(right.attrs[sequenceLinkAttribute]);
  const involved =
    (leftLink && leftLink.version >= 2 && leftLink.next) || (rightLink && rightLink.version >= 2 && rightLink.previous);
  if (!involved) return null;
  if (
    left.type.name !== "orderedList" ||
    right.type !== left.type ||
    !leftLink ||
    !rightLink ||
    leftLink.version < 2 ||
    leftLink.version !== rightLink.version ||
    !leftLink.next ||
    leftLink.next !== rightLink.previous ||
    selection.$from.index(1) !== 0 ||
    selection.$to.index(1) !== source.childCount - 1 ||
    source.marks.length ||
    left.marks.length ||
    right.marks.length
  )
    return false;
  if (leftLink.version !== 3) {
    for (let gap = leftIndex + 1; gap < rightIndex; gap++)
      if (gap !== index && state.doc.child(gap).type.name !== "paragraph") return false;
  }
  const targetItem = state.schema.nodes.listItem;
  if (!targetItem || listAttributesLost(source, left)) return false;
  const items: ProseMirrorNode[] = [];
  source.forEach((item) => items.push(item));
  if (
    items.some(
      (item) =>
        item.childCount !== 1 ||
        item.firstChild?.type.name !== "paragraph" ||
        !targetItem.validContent(item.content) ||
        discardedAttributes(item, targetItem, new Set(["checked"])),
    )
  )
    return false;
  const strip = (node: ProseMirrorNode) => {
    const { [sequenceLinkAttribute]: _link, [sequenceRegistryAttribute]: _registry, ...attrs } = node.attrs;
    return attrs;
  };
  if (JSON.stringify(strip(left)) !== JSON.stringify(strip(right))) return false;
  const requestedStyle = requestedAttrs?.semloEditorOrderedStyle;
  if (requestedStyle != null && requestedStyle !== (left.attrs.semloEditorOrderedStyle ?? "mixed")) return false;
  const before = resolveListNumbering(left),
    after = resolveListNumbering(right);
  if (!before.ok || before.value.kind !== "v1" || !after.ok || after.value.kind !== "v1") return false;
  const hintValues = items.map((item) => {
    const onItem = item.attrs[sequenceConversionHintAttribute];
    const onParagraph = item.firstChild?.attrs[sequenceConversionHintAttribute];
    return onItem != null && onParagraph != null && onItem !== onParagraph ? false : (onItem ?? onParagraph);
  });
  if (hintValues.some((value) => value === false)) return false;
  const hints = hintValues.map(parseSequenceConversionHint);
  const hasHints = hintValues.some((value) => value != null);
  const id = before.value.sequenceIds[0];
  if (hasHints && hints.some((hint) => !hint || hint.edge !== leftLink.next)) return false;
  if (
    !hasHints &&
    (before.value.sequenceIds.some((value) => value !== id) || after.value.sequenceIds.some((value) => value !== id))
  )
    return false;
  const ids = hasHints ? hints.map((hint) => hint!.sequenceId) : items.map(() => id);
  const leftDefinitions = new Map(before.value.registry.sequences.map((entry) => [entry.id, entry]));
  const rightDefinitions = new Map(after.value.registry.sequences.map((entry) => [entry.id, entry]));
  if (
    leftDefinitions.size !== rightDefinitions.size ||
    [...leftDefinitions].some(([key, entry]) => rightDefinitions.get(key)?.origin !== entry.origin) ||
    ids.some((key) => !leftDefinitions.has(key))
  )
    return false;
  const counts = new Map<string, number>();
  for (const key of before.value.sequenceIds) counts.set(key, (counts.get(key) ?? 0) + 1);
  const rightUsed = new Set(after.value.sequenceIds);
  for (const [key, first] of leftDefinitions) {
    if (rightUsed.has(key)) continue;
    const value = rightDefinitions.get(key)!.start;
    if (value !== first.start && value !== first.start + (counts.get(key) ?? 0)) return false;
  }
  for (const key of after.value.sequenceIds) {
    const first = leftDefinitions.get(key),
      last = rightDefinitions.get(key);
    if (!first || !last || last.start !== first.start + (counts.get(key) ?? 0)) return false;
  }
  const replacement = items.map((item, index) => {
    const paragraph = item.firstChild!;
    const content =
      paragraph.attrs[sequenceConversionHintAttribute] == null
        ? item.content
        : Fragment.from(
            paragraph.type.create(
              { ...paragraph.attrs, [sequenceConversionHintAttribute]: null },
              paragraph.content,
              paragraph.marks,
            ),
          );
    return targetItem.create(
      {
        ...item.attrs,
        [sequenceMemberAttribute]: ids[index],
        [sequenceConversionHintAttribute]: null,
        semloEditorListRestart: false,
      },
      content,
      item.marks,
    );
  });
  if (leftIndex !== index - 1 || rightIndex !== index + 1) {
    const nextLink = newSequenceLinkId(state.doc);
    const needed = new Set([...ids, ...after.value.sequenceIds]);
    const registry = {
      version: 1,
      sequences: before.value.registry.sequences.map((entry) =>
        needed.has(entry.id) ? { ...entry, start: entry.start + (counts.get(entry.id) ?? 0) } : entry,
      ),
    };
    const middle = left.type.create(
      {
        ...left.attrs,
        [sequenceRegistryAttribute]: registry,
        [sequenceLinkAttribute]: formatSequenceLink(leftLink.next, nextLink, leftLink.version),
      },
      Fragment.fromArray(replacement),
      left.marks,
    );
    let rightPos = 0;
    for (let i = 0; i < rightIndex; i++) rightPos += state.doc.child(i).nodeSize;
    const tr = closeHistory(state.tr);
    tr.setNodeMarkup(rightPos, undefined, {
      ...right.attrs,
      [sequenceLinkAttribute]: formatSequenceLink(nextLink, rightLink.next, rightLink.version),
    });
    tr.replaceWith(sourcePos, sourcePos + source.nodeSize, middle);
    try {
      tr.doc.check();
      assertNumberingSequenceDocument(tr.doc);
      tr.setSelection(
        TextSelection.create(tr.doc, selection.anchor, collapseSelection ? selection.anchor : selection.head),
      );
    } catch {
      return false;
    }
    return markSequenceOperation(tr.scrollIntoView());
  }
  const children: ProseMirrorNode[] = [];
  left.forEach((child) => children.push(child));
  children.push(...replacement);
  right.forEach((child) => children.push(child));
  const merged = left.type.create(
    { ...left.attrs, [sequenceLinkAttribute]: formatSequenceLink(leftLink.previous, rightLink.next, leftLink.version) },
    Fragment.fromArray(children),
    left.marks,
  );
  if (!state.doc.canReplace(index - 1, index + 2, Fragment.from(merged))) return false;
  const leftPos = sourcePos - left.nodeSize;
  const delta = leftPos + 1 + left.content.size - (sourcePos + 1);
  const tr = closeHistory(state.tr).replaceWith(leftPos, sourcePos + source.nodeSize + right.nodeSize, merged);
  const anchor = selection.anchor + delta,
    head = collapseSelection ? anchor : selection.head + delta;
  try {
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
    tr.setSelection(TextSelection.create(tr.doc, anchor, head)).scrollIntoView();
  } catch {
    return false;
  }
  return markSequenceOperation(tr);
}
