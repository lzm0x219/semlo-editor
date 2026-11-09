import { Fragment, type Node as ProseMirrorNode, type NodeType, type ResolvedPos } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";

import { rejoinSequenceBridge, rejoinSequenceParagraphTarget } from "../../features/list/numbering-sequence-bridge";
import {
  bridgeRemovedSequenceSegment,
  canConvertSequenceChain,
  connectedSequenceLists,
  newSequenceLinkId,
  planSequenceContinuation,
  upgradeSequenceChain,
} from "../../features/list/numbering-sequence-continuation";
import {
  formatSequenceConversionHint,
  parseSequenceConversionHint,
  sequenceConversionHintAttribute,
} from "../../features/list/numbering-sequence-conversion-hint";
import {
  assertNumberingSequenceDocument,
  formatSequenceLink,
  hasNumberingSequences,
  numberingSequenceInput,
  parseSequenceLink,
  resolveListNumbering,
  sequenceLinkAttribute,
  sequenceMemberAttribute,
  sequenceRegistryAttribute,
} from "../../features/list/numbering-sequence-document";
import { markSequenceOperation } from "../../features/list/numbering-sequence-transactions";
import { materializeNumberingSequences } from "../../features/list/numbering-sequences";
import { validOrderedListStart } from "../../features/list/numbering-values";
import { LINE_HEIGHT_VALUES } from "../../features/text/paragraph-layout";
import { MAX_INDENT } from "../../shared/indent";

type Layout = Partial<{ textAlign: string | null; semloEditorIndent: number; semloEditorLineHeight: string | null }>;
type ListKind = "bulletList" | "orderedList" | "taskList";
type BlockKind = "paragraph" | "heading" | ListKind;
const textContainers = new Set([
  "blockquote",
  "callout",
  "semloEditorColumn",
  "tableCell",
  "tableHeader",
  "detailsContent",
]);
export type BlockFormat = {
  kind: BlockKind | null;
  level?: number;
  layout: Layout;
  checked?: boolean;
  orderedStyle?: string | null;
  orderedType?: string | null;
  sourceList?: ProseMirrorNode;
  sourceSequenceId?: string;
};

function defaultAttributes(node: ProseMirrorNode, exceptions: readonly string[] = []): boolean {
  if (node.marks.length || Object.getOwnPropertySymbols(node.attrs).length) return false;
  return Object.entries(Object.getOwnPropertyDescriptors(node.attrs)).every(
    ([name, descriptor]) =>
      "value" in descriptor &&
      (exceptions.includes(name) || Object.is(descriptor.value, node.type.spec.attrs?.[name]?.default)),
  );
}

function simpleList(
  position: ResolvedPos,
): { kind: ListKind; list: ProseMirrorNode; item: ProseMirrorNode; depth: number } | null {
  const depth = position.depth - 2;
  if (depth < 1 || (depth !== 1 && !textContainers.has(position.node(depth - 1).type.name))) return null;
  const list = position.node(depth),
    item = position.node(depth + 1);
  const kind = list.type.name;
  if (kind !== "bulletList" && kind !== "orderedList" && kind !== "taskList") return null;
  const expectedItem = kind === "taskList" ? "taskItem" : "listItem";
  const exceptions =
    kind === "taskList"
      ? ["checked", sequenceConversionHintAttribute]
      : kind === "orderedList"
        ? [sequenceMemberAttribute, "semloEditorListRestart"]
        : [sequenceConversionHintAttribute];
  const listExceptions =
    kind === "orderedList"
      ? ["start", "type", "semloEditorOrderedStyle", sequenceRegistryAttribute, sequenceLinkAttribute]
      : [];
  const linked = list.attrs[sequenceLinkAttribute];
  if (
    item.type.name !== expectedItem ||
    item.firstChild !== position.parent ||
    !defaultAttributes(list, listExceptions) ||
    (linked != null &&
      (kind !== "orderedList" ||
        depth !== 1 ||
        !parseSequenceLink(linked) ||
        !canConvertSequenceChain(position.doc, position.before(depth))))
  )
    return null;
  let simple = true;
  list.forEach((child) => {
    if (
      child.type.name !== expectedItem ||
      child.childCount !== 1 ||
      child.firstChild?.type.name !== "paragraph" ||
      !defaultAttributes(child, exceptions) ||
      (child.attrs[sequenceConversionHintAttribute] != null &&
        !parseSequenceConversionHint(child.attrs[sequenceConversionHintAttribute])) ||
      (kind === "orderedList" &&
        child.attrs.semloEditorListRestart != null &&
        typeof child.attrs.semloEditorListRestart !== "boolean") ||
      (kind === "taskList" && typeof child.attrs.checked !== "boolean")
    )
      simple = false;
  });
  if (!simple) return null;
  if (kind === "orderedList") {
    if (
      validOrderedListStart(list.attrs.start ?? 1) === null ||
      ![null, undefined, "", "1", "a", "A", "i", "I"].includes(list.attrs.type) ||
      ![null, undefined, "mixed", "decimal", "chinese"].includes(list.attrs.semloEditorOrderedStyle)
    )
      return null;
    const resolved = resolveListNumbering(list);
    if (!resolved.ok) return null;
  }
  return { kind, list, item, depth };
}

/** 只识别允许独立块内容的内置容器，不将列表项或折叠标题当成普通正文。 */
function containedTextblock(position: ResolvedPos): boolean {
  return position.depth > 1 && textContainers.has(position.node(position.depth - 1).type.name);
}

/** 来源块的类型和排版只取明确支持的字段，不复制宿主属性或标题锚点。 */
export function captureBlockFormat(position: ResolvedPos): BlockFormat | null {
  const node = position.parent;
  if (node.type.name !== "paragraph" && node.type.name !== "heading") return null;
  const layout: Layout = {};
  const { textAlign, semloEditorIndent, semloEditorLineHeight } = node.attrs;
  if (textAlign === null || ["left", "center", "right", "justify"].includes(textAlign)) layout.textAlign = textAlign;
  if (Number.isInteger(semloEditorIndent) && semloEditorIndent >= 0 && semloEditorIndent <= MAX_INDENT)
    layout.semloEditorIndent = semloEditorIndent;
  const height = typeof semloEditorLineHeight === "number" ? String(semloEditorLineHeight) : semloEditorLineHeight;
  if (height === null || (typeof height === "string" && (LINE_HEIGHT_VALUES as readonly string[]).includes(height)))
    layout.semloEditorLineHeight = height;
  const list = simpleList(position);
  if (list)
    return {
      kind: list.kind,
      layout,
      ...(list.kind === "taskList" ? { checked: list.item.attrs.checked } : {}),
      ...(list.kind === "orderedList"
        ? {
            orderedStyle: list.list.attrs.semloEditorOrderedStyle,
            orderedType: list.list.attrs.type,
            sourceList: list.list,
            ...(typeof list.item.attrs[sequenceMemberAttribute] === "string"
              ? { sourceSequenceId: list.item.attrs[sequenceMemberAttribute] }
              : {}),
          }
        : {}),
    };
  if (position.depth !== 1 && !containedTextblock(position)) return { kind: null, layout };
  if (node.type.name === "heading") {
    const level = node.attrs.level;
    if (!Number.isInteger(level) || level < 1 || level > 6) return { kind: null, layout };
    return { kind: "heading", level, layout };
  }
  return { kind: "paragraph", layout };
}

function textblock(node: ProseMirrorNode, type: NodeType, source: BlockFormat): ProseMirrorNode | null {
  if (Object.getOwnPropertySymbols(node.attrs).length || !type.validContent(node.content)) return null;
  const attrs: Record<string, unknown> = {};
  const discardedHeading = new Set([
    "level",
    "semloEditorHeadingNumbering",
    "semloEditorHeadingAnchor",
    "semloEditorHeadingFolded",
  ]);
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(node.attrs))) {
    if (!("value" in descriptor)) return null;
    if (Object.hasOwn(type.spec.attrs ?? {}, name)) attrs[name] = descriptor.value;
    else if (
      !(node.type.name === "heading" && discardedHeading.has(name)) &&
      !Object.is(descriptor.value, node.type.spec.attrs?.[name]?.default)
    )
      return null;
  }
  for (const [name, value] of Object.entries(source.layout))
    if (Object.hasOwn(type.spec.attrs ?? {}, name)) attrs[name] = value;
  if (type.name === "heading" && source.kind === "heading") attrs.level = source.level;
  return type.createChecked(attrs, node.content, node.marks);
}

function selectionIn(tr: Transaction, position: number, block: ProseMirrorNode): TextSelection {
  return TextSelection.create(tr.doc, position + 1, position + 1 + block.content.size);
}

function listKind(kind: BlockKind): kind is ListKind {
  return kind === "bulletList" || kind === "orderedList" || kind === "taskList";
}

function newList(tr: Transaction, source: BlockFormat, block: ProseMirrorNode): ProseMirrorNode | null {
  if (!source.kind || !listKind(source.kind)) return null;
  const schema = tr.doc.type.schema;
  const listType = schema.nodes[source.kind],
    itemType = schema.nodes[source.kind === "taskList" ? "taskItem" : "listItem"];
  if (!listType || !itemType) return null;
  const item = itemType.createChecked(source.kind === "taskList" ? { checked: source.checked === true } : null, block);
  const attrs =
    source.kind === "orderedList"
      ? { semloEditorOrderedStyle: source.orderedStyle ?? null, type: source.orderedType ?? null }
      : null;
  return listType.createChecked(attrs, item);
}

function updateContinuation(tr: Transaction, previous: ProseMirrorNode): boolean {
  const updates = planSequenceContinuation(tr.doc, previous);
  if (!updates) return false;
  for (const { pos, node } of updates) tr.setNodeMarkup(pos, undefined, node.attrs, node.marks);
  assertNumberingSequenceDocument(tr.doc);
  markSequenceOperation(tr);
  return true;
}

/** 二级无序叶项及其展平后的成员转正文时，保留两侧成员的视觉缩进。 */
function paintBulletLeafParagraph(
  tr: Transaction,
  selection: TextSelection,
  source: BlockFormat,
): TextSelection | null {
  const position = selection.$from;
  if (
    source.kind !== "paragraph" ||
    (position.depth !== 3 && position.depth !== 5) ||
    position.node(1).type.name !== "bulletList" ||
    (position.depth === 5 && position.node(3).type.name !== "bulletList") ||
    position.node(position.depth - 1).childCount !== 1
  )
    return null;
  const list = position.node(1);
  if (!defaultAttributes(list)) return null;
  const updated = textblock(position.parent, tr.doc.type.schema.nodes.paragraph, source);
  if (!updated) return null;
  const listPos = position.before(1),
    targetPos = position.before(position.depth - 1);
  const items: ProseMirrorNode[] = [];
  let selected = -1,
    supported = true;
  list.forEach((item, offset) => {
    const indent = item.attrs.semloEditorListIndent;
    if (
      item.type.name !== "listItem" ||
      !defaultAttributes(item, ["semloEditorListIndent"]) ||
      !Number.isInteger(indent) ||
      indent < 0 ||
      indent > MAX_INDENT ||
      item.firstChild?.type.name !== "paragraph" ||
      item.childCount < 1 ||
      item.childCount > 2 ||
      (position.depth === 3 && item.childCount !== 1)
    ) {
      supported = false;
      return;
    }
    if (listPos + 1 + offset === targetPos) selected = items.length;
    items.push(item.type.createChecked(item.attrs, item.firstChild, item.marks));
    if (item.childCount === 1) return;
    const children = item.child(1);
    if (children.type.name !== "bulletList" || !defaultAttributes(children)) {
      supported = false;
      return;
    }
    const childrenPos = listPos + 2 + offset + item.firstChild.nodeSize;
    children.forEach((child, childOffset) => {
      const childIndent = child.attrs.semloEditorListIndent;
      if (
        child.type.name !== "listItem" ||
        child.childCount !== 1 ||
        child.firstChild?.type.name !== "paragraph" ||
        !defaultAttributes(child, ["semloEditorListIndent"]) ||
        !Number.isInteger(childIndent) ||
        childIndent < 0 ||
        indent + childIndent + 1 > MAX_INDENT
      ) {
        supported = false;
        return;
      }
      if (childrenPos + 1 + childOffset === targetPos) selected = items.length;
      items.push(
        child.type.createChecked({ ...child.attrs, semloEditorListIndent: indent + childIndent + 1 }, child.content),
      );
    });
  });
  if (!supported || selected < 0) return null;
  const before = selected
    ? list.type.createChecked(list.attrs, Fragment.fromArray(items.slice(0, selected)), list.marks)
    : null;
  const afterItems = items.slice(selected + 1);
  const after = afterItems.length
    ? list.type.createChecked(list.attrs, Fragment.fromArray(afterItems), list.marks)
    : null;
  const replacement = Fragment.fromArray([...(before ? [before] : []), updated, ...(after ? [after] : [])]);
  const root = tr.doc.resolve(listPos);
  if (!root.parent.canReplace(root.index(), root.index() + 1, replacement)) return null;
  tr.replaceWith(listPos, listPos + list.nodeSize, replacement);
  return selectionIn(tr, listPos + (before?.nodeSize ?? 0), updated);
}

/** 点击块时在一个事务内转换块类型与段落样式，复杂结构不作破坏性降级。 */
export function paintBlock(tr: Transaction, selection: TextSelection, source: BlockFormat): TextSelection | null {
  const position = selection.$from;
  const node = position.parent;
  const schema = tr.doc.type.schema;
  const target = simpleList(position);
  const listDepth = position.depth - 2;
  const unresolvedList = listDepth > 0 ? position.node(listDepth) : null;
  if (!target && unresolvedList?.type.name === "orderedList" && unresolvedList.attrs[sequenceLinkAttribute] != null)
    return null;
  if (position.depth !== 1 && !target && !containedTextblock(position)) {
    const nested = paintBulletLeafParagraph(tr, selection, source);
    if (nested) return nested;
    if (source.kind && source.kind !== "paragraph") return null;
    const updated = textblock(node, node.type, source);
    if (!updated) return null;
    if (!updated.eq(node)) tr.setNodeMarkup(position.before(), node.type, updated.attrs, node.marks);
    return selectionIn(tr, position.before(), updated);
  }
  if (position.depth !== 1 && !target && (source.kind === "paragraph" || source.kind === "heading")) {
    const type = schema.nodes[source.kind];
    const container = position.node(position.depth - 1);
    const index = position.index(position.depth - 1);
    const updated = type && textblock(node, type, source);
    if (!updated || !container.canReplaceWith(index, index + 1, type, updated.marks)) return null;
    if (!updated.eq(node)) tr.setNodeMarkup(position.before(), type, updated.attrs, node.marks);
    return selectionIn(tr, position.before(), updated);
  }
  if (!source.kind) {
    const updated = textblock(node, node.type, source);
    if (!updated) return null;
    if (!updated.eq(node)) tr.setNodeMarkup(position.before(), node.type, updated.attrs, node.marks);
    return selectionIn(tr, position.before(), updated);
  }
  const targetType = schema.nodes[source.kind === "heading" ? "heading" : "paragraph"];
  if (!targetType) return null;
  const updated = textblock(node, targetType, source);
  if (!updated) return null;
  if (target && source.kind === target.kind) {
    if (
      target.kind === "orderedList" &&
      (target.list.attrs.semloEditorOrderedStyle !== (source.orderedStyle ?? null) ||
        target.list.attrs.type !== (source.orderedType ?? null))
    )
      return null;
    if (target.kind === "taskList" && target.item.attrs.checked !== source.checked)
      tr.setNodeMarkup(position.before(target.depth + 1), undefined, {
        ...target.item.attrs,
        checked: source.checked === true,
      });
    const blockPos = position.before();
    if (!updated.eq(node)) tr.setNodeMarkup(blockPos, targetType, updated.attrs, node.marks);
    return selectionIn(tr, blockPos, updated);
  }
  if (target) {
    const previous = tr.doc;
    const onItem = target.item.attrs[sequenceConversionHintAttribute];
    const onText = node.attrs[sequenceConversionHintAttribute];
    if (onItem != null && onText != null && onItem !== onText) return null;
    let conversion = onItem ?? onText;
    if (conversion != null && source.kind === "orderedList") {
      const current = EditorState.create({ doc: tr.doc, selection });
      const restored = rejoinSequenceBridge(current, { semloEditorOrderedStyle: source.orderedStyle }, true);
      if (!restored) return null;
      for (const step of restored.steps) tr.step(step);
      markSequenceOperation(tr);
      const position = tr.doc.resolve(restored.selection.from);
      return selectionIn(tr, position.before(), position.parent);
    }
    let list = target.list;
    const listPos = position.before(target.depth),
      index = position.index(target.depth);
    const hasBefore = index > 0,
      hasAfter = index + 1 < list.childCount;
    // 现有跨段续接只支持根级列表，容器内的中间编号项暂不能安全拆分。
    if (target.kind === "orderedList" && target.depth !== 1 && hasBefore && hasAfter) return null;
    const numbered = target.kind === "orderedList" && (hasNumberingSequences(list) || (hasBefore && hasAfter));
    if (numbered && !hasNumberingSequences(list)) {
      const resolved = materializeNumberingSequences(numberingSequenceInput(list));
      if (!resolved.ok) return null;
      const items: ProseMirrorNode[] = [];
      list.forEach((item, _offset, at) =>
        items.push(
          item.type.createChecked(
            { ...item.attrs, [sequenceMemberAttribute]: resolved.value.sequenceIds[at] },
            item.content,
            item.marks,
          ),
        ),
      );
      list = list.type.createChecked(
        { ...list.attrs, [sequenceRegistryAttribute]: resolved.value.registry },
        Fragment.fromArray(items),
        list.marks,
      );
    }
    const before: ProseMirrorNode[] = [],
      after: ProseMirrorNode[] = [];
    list.forEach((item, _offset, at) => {
      if (at < index) before.push(item);
      else if (at > index) after.push(item);
    });
    const edge = numbered && before.length && after.length ? newSequenceLinkId(previous) : null;
    const link = parseSequenceLink(list.attrs[sequenceLinkAttribute]);
    if (numbered) {
      const resolved = resolveListNumbering(list);
      const chain = link ? connectedSequenceLists(previous, listPos) : [{ node: list, pos: listPos }];
      if (!resolved.ok || resolved.value.kind !== "v1" || !chain) return null;
      let needsIdentity = false;
      for (const segment of chain) {
        const numbering = resolveListNumbering(segment.node);
        if (!numbering.ok || numbering.value.kind !== "v1") return null;
        if (numbering.value.sequenceIds.some((id) => id !== resolved.value.sequenceIds[index])) needsIdentity = true;
      }
      if (needsIdentity || link) {
        const identityEdge =
          edge ??
          (before.length
            ? link?.next
            : after.length
              ? link?.previous
              : link?.previous && link.next
                ? link.previous
                : null);
        if (identityEdge) conversion = formatSequenceConversionHint(identityEdge, resolved.value.sequenceIds[index]);
      }
    }
    const required = source.kind === "heading" ? 3 : source.kind === "paragraph" ? 1 : 2;
    const version = Math.max(link?.version ?? 1, required) as 1 | 2 | 3;
    const upgraded = link && version > link.version ? upgradeSequenceChain(previous, listPos, version as 2 | 3) : [];
    const bridged =
      link && !before.length && !after.length ? bridgeRemovedSequenceSegment(previous, listPos, version) : [];
    if (!upgraded || !bridged) return null;
    const listAttrs = link
      ? { ...list.attrs, [sequenceLinkAttribute]: formatSequenceLink(link.previous, link.next, version) }
      : list.attrs;
    const prefixAttrs = edge
      ? { ...listAttrs, [sequenceLinkAttribute]: formatSequenceLink(link?.previous ?? null, edge, version) }
      : listAttrs;
    const suffixAttrs = edge
      ? { ...listAttrs, [sequenceLinkAttribute]: formatSequenceLink(edge, link?.next ?? null, version) }
      : listAttrs;
    const prefix = before.length ? list.type.createChecked(prefixAttrs, Fragment.fromArray(before), list.marks) : null;
    const suffix = after.length ? list.type.createChecked(suffixAttrs, Fragment.fromArray(after), list.marks) : null;
    let output = listKind(source.kind) ? newList(tr, source, updated) : updated;
    if (!output) return null;
    if (conversion != null && (source.kind === "paragraph" || source.kind === "heading")) {
      if (!Object.hasOwn(output.type.spec.attrs ?? {}, sequenceConversionHintAttribute)) return null;
      output = output.type.createChecked(
        { ...output.attrs, [sequenceConversionHintAttribute]: conversion },
        output.content,
        output.marks,
      );
    }
    if (conversion != null && (source.kind === "taskList" || source.kind === "bulletList")) {
      const item = output.firstChild;
      if (!item || !Object.hasOwn(item.type.spec.attrs ?? {}, sequenceConversionHintAttribute)) return null;
      const retained = item.type.createChecked(
        { ...item.attrs, [sequenceConversionHintAttribute]: conversion },
        item.content,
        item.marks,
      );
      output = output.type.createChecked(output.attrs, Fragment.from(retained), output.marks);
    }
    const replacement = Fragment.fromArray([...(prefix ? [prefix] : []), output, ...(suffix ? [suffix] : [])]);
    const root = tr.doc.resolve(listPos);
    if (!root.parent.canReplace(root.index(), root.index() + 1, replacement)) return null;
    const updates = new Map([...upgraded, ...bridged].map((entry) => [entry.pos, entry.node]));
    for (const [pos, node] of updates) if (pos !== listPos) tr.setNodeMarkup(pos, undefined, node.attrs, node.marks);
    tr.replaceWith(listPos, listPos + target.list.nodeSize, replacement);
    if (numbered && !updateContinuation(tr, previous)) return null;
    return selectionIn(tr, listPos + (prefix?.nodeSize ?? 0) + (listKind(source.kind) ? 2 : 0), updated);
  }
  if (listKind(source.kind)) {
    if (source.kind === "orderedList" && node.attrs[sequenceConversionHintAttribute] != null) {
      const current = EditorState.create({ doc: tr.doc, selection });
      const restored = rejoinSequenceParagraphTarget(current, position.before(), {
        semloEditorOrderedStyle: source.orderedStyle,
      });
      if (!restored) return null;
      for (const step of restored.steps) tr.step(step);
      markSequenceOperation(tr);
      const restoredPosition = tr.doc.resolve(restored.selection.from);
      return selectionIn(tr, restoredPosition.before(), restoredPosition.parent);
    }
    const candidate = newList(tr, source, updated);
    if (!candidate) return null;
    const listType = candidate.type;
    let item = candidate.firstChild!;
    const parentDepth = position.depth - 1;
    const root = position.node(parentDepth),
      index = position.index(parentDepth),
      blockPos = position.before();
    const sameList = (other: ProseMirrorNode | null) => other?.type === listType && other.sameMarkup(candidate);
    const previous = index > 0 ? root.child(index - 1) : null;
    const following = index + 1 < root.childCount ? root.child(index + 1) : null;
    let left = sameList(previous) ? previous : null,
      right = sameList(following) ? following : null;
    let sequence = false;
    let sourceListAttrs: ProseMirrorNode | null = null;
    if (source.kind === "orderedList") {
      const linked = previous === source.sourceList ? previous : following === source.sourceList ? following : null;
      const linkedPos = linked === previous ? blockPos - (linked?.nodeSize ?? 0) : blockPos + node.nodeSize;
      if (linked && hasNumberingSequences(linked) && !canConvertSequenceChain(tr.doc, linkedPos)) return null;
      if (linked && hasNumberingSequences(linked)) {
        const resolved = resolveListNumbering(linked);
        if (
          resolved.ok &&
          resolved.value.kind === "v1" &&
          source.sourceSequenceId &&
          resolved.value.sequenceIds.includes(source.sourceSequenceId)
        ) {
          item = item.type.createChecked(
            { ...item.attrs, [sequenceMemberAttribute]: source.sourceSequenceId },
            item.content,
            item.marks,
          );
          left = linked === previous ? linked : null;
          right = linked === following ? linked : null;
          sequence = true;
        }
      } else if (linked && !linked.sameMarkup(candidate)) {
        // 相邻的旧列表沿用自身起点，不把另一侧独立列表误并进来。
        left = linked === previous ? linked : null;
        right = linked === following ? linked : null;
        sourceListAttrs = linked;
      }
    }
    const items: ProseMirrorNode[] = [];
    left?.forEach((child) => items.push(child));
    const beforeSize = items.reduce((total, child) => total + child.nodeSize, 0);
    items.push(item);
    right?.forEach((child) => items.push(child));
    const merged = listType.createChecked(
      (sequence ? (left ?? right) : (sourceListAttrs ?? candidate))!.attrs,
      Fragment.fromArray(items),
      candidate.marks,
    );
    const from = blockPos - (left?.nodeSize ?? 0),
      to = blockPos + node.nodeSize + (right?.nodeSize ?? 0);
    const fromIndex = index - (left ? 1 : 0),
      toIndex = index + 1 + (right ? 1 : 0);
    if (!root.canReplace(fromIndex, toIndex, Fragment.from(merged))) return null;
    const previousDocument = tr.doc;
    tr.replaceWith(from, to, merged);
    if (sequence && !updateContinuation(tr, previousDocument)) return null;
    return selectionIn(tr, from + 2 + beforeSize, updated);
  }
  const blockPos = position.before();
  if (!updated.eq(node)) tr.setNodeMarkup(blockPos, targetType, updated.attrs, node.marks);
  return selectionIn(tr, blockPos, updated);
}
