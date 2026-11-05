import { type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { DOMSerializer, Fragment, type Node as ProseMirrorNode, type NodeType } from "@tiptap/pm/model";
import { Selection, type EditorState, type Transaction } from "@tiptap/pm/state";

import { orderedListSuffixAttrs } from "../../list/ordered-fragment";
import { normalizeOrderedAncestorPath } from "../../list/ordered-path";
import { orderedListLabels } from "../../list/ordered-style";
import { deriveOrderedListValues, rebaseOrderedListLevelStarts } from "../../list/ordinals";
import type { Target } from "./target";

export type Conversion = { label: string; type: string; level?: 1 | 2 | 3 | 4 | 5 | 6 };
export const listNodes = new Set(["bulletList", "orderedList", "taskList"]);
export const itemNodes = new Set(["listItem", "taskItem"]);

/** Flat lists encode depth on items; nested-list moves retain their original behavior. */
export function isFlatList(list: ProseMirrorNode): boolean {
  let nested = false;
  list.descendants((node) => {
    if (listNodes.has(node.type.name)) nested = true;
    return !nested && !node.isTextblock;
  });
  return !nested;
}

export function listHasRestarts(list: ProseMirrorNode): boolean {
  let found = false;
  list.forEach((item) => {
    if (item.attrs.semloEditorListRestart === true) found = true;
  });
  return found;
}

export function dispatchChange(editor: Editor, tr: Transaction): void {
  editor.view.dispatch(closeHistory(tr));
  if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
}

/** Preserve the stored level starts when a top-level list's first item changes. */
export function rebaseOrderedListAfterChange(
  tr: Transaction,
  original: ProseMirrorNode,
  originalPos: number,
  expectedContent: Fragment,
): boolean {
  if (
    original.type.name !== "orderedList" ||
    (original.attrs.semloEditorListLevelStarts == null && original.attrs.semloEditorOrderedAncestorPath == null)
  )
    return true;
  const mapped = tr.mapping.mapResult(originalPos, -1);
  if (mapped.deletedAcross) return false;
  const list = tr.doc.nodeAt(mapped.pos);
  if (!list || list.type !== original.type || !list.firstChild || !list.content.eq(expectedContent)) return false;
  const before = { ...original.attrs, start: null, semloEditorListLevelStarts: null };
  const after = { ...list.attrs, start: null, semloEditorListLevelStarts: null };
  if (JSON.stringify(before) !== JSON.stringify(after)) return false;
  const rebased = rebaseOrderedListLevelStarts(original, list.firstChild.attrs.semloEditorListIndent);
  if (!rebased.ok) return false;
  const oldPath = normalizeOrderedAncestorPath(original.attrs.semloEditorOrderedAncestorPath);
  const previousIndent = Number(original.firstChild?.attrs.semloEditorListIndent ?? 0);
  const nextIndent = Number(list.firstChild.attrs.semloEditorListIndent ?? 0);
  const nextPath =
    oldPath && oldPath.length === previousIndent && Number.isInteger(nextIndent) && nextIndent <= previousIndent
      ? normalizeOrderedAncestorPath(oldPath.slice(0, nextIndent))
      : null;
  if (
    rebased.attrs ||
    (original.attrs.semloEditorOrderedAncestorPath != null && JSON.stringify(oldPath) !== JSON.stringify(nextPath))
  )
    tr.setNodeMarkup(mapped.pos, undefined, {
      ...list.attrs,
      ...rebased.attrs,
      ...(original.attrs.semloEditorOrderedAncestorPath != null ? { semloEditorOrderedAncestorPath: nextPath } : {}),
    });
  return true;
}

/** Select a flat parent and its consecutive descendants without flattening rich blocks. */
export function listGroupTextRange(state: EditorState, target: Target): { from: number; to: number } | null {
  if (target.kind !== "item" || target.parentPos !== target.rootPos || state.doc.nodeAt(target.pos) !== target.node)
    return null;
  const list = state.doc.nodeAt(target.parentPos);
  if (!list || !isFlatList(list)) return null;
  const start = state.doc.resolve(target.pos).index(),
    level = Number(target.node.attrs.semloEditorListIndent ?? 0);
  let end = start + 1,
    size = target.node.nodeSize;
  while (end < list.childCount && Number(list.child(end).attrs.semloEditorListIndent ?? 0) > level) {
    size += list.child(end).nodeSize;
    end++;
  }
  for (let i = start; i < end; i++) {
    const item = list.child(i);
    if (item.childCount !== 1 || item.firstChild?.type.name !== "paragraph") return null;
  }
  return { from: target.pos + 2, to: target.pos + size - 2 };
}

function hasUnsupportedAttributes(node: ProseMirrorNode, allowed: ReadonlySet<string>): boolean {
  return Object.entries(node.attrs).some(([name, value]) => {
    if (allowed.has(name)) return false;
    const specification = node.type.spec.attrs?.[name];
    return !specification || !Object.is(value, specification.default);
  });
}

/** Convert verified ordered-list markers to code without dropping unsupported content. */
export function listGroupCodePlan(
  state: EditorState,
  target: Target,
): { from: number; to: number; content: Fragment; selection: number } | null {
  if (!listGroupTextRange(state, target)) return null;
  const list = state.doc.nodeAt(target.parentPos),
    code = state.schema.nodes.codeBlock;
  if (
    !list ||
    list.type.name !== "orderedList" ||
    !code ||
    list.attrs.type ||
    hasUnsupportedAttributes(
      list,
      new Set([
        "start",
        "type",
        "semloEditorOrderedStyle",
        "semloEditorListLevelStarts",
        "semloEditorOrderedAncestorPath",
      ]),
    )
  )
    return null;
  const style = list.attrs.semloEditorOrderedStyle;
  if (style != null && style !== "decimal" && style !== "mixed" && style !== "chinese") return null;
  const children: ProseMirrorNode[] = [];
  list.forEach((child) => children.push(child));
  const start = state.doc.resolve(target.pos).index(),
    level = Number(target.node.attrs.semloEditorListIndent ?? 0);
  if (level !== 0) return null;
  let end = start + 1;
  while (end < children.length && Number(children[end].attrs.semloEditorListIndent ?? 0) > level) end++;
  // Removing a restarted item may transfer its numbering boundary to a later sibling.
  if (target.node.attrs.semloEditorListRestart === true && end < children.length) return null;
  const labels = orderedListLabels(state.doc),
    values = deriveOrderedListValues(
      children.map((child) => child.attrs.semloEditorListIndent),
      list.attrs.start,
      list.attrs.semloEditorListLevelStarts,
      children.map((child) => child.attrs.semloEditorListRestart),
    ),
    lines: string[] = [];
  let pos = target.pos;
  for (const [offset, item] of children.slice(start, end).entries()) {
    const paragraph = item.firstChild!;
    if (
      hasUnsupportedAttributes(
        item,
        new Set(["semloEditorListIndent", "semloEditorListFolded", "semloEditorListRestart"]),
      ) ||
      hasUnsupportedAttributes(paragraph, new Set())
    )
      return null;
    if (
      paragraph.content.content.some(
        (child) => !child.isText || child.marks.some((mark) => !["bold", "italic"].includes(mark.type.name)),
      )
    )
      return null;
    const indent = Number(item.attrs.semloEditorListIndent ?? 0);
    if (!Number.isInteger(indent) || indent < 0 || indent > 8) return null;
    let label = labels.get(pos);
    if (style === "chinese" && indent > 1) return null;
    if (style !== "decimal" && style !== "chinese") {
      const value = values[start + offset];
      if (indent > 1 || value < 1) return null;
      if (indent === 0) label = `${value}.`;
      else {
        let number = value,
          letters = "";
        while (number > 0) {
          number--;
          letters = String.fromCharCode(97 + (number % 26)) + letters;
          number = Math.floor(number / 26);
        }
        label = `${letters}.`;
      }
    }
    if (!label) return null;
    lines.push(
      end === start + 1 && style == null
        ? paragraph.textContent
        : `${"  ".repeat(indent)}${label} ${paragraph.textContent}`,
    );
    pos += item.nodeSize;
  }
  const text = lines.join("\n");
  const codeContent = text ? Fragment.from(state.schema.text(text)) : Fragment.empty;
  if (!code.validContent(codeContent)) return null;
  const codeNode = code.create(null, codeContent);
  const before = children.slice(0, start),
    after = children.slice(end);
  const beforeNode = before.length ? list.type.create(list.attrs, before, list.marks) : null;
  const retained = [...before, ...after];
  const retainedList = retained.length ? list.type.create(list.attrs, retained, list.marks) : null;
  const afterNode =
    after.length && retainedList
      ? list.type.create(orderedListSuffixAttrs(retainedList, retained, before.length), after, list.marks)
      : null;
  const content = Fragment.fromArray([
    ...(beforeNode ? [beforeNode] : []),
    codeNode,
    ...(afterNode ? [afterNode] : []),
  ]);
  const $list = state.doc.resolve(target.parentPos);
  if (!$list.parent.canReplace($list.index(), $list.index() + 1, content)) return null;
  return {
    from: target.parentPos,
    to: target.parentPos + list.nodeSize,
    content,
    selection: target.parentPos + (beforeNode?.nodeSize ?? 0) + 1,
  };
}

/** Convert only when the target schema can retain all inline content and attributes. */
function retype(node: ProseMirrorNode, type: NodeType, attrs: Record<string, unknown> = {}): ProseMirrorNode | null {
  if (!type.validContent(node.content)) return null;
  const result = type.create({ ...node.attrs, ...attrs }, node.content, node.marks);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (name === "level" || name in result.attrs) continue;
    if (value !== null && value !== undefined && value !== false && value !== 0 && value !== "") return null;
  }
  return result;
}

export function replacement(state: EditorState, target: Target, conversion: Conversion): ProseMirrorNode | null {
  const { schema } = state,
    node = state.doc.nodeAt(target.pos);
  if (!node || target.kind !== "block" || !["paragraph", "heading"].includes(node.type.name)) return null;
  const paragraph = schema.nodes.paragraph && retype(node, schema.nodes.paragraph);
  if (conversion.type === "paragraph") return paragraph;
  if (conversion.type === "heading")
    return schema.nodes.heading ? retype(node, schema.nodes.heading, { level: conversion.level }) : null;
  if (conversion.type === "codeBlock") return schema.nodes.codeBlock ? retype(node, schema.nodes.codeBlock) : null;
  if (conversion.type === "blockquote" || conversion.type === "callout") {
    const wrapper = schema.nodes[conversion.type];
    return wrapper?.validContent(Fragment.from(node)) ? wrapper.create(null, node) : null;
  }
  if (conversion.type === "bulletList" || conversion.type === "orderedList" || conversion.type === "taskList") {
    const list = schema.nodes[conversion.type],
      item = schema.nodes[conversion.type === "taskList" ? "taskItem" : "listItem"];
    if (!paragraph || !list || !item || !item.validContent(Fragment.from(paragraph))) return null;
    const child = item.create(null, paragraph);
    return list.validContent(Fragment.from(child)) ? list.create(null, child) : null;
  }
  if (conversion.type === "semloEditorColumns") {
    const columns = schema.nodes.semloEditorColumns,
      column = schema.nodes.semloEditorColumn;
    const empty = schema.nodes.paragraph?.createAndFill();
    if (!columns || !column || !empty || !column.validContent(Fragment.from(node))) return null;
    const children = Fragment.fromArray([column.create(null, node), column.create(null, empty)]);
    return columns.validContent(children) ? columns.create(null, children) : null;
  }
  if (conversion.type === "details") {
    const details = schema.nodes.details,
      summary = schema.nodes.detailsSummary,
      content = schema.nodes.detailsContent;
    const empty = schema.nodes.paragraph?.createAndFill();
    if (!details || !summary || !content || !empty || !summary.validContent(node.content)) return null;
    // Summary has different block attributes. Do not discard meaningful ones.
    const title = retype(node, summary);
    if (!title) return null;
    const children = Fragment.fromArray([title, content.create(null, empty)]);
    return details.validContent(children) ? details.create({ open: true }, children) : null;
  }
  return null;
}

/** Wrap one flat list item while keeping its list type and content. */
export function listItemWrapper(
  state: EditorState,
  target: Target,
  wrapperType: "blockquote" | "callout" | "semloEditorColumns" | "details",
): { from: number; to: number; content: Fragment; selection: number } | null {
  if (target.kind !== "item" || target.parentPos !== target.rootPos || state.doc.nodeAt(target.pos) !== target.node)
    return null;
  const list = state.doc.nodeAt(target.parentPos);
  const wrapper = state.schema.nodes[wrapperType];
  if (!list || !listNodes.has(list.type.name) || !wrapper || !isFlatList(list)) return null;
  // Wrapping splits a list into independently numbered fragments. Their
  // continuation modes are not yet established for a continued first item.
  const index = state.doc.resolve(target.pos).index();
  if (list.type.name === "orderedList" && list.attrs.semloEditorListFirstContinue === true) {
    const observed =
      list.attrs.semloEditorListQuoteChain == null &&
      wrapperType === "blockquote" &&
      index > 0 &&
      index < list.childCount - 1 &&
      (list.attrs.semloEditorOrderedStyle == null || list.attrs.semloEditorOrderedStyle === "mixed") &&
      Number(list.attrs.start ?? 1) === 1 &&
      list.attrs.semloEditorListLevelStarts == null &&
      list.attrs.semloEditorOrderedAncestorPath == null &&
      Array.from({ length: list.childCount }, (_, i) => list.child(i)).every(
        (child) => Number(child.attrs.semloEditorListIndent ?? 0) === 0 && child.attrs.semloEditorListRestart !== true,
      );
    if (!observed) return null;
  }
  const children: ProseMirrorNode[] = [];
  list.forEach((child) => children.push(child));
  const item = children[index];
  if (item !== target.node) return null;
  let end = index + 1;
  const level = Number(item.attrs.semloEditorListIndent ?? 0);
  while (end < children.length && Number(children[end].attrs.semloEditorListIndent ?? 0) > level) end++;
  const selected = Fragment.fromArray(children.slice(index, end));
  if (!list.type.validContent(selected)) return null;
  const attrsAt = (offset: number) =>
    list.type.name === "orderedList" ? orderedListSuffixAttrs(list, children, offset) : list.attrs;
  const needsQuoteChain =
    list.type.name === "orderedList" &&
    list.attrs.semloEditorListFirstContinue === true &&
    wrapperType === "blockquote";
  if (needsQuoteChain && typeof globalThis.crypto?.randomUUID !== "function") return null;
  const quoteChain = needsQuoteChain ? globalThis.crypto.randomUUID() : null;
  const innerAttrs = attrsAt(index);
  const inner = list.type.create(
    quoteChain ? { ...innerAttrs, semloEditorListQuoteChain: quoteChain } : innerAttrs,
    selected,
    list.marks,
  );
  const before = children.slice(0, index);
  const after = children.slice(end);
  const beforeList = before.length
    ? list.type.create(
        quoteChain ? { ...list.attrs, semloEditorListQuoteChain: quoteChain } : list.attrs,
        before,
        list.marks,
      )
    : null;
  let wrapped: ProseMirrorNode;
  if (wrapperType === "semloEditorColumns") {
    const column = state.schema.nodes.semloEditorColumn;
    const empty = state.schema.nodes.paragraph?.createAndFill();
    if (!column || !empty || !column.validContent(Fragment.from(inner))) return null;
    const columns = Fragment.fromArray([column.create(null, inner), column.create(null, empty)]);
    if (!wrapper.validContent(columns)) return null;
    wrapped = wrapper.create(null, columns);
  } else if (wrapperType === "details") {
    const summary = state.schema.nodes.detailsSummary?.createAndFill();
    const bodyType = state.schema.nodes.detailsContent;
    if (!summary || !bodyType || !bodyType.validContent(Fragment.from(inner))) return null;
    const children = Fragment.fromArray([summary, bodyType.create(null, inner)]);
    if (!wrapper.validContent(children)) return null;
    wrapped = wrapper.create({ open: true }, children);
  } else {
    if (!wrapper.validContent(Fragment.from(inner))) return null;
    wrapped = wrapper.create(null, inner);
  }
  const nodes = [
    ...(beforeList ? [beforeList] : []),
    wrapped,
    ...(after.length
      ? [
          list.type.create(
            quoteChain ? { ...attrsAt(end), semloEditorListQuoteChain: quoteChain } : attrsAt(end),
            after,
            list.marks,
          ),
        ]
      : []),
  ];
  const content = Fragment.fromArray(nodes);
  const resolved = state.doc.resolve(target.parentPos);
  if (!resolved.parent.canReplace(resolved.index(), resolved.index() + 1, content)) return null;
  return {
    from: target.parentPos,
    to: target.parentPos + list.nodeSize,
    content,
    selection:
      target.parentPos +
      (beforeList?.nodeSize ?? 0) +
      (wrapperType === "semloEditorColumns" ? 5 : wrapperType === "details" ? 2 : 4),
  };
}

/** Remove a simple linked quote and reunite its continued list fragments. */
export function linkedQuoteUnwrap(
  state: EditorState,
  target: Target,
): { from: number; to: number; node: ProseMirrorNode; selection: number } | null {
  if (target.kind !== "block" || target.node.type.name !== "blockquote" || target.node.childCount !== 1) return null;
  try {
    if (!target.node.type.create(null, target.node.content).sameMarkup(target.node)) return null;
  } catch {
    return null;
  }
  const inner = target.node.firstChild;
  const quotePos = target.pos;
  const previous = state.doc.resolve(quotePos).nodeBefore;
  const afterPos = quotePos + target.node.nodeSize;
  const after = state.doc.resolve(afterPos).nodeAfter;
  const chain = inner?.attrs.semloEditorListQuoteChain;
  if (
    !inner ||
    inner.type.name !== "orderedList" ||
    typeof chain !== "string" ||
    !chain ||
    !previous ||
    !after ||
    previous.type !== inner.type ||
    after.type !== inner.type ||
    previous.attrs.semloEditorListQuoteChain !== chain ||
    after.attrs.semloEditorListQuoteChain !== chain ||
    inner.attrs.semloEditorListFirstContinue !== true ||
    after.attrs.semloEditorListFirstContinue !== true ||
    inner.childCount !== 1 ||
    !isFlatList(previous) ||
    !isFlatList(inner) ||
    !isFlatList(after)
  )
    return null;
  const simple = (node: ProseMirrorNode) =>
    (node.attrs.semloEditorOrderedStyle == null || node.attrs.semloEditorOrderedStyle === "mixed") &&
    node.attrs.semloEditorListLevelStarts == null &&
    node.attrs.semloEditorOrderedAncestorPath == null &&
    Array.from({ length: node.childCount }, (_, i) => node.child(i)).every(
      (item) => Number(item.attrs.semloEditorListIndent ?? 0) === 0 && item.attrs.semloEditorListRestart !== true,
    );
  if (
    !simple(previous) ||
    !simple(inner) ||
    !simple(after) ||
    Number(inner.attrs.start) !== Number(previous.attrs.start) + previous.childCount ||
    Number(after.attrs.start) !== Number(inner.attrs.start) + 1
  )
    return null;
  const compatible = (node: ProseMirrorNode) =>
    previous.type
      .create(
        { ...previous.attrs, start: node.attrs.start, semloEditorListFirstContinue: true },
        node.content,
        previous.marks,
      )
      .sameMarkup(node);
  if (!compatible(inner) || !compatible(after)) return null;
  const content = previous.content.append(inner.content).append(after.content);
  if (!previous.type.validContent(content)) return null;
  const merged = previous.type.create({ ...previous.attrs, semloEditorListQuoteChain: null }, content, previous.marks);
  const from = quotePos - previous.nodeSize;
  const resolved = state.doc.resolve(from);
  if (!resolved.parent.canReplace(resolved.index(), resolved.index() + 3, Fragment.from(merged))) return null;
  return { from, to: afterPos + after.nodeSize, node: merged, selection: from + previous.content.size + 3 };
}

export const conversions: Conversion[] = [
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({ label: `标题 ${level}`, type: "heading", level })),
  { label: "正文", type: "paragraph" },
  { label: "无序列表", type: "bulletList" },
  { label: "有序列表", type: "orderedList" },
  { label: "待办事项", type: "taskList" },
  { label: "代码块", type: "codeBlock" },
  { label: "高亮块", type: "callout" },
  { label: "引用", type: "blockquote" },
  { label: "分栏", type: "semloEditorColumns" },
  { label: "折叠块", type: "details" },
];

export function removal(
  state: EditorState,
  target: Target,
): { from: number; to: number; replaceWithParagraph: boolean } | null {
  const current = state.doc.nodeAt(target.pos);
  if (!current || current !== target.node) return null;
  const resolved = state.doc.resolve(target.pos);
  let from = target.pos,
    to = target.pos + current.nodeSize;
  for (let depth = resolved.depth; depth >= 0; depth--) {
    const parent = resolved.node(depth),
      index = resolved.index(depth);
    if (parent.canReplace(index, index + 1)) return { from, to, replaceWithParagraph: false };
    if (depth === 0)
      return state.schema.nodes.paragraph?.createAndFill() ? { from, to, replaceWithParagraph: true } : null;
    from = resolved.before(depth);
    to = resolved.after(depth);
  }
  return null;
}

export function deleteTarget(editor: Editor, target: Target): boolean {
  if (
    target.pos < 0 ||
    target.pos > editor.state.doc.content.size ||
    editor.state.doc.nodeAt(target.pos) !== target.node
  )
    return false;
  const parent = target.kind === "item" ? editor.state.doc.resolve(target.pos).parent : null;
  if (parent?.type.name === "orderedList" && parent.attrs.semloEditorListFirstContinue === true) {
    let flat = isFlatList(parent);
    parent.forEach((item) => {
      if (Number(item.attrs.semloEditorListIndent ?? 0) !== 0) flat = false;
    });
    // The continuation mode's migration after deleting an indented group has
    // not yet been established against the reference editor.
    if (!flat) return false;
  }
  let restartSuccessor: number | null = null;
  if (parent?.type.name === "orderedList" && listHasRestarts(parent)) {
    const index = editor.state.doc.resolve(target.pos).index();
    const next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
    let simple = true;
    parent.forEach((item) => {
      const level = Number(item.attrs.semloEditorListIndent ?? 0);
      if (
        !Number.isInteger(level) ||
        level < 0 ||
        level > 2 ||
        item.childCount !== 1 ||
        item.firstChild?.type.name !== "paragraph"
      )
        simple = false;
    });
    let directChildren = true;
    let twoParentShape = parent.childCount === 4 || parent.childCount === 5;
    let restartCount = 0;
    let restartIndex = -1;
    parent.forEach((item, _offset, itemIndex) => {
      const indent = Number(item.attrs.semloEditorListIndent ?? 0);
      if (indent !== (itemIndex === 0 ? 0 : 1)) directChildren = false;
      if (indent !== (itemIndex === 0 || itemIndex === 2 ? 0 : 1)) twoParentShape = false;
      if (item.attrs.semloEditorListRestart === true) {
        restartCount++;
        restartIndex = itemIndex;
      }
    });
    const lastDirectRestart =
      index >= 2 && index === parent.childCount - 1 && (directChildren || twoParentShape) && restartCount === 1;
    const directBeforeLastRestart =
      ((index === 1 && parent.childCount === 3 && directChildren) ||
        (index === 3 && parent.childCount === 5 && twoParentShape)) &&
      restartCount === 1 &&
      target.node.attrs.semloEditorListRestart !== true &&
      next?.attrs.semloEditorListRestart === true;
    const lastOrdinaryAfterRestart =
      directChildren &&
      index === parent.childCount - 1 &&
      restartCount === 1 &&
      restartIndex >= 2 &&
      restartIndex < index &&
      target.node.attrs.semloEditorListRestart !== true;
    if (
      !isFlatList(parent) ||
      !simple ||
      parent.attrs.semloEditorOrderedStyle !== "decimal" ||
      Number(parent.attrs.start ?? 1) !== 1 ||
      parent.attrs.semloEditorListLevelStarts != null ||
      parent.attrs.semloEditorOrderedAncestorPath != null ||
      ![1, 2].includes(Number(target.node.attrs.semloEditorListIndent ?? 0)) ||
      (!directBeforeLastRestart &&
        !lastOrdinaryAfterRestart &&
        (target.node.attrs.semloEditorListRestart !== true ||
          (!lastDirectRestart &&
            (!next ||
              Number(next.attrs.semloEditorListIndent ?? 0) !== Number(target.node.attrs.semloEditorListIndent ?? 0)))))
    )
      return false;
    if (!lastDirectRestart && !directBeforeLastRestart && !lastOrdinaryAfterRestart)
      restartSuccessor = target.pos + target.node.nodeSize;
  }
  if (editor.isDestroyed || !editor.isEditable) return false;
  let range = removal(editor.state, target);
  if (!range) return false;
  let removedItemSize = target.node.nodeSize;
  if (target.kind === "item" && target.parentPos === target.rootPos) {
    const list = editor.state.doc.nodeAt(target.parentPos);
    const start = editor.state.doc.resolve(target.pos).index();
    if (list && isFlatList(list)) {
      const level = Number(target.node.attrs.semloEditorListIndent ?? 0);
      let count = 1;
      for (let index = start + 1; index < list.childCount; index++) {
        const child = list.child(index);
        if (Number(child.attrs.semloEditorListIndent ?? 0) <= level) break;
        removedItemSize += child.nodeSize;
        count++;
      }
      if (count > 1) {
        if (count === list.childCount) {
          const $list = editor.state.doc.resolve(target.parentPos);
          range = {
            from: target.parentPos,
            to: target.parentPos + list.nodeSize,
            replaceWithParagraph: !$list.parent.canReplace($list.index(), $list.index() + 1),
          };
        } else range = { from: target.pos, to: target.pos + removedItemSize, replaceWithParagraph: false };
      }
    }
  }
  let tr = editor.state.tr;
  if (range.replaceWithParagraph) {
    const empty = editor.schema.nodes.paragraph.createAndFill();
    if (!empty) return false;
    tr = tr.replaceWith(range.from, range.to, empty);
  } else tr = tr.deleteRange(range.from, range.to);
  if (restartSuccessor !== null) {
    const position = tr.mapping.map(restartSuccessor, 1);
    const item = tr.doc.nodeAt(position);
    if (!item || item.type.name !== "listItem") return false;
    tr.setNodeMarkup(position, undefined, { ...item.attrs, semloEditorListRestart: true });
  }
  if (target.kind === "item" && target.parentPos === target.rootPos) {
    const list = editor.state.doc.nodeAt(target.parentPos);
    const position = editor.state.doc.resolve(target.pos);
    if (
      list?.type.name === "orderedList" &&
      (list.attrs.semloEditorListLevelStarts != null || list.attrs.semloEditorOrderedAncestorPath != null) &&
      list.content.size > removedItemSize &&
      position.index() === 0 &&
      !rebaseOrderedListAfterChange(tr, list, target.parentPos, list.content.cut(removedItemSize))
    )
      return false;
  }
  tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(range.from, tr.doc.content.size)), 1)).scrollIntoView();
  dispatchChange(editor, tr);
  if (!editor.isDestroyed) editor.view.focus();
  return true;
}

export function clipboardContents(editor: Editor, target: Target): { html: string; text: string } | null {
  if (editor.state.doc.nodeAt(target.pos) !== target.node) return null;
  const doc = editor.view.dom.ownerDocument;
  let node = target.node;
  if (target.kind === "item") {
    const resolved = editor.state.doc.resolve(target.pos),
      parent = resolved.parent;
    if (!listNodes.has(parent.type.name)) return null;
    const children: ProseMirrorNode[] = [node];
    if (target.parentPos === target.rootPos && isFlatList(parent)) {
      const level = Number(node.attrs.semloEditorListIndent ?? 0);
      for (let index = resolved.index() + 1; index < parent.childCount; index++) {
        const child = parent.child(index);
        if (Number(child.attrs.semloEditorListIndent ?? 0) <= level) break;
        children.push(child);
      }
    }
    const fragment = Fragment.fromArray(children);
    if (!parent.type.validContent(fragment)) return null;
    // A copied subset becomes a separate ordered list. Its continuation mode
    // is unknown when the source uses the first-item continuation state.
    if (
      parent.type.name === "orderedList" &&
      parent.attrs.semloEditorListFirstContinue === true &&
      children.length !== parent.childCount
    )
      return null;
    const all: ProseMirrorNode[] = [];
    parent.forEach((child) => all.push(child));
    const attrs =
      parent.type.name === "orderedList" ? orderedListSuffixAttrs(parent, all, resolved.index()) : parent.attrs;
    node = parent.type.create(attrs, fragment, parent.marks);
  }
  const wrapper = doc.createElement("div");
  wrapper.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(Fragment.from(node), { document: doc }));
  const text =
    node.textBetween(0, node.content.size, "\n", "") ||
    String(target.node.attrs.alt ?? target.node.attrs.title ?? target.node.attrs.name ?? "");
  return { html: wrapper.innerHTML, text };
}

export async function writeClipboard(
  doc: Document,
  contents: { html: string; text: string },
): Promise<"rich" | "plain" | "failed"> {
  const win = doc.defaultView,
    clipboard = win?.navigator.clipboard;
  if (!win || !clipboard) return "failed";
  try {
    if (clipboard.write && win.ClipboardItem) {
      const item = new win.ClipboardItem({
        "text/html": new win.Blob([contents.html], { type: "text/html" }),
        "text/plain": new win.Blob([contents.text], { type: "text/plain" }),
      });
      await clipboard.write([item]);
      return "rich";
    }
  } catch {
    /* Some browsers allow only the plain-text clipboard method. */
  }
  try {
    if (clipboard.writeText) {
      await clipboard.writeText(contents.text);
      return "plain";
    }
  } catch {
    /* Permission denied. */
  }
  return "failed";
}
