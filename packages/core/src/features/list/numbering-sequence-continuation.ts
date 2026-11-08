import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

import {
  formatSequenceConversionHint,
  parseSequenceConversionHint,
  sequenceConversionHintAttribute,
} from "./numbering-sequence-conversion-hint";
import {
  formatSequenceLink,
  parseSequenceLink,
  assertNumberingSequenceDocument,
  resolveListNumbering,
  sequenceLinkAttribute,
  sequenceMemberAttribute,
  sequenceRegistryAttribute,
  type SequenceLink,
} from "./numbering-sequence-document";

type Segment = { node: ProseMirrorNode; pos: number; index: number; link: SequenceLink };
type Edge = { from?: Segment; to?: Segment };

function collect(root: ProseMirrorNode): Map<string, Edge> {
  const edges = new Map<string, Edge>();
  root.forEach((node, pos, index) => {
    const link = node.type.name === "orderedList" ? parseSequenceLink(node.attrs[sequenceLinkAttribute]) : null;
    if (!link) return;
    const segment = { node, pos, index, link };
    if (link.previous) {
      const edge = edges.get(link.previous) ?? {};
      edge.to = segment;
      edges.set(link.previous, edge);
    }
    if (link.next) {
      const edge = edges.get(link.next) ?? {};
      edge.from = segment;
      edges.set(link.next, edge);
    }
  });
  return edges;
}

function connected(root: ProseMirrorNode, edge: Edge): edge is { from: Segment; to: Segment } {
  if (!edge.from || !edge.to || edge.from.index >= edge.to.index || edge.from.link.version !== edge.to.link.version)
    return false;
  const allowed =
    edge.from.link.version === 3
      ? ["paragraph", "taskList", "bulletList", "heading"]
      : edge.from.link.version === 2
        ? ["paragraph", "taskList", "bulletList"]
        : ["paragraph"];
  for (let index = edge.from.index + 1; index < edge.to.index; index++)
    if (!allowed.includes(root.child(index).type.name)) return false;
  return true;
}

function sequenceChain(root: ProseMirrorNode, sourcePos: number): Segment[] | null {
  const edges = collect(root);
  const source = [...edges.values()]
    .flatMap((edge) => [edge.from, edge.to])
    .find((segment) => segment?.pos === sourcePos);
  if (!source) return null;
  const pending = [source];
  const visited = new Map<number, Segment>();
  while (pending.length) {
    const segment = pending.pop()!;
    if (visited.has(segment.pos)) continue;
    if (segment.link.version !== source.link.version) return null;
    visited.set(segment.pos, segment);
    for (const id of [segment.link.previous, segment.link.next]) {
      if (!id) continue;
      const edge = edges.get(id);
      if (!edge || !connected(root, edge) || (edge.from.pos !== segment.pos && edge.to.pos !== segment.pos))
        return null;
      pending.push(edge.from, edge.to);
    }
  }
  return [...visited.values()];
}

/** 只返回边关系完整的续接链，调用方仍需校验各段编号。 */
export function connectedSequenceLists(
  root: ProseMirrorNode,
  sourcePos: number,
): Array<{
  node: ProseMirrorNode;
  pos: number;
}> | null {
  const chain = sequenceChain(root, sourcePos);
  return chain ? chain.map(({ node, pos }) => ({ node, pos })) : null;
}

/** 失效的续接不能通过转换推断或重建。 */
export function canConvertSequenceChain(root: ProseMirrorNode, sourcePos: number): boolean {
  const source = root.nodeAt(sourcePos);
  return !!source && (source.attrs[sequenceLinkAttribute] == null || sequenceChain(root, sourcePos) !== null);
}

/** 在新增跨类型间隔前，原子升级完整的续接链。 */
export function upgradeSequenceChain(
  root: ProseMirrorNode,
  sourcePos: number,
  version: 2 | 3 = 2,
): Array<{ pos: number; node: ProseMirrorNode }> | null {
  const chain = sequenceChain(root, sourcePos);
  if (!chain || chain.some((segment) => segment.link.version >= version)) return null;
  return chain.map(({ node, pos, link }) => ({
    pos,
    node: node.type.create(
      { ...node.attrs, [sequenceLinkAttribute]: formatSequenceLink(link.previous, link.next, version) },
      node.content,
      node.marks,
    ),
  }));
}

/** 整段转为其他块后，让原先经该段续接的两侧继续关联。 */
export function bridgeRemovedSequenceSegment(
  root: ProseMirrorNode,
  sourcePos: number,
  version: 1 | 2 | 3,
): Array<{ pos: number; node: ProseMirrorNode }> | null {
  const chain = sequenceChain(root, sourcePos);
  const source = chain?.find((segment) => segment.pos === sourcePos);
  if (!source) return null;
  if (!source.link.previous || !source.link.next) return [];
  const edges = collect(root);
  const right = edges.get(source.link.next)?.to;
  if (!right) return null;
  return [
    {
      pos: right.pos,
      node: right.node.type.create(
        {
          ...right.node.attrs,
          [sequenceLinkAttribute]: formatSequenceLink(source.link.previous, right.link.next, version),
        },
        right.node.content,
        right.node.marks,
      ),
    },
  ];
}

/** 随文档生成无冲突的关联标识；关联不是安全凭据。 */
export function newSequenceLinkId(root: ProseMirrorNode, reserved: ReadonlySet<string> = new Set()): string {
  const existing = new Set(reserved);
  root.descendants((node) => {
    const link = parseSequenceLink(node.attrs[sequenceLinkAttribute]);
    if (link?.previous) existing.add(link.previous);
    if (link?.next) existing.add(link.next);
    const conversion = parseSequenceConversionHint(node.attrs[sequenceConversionHintAttribute]);
    if (conversion) existing.add(conversion.edge);
    return !node.isTextblock;
  });
  for (let attempt = 0; attempt < 8; attempt++) {
    const value = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    if (value && !existing.has(value)) return value;
  }
  let fallback = 1;
  while (existing.has(`link-${fallback}`)) fallback++;
  return `link-${fallback}`;
}

/** 规划后段起点及失效关联的清理；返回 null 表示编号无法安全表示。 */
export function planSequenceContinuation(
  root: ProseMirrorNode,
  previousRoot?: ProseMirrorNode,
): Array<{ pos: number; node: ProseMirrorNode }> | null {
  const edges = collect(root);
  const previousEdges = previousRoot ? collect(previousRoot) : new Map<string, Edge>();
  const updates = new Map<number, ProseMirrorNode>();
  const current = (segment: Segment) => updates.get(segment.pos) ?? segment.node;
  const update = (segment: Segment, attrs: Record<string, unknown>) => {
    const node = current(segment);
    updates.set(segment.pos, node.type.create({ ...node.attrs, ...attrs }, node.content, node.marks));
  };
  const rebase = (from: ProseMirrorNode, target: Segment, includeMembers: boolean): boolean => {
    const left = resolveListNumbering(from),
      right = resolveListNumbering(current(target));
    if (!left.ok || left.value.kind !== "v1" || !right.ok || right.value.kind !== "v1") return false;
    const definitions = new Map(left.value.registry.sequences.map((item) => [item.id, item]));
    const used = new Set(right.value.sequenceIds);
    const counts = new Map<string, number>();
    if (includeMembers) for (const id of left.value.sequenceIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    let changed = false;
    const sequences = right.value.registry.sequences.map((item) => {
      const source = definitions.get(item.id);
      if (!source || !used.has(item.id) || source.origin !== item.origin) return item;
      const start = source.start + (counts.get(item.id) ?? 0);
      if (start !== item.start) changed = true;
      return { ...item, start };
    });
    if (!changed) return true;
    const node = current(target);
    const replacement = node.type.create(
      { ...node.attrs, [sequenceRegistryAttribute]: { version: 1, sequences } },
      node.content,
      node.marks,
    );
    const verified = resolveListNumbering(replacement);
    if (!verified.ok || verified.value.kind !== "v1") return false;
    updates.set(target.pos, replacement);
    return true;
  };
  const detach = (segment: Segment, side: "previous" | "next") => {
    const link = parseSequenceLink(current(segment).attrs[sequenceLinkAttribute]);
    if (!link) return;
    update(segment, {
      [sequenceLinkAttribute]: formatSequenceLink(
        side === "previous" ? null : link.previous,
        side === "next" ? null : link.next,
        link.version,
      ),
    });
  };
  // 删除仅含一个叶项的中间片段时，直接续接原有的前后片段；不能凭局部 ID 猜测新关系。
  if (previousRoot)
    for (const [id, edge] of edges) {
      const old = previousEdges.get(id);
      if (!edge.from || edge.to || !old || !connected(previousRoot, old)) continue;
      const middle = old.to;
      const followingId = middle.link.next;
      const oldFollowing = followingId ? previousEdges.get(followingId) : undefined;
      const following = followingId ? edges.get(followingId) : undefined;
      if (
        middle.node.childCount !== 1 ||
        middle.node.firstChild?.childCount !== 1 ||
        !followingId ||
        !oldFollowing ||
        !connected(previousRoot, oldFollowing) ||
        oldFollowing.from.pos !== middle.pos ||
        !following?.to ||
        following.from ||
        !connected(root, { from: edge.from, to: following.to })
      )
        continue;
      const head = resolveListNumbering(current(edge.from));
      const tail = resolveListNumbering(current(following.to));
      if (!head.ok || head.value.kind !== "v1" || !tail.ok || tail.value.kind !== "v1") continue;
      const definitions = new Map(head.value.registry.sequences.map((item) => [item.id, item.origin]));
      const used = new Set(tail.value.sequenceIds);
      if (tail.value.registry.sequences.some((item) => used.has(item.id) && definitions.get(item.id) !== item.origin))
        continue;
      const tailLink = parseSequenceLink(current(following.to).attrs[sequenceLinkAttribute]);
      if (!tailLink || tailLink.version !== edge.from.link.version) continue;
      update(following.to, { [sequenceLinkAttribute]: formatSequenceLink(id, tailLink.next, tailLink.version) });
      edge.to = following.to;
      edges.delete(followingId);
    }
  for (const [id, edge] of edges) {
    if (connected(root, edge)) continue;
    const old = previousEdges.get(id);
    if (!edge.from && edge.to && previousRoot && old && connected(previousRoot, old)) {
      if (!rebase(old.from.node, edge.to, false)) return null;
    }
    if (edge.from) detach(edge.from, "next");
    if (edge.to) detach(edge.to, "previous");
  }
  const linked = [...edges.values()]
    .filter((edge) => connected(root, edge))
    .sort((a, b) => a.from!.index - b.from!.index);
  for (const edge of linked) if (!rebase(current(edge.from!), edge.to!, true)) return null;
  return [...updates].map(([pos, node]) => ({ pos, node }));
}

/** 所测三段续接中的空子项依次退到根级、再退出列表，保留两端内容。 */
export function planEmptySequenceBackspace(state: EditorState): Transaction | null {
  try {
    const selection = state.selection;
    if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.depth !== 3) return null;
    const { $from } = selection;
    if ($from.parent.type.name !== "paragraph" || $from.parent.content.size !== 0) return null;
    const list = $from.node(1),
      item = $from.node(2),
      listPos = $from.before(1),
      itemPos = $from.before(2);
    const link = parseSequenceLink(list.attrs[sequenceLinkAttribute]);
    if (
      list.type.name !== "orderedList" ||
      list.childCount !== 1 ||
      item.childCount !== 1 ||
      !link?.previous ||
      !link.next
    )
      return null;
    const edges = collect(state.doc),
      previous = edges.get(link.previous),
      following = edges.get(link.next);
    if (
      !previous ||
      !following ||
      !connected(state.doc, previous) ||
      !connected(state.doc, following) ||
      previous.to.pos !== listPos ||
      following.from.pos !== listPos
    )
      return null;
    const headNode = previous.from.node,
      tailNode = following.to.node;
    const head = resolveListNumbering(headNode),
      middle = resolveListNumbering(list),
      tail = resolveListNumbering(tailNode);
    if (
      !head.ok ||
      head.value.kind !== "v1" ||
      !middle.ok ||
      middle.value.kind !== "v1" ||
      !tail.ok ||
      tail.value.kind !== "v1"
    )
      return null;
    if (
      headNode.childCount < 2 ||
      Number(headNode.firstChild?.attrs.semloEditorListIndent ?? 0) !== 0 ||
      Array.from({ length: headNode.childCount - 1 }, (_, index) => headNode.child(index + 1)).some(
        (child) => Number(child.attrs.semloEditorListIndent ?? 0) !== 1,
      ) ||
      Number(tailNode.firstChild?.attrs.semloEditorListIndent ?? 0) !== 1
    )
      return null;
    const rootId = head.value.sequenceIds[0],
      childId = head.value.sequenceIds[headNode.childCount - 1];
    if (rootId === childId || tail.value.sequenceIds[0] !== childId) return null;
    const definitions = new Map(head.value.registry.sequences.map((entry) => [entry.id, entry]));
    const used = new Set(tail.value.sequenceIds);
    if (
      tail.value.registry.sequences.some(
        (entry) => used.has(entry.id) && definitions.get(entry.id)?.origin !== entry.origin,
      )
    )
      return null;
    const level = Number(item.attrs.semloEditorListIndent ?? 0),
      middleId = middle.value.sequenceIds[0];
    let tr: Transaction;
    if (level === 1 && middleId === childId) {
      const sequences = middle.value.registry.sequences.map((entry) => {
        const source = definitions.get(entry.id);
        return used.has(entry.id) && entry.id !== rootId && source ? { ...entry, start: source.start } : entry;
      });
      tr = state.tr.setNodeMarkup(listPos, undefined, {
        ...list.attrs,
        [sequenceRegistryAttribute]: { version: 1, sequences },
      });
      tr.setNodeMarkup(itemPos, undefined, {
        ...item.attrs,
        semloEditorListIndent: 0,
        semloEditorListRestart: false,
        [sequenceMemberAttribute]: rootId,
      });
    } else if (level === 0 && middleId === rootId) {
      tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, $from.parent);
    } else return null;
    const updates = planSequenceContinuation(tr.doc, state.doc);
    if (!updates) return null;
    for (const { pos, node } of updates) tr.setNodeMarkup(pos, undefined, node.attrs, node.marks);
    tr.setSelection(TextSelection.create(tr.doc, level === 1 ? itemPos + 2 : listPos + 1));
    tr.doc.check();
    assertNumberingSequenceDocument(tr.doc);
    return tr;
  } catch {
    return null;
  }
}

/** 剪贴板内容中的关联在完整复制时换新身份，单段复制不携带源关联。 */
export function remapSequenceLinks(slice: Slice, root: ProseMirrorNode): Slice {
  const counts = new Map<string, { previous: number; next: number }>();
  let hints = false;
  slice.content.descendants((node) => {
    if (parseSequenceConversionHint(node.attrs[sequenceConversionHintAttribute])) hints = true;
    const link = parseSequenceLink(node.attrs[sequenceLinkAttribute]);
    if (!link) return;
    for (const side of ["previous", "next"] as const) {
      const id = link[side];
      if (!id) continue;
      const count = counts.get(id) ?? { previous: 0, next: 0 };
      count[side]++;
      counts.set(id, count);
    }
  });
  if (!counts.size && !hints) return slice;
  const replacements = new Map<string, string>();
  const reserved = new Set<string>();
  if (slice.openStart === 0 && slice.openEnd === 0)
    for (const [id, count] of counts) {
      if (count.previous !== 1 || count.next !== 1) continue;
      const replacement = newSequenceLinkId(root, reserved);
      reserved.add(replacement);
      replacements.set(id, replacement);
    }
  const map = (fragment: Fragment): Fragment => {
    const children: ProseMirrorNode[] = [];
    fragment.forEach((node) => {
      if (node.isText || node.isLeaf) {
        children.push(node);
        return;
      }
      const content = map(node.content),
        link = parseSequenceLink(node.attrs[sequenceLinkAttribute]),
        conversion = parseSequenceConversionHint(node.attrs[sequenceConversionHintAttribute]);
      const value = link
        ? formatSequenceLink(
            replacements.get(link.previous ?? "") ?? null,
            replacements.get(link.next ?? "") ?? null,
            link.version,
          )
        : node.attrs[sequenceLinkAttribute];
      const mappedEdge = conversion && replacements.get(conversion.edge);
      children.push(
        link || conversion
          ? node.type.create(
              {
                ...node.attrs,
                ...(link ? { [sequenceLinkAttribute]: value } : {}),
                ...(conversion
                  ? {
                      [sequenceConversionHintAttribute]: mappedEdge
                        ? formatSequenceConversionHint(mappedEdge, conversion.sequenceId)
                        : null,
                    }
                  : {}),
              },
              content,
              node.marks,
            )
          : node.copy(content),
      );
    });
    return Fragment.fromArray(children);
  };
  return new Slice(map(slice.content), slice.openStart, slice.openEnd);
}
