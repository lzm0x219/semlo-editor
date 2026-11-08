import { getText, getTextSerializersFromSchema } from "@tiptap/core";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

import { headingNumberingStyle, headingNumberMarkers } from "../heading/numbering";
import { newSequenceLinkId, planSequenceContinuation } from "./numbering-sequence-continuation";
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
import { orderedListLabels } from "./ordered-style";
import { orderedListPlainLabels } from "./ordinals";

type ProjectedHeading = { level: number; text: string; style: string | null; marker: string | null };

export interface NumberingSequenceClipboard {
  slice: Slice;
  root: ProseMirrorNode;
  text: string;
  headings?: ProjectedHeading[];
  /** 已验证的同层叶项范围始终合并首 prefix 与末 suffix，首项即使为空也保留。 */
  cut: Transaction;
}

type NumberingSequenceCopy = Omit<NumberingSequenceClipboard, "cut">;

/** 仅在序列化结果仍与投影一致时添加源标题编号，避免改写宿主自定义输出。 */
export function serializeSequenceCopyHeadingsHTML(
  html: string,
  owner: Document,
  headings: readonly ProjectedHeading[] | undefined,
): string | null {
  if (!headings?.some(({ marker }) => marker)) return html;
  const template = owner.createElement("template");
  template.innerHTML = html;
  const elements = Array.from(template.content.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  if (
    elements.length !== headings.length ||
    elements.some((element, index) => {
      const heading = headings[index];
      return (
        element.tagName.toLowerCase() !== `h${heading.level}` ||
        element.textContent !== heading.text ||
        element.getAttribute("data-semlo-editor-heading-numbering") !== heading.style ||
        !!element.querySelector("[data-semlo-editor-heading-marker]")
      );
    })
  )
    return null;
  headings.forEach(({ marker }, index) => {
    if (!marker) return;
    const span = owner.createElement("span");
    span.setAttribute("data-semlo-editor-heading-marker", "");
    span.textContent = `${marker} `;
    elements[index].prepend(span);
  });
  return template.innerHTML;
}

function copyProjection(
  state: EditorState,
  list: ProseMirrorNode,
  listPos: number,
  first: number,
  last: number,
  firstOffset: number,
  lastOffset: number,
): NumberingSequenceCopy | null {
  const custom = orderedListLabels(state.doc),
    native = orderedListPlainLabels(state.doc);
  const children: ProseMirrorNode[] = [],
    plain: string[] = [];
  let supported = true;
  const serializers = getTextSerializersFromSchema(state.schema);
  list.forEach((item, offset, index) => {
    if (index < first || index > last) return;
    const paragraph = item.firstChild!;
    const selected = paragraph.content.cut(
      index === first ? firstOffset : 0,
      index === last ? lastOffset : paragraph.content.size,
    );
    const copiedParagraph = paragraph.type.create(paragraph.attrs, selected, paragraph.marks);
    const label = custom.get(listPos + 1 + offset) ?? native.get(listPos + 1 + offset);
    if (!label) supported = false;
    const indentation = "  ".repeat(Number(item.attrs.semloEditorListIndent ?? 0));
    plain.push(
      `${indentation}${label} ${getText(copiedParagraph, { blockSeparator: "", textSerializers: serializers })}`,
    );
    children.push(
      item.type.create(
        { ...item.attrs, [sequenceMemberAttribute]: null, semloEditorListRestart: false },
        copiedParagraph,
        item.marks,
      ),
    );
  });
  if (!supported) return null;
  // 新片段独立从一开始；任何源计数或来源链都不能混入新物理列表。
  const projected = list.type.create(
    {
      ...list.attrs,
      start: 1,
      [sequenceRegistryAttribute]: null,
      [sequenceLinkAttribute]: null,
      semloEditorListLevelStarts: null,
      semloEditorOrderedAncestorPath: null,
      semloEditorListFirstContinue: false,
      semloEditorListQuoteChain: null,
      semloEditorListTaskChain: null,
    },
    children,
    list.marks,
  );
  projected.check();
  return {
    slice: new Slice(Fragment.from(projected), 0, 0),
    root: state.schema.topNodeType.create(null, projected),
    text: plain.join("\n"),
  };
}

/** 跨父子项只投影复制，剪切仍由单独的安全事务规划。 */
export function projectNumberingSequenceMixedCopy(state: EditorState): NumberingSequenceCopy | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const { $from, $to } = selection;
  if ($from.depth !== 3 || $to.depth !== 3 || $from.before(1) !== $to.before(1)) return null;
  const list = $from.node(1),
    listPos = $from.before(1);
  const first = $from.index(1),
    last = $to.index(1);
  if (
    list.type.name !== "orderedList" ||
    !hasNumberingSequences(list) ||
    first >= last ||
    list.attrs.semloEditorListQuoteChain != null ||
    list.attrs.semloEditorListTaskChain != null ||
    list.attrs.semloEditorListFirstContinue === true
  )
    return null;
  const resolved = resolveListNumbering(list);
  if (!resolved.ok || resolved.value.kind !== "v1") return null;
  const levels = new Set<number>();
  for (let index = first; index <= last; index++) {
    const item = list.child(index),
      level = Number(item.attrs.semloEditorListIndent ?? 0);
    if (item.type.name !== "listItem" || item.childCount !== 1 || item.firstChild?.type.name !== "paragraph")
      return null;
    levels.add(level);
  }
  if (levels.size < 2 || $from.parent !== list.child(first).firstChild || $to.parent !== list.child(last).firstChild)
    return null;
  return copyProjection(state, list, listPos, first, last, $from.parentOffset, $to.parentOffset);
}

/** 跨根级正文和列表的复制独立投图片段；不规划跨块剪切。 */
export function projectNumberingSequenceRootCopy(state: EditorState): NumberingSequenceCopy | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const { $from, $to } = selection;
  if ($from.index(0) === $to.index(0)) return null;
  const blocks: ProseMirrorNode[] = [];
  const plain: string[] = [];
  const headings: ProjectedHeading[] = [];
  const markers = headingNumberMarkers(state);
  const lists: Array<{ source: ProseMirrorNode; output: number; first: number; last: number }> = [];
  const serializers = getTextSerializersFromSchema(state.schema);
  let supported = true;
  let hasSequence = false;
  state.doc.forEach((block, pos) => {
    if (!supported || selection.from >= pos + block.nodeSize || selection.to <= pos) return;
    if (block.type.name === "paragraph" || block.type.name === "heading") {
      const first = selection.from > pos ? ($from.parent === block ? $from.parentOffset : -1) : 0;
      const last =
        selection.to < pos + block.nodeSize ? ($to.parent === block ? $to.parentOffset : -1) : block.content.size;
      if (first < 0 || last < first) {
        supported = false;
        return;
      }
      const copied = block.type.create(block.attrs, block.content.cut(first, last), block.marks);
      if (block.type.name === "heading") {
        const numbering = block.attrs.semloEditorHeadingNumbering;
        const style = headingNumberingStyle(numbering);
        const marker = markers.get(pos) ?? null;
        // 部分编号标题的复制不应把标题结构或整段编号扩进选区。
        if (numbering != null && (!style || !marker || first !== 0 || last !== block.content.size)) {
          supported = false;
          return;
        }
        headings.push({ level: Number(block.attrs.level), text: copied.textContent, style, marker });
      }
      blocks.push(copied);
      plain.push(getText(copied, { blockSeparator: "", textSerializers: serializers }));
      return;
    }
    if (block.type.name !== "orderedList" || !hasNumberingSequences(block)) {
      supported = false;
      return;
    }
    const resolved = resolveListNumbering(block);
    if (!resolved.ok || resolved.value.kind !== "v1") {
      supported = false;
      return;
    }
    const partialFrom = selection.from > pos;
    const partialTo = selection.to < pos + block.nodeSize;
    if (
      (partialFrom && ($from.depth !== 3 || $from.before(1) !== pos)) ||
      (partialTo && ($to.depth !== 3 || $to.before(1) !== pos))
    ) {
      supported = false;
      return;
    }
    const first = partialFrom ? $from.index(1) : 0;
    const last = partialTo ? $to.index(1) : block.childCount - 1;
    for (let index = first; index <= last; index++) {
      const item = block.child(index);
      if (item.type.name !== "listItem" || item.childCount !== 1 || item.firstChild?.type.name !== "paragraph") {
        supported = false;
        return;
      }
    }
    const projected = copyProjection(
      state,
      block,
      pos,
      first,
      last,
      partialFrom ? $from.parentOffset : 0,
      partialTo ? $to.parentOffset : block.child(last).firstChild!.content.size,
    );
    if (!projected) {
      supported = false;
      return;
    }
    hasSequence = true;
    lists.push({ source: block, output: blocks.length, first, last });
    blocks.push(projected.slice.content.firstChild!);
    plain.push(projected.text);
  });
  if (!supported || !hasSequence || !blocks.length) return null;
  const edges = new Map<number, { id: string; version: 1 | 2 | 3 }>();
  const reserved = new Set<string>();
  for (let index = 0; index + 1 < lists.length; index++) {
    const left = lists[index],
      right = lists[index + 1];
    const leftLink = parseSequenceLink(left.source.attrs[sequenceLinkAttribute]);
    const rightLink = parseSequenceLink(right.source.attrs[sequenceLinkAttribute]);
    const next = leftLink?.next;
    const previous = rightLink?.previous;
    if (
      !next ||
      next !== previous ||
      leftLink?.version !== rightLink?.version ||
      blocks
        .slice(left.output + 1, right.output)
        .some((block) => block.type.name !== "paragraph" && !(leftLink.version === 3 && block.type.name === "heading"))
    )
      continue;
    const validate = (list: ProseMirrorNode) => {
      const result = resolveListNumbering(list);
      if (!result.ok || result.value.kind !== "v1") return null;
      const id = result.value.sequenceIds[0];
      const definition = result.value.registry.sequences.find((item) => item.id === id);
      if (!definition || definition.origin !== "initial" || result.value.sequenceIds.some((item) => item !== id))
        return null;
      let flat = true;
      list.forEach((item) => {
        if (
          item.type.name !== "listItem" ||
          item.childCount !== 1 ||
          item.firstChild?.type.name !== "paragraph" ||
          Number(item.attrs.semloEditorListIndent ?? 0) !== 0 ||
          item.attrs.semloEditorListRestart === true
        )
          flat = false;
      });
      return flat ? { id, start: definition.start, count: list.childCount } : null;
    };
    const before = validate(left.source),
      after = validate(right.source);
    if (!before || !after || before.id !== after.id || before.start + before.count !== after.start) return null;
    const id = newSequenceLinkId(state.doc, reserved);
    reserved.add(id);
    edges.set(index, { id, version: leftLink.version });
  }
  let start = 1;
  for (let index = 0; index < lists.length; index++) {
    const previous = edges.get(index - 1),
      next = edges.get(index);
    if (!previous) start = 1;
    if (!previous && !next) continue;
    // 一个物理列表只有一个版本字段，不能把不同版本的两条关联强行降级。
    if (previous && next && previous.version !== next.version) return null;
    const entry = lists[index];
    const resolved = resolveListNumbering(entry.source);
    if (!resolved.ok || resolved.value.kind !== "v1") return null;
    const id = resolved.value.sequenceIds[entry.first];
    const projected = blocks[entry.output];
    const items: ProseMirrorNode[] = [];
    projected.forEach((item) =>
      items.push(item.type.create({ ...item.attrs, [sequenceMemberAttribute]: id }, item.content, item.marks)),
    );
    blocks[entry.output] = projected.type.create(
      {
        ...projected.attrs,
        start,
        [sequenceRegistryAttribute]: { version: 1, sequences: [{ id, start, origin: "initial" }] },
        [sequenceLinkAttribute]: formatSequenceLink(
          previous?.id ?? null,
          next?.id ?? null,
          (previous ?? next)!.version,
        ),
      },
      items,
      projected.marks,
    );
    start += entry.last - entry.first + 1;
  }
  const root = state.schema.topNodeType.create(null, blocks);
  root.check();
  if (edges.size) {
    assertNumberingSequenceDocument(root);
    const continuation = planSequenceContinuation(root);
    if (!continuation || continuation.length) return null;
  }
  return { root, slice: new Slice(Fragment.fromArray(blocks), 0, 0), text: plain.join("\n\n"), headings };
}

/** 处理根项到后代范围及两个默认父项之间的直接子项范围；不迁移未定义的深层子树。 */
export function projectNumberingSequenceMixedCut(state: EditorState): NumberingSequenceClipboard | null {
  const copy = projectNumberingSequenceMixedCopy(state);
  if (!copy) return null;
  const { $from, $to } = state.selection;
  const list = $from.node(1),
    listPos = $from.before(1);
  const first = $from.index(1),
    last = $to.index(1);
  if (list.attrs[sequenceLinkAttribute] != null || !$from.parent.sameMarkup($to.parent)) return null;
  const resolved = resolveListNumbering(list);
  if (!resolved.ok || resolved.value.kind !== "v1") return null;
  const entries: ProseMirrorNode[] = [];
  list.forEach((item) => entries.push(item));
  const level = (index: number) => Number(entries[index].attrs.semloEditorListIndent ?? 0);
  if (
    entries.some((item, index) => item.type.name !== "listItem" || !Number.isInteger(level(index)) || level(index) < 0)
  )
    return null;
  const parentOf = (index: number) => {
    for (let position = index - 1; position >= 0; position--) if (level(position) === 0) return position;
    return -1;
  };
  const logicalParentOf = (index: number) => {
    for (let position = index - 1; position >= 0; position--) if (level(position) < level(index)) return position;
    return -1;
  };
  let reparentFrom = -1,
    reparentTo = -1,
    childSequence = "";
  if (level(first) === level(last) && logicalParentOf(first) === logicalParentOf(last)) {
    // 首尾同级且中间子树完整选中时可合并；末项的未选后代仍需保护。
    if (last + 1 < entries.length && level(last + 1) > level(last)) return null;
  } else if (level(first) === 0 && level(last) > 0) {
    if (parentOf(last) !== first) return null;
    // 完整选中的中间子树可随选区删除；末项仍有未选后代时不能猜测其归属。
    if (last + 1 < entries.length && level(last + 1) > 1) return null;
  } else if (level(first) === 1 && level(last) === 1) {
    const firstParent = parentOf(first),
      lastParent = parentOf(last);
    if (
      firstParent < 0 ||
      lastParent <= first ||
      entries.slice(first + 1, lastParent).some((_item, offset) => level(first + 1 + offset) === 0)
    )
      return null;
    reparentFrom = last + 1;
    reparentTo = reparentFrom;
    while (reparentTo < entries.length && level(reparentTo) === 1) reparentTo++;
    // 中间深层项完全落在选区时可一并删除；范围外的深层项仍可能需要重新归属。
    if (
      (reparentTo < entries.length && level(reparentTo) !== 0) ||
      entries
        .slice(firstParent, reparentTo)
        .some(
          (item, offset) =>
            (level(firstParent + offset) > 1 && (firstParent + offset <= first || firstParent + offset >= last)) ||
            item.childCount !== 1 ||
            item.firstChild?.type.name !== "paragraph",
        )
    )
      return null;
    const ids = resolved.value.sequenceIds;
    const definitions = new Map(resolved.value.registry.sequences.map((entry) => [entry.id, entry]));
    const rootId = ids[firstParent],
      firstId = ids[first],
      lastId = ids[last];
    const isInitial = (id: string) => definitions.get(id)?.origin === "initial" && definitions.get(id)?.start === 1;
    if (
      ids[lastParent] !== rootId ||
      !isInitial(rootId) ||
      !isInitial(firstId) ||
      !isInitial(lastId) ||
      entries
        .slice(firstParent + 1, lastParent)
        .some(
          (item, offset) =>
            level(firstParent + 1 + offset) === 1 &&
            (ids[firstParent + 1 + offset] !== firstId || item.attrs.semloEditorListRestart === true),
        ) ||
      entries
        .slice(lastParent + 1, reparentTo)
        .some(
          (item, offset) =>
            level(lastParent + 1 + offset) === 1 &&
            (ids[lastParent + 1 + offset] !== lastId || item.attrs.semloEditorListRestart === true),
        )
    )
      return null;
    childSequence = firstId;
  } else return null;
  const firstItem = entries[first],
    lastItem = entries[last];
  const adjustedAttrs = {
    ...lastItem.attrs,
    semloEditorListIndent: firstItem.attrs.semloEditorListIndent,
    semloEditorListRestart: firstItem.attrs.semloEditorListRestart,
    semloEditorListFolded: firstItem.attrs.semloEditorListFolded,
    [sequenceMemberAttribute]: firstItem.attrs[sequenceMemberAttribute],
  };
  if (!lastItem.type.create(adjustedAttrs, lastItem.content, lastItem.marks).sameMarkup(firstItem)) return null;
  const prefix = $from.parent.content.cut(0, $from.parentOffset);
  const suffix = $to.parent.content.cut($to.parentOffset);
  const merged = firstItem.type.create(
    firstItem.attrs,
    $from.parent.type.create($from.parent.attrs, prefix.append(suffix), $from.parent.marks),
    firstItem.marks,
  );
  const retained = entries.flatMap((item, index) => {
    if (index === first) return [merged];
    if (index > first && index <= last) return [];
    if (index >= reparentFrom && index < reparentTo)
      return [item.type.create({ ...item.attrs, [sequenceMemberAttribute]: childSequence }, item.content, item.marks)];
    return [item];
  });
  const replacement = list.type.create(list.attrs, retained, list.marks);
  let itemPos = listPos + 1;
  for (let index = 0; index < first; index++) itemPos += entries[index].nodeSize;
  const cut = state.tr.replaceWith(listPos, listPos + list.nodeSize, replacement);
  cut.setSelection(TextSelection.create(cut.doc, itemPos + 2 + prefix.size));
  cut.doc.check();
  assertNumberingSequenceDocument(cut.doc);
  return { ...copy, cut };
}

/** 只计划当前选区，不写剪贴板、不派发事务；失败不降级成丢身份的 open slice。 */
export function projectNumberingSequenceClipboard(state: EditorState): NumberingSequenceClipboard | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const { $from, $to } = selection;
  if ($from.depth !== 3 || $to.depth !== 3 || $from.before(1) !== $to.before(1)) return null;
  const list = $from.node(1),
    listPos = $from.before(1);
  const first = $from.index(1),
    last = $to.index(1);
  if (
    list.type.name !== "orderedList" ||
    !hasNumberingSequences(list) ||
    first >= last ||
    list.attrs.semloEditorListQuoteChain != null ||
    list.attrs.semloEditorListTaskChain != null ||
    list.attrs.semloEditorListFirstContinue === true
  )
    return null;
  const resolved = resolveListNumbering(list);
  if (!resolved.ok || resolved.value.kind !== "v1") return null;
  const level = Number(list.child(first).attrs.semloEditorListIndent ?? 0);
  // 连续范围逐项同层，内部不可能出现更浅的父项；一次遍历即可保证同逻辑父。
  for (let index = first; index <= last; index++)
    if (!sequenceLeaf(list, index) || Number(list.child(index).attrs.semloEditorListIndent ?? 0) !== level) return null;
  if ($from.parent !== list.child(first).firstChild || $to.parent !== list.child(last).firstChild) return null;
  const copy = copyProjection(state, list, listPos, first, last, $from.parentOffset, $to.parentOffset);
  if (!copy) return null;
  let itemPos = listPos + 1;
  for (let index = 0; index < first; index++) itemPos += list.child(index).nodeSize;
  const prefix = $from.parent.content.cut(0, $from.parentOffset);
  const suffix = $to.parent.content.cut($to.parentOffset);
  const firstItem = list.child(first);
  const merged = firstItem.type.create(
    firstItem.attrs,
    $from.parent.type.create($from.parent.attrs, prefix.append(suffix), $from.parent.marks),
    firstItem.marks,
  );
  const retained: ProseMirrorNode[] = [];
  list.forEach((item, _offset, index) => {
    if (index < first || index > last) retained.push(item);
    else if (index === first) retained.push(merged);
  });
  const replacement = list.type.create(list.attrs, retained, list.marks);
  const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, replacement);
  tr.setSelection(TextSelection.create(tr.doc, itemPos + 2 + prefix.size));
  tr.doc.check();
  assertNumberingSequenceDocument(tr.doc);
  return { ...copy, cut: tr };
}
