import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

import { ContentValidationError } from "../../shared/content-error";
import { parseSequenceConversionHint, sequenceConversionHintAttribute } from "./numbering-sequence-conversion-hint";
import { resolveNumberingSequences, type NumberingSequenceInput } from "./numbering-sequences";

export const sequenceRegistryAttribute = "semloEditorListSequences";
export const sequenceMemberAttribute = "semloEditorListSequence";
export const sequenceRegistryHTMLAttribute = "data-semlo-editor-list-sequences";
export const sequenceMemberHTMLAttribute = "data-semlo-editor-list-sequence";
export const sequenceLinkAttribute = "semloEditorListSequenceLink";
export const sequenceLinkHTMLAttribute = "data-semlo-editor-list-sequence-link";

export type SequenceLink = { version: 1 | 2 | 3; previous: string | null; next: string | null };

/** 每条关联只连接相邻两段；缺省字段不改变旧内容的输出。 */
export function parseSequenceLink(value: unknown): SequenceLink | null {
  if (typeof value !== "string") return null;
  const matched = /^v([123]):([A-Za-z0-9-]{1,64}|_):([A-Za-z0-9-]{1,64}|_)$/.exec(value);
  if (!matched) return null;
  const previous = matched[2] === "_" ? null : matched[2];
  const next = matched[3] === "_" ? null : matched[3];
  const version = matched[1] === "1" ? 1 : matched[1] === "2" ? 2 : 3;
  return (!previous && !next) || (previous && previous === next) ? null : { version, previous, next };
}

export function formatSequenceLink(
  previous: string | null,
  next: string | null,
  version: 1 | 2 | 3 = 1,
): string | null {
  return previous || next ? `v${version}:${previous ?? "_"}:${next ?? "_"}` : null;
}

export function hasNumberingSequences(node: ProseMirrorNode): boolean {
  if (node.type.name !== "orderedList") return false;
  if (node.attrs[sequenceRegistryAttribute] != null) return true;
  let member = false;
  node.forEach((item) => {
    if (item.attrs[sequenceMemberAttribute] != null) member = true;
  });
  return member;
}

export function numberingSequenceInput(list: ProseMirrorNode, resetStart = false): NumberingSequenceInput {
  const items: NumberingSequenceInput["items"][number][] = [];
  list.forEach((item) => {
    items.push({
      level: item.attrs.semloEditorListIndent ?? 0,
      restart: item.attrs.semloEditorListRestart,
      sequenceId: item.attrs[sequenceMemberAttribute],
      leaf: item.type.name === "listItem" && item.childCount === 1 && item.firstChild?.type.name === "paragraph",
    });
  });
  return {
    items,
    start: resetStart ? 1 : list.attrs.start,
    levelStarts: list.attrs.semloEditorListLevelStarts,
    registry: list.attrs[sequenceRegistryAttribute],
  };
}

export function resolveListNumbering(list: ProseMirrorNode, resetStart = false) {
  return resolveNumberingSequences(numberingSequenceInput(list, resetStart));
}

export function sequenceListValues(list: ProseMirrorNode, resetStart = false): number[] {
  const result = resolveListNumbering(list, resetStart);
  if (!result.ok) throw new ContentValidationError(`编号序列无效：${result.reason}`);
  return result.value.values;
}

/** 关系必须在整个物理列表中检查，单个属性的 schema 校验不足以保证归属。 */
export function assertNumberingSequenceDocument(root: ProseMirrorNode): void {
  const previous = new Set<string>(),
    next = new Set<string>();
  root.descendants((node, pos, parent) => {
    const conversion = node.attrs[sequenceConversionHintAttribute];
    if (conversion != null) {
      const parentList = parent && ["listItem", "taskItem"].includes(parent.type.name) ? root.resolve(pos) : null;
      const parentListType =
        parentList && parentList.depth > 1 ? parentList.node(parentList.depth - 1).type.name : null;
      const textblockConversion =
        ((node.type.name === "paragraph" || node.type.name === "heading") && parent === root) ||
        (node.type.name === "paragraph" &&
          ((parent?.type.name === "listItem" && parentListType === "bulletList") ||
            (parent?.type.name === "taskItem" && parentListType === "taskList")));
      if (
        !parseSequenceConversionHint(conversion) ||
        !(
          textblockConversion ||
          (node.type.name === "listItem" && parent?.type.name === "bulletList") ||
          (node.type.name === "taskItem" && parent?.type.name === "taskList")
        )
      )
        throw new ContentValidationError("编号序列转换标识无效");
    }
    const linkValue = node.attrs[sequenceLinkAttribute];
    if (linkValue != null) {
      const link = parseSequenceLink(linkValue);
      if (!link || node.type.name !== "orderedList" || parent !== root || !hasNumberingSequences(node))
        throw new ContentValidationError("编号序列关联无效");
      if ((link.previous && previous.has(link.previous)) || (link.next && next.has(link.next)))
        throw new ContentValidationError("编号序列关联重复");
      if (link.previous) previous.add(link.previous);
      if (link.next) next.add(link.next);
    }
    if (
      node.type.name === "listItem" &&
      node.attrs[sequenceMemberAttribute] != null &&
      parent?.type.name !== "orderedList"
    )
      throw new ContentValidationError("编号序列成员必须位于有序列表中");
    if (!hasNumberingSequences(node)) return true;
    if (
      node.attrs.semloEditorListQuoteChain != null ||
      node.attrs.semloEditorListTaskChain != null ||
      node.attrs.semloEditorListFirstContinue === true
    )
      throw new ContentValidationError("编号序列暂不与旧片段继续编号同时使用");
    const result = resolveListNumbering(node);
    if (!result.ok || result.value.kind !== "v1")
      throw new ContentValidationError(`编号序列无效：${result.ok ? "missing-registry" : result.reason}`);
    return true;
  });
}

export function sequenceLists(root: ProseMirrorNode): Array<{ node: ProseMirrorNode; pos: number }> {
  const lists: Array<{ node: ProseMirrorNode; pos: number }> = [];
  root.descendants((node, pos) => {
    if (hasNumberingSequences(node)) lists.push({ node, pos });
    return !node.isTextblock;
  });
  return lists;
}

export function selectionHasNumberingSequences(
  state: EditorState,
  from = state.selection.from,
  to = state.selection.to,
): boolean {
  for (const position of [from, to]) {
    const resolved = state.doc.resolve(position);
    for (let depth = resolved.depth; depth > 0; depth--) if (hasNumberingSequences(resolved.node(depth))) return true;
  }
  let found = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (hasNumberingSequences(node)) found = true;
    return !found;
  });
  return found;
}

export function parseSequenceRegistryAttribute(element: HTMLElement): unknown {
  const raw = element.getAttribute(sequenceRegistryHTMLAttribute);
  if (raw === null) return null;
  if (raw.length > 2_097_152) return { invalid: "capacity" };
  try {
    const value: unknown = JSON.parse(raw);
    return value === null ? { invalid: "null" } : value;
  } catch {
    // 保留为不可接受值，让载入失败，不能把损坏的结构当成缺省旧列表。
    return { invalid: "json" };
  }
}

export function sequenceLeaf(list: ProseMirrorNode, index: number): boolean {
  const item = list.maybeChild(index);
  return (
    !!item &&
    item.childCount === 1 &&
    item.firstChild?.type.name === "paragraph" &&
    (index + 1 === list.childCount ||
      Number(list.child(index + 1).attrs.semloEditorListIndent ?? 0) <= Number(item.attrs.semloEditorListIndent ?? 0))
  );
}

/** 检查可无损转换的根级平铺范围或末尾直接子项。 */
export function sequenceConvertible(list: ProseMirrorNode, first: number, last = first): boolean {
  const linkValue = list.attrs[sequenceLinkAttribute];
  const link = parseSequenceLink(linkValue);
  if (
    !hasNumberingSequences(list) ||
    (linkValue != null && !link) ||
    (list.childCount < 2 && !link) ||
    first < 0 ||
    last < first ||
    last >= list.childCount
  )
    return false;
  for (let index = first; index <= last; index++) if (!sequenceLeaf(list, index)) return false;
  let flat = true;
  list.forEach((item) => {
    if (Number(item.attrs.semloEditorListIndent ?? 0) !== 0) flat = false;
    item.descendants((node) => {
      if (["bulletList", "orderedList", "taskList"].includes(node.type.name)) flat = false;
      return flat && !node.isTextblock;
    });
  });
  if (link) {
    const resolved = resolveListNumbering(list);
    if (!flat || !resolved.ok || resolved.value.kind !== "v1") return false;
    const ids = resolved.value.sequenceIds;
    // 跨序列时需要前后两段共同承载转换标识；链两端整段仍不能推断归属。
    if (ids.some((id) => id !== ids[first]) && (first === 0 || last === list.childCount - 1)) return false;
  }
  if (!flat) {
    // 所测末尾子项之后没有需要重新归属的成员，前一个同层项保留其序列。
    const previous = list.maybeChild(last - 1);
    const selected = list.child(last);
    const resolved = resolveListNumbering(list);
    let simple = true;
    list.forEach((item) => {
      const indent = Number(item.attrs.semloEditorListIndent ?? 0);
      if ((indent !== 0 && indent !== 1) || item.childCount !== 1 || item.firstChild?.type.name !== "paragraph")
        simple = false;
    });
    return (
      first === last &&
      last === list.childCount - 1 &&
      last >= 2 &&
      simple &&
      (list.attrs.semloEditorOrderedStyle == null || list.attrs.semloEditorOrderedStyle === "mixed") &&
      Number(selected.attrs.semloEditorListIndent ?? 0) === 1 &&
      Number(previous?.attrs.semloEditorListIndent ?? 0) === 1 &&
      resolved.ok &&
      resolved.value.kind === "v1" &&
      resolved.value.sequenceIds[last] === resolved.value.sequenceIds[last - 1]
    );
  }
  if (flat && first > 0 && last < list.childCount - 1) {
    const resolved = resolveListNumbering(list);
    if (!resolved.ok || resolved.value.kind !== "v1") return false;
  }
  return flat;
}

export function sequenceConvertibleSelection(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return (
    $from.depth === 3 &&
    $to.depth === 3 &&
    $from.node(1) === $to.node(1) &&
    sequenceConvertible($from.node(1), $from.index(1), $to.index(1))
  );
}
