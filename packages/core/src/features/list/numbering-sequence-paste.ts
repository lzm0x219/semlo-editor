import { Fragment, type Node as ProseMirrorNode, type Slice } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

import { mixedRomanMarker } from "./mixed-roman";
import { canConvertSequenceChain, newSequenceLinkId } from "./numbering-sequence-continuation";
import {
  assertNumberingSequenceDocument,
  hasNumberingSequences,
  resolveListNumbering,
  sequenceLeaf,
  sequenceMemberAttribute,
  sequenceRegistryAttribute,
  sequenceLinkAttribute,
  parseSequenceLink,
  formatSequenceLink,
} from "./numbering-sequence-document";

export type NumberingSequencePastePlan =
  | { kind: "apply"; transaction: Transaction }
  | { kind: "reject"; reason: "target" | "source" | "format" | "numbering" };

function plainParagraph(node: ProseMirrorNode): boolean {
  if (node.type.name !== "paragraph") return false;
  let plain = true;
  node.forEach((child) => {
    if (!child.isText) plain = false;
  });
  return plain;
}

/** 多行纯文本在同父同层叶项范围拆出正文和独立列表，重新设置后半段各局部序列的起点。 */
export function planNumberingSequencePlainPaste(state: EditorState, slice: Slice): NumberingSequencePastePlan {
  const reject = (reason: "target" | "source" | "format" | "numbering"): NumberingSequencePastePlan => ({
    kind: "reject",
    reason,
  });
  try {
    const selection = state.selection;
    if (
      !(selection instanceof TextSelection) ||
      selection.$from.depth !== 3 ||
      selection.$to.depth !== 3 ||
      selection.$from.before(1) !== selection.$to.before(1)
    )
      return reject("target");
    const { $from, $to } = selection;
    const list = $from.node(1),
      index = $from.index(1),
      last = $to.index(1);
    if (list.type.name !== "orderedList" || !hasNumberingSequences(list) || !sequenceLeaf(list, index))
      return reject("target");
    const item = list.child(index),
      target = $from.parent,
      resolved = resolveListNumbering(list);
    if (!plainParagraph(target) || !resolved.ok || resolved.value.kind !== "v1") return reject("target");
    const level = item.attrs.semloEditorListIndent ?? 0;
    if (!Number.isInteger(level) || level < 0 || level > 8) return reject("target");
    for (let position = index; position <= last; position++) {
      const candidate = list.child(position);
      if (
        !sequenceLeaf(list, position) ||
        (candidate.attrs.semloEditorListIndent ?? 0) !== level ||
        !compatibleMarkup(candidate, item, projectedItemAttributes) ||
        !candidate.firstChild ||
        !plainParagraph(candidate.firstChild) ||
        !candidate.firstChild.sameMarkup(target)
      )
        return reject("target");
    }
    const paragraphs: ProseMirrorNode[] = [];
    slice.content.forEach((node) => paragraphs.push(node));
    if (
      paragraphs.length < 2 ||
      slice.openStart > 1 ||
      slice.openEnd > 1 ||
      paragraphs.some((node) => !plainParagraph(node))
    )
      return reject("source");
    const prefix = target.content.cut(0, $from.parentOffset);
    const suffix = $to.parent.content.cut($to.parentOffset);
    const leftItem = item.copy(Fragment.from(target.copy(prefix.append(paragraphs[0].content))));
    const rightItem = item.type.create(
      { ...item.attrs, semloEditorListRestart: false },
      target.copy(suffix),
      item.marks,
    );
    const starts = new Map<string, number>([[resolved.value.sequenceIds[index], resolved.value.values[index] + 1]]);
    const removed = new Map<string, number>();
    for (let position = index + 1; position <= last; position++) {
      const id = resolved.value.sequenceIds[position];
      removed.set(id, (removed.get(id) ?? 0) + 1);
    }
    // 其他序列被选中的成员已删除，后半段起点应扣除这些成员而非沿用删除前的序号。
    for (let position = last + 1; position < list.childCount; position++) {
      const id = resolved.value.sequenceIds[position];
      if (!starts.has(id)) starts.set(id, resolved.value.values[position] - (removed.get(id) ?? 0));
    }
    const registry = {
      version: 1,
      sequences: resolved.value.registry.sequences.map((sequence) => ({
        ...sequence,
        start: starts.get(sequence.id) ?? sequence.start,
      })),
    };
    const items: ProseMirrorNode[] = [];
    list.forEach((node) => items.push(node));
    if (!Object.hasOwn(list.type.spec.attrs ?? {}, sequenceLinkAttribute)) return reject("numbering");
    const link = parseSequenceLink(list.attrs[sequenceLinkAttribute]);
    // 保留整条已有链的版本；失效的跨类型关联不能借拆分推断或修复。
    if (link && link.version >= 2 && !canConvertSequenceChain(state.doc, $from.before(1))) return reject("numbering");
    const version = link?.version ?? 1;
    const edge = newSequenceLinkId(state.doc);
    const left = list.type.create(
      { ...list.attrs, [sequenceLinkAttribute]: formatSequenceLink(link?.previous ?? null, edge, version) },
      Fragment.fromArray([...items.slice(0, index), leftItem]),
      list.marks,
    );
    const right = list.type.create(
      {
        ...list.attrs,
        [sequenceRegistryAttribute]: registry,
        [sequenceLinkAttribute]: formatSequenceLink(edge, link?.next ?? null, version),
      },
      Fragment.fromArray([rightItem, ...items.slice(last + 1)]),
      list.marks,
    );
    const middle = paragraphs.slice(1);
    const listPos = $from.before(1);
    const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, Fragment.fromArray([left, ...middle, right]));
    const lastStart = listPos + left.nodeSize + middle.slice(0, -1).reduce((sum, node) => sum + node.nodeSize, 0);
    tr.setSelection(TextSelection.create(tr.doc, lastStart + 1 + middle[middle.length - 1].content.size));
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
    return { kind: "apply", transaction: tr };
  } catch {
    return reject("numbering");
  }
}

const nativeTypes: Readonly<Record<string, string>> = {
  "1": "decimal",
  a: "lower-alpha",
  A: "upper-alpha",
  i: "lower-roman",
  I: "upper-roman",
};
function effectiveStyle(list: ProseMirrorNode, level: number): string | null {
  const type = list.attrs.type;
  if (type != null && type !== "" && !Object.hasOwn(nativeTypes, String(type))) return null;
  const style = list.attrs.semloEditorOrderedStyle;
  // 多级数字样式与原生decimal marker有不同路径语义，不能因同名就允许互贴。
  if (style === "chinese" || style === "decimal") return `custom:${style}`;
  if (style != null && style !== "mixed") return null;
  if (type == null || type === "") return `mixed:${["decimal", "lower-alpha", mixedRomanMarker][level % 3]}`;
  return `mixed:${nativeTypes[String(type)]}`;
}

function independentSource(list: ProseMirrorNode): boolean {
  return (
    list.type.name === "orderedList" &&
    list.childCount >= 2 &&
    list.marks.length === 0 &&
    !hasNumberingSequences(list) &&
    list.attrs.start === 1 &&
    list.attrs.semloEditorListLevelStarts == null &&
    list.attrs.semloEditorOrderedAncestorPath == null &&
    list.attrs.semloEditorListQuoteChain == null &&
    list.attrs.semloEditorListTaskChain == null &&
    list.attrs[sequenceLinkAttribute] == null &&
    (list.attrs.semloEditorListFirstContinue == null || list.attrs.semloEditorListFirstContinue === false)
  );
}

function compatibleMarkup(source: ProseMirrorNode, target: ProseMirrorNode, projected: readonly string[]): boolean {
  const attrs = { ...source.attrs };
  // 只豁免普通片段已清理/规范化的内置字段；其余声明属性由sameMarkup深比较，不能丢弃宿主语义。
  for (const name of projected) attrs[name] = target.attrs[name];
  return source.type.create(attrs, source.content, source.marks).sameMarkup(target);
}
const projectedListAttributes = [
  "start",
  "type",
  "semloEditorOrderedStyle",
  "semloEditorListSequences",
  "semloEditorListLevelStarts",
  "semloEditorOrderedAncestorPath",
  "semloEditorListQuoteChain",
  "semloEditorListTaskChain",
  "semloEditorListFirstContinue",
  sequenceLinkAttribute,
] as const;
const projectedItemAttributes = [sequenceMemberAttribute, "semloEditorListRestart", "semloEditorListIndent"] as const;

/** 把闭合普通列表合入已支持的目标范围；不派发事务或恢复来源身份。 */
export function planNumberingSequencePaste(state: EditorState, slice: Slice): NumberingSequencePastePlan {
  const reject = (reason: "target" | "source" | "format" | "numbering"): NumberingSequencePastePlan => ({
    kind: "reject",
    reason,
  });
  try {
    const selection = state.selection;
    if (
      !(selection instanceof TextSelection) ||
      selection.$from.depth !== 3 ||
      selection.$to.depth !== 3 ||
      selection.$from.before(1) !== selection.$to.before(1)
    )
      return reject("target");
    const { $from, $to } = selection;
    const list = $from.node(1),
      index = $from.index(1),
      last = $to.index(1),
      item = list.child(index);
    const resolved = resolveListNumbering(list);
    if (
      !hasNumberingSequences(list) ||
      !resolved.ok ||
      resolved.value.kind !== "v1" ||
      list.type.name !== "orderedList" ||
      item.childCount !== 1 ||
      !plainParagraph($from.parent)
    )
      return reject("target");
    const level = item.attrs.semloEditorListIndent ?? 0;
    if (!Number.isInteger(level) || level < 0 || level > 8) return reject("target");
    // 已对照的跨层级范围从首个根项延伸到直接子项；剩余同序列子项归属最后一个新根项。
    const rootId = resolved.value.sequenceIds[0],
      childId = resolved.value.sequenceIds[1];
    const root = resolved.value.registry.sequences.find((entry) => entry.id === rootId),
      child = resolved.value.registry.sequences.find((entry) => entry.id === childId);
    let hasRemainingRoot = false;
    const tailPreservesScope = Array.from(
      { length: list.childCount - last - 1 },
      (_, offset) => last + 1 + offset,
    ).every((position) => {
      const candidate = list.child(position),
        candidateLevel = candidate.attrs.semloEditorListIndent ?? 0,
        candidateId = resolved.value.sequenceIds[position];
      if (candidate.attrs.semloEditorListRestart === true) return false;
      if (candidateLevel === 0 && candidateId === rootId) {
        hasRemainingRoot = true;
        return true;
      }
      return !hasRemainingRoot && candidateLevel === 1 && candidateId === childId && sequenceLeaf(list, position);
    });
    const crossLevel =
      index === 0 &&
      level === 0 &&
      last > index &&
      last + 1 < list.childCount &&
      list.attrs[sequenceLinkAttribute] == null &&
      rootId !== childId &&
      root?.origin === "initial" &&
      root.start === 1 &&
      child?.origin === "initial" &&
      child.start === 1 &&
      item.attrs.semloEditorListRestart !== true &&
      Array.from({ length: last }, (_, offset) => offset + 1).every(
        (position) =>
          (list.child(position).attrs.semloEditorListIndent ?? 0) === 1 &&
          list.child(position).attrs.semloEditorListRestart !== true &&
          resolved.value.sequenceIds[position] === childId,
      ) &&
      tailPreservesScope &&
      hasRemainingRoot;
    if (!sequenceLeaf(list, index) && !crossLevel) return reject("target");
    // 只保留首项身份前，先排除无法无损合并的宿主属性和非文本内容。
    for (let position = index; position <= last; position++) {
      const candidate = list.child(position);
      if (
        (!(crossLevel && position === index) && !sequenceLeaf(list, position)) ||
        (candidate.attrs.semloEditorListIndent ?? 0) !== (crossLevel && position > index ? 1 : level) ||
        !compatibleMarkup(candidate, item, projectedItemAttributes) ||
        !candidate.firstChild ||
        !plainParagraph(candidate.firstChild) ||
        !candidate.firstChild.sameMarkup($from.parent)
      )
        return reject("target");
    }
    const source = slice.content.firstChild;
    if (
      slice.openStart !== 0 ||
      slice.openEnd !== 0 ||
      slice.content.childCount !== 1 ||
      !source ||
      !independentSource(source)
    )
      return reject("source");
    const style = effectiveStyle(list, level);
    if (!style || effectiveStyle(source, level) !== style || !compatibleMarkup(source, list, projectedListAttributes))
      return reject("format");
    const paragraphs: ProseMirrorNode[] = [];
    let safe = true;
    source.forEach((child) => {
      const paragraph = child.firstChild;
      if (
        child.type !== item.type ||
        child.childCount !== 1 ||
        child.marks.length ||
        !compatibleMarkup(child, item, projectedItemAttributes) ||
        (child.attrs.semloEditorListIndent ?? 0) !== level ||
        child.attrs[sequenceMemberAttribute] != null ||
        (child.attrs.semloEditorListRestart != null && child.attrs.semloEditorListRestart !== false) ||
        !paragraph ||
        !plainParagraph(paragraph)
      )
        safe = false;
      else paragraphs.push(paragraph);
    });
    if (!safe) return reject("source");
    if (crossLevel && paragraphs.length !== 2) return reject("source");
    if (!paragraphs[0].sameMarkup($from.parent) || !paragraphs[paragraphs.length - 1].sameMarkup($from.parent))
      return reject("format");
    const prefix = $from.parent.content.cut(0, $from.parentOffset);
    const suffix = $to.parent.content.cut($to.parentOffset);
    const inserted = paragraphs.map((paragraph, sourceIndex) => {
      let content = paragraph.content;
      if (sourceIndex === 0) content = prefix.append(content);
      if (sourceIndex === paragraphs.length - 1) content = content.append(suffix);
      const attrs = sourceIndex === 0 ? item.attrs : { ...item.attrs, semloEditorListRestart: false };
      return item.type.create(attrs, paragraph.type.create(paragraph.attrs, content, paragraph.marks), item.marks);
    });
    const itemPos = $from.before(2);
    const tr = state.tr.replaceWith(itemPos, $to.after(2), Fragment.fromArray(inserted));
    const lastPos = itemPos + inserted.slice(0, -1).reduce((size, node) => size + node.nodeSize, 0);
    tr.setSelection(TextSelection.create(tr.doc, lastPos + 2 + paragraphs[paragraphs.length - 1].content.size));
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
    return { kind: "apply", transaction: tr };
  } catch {
    return reject("numbering");
  }
}
