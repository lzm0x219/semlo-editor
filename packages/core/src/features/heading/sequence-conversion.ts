import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";

import {
  bridgeRemovedSequenceSegment,
  canConvertSequenceChain,
  connectedSequenceLists,
  newSequenceLinkId,
  upgradeSequenceChain,
} from "../list/numbering-sequence-continuation";
import {
  formatSequenceConversionHint,
  sequenceConversionHintAttribute,
} from "../list/numbering-sequence-conversion-hint";
import {
  assertNumberingSequenceDocument,
  formatSequenceLink,
  hasNumberingSequences,
  parseSequenceLink,
  resolveListNumbering,
  sequenceLinkAttribute,
  sequenceMemberAttribute,
} from "../list/numbering-sequence-document";
import { markSequenceOperation } from "../list/numbering-sequence-transactions";
import { clearHeadingInlineFormat } from "./clear-inline";
import { headingNumberingStyle, inheritedHeadingNumbering } from "./numbering";
import type { HeadingStyleLevel } from "./selection";

/** 平铺交错序列只开放可记录两端关联的范围。 */
export function canConvertSequenceTextblocks(list: ProseMirrorNode, index: number, last = index): boolean {
  const rawLink = list.attrs[sequenceLinkAttribute];
  const link = parseSequenceLink(rawLink);
  if (
    !hasNumberingSequences(list) ||
    (rawLink != null && !link) ||
    index < 0 ||
    index >= list.childCount ||
    last < index ||
    last >= list.childCount ||
    (list.attrs.semloEditorOrderedStyle != null && !headingNumberingStyle(list.attrs.semloEditorOrderedStyle))
  )
    return false;
  let simple = true;
  list.forEach((item) => {
    if (
      item.type.name !== "listItem" ||
      Number(item.attrs.semloEditorListIndent ?? 0) !== 0 ||
      item.childCount !== 1 ||
      item.firstChild?.type.name !== "paragraph"
    )
      simple = false;
  });
  const resolved = resolveListNumbering(list);
  if (!simple || !resolved.ok || resolved.value.kind !== "v1") return false;
  const ids = resolved.value.sequenceIds;
  const bounded =
    (index > 0 && last < list.childCount - 1) ||
    (index === 0 && last < list.childCount - 1 && !!link?.previous) ||
    (index > 0 && last === list.childCount - 1 && !!link?.next) ||
    (index === 0 && last === list.childCount - 1 && !!link?.previous && !!link.next);
  if (link) return bounded;
  return ids.every((id) => id === ids[index]) || bounded;
}

/** 将同一平铺编号列表与相邻根级正文作为一个事务转换。 */
function convertMixedSequenceTextblocks(
  editor: Editor,
  level: HeadingStyleLevel,
  selection: TextSelection,
  options: { selection?: { from: number; to: number }; focus?: boolean; preserveInlineMarks?: boolean },
): boolean {
  const state = editor.state;
  const { $from, $to } = selection;
  if (
    $from.parent.type.name !== "paragraph" ||
    $to.parent.type.name !== "paragraph" ||
    ![1, 3].includes($from.depth) ||
    ![1, 3].includes($to.depth) ||
    $from.index(0) === $to.index(0) ||
    $to.parentOffset === 0
  )
    return false;
  const targetType = state.schema.nodes[level ? "heading" : "paragraph"];
  if (!targetType) return false;
  const firstRoot = $from.index(0),
    lastRoot = $to.index(0);
  const firstPos = $from.before(1),
    lastEnd = $to.after(1);
  const outputs: Array<{ node: ProseMirrorNode; source?: number; listHeading?: boolean }> = [];
  let listCount = 0;
  let listStyle: ReturnType<typeof headingNumberingStyle> = null;
  let planned: Transaction;
  const convertParagraph = (paragraph: ProseMirrorNode): ProseMirrorNode | null => {
    if (!level) return paragraph;
    const attrs: Record<string, unknown> = { level, semloEditorHeadingNumbering: null };
    if (Object.getOwnPropertySymbols(paragraph.attrs).length) return null;
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(paragraph.attrs))) {
      if (!("value" in descriptor)) return null;
      if (name === "level" || name === "semloEditorHeadingNumbering") {
        if (!Object.is(descriptor.value, attrs[name])) return null;
      } else if (Object.hasOwn(targetType.spec.attrs ?? {}, name)) attrs[name] = descriptor.value;
      else if (!Object.is(descriptor.value, paragraph.type.spec.attrs?.[name]?.default)) return null;
    }
    if (!targetType.validContent(paragraph.content)) return null;
    return targetType.create(attrs, paragraph.content, paragraph.marks);
  };
  try {
    let rootPos = firstPos;
    for (let index = firstRoot; index <= lastRoot; index++) {
      const root = state.doc.child(index);
      if (root.type.name === "paragraph") {
        const block = convertParagraph(root);
        if (!block) return false;
        outputs.push({ node: block, source: rootPos });
      } else if (root.type.name === "orderedList") {
        listCount++;
        const first = index === firstRoot ? $from.index(1) : 0;
        const last = index === lastRoot ? $to.index(1) : root.childCount - 1;
        if (
          listCount !== 1 ||
          (index === firstRoot && ($from.depth !== 3 || $from.node(2).firstChild !== $from.parent)) ||
          (index === lastRoot && ($to.depth !== 3 || $to.node(2).firstChild !== $to.parent)) ||
          root.attrs[sequenceLinkAttribute] != null ||
          !canConvertSequenceTextblocks(root, first, last) ||
          first > last ||
          last >= root.childCount
        )
          return false;
        const discardable = new Set(["start", "type", "semloEditorOrderedStyle", "semloEditorListSequences"]);
        if (root.marks.length || Object.getOwnPropertySymbols(root.attrs).length) return false;
        for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(root.attrs))) {
          if (!("value" in descriptor)) return false;
          if (discardable.has(name)) continue;
          if (!Object.is(descriptor.value, root.type.spec.attrs?.[name]?.default)) return false;
        }
        listStyle = headingNumberingStyle(root.attrs.semloEditorOrderedStyle) ?? "mixed";
        const before: ProseMirrorNode[] = [],
          after: ProseMirrorNode[] = [];
        root.forEach((item, _offset, itemIndex) => {
          if (itemIndex < first) before.push(item);
          else if (itemIndex > last) after.push(item);
        });
        if (before.length) outputs.push({ node: root.type.create(root.attrs, Fragment.fromArray(before), root.marks) });
        let itemPos = rootPos + 1 + before.reduce((sum, item) => sum + item.nodeSize, 0);
        for (let itemIndex = first; itemIndex <= last; itemIndex++) {
          const item = root.child(itemIndex);
          if (item.marks.length || Object.getOwnPropertySymbols(item.attrs).length) return false;
          for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item.attrs))) {
            if (!("value" in descriptor)) return false;
            if ([sequenceMemberAttribute, "semloEditorListRestart", "semloEditorListIndent"].includes(name)) continue;
            if (!Object.is(descriptor.value, item.type.spec.attrs?.[name]?.default)) return false;
          }
          const block = convertParagraph(item.firstChild!);
          if (!block) return false;
          outputs.push({ node: block, source: itemPos + 1, listHeading: true });
          itemPos += item.nodeSize;
        }
        if (after.length) outputs.push({ node: root.type.create(root.attrs, Fragment.fromArray(after), root.marks) });
      } else return false;
      rootPos += root.nodeSize;
    }
    if (listCount !== 1) return false;
    const replacement = Fragment.fromArray(outputs.map(({ node }) => node));
    if (!state.doc.canReplace(firstRoot, lastRoot + 1, replacement)) return false;
    const tr = closeHistory(state.tr).replaceWith(firstPos, lastEnd, replacement);
    const converted = new Map<number, number>();
    const ranges: Array<[number, number]> = [];
    let position = firstPos;
    for (const output of outputs) {
      if (output.source !== undefined) {
        if (level) {
          const numbering =
            inheritedHeadingNumbering(tr.doc, position, level) ?? (output.listHeading ? listStyle : null);
          tr.setNodeMarkup(position, undefined, { ...output.node.attrs, semloEditorHeadingNumbering: numbering });
        }
        converted.set(output.source, position);
        ranges.push([position + 1, position + output.node.nodeSize - 1]);
      }
      position += output.node.nodeSize;
    }
    const mapEndpoint = (endpoint: typeof $from) => {
      const mapped = converted.get(endpoint.before(endpoint.depth));
      if (mapped === undefined) throw new Error("标题选区无对应内容");
      return mapped + 1 + endpoint.parentOffset;
    };
    const anchor = mapEndpoint(selection.$anchor);
    const head = options.selection ? anchor : mapEndpoint(selection.$head);
    tr.setSelection(TextSelection.create(tr.doc, anchor, head));
    if (level || !options.preserveInlineMarks) clearHeadingInlineFormat(tr, ranges);
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
    planned = markSequenceOperation(tr.scrollIntoView());
  } catch {
    return false;
  }
  editor.view.dispatch(planned);
  if (editor.isDestroyed || editor.state.doc.eq(state.doc)) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  if (options.focus !== false) editor.view.focus();
  return true;
}

/** 转换时保留未选列表、选区和宿主属性；无法无损处理时不修改文档。 */
export function convertSequenceTextblocks(
  editor: Editor,
  level: HeadingStyleLevel,
  options: { selection?: { from: number; to: number }; focus?: boolean; preserveInlineMarks?: boolean },
): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const state = editor.state;
  let selection = state.selection;
  if (options.selection) {
    const { from, to } = options.selection;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > state.doc.content.size)
      return false;
    try {
      selection = TextSelection.create(state.doc, from, to);
    } catch {
      return false;
    }
  }
  if (!(selection instanceof TextSelection)) return false;
  if (selection.$from.depth !== 3 || selection.$to.depth !== 3 || selection.$from.before(1) !== selection.$to.before(1))
    return convertMixedSequenceTextblocks(editor, level, selection, options);
  const { $from, $to } = selection;
  const list = $from.node(1),
    listPos = $from.before(1),
    first = $from.index(1),
    last = $to.index(1),
    targetType = state.schema.nodes[level ? "heading" : "paragraph"];
  if (
    !targetType ||
    $to.before(1) !== $from.before(1) ||
    !canConvertSequenceTextblocks(list, first, last) ||
    !canConvertSequenceChain(state.doc, listPos) ||
    first > last ||
    last >= list.childCount
  )
    return false;
  const blocks: ProseMirrorNode[] = [];
  for (let index = first; index <= last; index++) {
    const item = list.child(index),
      paragraph = item.firstChild!;
    if (
      item.marks.length ||
      (index === first && $from.parent !== paragraph) ||
      (index === last && $to.parent !== paragraph)
    )
      return false;
    for (const [name, value] of Object.entries(item.attrs)) {
      if ([sequenceMemberAttribute, "semloEditorListRestart", "semloEditorListIndent"].includes(name)) continue;
      const original = item.type.spec.attrs?.[name];
      if (!original || !Object.is(value, original.default)) return false;
    }
    if (!level) {
      blocks.push(paragraph);
      continue;
    }
    const headingAttrs: Record<string, unknown> = { level, semloEditorHeadingNumbering: "mixed" };
    for (const [name, value] of Object.entries(paragraph.attrs)) {
      if (name === "level" || name === "semloEditorHeadingNumbering") {
        if (!Object.is(value, headingAttrs[name])) return false;
      } else if (Object.hasOwn(targetType.spec.attrs ?? {}, name)) headingAttrs[name] = value;
      else if (!Object.is(value, paragraph.type.spec.attrs?.[name]?.default)) return false;
    }
    if (!targetType.validContent(paragraph.content)) return false;
    blocks.push(targetType.create(headingAttrs, paragraph.content, paragraph.marks));
  }
  const before: ProseMirrorNode[] = [],
    after: ProseMirrorNode[] = [];
  list.forEach((child, _offset, childIndex) => {
    if (childIndex < first) before.push(child);
    if (childIndex > last) after.push(child);
  });
  const edge = before.length && after.length ? newSequenceLinkId(state.doc) : null;
  const link = parseSequenceLink(list.attrs[sequenceLinkAttribute]);
  const numbered = resolveListNumbering(list);
  if (!numbered.ok || numbered.value.kind !== "v1") return false;
  const chain = link ? connectedSequenceLists(state.doc, listPos) : [{ node: list, pos: listPos }];
  if (!chain) return false;
  let needsIdentity = false;
  for (const segment of chain) {
    const resolved = resolveListNumbering(segment.node);
    if (!resolved.ok || resolved.value.kind !== "v1") return false;
    if (resolved.value.sequenceIds.some((id) => id !== numbered.value.sequenceIds[first])) needsIdentity = true;
  }
  const identityEdge =
    edge ??
    (before.length ? link?.next : after.length ? link?.previous : link?.previous && link.next ? link.previous : null);
  if (needsIdentity || link) {
    if (!identityEdge) return false;
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (!Object.hasOwn(block.type.spec.attrs ?? {}, sequenceConversionHintAttribute)) return false;
      blocks[index] = block.type.createChecked(
        {
          ...block.attrs,
          [sequenceConversionHintAttribute]: formatSequenceConversionHint(
            identityEdge,
            numbered.value.sequenceIds[first + index],
          ),
        },
        block.content,
        block.marks,
      );
    }
  }
  const version = Math.max(link?.version ?? 1, level ? 3 : 1) as 1 | 2 | 3;
  const upgraded = link && version > link.version ? upgradeSequenceChain(state.doc, listPos, version as 2 | 3) : [];
  const bridged =
    link && !before.length && !after.length ? bridgeRemovedSequenceSegment(state.doc, listPos, version) : [];
  if (!upgraded || !bridged) return false;
  const linkedAttrs = link
    ? { ...list.attrs, [sequenceLinkAttribute]: formatSequenceLink(link.previous, link.next, version) }
    : list.attrs;
  const prefix = before.length
    ? list.type.create(
        edge
          ? { ...linkedAttrs, [sequenceLinkAttribute]: formatSequenceLink(link?.previous ?? null, edge, version) }
          : linkedAttrs,
        Fragment.fromArray(before),
        list.marks,
      )
    : null;
  const suffix = after.length
    ? list.type.create(
        edge
          ? { ...linkedAttrs, [sequenceLinkAttribute]: formatSequenceLink(edge, link?.next ?? null, version) }
          : linkedAttrs,
        Fragment.fromArray(after),
        list.marks,
      )
    : null;
  const headingPos = listPos + (prefix?.nodeSize ?? 0),
    parent = state.doc.resolve(listPos);
  const replacement = Fragment.fromArray([...(prefix ? [prefix] : []), ...blocks, ...(suffix ? [suffix] : [])]);
  if (!parent.parent.canReplace(parent.index(), parent.index() + 1, replacement)) return false;
  const tr = closeHistory(state.tr);
  const updates = new Map([...upgraded, ...bridged].map((entry) => [entry.pos, entry.node]));
  for (const [pos, node] of updates) if (pos !== listPos) tr.setNodeMarkup(pos, undefined, node.attrs, node.marks);
  tr.replaceWith(listPos, listPos + list.nodeSize, replacement);
  const positions: number[] = [];
  let position = headingPos;
  const numbering = level
    ? (inheritedHeadingNumbering(tr.doc, headingPos, level) ??
      headingNumberingStyle(list.attrs.semloEditorOrderedStyle) ??
      "mixed")
    : null;
  for (const block of blocks) {
    positions.push(position);
    if (level) tr.setNodeMarkup(position, undefined, { ...block.attrs, semloEditorHeadingNumbering: numbering });
    position += block.nodeSize;
  }
  const anchor = positions[selection.$anchor.index(1) - first] + 1 + selection.$anchor.parentOffset;
  const head = options.selection
    ? anchor
    : positions[selection.$head.index(1) - first] + 1 + selection.$head.parentOffset;
  try {
    tr.setSelection(TextSelection.create(tr.doc, anchor, head));
    if (level || !options.preserveInlineMarks)
      clearHeadingInlineFormat(
        tr,
        blocks.map((block, index) => [positions[index] + 1, positions[index] + block.nodeSize - 1]),
      );
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
  } catch {
    return false;
  }
  editor.view.dispatch(markSequenceOperation(tr.scrollIntoView()));
  if (editor.isDestroyed || editor.state.doc.eq(state.doc)) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  if (options.focus !== false) editor.view.focus();
  return true;
}
