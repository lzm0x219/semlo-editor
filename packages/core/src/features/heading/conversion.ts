import { CommandManager, createChainableState, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";

import { sequenceConversionHintAttribute } from "../list/numbering-sequence-conversion-hint";
import {
  selectionHasNumberingSequences,
  sequenceLinkAttribute,
  sequenceRegistryAttribute,
} from "../list/numbering-sequence-document";
import { normalizeOrderedAncestorPath } from "../list/ordered-path";
import {
  deriveOrderedListValues,
  normalizeOrderedListLevelStarts,
  rebaseOrderedListLevelStarts,
} from "../list/ordinals";
import { canJoinQuoteHeading, markJoinedQuoteHeading } from "../text/quote-keyboard";
import { clearHeadingInlineFormat } from "./clear-inline";
import { headingNumberingStyle, inheritedHeadingNumbering, type HeadingNumberingStyle } from "./numbering";
import { getHeadingSelection, type HeadingStyleLevel } from "./selection";
import { convertSequenceTextblocks } from "./sequence-conversion";

type OriginalBlock = {
  pos: number;
  node: ProseMirrorNode;
  type: string;
  listItem: boolean;
  listDepth: number;
  hasNestedList: boolean;
  unsupportedContainer: boolean;
  unsupportedOrdered: boolean;
  normalizedFlatOrderedPos: number | null;
  nestedCustomOrdered: boolean;
  numbering: HeadingNumberingStyle | null;
};
type OriginalListItem = {
  contentPos: number;
  depth: number;
  effectiveIndent: number;
  ordinal: number | null;
  normalizedFlat: boolean;
  listAttrs: Readonly<Record<string, unknown>> | null;
  ancestorPath: number[] | null;
  ancestorKnown: boolean;
  firstChild: ProseMirrorNode;
  attrs: Readonly<Record<string, unknown>>;
};
type RestartHeadingCase = { listPos: number; selectedIndex: number; selectedWasRestart: boolean };
type FirstContinueHeadingCase = { listPos: number; retainedContentPos: number; retainedList: ProseMirrorNode };
type PreservedListBlock = { contentPos: number; node: ProseMirrorNode };
type PreservedListContainer = { position: number; node: ProseMirrorNode };

function listDepth(position: ResolvedPos): number {
  let depth = 0;
  for (let index = 1; index <= position.depth; index += 1)
    if (["bulletList", "orderedList"].includes(position.node(index).type.name)) depth += 1;
  return Math.max(0, depth - 1);
}

function listIndent(value: unknown): number {
  const indent = Number(value);
  return Number.isInteger(indent) ? Math.max(0, Math.min(8, indent)) : 0;
}

function inheritedListIndent(position: ResolvedPos, beforeDepth = position.depth + 1): number {
  let indent = listDepth(position);
  for (let depth = 1; depth < beforeDepth; depth += 1) {
    const node = position.node(depth);
    if (node.type.name === "listItem") indent += listIndent(node.attrs.semloEditorListIndent);
  }
  return indent;
}

/** Only derive flat-list paths when there are no physically nested list nodes. */
function isPhysicallyFlatList(list: ProseMirrorNode): boolean {
  let nested = false;
  list.descendants((node) => {
    if (["bulletList", "orderedList", "taskList"].includes(node.type.name)) nested = true;
    return !nested;
  });
  return !nested;
}

function originalListItems(
  state: EditorState,
  selected: ReadonlySet<number>,
  normalizedFlatOrdered: ReadonlySet<number>,
  restartHeading: RestartHeadingCase | null,
): OriginalListItem[] {
  const items: OriginalListItem[] = [];
  const lists = new Map<
    number,
    {
      flat: boolean;
      start: number;
      removedBefore: number[];
      ordinals: Array<number | null>;
      paths: Array<number[] | null>;
      known: boolean[];
    }
  >();
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "listItem" || !node.firstChild?.isTextblock) return;
    const resolved = state.doc.resolve(pos + 2);
    let ordinal: number | null = null;
    let normalizedFlat = false;
    let listAttrs: Readonly<Record<string, unknown>> | null = null;
    let ancestorPath: number[] | null = null;
    let ancestorKnown = false;
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      if (resolved.node(depth).type.name !== "listItem") continue;
      const list = resolved.node(depth - 1);
      if (list.type.name === "orderedList") {
        const listPos = resolved.before(depth - 1);
        let info = lists.get(listPos);
        if (!info) {
          info = {
            flat: true,
            start: Number(list.attrs.start ?? 1),
            removedBefore: [],
            ordinals: Array(list.childCount).fill(null),
            paths: Array(list.childCount).fill(null),
            known: Array(list.childCount).fill(false),
          };
          let removed = 0;
          const retainedIndices: number[] = [];
          const retainedIndents: unknown[] = [];
          const retainedRestarts: boolean[] = [];
          list.forEach((item, offset, index) => {
            info!.removedBefore.push(removed);
            const indent = Number(item.attrs.semloEditorListIndent ?? 0);
            const isSelected = selected.has(listPos + 2 + offset);
            if (indent !== 0) info!.flat = false;
            if (!isSelected) {
              retainedIndices.push(info!.removedBefore.length - 1);
              retainedIndents.push(item.attrs.semloEditorListIndent);
              // Removing the restarted item creates a new segment. The
              // observed successor begins again at 1 without inheriting the
              // removed item's persistent restart attribute.
              const startsNewSegment =
                restartHeading?.listPos === listPos &&
                restartHeading.selectedWasRestart &&
                index === restartHeading.selectedIndex + 1;
              retainedRestarts.push(item.attrs.semloEditorListRestart === true || startsNewSegment);
            }
            if (isSelected) removed += 1;
          });
          if (normalizedFlatOrdered.has(listPos)) {
            const originalPath = normalizeOrderedAncestorPath(list.attrs.semloEditorOrderedAncestorPath);
            // A path without explicit level seeds does not establish how a
            // non-default first-level start should move to another level.
            // Preserve the document until that transition is verified.
            const ambiguousStart =
              originalPath &&
              list.attrs.semloEditorListLevelStarts == null &&
              info.start !== 1 &&
              retainedIndents.length > 0 &&
              listIndent(retainedIndents[0]) !== listIndent(list.firstChild?.attrs.semloEditorListIndent);
            // In a previously split list, start belongs to the original first
            // level. If that level disappears, retain the seed of the new one.
            const rebased = retainedIndents.length
              ? rebaseOrderedListLevelStarts(list, retainedIndents[0])
              : { ok: true as const, attrs: null };
            const values =
              !ambiguousStart && rebased.ok
                ? deriveOrderedListValues(
                    retainedIndents,
                    rebased.attrs?.start ?? info.start,
                    rebased.attrs ? rebased.attrs.semloEditorListLevelStarts : list.attrs.semloEditorListLevelStarts,
                    retainedRestarts,
                  )
                : [];
            const trackPaths =
              isPhysicallyFlatList(list) && (list.attrs.semloEditorOrderedStyle === "decimal" || originalPath);
            const levels: number[] = originalPath ? [...originalPath] : [];
            // Distinguish actual retained ancestors from the default 1s used
            // to display an independent list beginning at a deeper level.
            const known: boolean[] = originalPath ? originalPath.map(() => true) : [];
            retainedIndices.forEach((index, valueIndex) => {
              info!.ordinals[index] = values[valueIndex] ?? null;
              if (trackPaths) {
                const level = Number(retainedIndents[valueIndex] ?? 0);
                if (values[valueIndex] === undefined) return;
                levels[level] = values[valueIndex];
                levels.length = level + 1;
                known[level] = true;
                known.length = level + 1;
                info!.paths[index] = Array.from({ length: level }, (_, depth) => levels[depth] ?? 1);
                info!.known[index] = known.slice(0, level).some(Boolean);
              }
            });
          }
          lists.set(listPos, info);
        }
        if (normalizedFlatOrdered.has(listPos)) {
          const itemIndex = resolved.index(depth - 1);
          normalizedFlat = true;
          listAttrs = list.attrs;
          ordinal = info.ordinals[itemIndex];
          ancestorPath = info.paths[itemIndex];
          ancestorKnown = info.known[itemIndex];
        } else if (info.flat && Number.isSafeInteger(info.start)) {
          const itemIndex = resolved.index(depth - 1);
          ordinal = info.start + itemIndex - info.removedBefore[itemIndex];
        }
      }
      break;
    }
    items.push({
      contentPos: pos + 2,
      depth: listDepth(resolved),
      effectiveIndent: inheritedListIndent(resolved),
      ordinal,
      normalizedFlat,
      listAttrs,
      ancestorPath,
      ancestorKnown,
      firstChild: node.firstChild,
      attrs: node.attrs,
    });
  });
  return items;
}

function unselectedListBlocks(state: EditorState, selected: ReadonlySet<number>): PreservedListBlock[] {
  const blocks: PreservedListBlock[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock || selected.has(pos)) return;
    const position = state.doc.resolve(pos + 1);
    for (let depth = position.depth - 1; depth > 0; depth -= 1) {
      if (position.node(depth).type.name === "listItem") {
        blocks.push({ contentPos: pos + 1, node });
        break;
      }
    }
  });
  return blocks;
}

function preservedListBlocks(transaction: Transaction, blocks: readonly PreservedListBlock[]): boolean {
  const seen = new Set<number>();
  for (const block of blocks) {
    const mapped = transaction.mapping.mapResult(block.contentPos, 1);
    if (mapped.deletedAcross) return false;
    const resolved = transaction.doc.resolve(mapped.pos);
    if (!resolved.parent.isTextblock || !resolved.parent.eq(block.node)) return false;
    const pos = resolved.before();
    if (seen.has(pos)) return false;
    seen.add(pos);
  }
  return true;
}

/** Retain unselected wrappers/atoms; optionally require nested list subtrees to stay intact too. */
function unselectedListContainers(
  state: EditorState,
  selected: ReadonlySet<number>,
  preserveListSubtrees = false,
): PreservedListContainer[] {
  const result: PreservedListContainer[] = [];
  const selectedPositions = [...selected].sort((left, right) => left - right);
  state.doc.descendants((node, pos) => {
    if (
      !node.isBlock ||
      node.isTextblock ||
      node.type.name === "listItem" ||
      (!preserveListSubtrees && ["bulletList", "orderedList"].includes(node.type.name))
    )
      return true;
    let low = 0,
      high = selectedPositions.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (selectedPositions[middle] <= pos) low = middle + 1;
      else high = middle;
    }
    if (low < selectedPositions.length && selectedPositions[low] < pos + node.nodeSize) return true;
    const position = state.doc.resolve(pos);
    for (let depth = position.depth; depth > 0; depth -= 1) {
      if (position.node(depth).type.name === "listItem") {
        result.push({ position: pos, node });
        return false;
      }
    }
    return true;
  });
  return result;
}

function preservedListContainers(transaction: Transaction, nodes: readonly PreservedListContainer[]): boolean {
  const seen = new Set<number>();
  for (const { position, node } of nodes) {
    const mapped = transaction.mapping.mapResult(position + (node.isLeaf ? 0 : 1), 1);
    if (mapped.deletedAcross) return false;
    if (node.isLeaf) {
      if (!transaction.doc.nodeAt(mapped.pos)?.eq(node) || seen.has(mapped.pos)) return false;
      seen.add(mapped.pos);
      continue;
    }
    const resolved = transaction.doc.resolve(mapped.pos);
    let found = -1;
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      if (resolved.node(depth).eq(node)) {
        found = resolved.before(depth);
        break;
      }
    }
    if (found < 0 || seen.has(found)) return false;
    seen.add(found);
  }
  return true;
}

/** Reject a transformation that reorders unselected text or non-list blocks. */
function preservedListOrder(
  transaction: Transaction,
  blocks: readonly PreservedListBlock[],
  containers: readonly PreservedListContainer[],
): boolean {
  const positions = [
    ...blocks.map((block) => block.contentPos),
    ...containers.map(({ position, node }) => position + (node.isLeaf ? 0 : 1)),
  ].sort((left, right) => left - right);
  let previous = -1;
  for (const position of positions) {
    const mapped = transaction.mapping.mapResult(position, 1);
    if (mapped.deletedAcross || mapped.pos < previous) return false;
    previous = mapped.pos;
  }
  return true;
}

/** Retain each selected textblock until the intentional mark cleanup runs. */
function preservedSelectedHeadings(transaction: Transaction, blocks: readonly OriginalBlock[], level: number): boolean {
  let previous = -1;
  for (const block of blocks) {
    const mapped = transaction.mapping.mapResult(block.pos + 1, 1);
    if (mapped.deletedAcross) return false;
    const resolved = transaction.doc.resolve(mapped.pos);
    const heading = resolved.parent;
    if (heading.type.name !== "heading" || heading.attrs.level !== level || !heading.content.eq(block.node.content))
      return false;
    const position = resolved.before();
    if (position <= previous) return false;
    previous = position;
  }
  return true;
}

/** Reject loss of host-specific paragraph data in guarded list conversions. */
function preservedParagraphHostAttributes(transaction: Transaction, block: OriginalBlock): boolean {
  try {
    const mapped = transaction.mapping.mapResult(block.pos + 1, 1);
    if (mapped.deletedAcross) return false;
    const heading = transaction.doc.resolve(mapped.pos).parent;
    if (heading.type.name !== "heading" || Object.getOwnPropertySymbols(block.node.attrs).length) return false;
    const normalParagraphAttributes = new Set(["textAlign", "semloEditorIndent", "semloEditorLineHeight"]);
    const definitions = block.node.type.spec.attrs ?? {};
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(block.node.attrs))) {
      if (!("value" in descriptor)) return false;
      if (normalParagraphAttributes.has(name)) continue;
      if (Object.hasOwn(heading.attrs, name) && Object.is(heading.attrs[name], descriptor.value)) continue;
      const definition = definitions[name];
      const defaultValue = definition && Object.getOwnPropertyDescriptor(definition, "default");
      if (!defaultValue || !("value" in defaultValue) || !Object.is(defaultValue.value, descriptor.value)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Keep this special path conservative around host-defined attributes. */
function hasSimpleAttributes(node: ProseMirrorNode): boolean {
  try {
    if (Object.getOwnPropertySymbols(node.attrs).length) return false;
    return Object.values(Object.getOwnPropertyDescriptors(node.attrs)).every((entry) => {
      if (!("value" in entry)) return false;
      const value = entry.value;
      return (
        value == null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      );
    });
  } catch {
    return false;
  }
}

/** A single text block directly in a quote inside a physically nested list item. */
function nestedQuoteHeadingCandidate(state: EditorState, blocks: readonly OriginalBlock[], target: number): boolean {
  try {
    const selection = state.selection;
    if (
      !Number.isInteger(target) ||
      target < 0 ||
      target > 6 ||
      !(selection instanceof TextSelection) ||
      selection.ranges.length !== 1 ||
      !selection.$anchor.sameParent(selection.$head) ||
      blocks.length !== 1 ||
      !["paragraph", "heading"].includes(blocks[0].type) ||
      (!target && blocks[0].type !== "heading") ||
      blocks[0].unsupportedOrdered
    )
      return false;
    const position = selection.$anchor;
    const original = position.parent;
    if (
      original.type.name === "heading" &&
      (!Number.isInteger(original.attrs.level) ||
        original.attrs.level < 1 ||
        original.attrs.level > 6 ||
        original.attrs.semloEditorHeadingNumbering != null)
    )
      return false;
    const quoteDepth = position.depth - 1;
    const quote = position.node(quoteDepth);
    if (quote.type.name !== "blockquote" || !hasSimpleAttributes(original) || !hasSimpleAttributes(quote)) return false;
    const itemDepth = quoteDepth - 1;
    const item = position.node(itemDepth);
    if (item.type.name !== "listItem") return false;
    let hasChildList = false;
    item.forEach((child) => {
      if (child.type.name === "bulletList" || child.type.name === "orderedList") hasChildList = true;
    });
    if (!hasChildList) return false;
    // Accept only a chain of list items and lists directly rooted in the
    // document. A custom outer container needs separately verified semantics.
    let listCount = 0;
    for (let depth = itemDepth; depth > 0; depth -= 2) {
      const ancestor = position.node(depth);
      const list = position.node(depth - 1);
      if (
        ancestor.type.name !== "listItem" ||
        !["bulletList", "orderedList"].includes(list.type.name) ||
        !hasSimpleAttributes(ancestor) ||
        !hasSimpleAttributes(list)
      )
        return false;
      const indent = ancestor.attrs.semloEditorListIndent;
      if (indent != null && (typeof indent !== "number" || !Number.isInteger(indent) || indent < 0 || indent > 8))
        return false;
      const start = list.attrs.start;
      if (
        list.type.name === "orderedList" &&
        (typeof start !== "number" || !Number.isInteger(start) || start < -2147483648 || start > 2147483647)
      )
        return false;
      listCount += 1;
      if (depth - 2 === 0) break;
      if (depth - 2 < 0) return false;
    }
    if (listCount < 2) return false;
    const replacement = state.schema.nodes[target ? "heading" : "paragraph"];
    const index = position.index(quoteDepth);
    if (!replacement || !replacement.isTextblock || !quote.canReplaceWith(index, index + 1, replacement)) return false;
    if (!replacement.validContent(original.content)) return false;
    // Number inheritance within this nested quote has not been observed.
    let numbered = false;
    quote.descendants((node) => {
      if (node.type.name === "heading" && node.attrs.semloEditorHeadingNumbering != null) numbered = true;
      return !numbered;
    });
    return !numbered;
  } catch {
    return false;
  }
}

/** Verify that the staged command changed exactly the selected text block. */
function preservedNestedQuoteTransform(
  state: EditorState,
  transaction: Transaction,
  block: OriginalBlock,
  target: number,
): boolean {
  try {
    const replacement = transaction.doc.nodeAt(block.pos);
    if (
      !replacement ||
      replacement.type.name !== (target ? "heading" : "paragraph") ||
      (target !== 0 && (replacement.attrs.level !== target || replacement.attrs.semloEditorHeadingNumbering != null)) ||
      !hasSimpleAttributes(replacement) ||
      !replacement.content.eq(block.node.content)
    )
      return false;
    // Do not silently discard selected block attributes supplied by hosts.
    for (const [name, value] of Object.entries(block.node.attrs)) {
      if (block.type === "heading" && name === "level") continue;
      if (Object.hasOwn(replacement.attrs, name)) {
        if (replacement.attrs[name] !== value) return false;
      } else if (value !== block.node.type.spec.attrs?.[name]?.default) return false;
    }
    const expected = state.tr.setNodeMarkup(block.pos, replacement.type, replacement.attrs, replacement.marks);
    return expected.doc.eq(transaction.doc);
  } catch {
    return false;
  }
}

/** Preserve visual depth when lifting an actual nested list into flat siblings. */
function restoreListIndent(
  transaction: Transaction,
  originals: readonly OriginalListItem[],
  selected: ReadonlySet<number>,
): boolean {
  const corrections = new Map<number, number>();
  const starts = new Map<number, number>();
  for (const original of originals) {
    if (selected.has(original.contentPos - 1)) continue;
    if (original.normalizedFlat && original.ordinal === null) return false;
    const mapped = transaction.mapping.mapResult(original.contentPos, 1);
    if (mapped.deletedAcross) {
      if (original.depth || original.ordinal !== null) return false;
      continue;
    }
    const resolved = transaction.doc.resolve(mapped.pos);
    let found = false;
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      const item = resolved.node(depth);
      if (item.type.name !== "listItem") continue;
      if (!item.firstChild?.eq(original.firstChild)) break;
      const oldAttrs = { ...original.attrs, semloEditorListIndent: null };
      const newAttrs = { ...item.attrs, semloEditorListIndent: null };
      if (JSON.stringify(oldAttrs) !== JSON.stringify(newAttrs)) return false;
      found = true;
      const next = original.effectiveIndent - inheritedListIndent(resolved, depth);
      if (next < 0 || next > 8) return false;
      if (item.attrs.semloEditorListIndent !== next) corrections.set(resolved.before(depth), next);
      const parentDepth = depth - 1;
      const list = resolved.node(parentDepth);
      if (
        !original.normalizedFlat &&
        original.ordinal !== null &&
        list.type.name === "orderedList" &&
        resolved.index(parentDepth) === 0
      ) {
        if (Number(list.attrs.start ?? 1) !== original.ordinal)
          starts.set(resolved.before(parentDepth), original.ordinal);
      }
      break;
    }
    if (!found && (original.depth || original.ordinal !== null)) return false;
  }
  for (const [pos, start] of starts) {
    const node = transaction.doc.nodeAt(pos);
    if (node?.type.name === "orderedList") transaction.setNodeMarkup(pos, undefined, { ...node.attrs, start });
  }
  for (const [pos, indent] of corrections) {
    const node = transaction.doc.nodeAt(pos);
    if (node?.type.name === "listItem")
      transaction.setNodeMarkup(pos, undefined, { ...node.attrs, semloEditorListIndent: indent });
  }
  // Each split can begin with inherited counters at several levels. Preserve
  // those initial values in list metadata, then verify the entire split using
  // the same derivation as the editor's displayed and exported markers.
  const splits = new Map<
    number,
    {
      ordinals: Array<number | null>;
      paths: Array<number[] | null>;
      known: boolean[];
      attrs: Readonly<Record<string, unknown>>;
    }
  >();
  for (const original of originals) {
    if (!original.normalizedFlat || selected.has(original.contentPos - 1)) continue;
    const mapped = transaction.mapping.mapResult(original.contentPos, 1);
    if (mapped.deletedAcross || original.ordinal === null || !original.listAttrs) return false;
    const resolved = transaction.doc.resolve(mapped.pos);
    let verified = false;
    for (let depth = resolved.depth; depth > 1; depth -= 1) {
      const item = resolved.node(depth);
      if (item.type.name !== "listItem") continue;
      const listDepth = depth - 1;
      const list = resolved.node(listDepth);
      if (list.type.name !== "orderedList" || resolved.node(listDepth - 1).type.name !== "doc") return false;
      const beforeAttrs = { ...original.listAttrs, start: null, semloEditorListLevelStarts: null };
      const afterAttrs = { ...list.attrs, start: null, semloEditorListLevelStarts: null };
      if (JSON.stringify(beforeAttrs) !== JSON.stringify(afterAttrs)) return false;
      const listPos = resolved.before(listDepth);
      let split = splits.get(listPos);
      if (!split) {
        split = {
          ordinals: Array(list.childCount).fill(null),
          paths: Array(list.childCount).fill(null),
          known: Array(list.childCount).fill(false),
          attrs: original.listAttrs,
        };
        splits.set(listPos, split);
      } else if (
        JSON.stringify(normalizeOrderedListLevelStarts(split.attrs.semloEditorListLevelStarts)) !==
        JSON.stringify(normalizeOrderedListLevelStarts(original.listAttrs.semloEditorListLevelStarts))
      ) {
        return false;
      }
      const index = resolved.index(listDepth);
      if (split.ordinals[index] !== null && split.ordinals[index] !== original.ordinal) return false;
      split.ordinals[index] = original.ordinal;
      split.paths[index] = original.ancestorPath;
      split.known[index] = original.ancestorKnown;
      verified = true;
      break;
    }
    if (!verified) return false;
  }
  for (const [pos, split] of splits) {
    const list = transaction.doc.nodeAt(pos);
    if (!list || list.type.name !== "orderedList" || split.ordinals.some((value) => value === null)) return false;
    const ordinals = split.ordinals as number[];
    const indents: number[] = [];
    const restarts: boolean[] = [];
    list.forEach((child) => {
      indents.push(Number(child.attrs.semloEditorListIndent ?? 0));
      restarts.push(child.attrs.semloEditorListRestart === true);
    });
    let ancestorPath: number[] | null | undefined;
    if (split.paths.some((path) => path !== null)) {
      if (split.paths.some((path) => path === null)) return false;
      const paths = split.paths as number[][];
      const first = paths[0];
      if (first.length !== indents[0]) return false;
      if (!split.known[0] && first.some((value) => value !== 1)) return false;
      ancestorPath = first.length && split.known[0] ? first : null;
      const levels = [...first];
      for (let index = 0; index < indents.length; index += 1) {
        const level = indents[index];
        levels[level] = ordinals[index];
        levels.length = level + 1;
        const expected = paths[index];
        if (expected.length !== level) return false;
        for (let depth = 0; depth < level; depth += 1) if ((levels[depth] ?? 1) !== expected[depth]) return false;
      }
    }
    const start = ordinals[0];
    const levelStarts = { ...normalizeOrderedListLevelStarts(split.attrs.semloEditorListLevelStarts) };
    const current = deriveOrderedListValues(indents, start, levelStarts, restarts);
    if (current.some((value, index) => value !== ordinals[index])) {
      const seen = new Set<number>([indents[0]]);
      for (let index = 1; index < indents.length; index += 1) {
        const indent = indents[index];
        if (seen.has(indent)) continue;
        seen.add(indent);
        if (ordinals[index] === 1) delete levelStarts[String(indent)];
        else levelStarts[String(indent)] = ordinals[index];
      }
      const adjusted = deriveOrderedListValues(indents, start, levelStarts, restarts);
      if (adjusted.some((value, index) => value !== ordinals[index])) return false;
    }
    const storedStarts = Object.keys(levelStarts).length ? levelStarts : null;
    if (
      Number(list.attrs.start ?? 1) !== start ||
      JSON.stringify(list.attrs.semloEditorListLevelStarts ?? null) !== JSON.stringify(storedStarts) ||
      (ancestorPath !== undefined &&
        JSON.stringify(list.attrs.semloEditorOrderedAncestorPath ?? null) !== JSON.stringify(ancestorPath))
    )
      transaction.setNodeMarkup(pos, undefined, {
        ...list.attrs,
        start,
        semloEditorListLevelStarts: storedStarts,
        ...(ancestorPath !== undefined ? { semloEditorOrderedAncestorPath: ancestorPath } : {}),
      });
  }
  return true;
}

function selectedBlocks(state: EditorState): OriginalBlock[] {
  const result = new Map<number, OriginalBlock>();
  const orderedSupport = new Map<number, { unsupported: boolean; normalizedFlat: boolean; nestedCustom: boolean }>();
  const add = (node: ProseMirrorNode, pos: number) => {
    if (!node.isTextblock || result.has(pos)) return;
    const resolved = state.doc.resolve(pos + 1);
    let listItem = false;
    let hasNestedList = false;
    let insideContainer = false;
    let unsupportedOrdered = false;
    let normalizedFlatOrderedPos: number | null = null;
    let nestedCustomOrdered = false;
    for (let depth = resolved.depth - 1; depth > 0; depth -= 1) {
      if (
        resolved.node(depth).type.name === "listItem" &&
        ["bulletList", "orderedList"].includes(resolved.node(depth - 1).type.name)
      ) {
        listItem = true;
        const list = resolved.node(depth - 1);
        if (list.type.name === "orderedList") {
          const listPos = resolved.before(depth - 1);
          let support = orderedSupport.get(listPos);
          if (!support) {
            const start = Number(list.attrs.start ?? 1);
            const last = start + list.childCount - 1;
            const customStart = start !== 1;
            const directDocument = resolved.node(depth - 2).type.name === "doc";
            const singleTextblock =
              state.selection.ranges.length === 1 &&
              state.selection.$from.sameParent(state.selection.$to) &&
              state.selection.$from.start() - 1 === pos;
            const plainAttributes = Object.entries(list.attrs).every(
              ([name, value]) =>
                name === "start" ||
                (name === "semloEditorListFirstContinue" && value === false) ||
                ([
                  "type",
                  "semloEditorListLevelStarts",
                  "semloEditorOrderedStyle",
                  "semloEditorOrderedAncestorPath",
                  "semloEditorListQuoteChain",
                  "semloEditorListTaskChain",
                  sequenceRegistryAttribute,
                  sequenceLinkAttribute,
                ].includes(name) &&
                  value === null),
            );
            // Only the observed two-level nested bullet/ordered structure is
            // opened here. Other custom-start structures remain conservative.
            const nestedBullet =
              depth === 4 &&
              resolved.node(depth - 2).type.name === "listItem" &&
              resolved.node(depth - 3).type.name === "bulletList" &&
              resolved.node(depth - 4).type.name === "doc";
            const nestedCustom = customStart && !directDocument && nestedBullet && singleTextblock && plainAttributes;
            const indents: number[] = [];
            let validItems = true;
            list.forEach((child) => {
              const indent = child.attrs.semloEditorListIndent ?? 0;
              if (
                typeof indent !== "number" ||
                !Number.isInteger(indent) ||
                indent < 0 ||
                indent > 8 ||
                child.type.name !== "listItem" ||
                child.firstChild?.type.name !== "paragraph"
              )
                validItems = false;
              indents.push(Number(indent));
            });
            const normalizedFlat =
              directDocument &&
              validItems &&
              (indents.some((indent) => indent !== 0) || list.attrs.semloEditorListLevelStarts != null);
            // HTML's ordered-list start is a signed 32-bit integer. Out-of-range
            // split starts would display as 1 even if the document retained them.
            let unsupported =
              !Number.isSafeInteger(start) ||
              !Number.isSafeInteger(last) ||
              (customStart &&
                ((!directDocument && !nestedCustom) ||
                  start < -2147483648 ||
                  start > 2147483647 ||
                  (!normalizedFlat && last > 2147483647)));
            if (
              list.attrs.semloEditorListLevelStarts != null &&
              (!normalizedFlat || !normalizeOrderedListLevelStarts(list.attrs.semloEditorListLevelStarts))
            )
              unsupported = true;
            if (list.attrs.semloEditorOrderedAncestorPath != null) {
              const path = normalizeOrderedAncestorPath(list.attrs.semloEditorOrderedAncestorPath);
              if (!path || path.length !== indents[0] || !directDocument || !isPhysicallyFlatList(list))
                unsupported = true;
            }
            list.forEach((child) => {
              if (Number(child.attrs.semloEditorListIndent ?? 0) !== 0 && !normalizedFlat) unsupported = true;
              if (
                customStart &&
                !normalizedFlat &&
                (child.childCount !== 1 || child.firstChild?.type.name !== "paragraph")
              )
                unsupported = true;
            });
            support = { unsupported, normalizedFlat, nestedCustom };
            orderedSupport.set(listPos, support);
          }
          unsupportedOrdered =
            support.unsupported ||
            (support.normalizedFlat && (resolved.node(depth).firstChild !== node || node.type.name !== "paragraph"));
          if (support.normalizedFlat) normalizedFlatOrderedPos = listPos;
          nestedCustomOrdered = support.nestedCustom;
        }
        resolved.node(depth).forEach((child) => {
          if (child.type.name === "bulletList" || child.type.name === "orderedList") hasNestedList = true;
        });
        break;
      }
      const ancestor = resolved.node(depth);
      if (ancestor.isBlock && !ancestor.isTextblock && !["bulletList", "orderedList"].includes(ancestor.type.name))
        insideContainer = true;
    }
    result.set(pos, {
      pos,
      node,
      type: node.type.name,
      listItem,
      listDepth: listDepth(resolved),
      hasNestedList,
      unsupportedContainer: listItem && insideContainer,
      unsupportedOrdered,
      normalizedFlatOrderedPos,
      nestedCustomOrdered,
      numbering: headingNumberingStyle(node.attrs.semloEditorHeadingNumbering),
    });
  };
  for (const range of state.selection.ranges) {
    if (range.$from.pos === range.$to.pos) {
      add(range.$from.parent, range.$from.start() - 1);
    } else {
      state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
        if (!node.isTextblock) return true;
        add(node, pos);
        return false;
      });
    }
  }
  return [...result.values()].sort((left, right) => left.pos - right.pos);
}

function listHasRestart(list: ProseMirrorNode): boolean {
  if (!["bulletList", "orderedList"].includes(list.type.name)) return false;
  let found = false;
  list.forEach((item) => {
    const restart = item.attrs.semloEditorListRestart;
    // Undefined allows the pre-attribute schema. Any malformed value is
    // conservative as well: this path must not discard host data.
    if (restart !== undefined && restart !== false) found = true;
  });
  return found;
}

/** A selected item may split its ancestor lists or lift its own nested lists. */
function affectedListHasAttribute(
  state: EditorState,
  blocks: readonly OriginalBlock[],
  hasAttribute: (node: ProseMirrorNode) => boolean,
  allowedListPos: number | null,
): boolean {
  for (const block of blocks) {
    if (!block.listItem) continue;
    const position = state.doc.resolve(block.pos + 1);
    let selectedItem: ProseMirrorNode | undefined;
    for (let depth = position.depth - 1; depth > 0; depth -= 1) {
      const node = position.node(depth);
      if (node.type.name !== "listItem") continue;
      selectedItem ??= node;
      if (hasAttribute(position.node(depth - 1)) && position.before(depth - 1) !== allowedListPos) return true;
    }
    if (!selectedItem) return true;
    let nestedAttribute = false;
    selectedItem.descendants((node) => {
      if (hasAttribute(node)) nestedAttribute = true;
      return !nestedAttribute;
    });
    if (nestedAttribute) return true;
  }
  return false;
}

function listHasFirstContinue(list: ProseMirrorNode): boolean {
  if (list.type.name !== "orderedList") return false;
  const mode = list.attrs.semloEditorListFirstContinue;
  // Undefined supports schemas from before this attribute existed. Refuse
  // malformed explicit values rather than silently discarding host data.
  return mode !== undefined && mode !== false;
}

/**
 * An edge item of a simple root list leaves one list with its original mode.
 * A middle split and more complex structures need separately verified rules.
 */
function firstContinueHeadingCase(
  state: EditorState,
  blocks: readonly OriginalBlock[],
  target: number,
): FirstContinueHeadingCase | null {
  try {
    if (
      !target ||
      blocks.length !== 1 ||
      blocks[0].type !== "paragraph" ||
      !(state.selection instanceof TextSelection) ||
      state.selection.ranges.length !== 1 ||
      !state.selection.$anchor.sameParent(state.selection.$head)
    )
      return null;
    const position = state.doc.resolve(blocks[0].pos + 1);
    if (position.depth !== 3 || position.node(2).type.name !== "listItem") return null;
    const list = position.node(1);
    if (
      list.type.name !== "orderedList" ||
      list.attrs.semloEditorListFirstContinue !== true ||
      list.attrs.start !== 1 ||
      list.childCount < 2 ||
      !isPhysicallyFlatList(list)
    )
      return null;
    const selectedIndex = position.index(1);
    if (selectedIndex !== 0 && selectedIndex !== list.childCount - 1) return null;
    let valid = true;
    let retainedContentPos = -1;
    const retainedItems: ProseMirrorNode[] = [];
    const listPos = position.before(1);
    list.forEach((item, offset, index) => {
      if (
        item.type.name !== "listItem" ||
        item.childCount !== 1 ||
        item.firstChild?.type.name !== "paragraph" ||
        item.attrs.semloEditorListIndent !== 0 ||
        (index === selectedIndex && !hasOnlyDefaultCustomAttributes(item, discardableItemAttrs))
      )
        valid = false;
      if (index !== selectedIndex) {
        retainedItems.push(item);
        if (retainedContentPos < 0) retainedContentPos = listPos + offset + 3;
      }
    });
    if (!valid || retainedContentPos < 0) return null;
    return { listPos, retainedContentPos, retainedList: list.copy(Fragment.fromArray(retainedItems)) };
  } catch {
    return null;
  }
}

function preservedFirstContinueHeading(transaction: Transaction, candidate: FirstContinueHeadingCase): boolean {
  try {
    const mapped = transaction.mapping.mapResult(candidate.retainedContentPos, 1);
    if (mapped.deletedAcross) return false;
    const position = transaction.doc.resolve(mapped.pos);
    return position.depth >= 2 && position.node(1).eq(candidate.retainedList);
  } catch {
    return false;
  }
}

/** Preserve host-defined data on nodes that will disappear during extraction. */
function hasOnlyDefaultCustomAttributes(node: ProseMirrorNode, discardable: ReadonlySet<string>): boolean {
  try {
    if (node.marks.length || Object.getOwnPropertySymbols(node.attrs).length) return false;
    const attributes = node.type.spec.attrs ?? {};
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(node.attrs))) {
      if (!("value" in descriptor)) return false;
      if (discardable.has(name)) continue;
      const definition = attributes[name];
      const defaultValue = definition && Object.getOwnPropertyDescriptor(definition, "default");
      if (!defaultValue || !("value" in defaultValue) || !Object.is(descriptor.value, defaultValue.value)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const discardableItemAttrs = new Set(["semloEditorListIndent", "semloEditorListFolded"]);
const discardableOrderedListAttrs = new Set([
  "start",
  "type",
  "semloEditorOrderedStyle",
  "semloEditorListLevelStarts",
  "semloEditorOrderedAncestorPath",
]);

/**
 * Known restart-to-heading cases have a flat decimal list with same-level,
 * nonadjacent restarts and a single selected item at or just before a restart.
 * Other layouts remain protected until their semantics are established.
 */
function restartHeadingCase(
  state: EditorState,
  blocks: readonly OriginalBlock[],
  target: number,
): RestartHeadingCase | null {
  try {
    const selection = state.selection;
    if (
      target !== 3 ||
      !(selection instanceof TextSelection) ||
      selection.ranges.length !== 1 ||
      !selection.$anchor.sameParent(selection.$head) ||
      blocks.length !== 1 ||
      blocks[0].type !== "paragraph" ||
      !blocks[0].listItem ||
      blocks[0].unsupportedOrdered
    )
      return null;
    const position = state.doc.resolve(blocks[0].pos + 1);
    if (
      position.depth !== 3 ||
      position.node(1).type.name !== "orderedList" ||
      position.node(2).type.name !== "listItem" ||
      position.index(2) !== 0
    )
      return null;
    const list = position.node(1);
    if (
      list.attrs.start !== 1 ||
      list.attrs.type != null ||
      list.attrs.semloEditorOrderedStyle !== "decimal" ||
      list.attrs.semloEditorListLevelStarts != null ||
      list.attrs.semloEditorOrderedAncestorPath != null ||
      !hasOnlyDefaultCustomAttributes(list, discardableOrderedListAttrs)
    )
      return null;
    const indents: number[] = [];
    const restartIndices: number[] = [];
    let invalid = false;
    list.forEach((item, _offset, index) => {
      const indent = item.attrs.semloEditorListIndent;
      const restart = item.attrs.semloEditorListRestart;
      if (
        item.type.name !== "listItem" ||
        item.childCount !== 1 ||
        item.firstChild?.type.name !== "paragraph" ||
        typeof indent !== "number" ||
        !Number.isInteger(indent) ||
        indent < 0 ||
        indent > 8 ||
        (index === 0 ? indent !== 0 : indent > indents[index - 1] + 1) ||
        item.attrs.semloEditorListFolded !== false ||
        (restart !== false && restart !== true)
      )
        invalid = true;
      if (restart === true) restartIndices.push(index);
      indents.push(Number(indent));
    });
    const selectedIndex = position.index(1);
    const selectedWasRestart = position.node(2).attrs.semloEditorListRestart === true;
    const restartIndex = selectedWasRestart ? selectedIndex : selectedIndex + 1;
    const level = indents[restartIndex];
    if (
      invalid ||
      !restartIndices.includes(restartIndex) ||
      level < 1 ||
      restartIndices.some(
        (index, order) =>
          index < 1 ||
          index + 1 >= list.childCount ||
          indents[index] !== level ||
          indents[index - 1] !== level ||
          indents[index + 1] !== level ||
          (order > 0 && index - restartIndices[order - 1] < 2),
      )
    )
      return null;
    const selectedItem = position.node(2);
    if (!hasOnlyDefaultCustomAttributes(selectedItem, new Set([...discardableItemAttrs, "semloEditorListRestart"])))
      return null;
    return { listPos: position.before(1), selectedIndex, selectedWasRestart };
  } catch {
    return null;
  }
}

/** A block-menu list group is a contiguous selection of flat, single-paragraph ordered items. */
function flatOrderedParagraphSelection(state: EditorState, blocks: readonly OriginalBlock[]): boolean {
  if (!(state.selection instanceof TextSelection) || state.selection.ranges.length !== 1 || !blocks.length)
    return false;
  const first = blocks[0],
    last = blocks[blocks.length - 1];
  if (state.selection.from !== first.pos + 1 || state.selection.to !== last.pos + last.node.nodeSize - 1) return false;
  let listPos: number | null = null;
  let list: ProseMirrorNode | null = null;
  let firstIndex = -1;
  let lastIndex = -1;
  for (const block of blocks) {
    if (block.type !== "paragraph" || !block.listItem || block.unsupportedOrdered) return false;
    if (Number(block.node.attrs.semloEditorIndent ?? 0) !== 0) return false;
    const $inside = state.doc.resolve(block.pos + 1);
    if (
      $inside.depth !== 3 ||
      $inside.node(1).type.name !== "orderedList" ||
      $inside.node(2).type.name !== "listItem" ||
      $inside.index(2) !== 0 ||
      $inside.node(2).childCount !== 1
    )
      return false;
    const item = $inside.node(2);
    if (
      !Number.isInteger(item.attrs.semloEditorListIndent) ||
      item.attrs.semloEditorListIndent < 0 ||
      item.attrs.semloEditorListIndent > 8 ||
      typeof item.attrs.semloEditorListFolded !== "boolean" ||
      !hasOnlyDefaultCustomAttributes(item, discardableItemAttrs)
    )
      return false;
    const position = $inside.before(1);
    if (listPos === null) {
      listPos = position;
      list = $inside.node(1);
      if (!isPhysicallyFlatList(list)) return false;
    } else if (listPos !== position) return false;
    const index = $inside.index(1);
    if (firstIndex < 0) firstIndex = index;
    else if (index !== lastIndex + 1) return false;
    lastIndex = index;
  }
  if (list) {
    const removesList = firstIndex === 0 && lastIndex === list.childCount - 1;
    const splitsList = firstIndex > 0 && lastIndex < list.childCount - 1;
    if ((removesList || splitsList) && !hasOnlyDefaultCustomAttributes(list, discardableOrderedListAttrs)) return false;
  }
  return true;
}

function headingPlan(
  state: EditorState,
  level: HeadingStyleLevel,
  options: { toggle?: boolean; preserveInlineMarks?: boolean },
) {
  const selected = getHeadingSelection(state);
  const target = level && options.toggle && selected.headingsOnly && selected.level === level ? 0 : level;
  const originalSelection = state.selection;
  let originalBlocks: OriginalBlock[];
  let flatOrderedParagraphs = false;
  try {
    if (target) originalBlocks = selectedBlocks(state);
    else {
      // Paragraph conversion normally uses the established command path. Only a
      // deep list quote containing a selected heading needs the stricter guard.
      const blocks = selectedBlocks(state);
      flatOrderedParagraphs = !!options.preserveInlineMarks && flatOrderedParagraphSelection(state, blocks);
      if (options.preserveInlineMarks && blocks.some((block) => block.listItem) && !flatOrderedParagraphs) return null;
      originalBlocks =
        blocks.some(
          (block) =>
            block.type === "heading" &&
            block.listItem &&
            block.hasNestedList &&
            block.listDepth > 0 &&
            block.unsupportedContainer,
        ) || flatOrderedParagraphs
          ? blocks
          : [];
    }
  } catch {
    return null;
  }
  const deepNestedParent = originalBlocks.some((block) => block.listItem && block.hasNestedList && block.listDepth > 0);
  const stagedSelection =
    flatOrderedParagraphs ||
    deepNestedParent ||
    originalBlocks.some((block) => block.normalizedFlatOrderedPos !== null);
  const nestedQuoteHeading = stagedSelection && nestedQuoteHeadingCandidate(state, originalBlocks, target);
  const restartHeading = restartHeadingCase(state, originalBlocks, target);
  const firstContinueHeading = firstContinueHeadingCase(state, originalBlocks, target);
  if (
    (!nestedQuoteHeading &&
      (affectedListHasAttribute(state, originalBlocks, listHasRestart, restartHeading?.listPos ?? null) ||
        affectedListHasAttribute(
          state,
          originalBlocks,
          listHasFirstContinue,
          firstContinueHeading?.listPos ?? null,
        ))) ||
    originalBlocks.some((block) => block.unsupportedOrdered) ||
    (stagedSelection && originalBlocks.some((block) => block.unsupportedContainer) && !nestedQuoteHeading)
  )
    return null;
  const selectedPositions = new Set(originalBlocks.map((block) => block.pos));
  const normalizedFlatOrdered = new Set(
    originalBlocks.flatMap((block) =>
      block.normalizedFlatOrderedPos === null ? [] : [block.normalizedFlatOrderedPos],
    ),
  );
  const listItems =
    !nestedQuoteHeading && originalBlocks.some((block) => block.listItem)
      ? originalListItems(state, selectedPositions, normalizedFlatOrdered, restartHeading)
      : [];
  const preserved = listItems.length ? unselectedListBlocks(state, selectedPositions) : [];
  const preservedRestartLists: PreservedListContainer[] = [];
  const preservedFirstContinueLists: PreservedListContainer[] = [];
  if (listItems.length) {
    state.doc.descendants((node, position) => {
      if (listHasRestart(node) && position !== restartHeading?.listPos) preservedRestartLists.push({ position, node });
      if (listHasFirstContinue(node) && position !== firstContinueHeading?.listPos)
        preservedFirstContinueLists.push({ position, node });
    });
  }
  const preservedContainers = listItems.length
    ? unselectedListContainers(
        state,
        selectedPositions,
        normalizedFlatOrdered.size > 0 || originalBlocks.some((block) => block.nestedCustomOrdered),
      )
    : [];
  return {
    selected,
    target,
    originalSelection,
    originalBlocks,
    flatOrderedParagraphs,
    deepNestedParent,
    stagedSelection,
    nestedQuoteHeading,
    restartHeading,
    firstContinueHeading,
    selectedPositions,
    normalizedFlatOrdered,
    listItems,
    preserved,
    preservedRestartLists,
    preservedFirstContinueLists,
    preservedContainers,
  };
}

/** Apply an explicit paragraph/heading choice and clean the complete affected blocks. */
export function setHeadingStyle(
  editor: Editor,
  level: HeadingStyleLevel,
  options: {
    toggle?: boolean;
    preserveInlineMarks?: boolean;
    selection?: { from: number; to: number };
    focus?: boolean;
    joinQuoteHistory?: boolean;
  } = {},
): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  if (selectionHasNumberingSequences(editor.state, options.selection?.from, options.selection?.to))
    return convertSequenceTextblocks(editor, level, options);
  const joinQuoteHistory = options.joinQuoteHistory === true && canJoinQuoteHeading(editor.state, level);
  const preplanned = options.selection ? null : headingPlan(editor.state, level, options);
  if (!options.selection && !preplanned) return false;
  const initialDoc = editor.state.doc;
  let attempted: Transaction | undefined;
  const chain = editor.chain();
  if (options.focus !== false) chain.focus();
  const result = chain
    .command(({ tr, commands, state }) => {
      attempted = tr;
      const reject = () => {
        tr.setMeta("preventDispatch", true);
        return false;
      };
      if (options.selection) {
        try {
          const { from, to } = options.selection;
          if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > tr.doc.content.size)
            return reject();
          if (!tr.doc.resolve(from).parent.inlineContent || !tr.doc.resolve(to).parent.inlineContent) return reject();
          tr.setSelection(TextSelection.create(tr.doc, from, to));
          // Tiptap's chainable state refreshes its cached selection via tr.
          void state.tr;
        } catch {
          return reject();
        }
      }
      const plan = preplanned ?? headingPlan(state, level, options);
      if (!plan) return reject();
      const conversionHints: Array<{ pos: number; value: unknown }> = [];
      const firstRoot = state.selection.$from.index(0),
        lastRoot = state.selection.$to.index(0);
      state.doc.forEach((node, pos, index) => {
        if (index < firstRoot || index > lastRoot || !["paragraph", "heading"].includes(node.type.name)) return;
        const value = node.attrs[sequenceConversionHintAttribute];
        if (value != null) conversionHints.push({ pos, value });
      });
      const {
        selected,
        target,
        originalSelection,
        originalBlocks,
        flatOrderedParagraphs,
        deepNestedParent,
        stagedSelection,
        nestedQuoteHeading,
        restartHeading,
        firstContinueHeading,
        selectedPositions,
        normalizedFlatOrdered,
        listItems,
        preserved,
        preservedRestartLists,
        preservedFirstContinueLists,
        preservedContainers,
      } = plan;
      if (!joinQuoteHistory) closeHistory(tr);
      let converted: boolean;
      // List commands map positions from their initial transaction document.
      // Stage each required command from the current document, then append its
      // steps to the single transaction that will be dispatched or discarded.
      const stagedCommand = (command: "lift" | "heading" | "paragraph") => {
        // Match Tiptap's chainable state: plugin fields remain at the last
        // committed state until the final transaction is dispatched.
        const staged = EditorState.create({ doc: tr.doc, selection: tr.selection, storedMarks: tr.storedMarks }).tr;
        const fresh = createChainableState({ state: editor.state, transaction: staged });
        if (!joinQuoteHistory) closeHistory(staged);
        const setMeta = staged.setMeta.bind(staged);
        const getMeta = staged.getMeta.bind(staged);
        const presence = EditorState.create({ doc: tr.doc, selection: tr.selection }).tr;
        const changedMetaKeys: Array<Parameters<Transaction["setMeta"]>[0]> = [];
        staged.setMeta = (key, value) => {
          presence.setMeta(key, true);
          if (!changedMetaKeys.includes(key)) changedMetaKeys.push(key);
          return setMeta(key, value);
        };
        staged.getMeta = (key) => (presence.getMeta(key) ? getMeta(key) : tr.getMeta(key));
        const chain = new CommandManager({ editor, state: fresh }).createChain(staged);
        const ok =
          command === "lift"
            ? chain.liftListItem("listItem").run()
            : command === "heading"
              ? chain.setHeading({ level: target as 1 | 2 | 3 | 4 | 5 | 6 }).run()
              : chain.setParagraph().run();
        if (!ok || staged.getMeta("preventDispatch")) return false;
        for (const step of staged.steps) tr.step(step);
        if (!staged.doc.eq(tr.doc)) return false;
        tr.setSelection(staged.selection.map(tr.doc, new Mapping()));
        if (staged.storedMarksSet) tr.setStoredMarks(staged.storedMarks);
        if (staged.scrolledIntoView) tr.scrollIntoView();
        for (const key of changedMetaKeys) {
          tr.setMeta(key, staged.getMeta(key));
        }
        return true;
      };
      const listItemDepth = () => {
        const position = tr.selection.$from;
        let depth = 0;
        for (let index = 1; index <= position.depth; index += 1)
          if (position.node(index).type.name === "listItem") depth += 1;
        return depth;
      };
      const selectedItemHasNestedList = () => {
        const position = tr.selection.$from;
        for (let depth = position.depth; depth > 0; depth -= 1) {
          const node = position.node(depth);
          if (node.type.name !== "listItem") continue;
          let nested = false;
          node.forEach((child) => {
            if (child.type.name === "bulletList" || child.type.name === "orderedList") nested = true;
          });
          return nested;
        }
        return false;
      };
      const liftSelectedItem = (staged = false) => {
        let depth = listItemDepth();
        while (depth > 0) {
          const textblock = tr.selection.$from.parent;
          void state.tr;
          if (!(staged ? stagedCommand("lift") : commands.liftListItem("listItem"))) return false;
          const next = listItemDepth();
          if (next >= depth || !tr.selection.$from.parent.eq(textblock)) return false;
          depth = next;
        }
        return true;
      };
      try {
        if (nestedQuoteHeading) {
          converted = stagedCommand(target ? "heading" : "paragraph");
          if (!converted || !preservedNestedQuoteTransform(editor.state, tr, originalBlocks[0], target)) {
            tr.setMeta("preventDispatch", true);
            return false;
          }
          // The structure and selected text are unchanged apart from the node
          // type, so both ends (including reverse selections) retain positions.
          tr.setSelection(TextSelection.create(tr.doc, originalSelection.anchor, originalSelection.head));
        } else if (flatOrderedParagraphs) {
          for (const block of [...originalBlocks].reverse()) {
            const originalItem = listItems.find((item) => item.contentPos - 1 === block.pos);
            const indent = originalItem?.effectiveIndent ?? -1;
            if (!originalItem || !Number.isInteger(indent) || indent > 8 || indent < 0) {
              tr.setMeta("preventDispatch", true);
              return false;
            }
            const mapped = tr.mapping.map(block.pos + 1, 1);
            const position = tr.doc.resolve(mapped);
            if (!position.parent.isTextblock) {
              tr.setMeta("preventDispatch", true);
              return false;
            }
            tr.setSelection(TextSelection.create(tr.doc, mapped));
            if (!liftSelectedItem(true)) {
              tr.setMeta("preventDispatch", true);
              return false;
            }
            const $paragraph = tr.selection.$from;
            if ($paragraph.depth !== 1 || $paragraph.parent.type.name !== "paragraph") {
              tr.setMeta("preventDispatch", true);
              return false;
            }
            if (Number($paragraph.parent.attrs.semloEditorIndent ?? 0) !== indent)
              tr.setNodeMarkup($paragraph.before(), undefined, {
                ...$paragraph.parent.attrs,
                semloEditorIndent: indent,
              });
          }
          tr.setSelection(originalSelection.map(tr.doc, tr.mapping));
          converted = true;
        } else if (target && originalBlocks.length > 1 && originalBlocks.some((block) => block.listItem)) {
          for (const block of [...originalBlocks].reverse()) {
            const mapped = tr.mapping.map(block.pos + 1, 1);
            const position = tr.doc.resolve(mapped);
            if (!position.parent.isTextblock) {
              tr.setMeta("preventDispatch", true);
              return false;
            }
            tr.setSelection(TextSelection.create(tr.doc, mapped));
            void state.tr;
            if (stagedSelection) {
              if (block.hasNestedList && selectedItemHasNestedList() && !liftSelectedItem(true)) {
                tr.setMeta("preventDispatch", true);
                return false;
              }
            } else if (block.hasNestedList && block.listDepth === 0) {
              commands.liftListItem("listItem");
            }
            void state.tr;
            const changed = stagedSelection ? stagedCommand("heading") : commands.setHeading({ level: target });
            if (
              !changed &&
              !(tr.selection.$from.parent.type.name === "heading" && tr.selection.$from.parent.attrs.level === target)
            ) {
              tr.setMeta("preventDispatch", true);
              return false;
            }
          }
          tr.setSelection(originalSelection.map(tr.doc, tr.mapping));
          converted = true;
        } else {
          if (
            target &&
            originalBlocks.length === 1 &&
            originalBlocks[0].hasNestedList &&
            tr.selection.$from.sameParent(tr.selection.$to)
          ) {
            if (deepNestedParent && !liftSelectedItem()) {
              tr.setMeta("preventDispatch", true);
              return false;
            }
            if (!deepNestedParent && normalizedFlatOrdered.size > 0 && !liftSelectedItem(true)) {
              tr.setMeta("preventDispatch", true);
              return false;
            }
            if (!stagedSelection && originalBlocks[0].listDepth === 0) commands.liftListItem("listItem");
          }
          void state.tr;
          converted = target
            ? normalizedFlatOrdered.size > 0
              ? stagedCommand("heading")
              : commands.setHeading({ level: target })
            : commands.setParagraph();
        }
      } catch {
        // Some host-defined list structures cannot be lifted safely. Discard
        // the whole transaction instead of applying a partial conversion.
        tr.setMeta("preventDispatch", true);
        return false;
      }
      if (!converted && selected.level !== target) {
        tr.setMeta("preventDispatch", true);
        return false;
      }
      for (const hint of conversionHints) {
        const mapped = tr.mapping.mapResult(hint.pos + 1, 1);
        if (mapped.deletedAcross) return reject();
        const position = tr.doc.resolve(mapped.pos);
        const block = position.parent;
        if (
          position.depth !== 1 ||
          !["paragraph", "heading"].includes(block.type.name) ||
          !Object.hasOwn(block.type.spec.attrs ?? {}, sequenceConversionHintAttribute) ||
          (block.attrs[sequenceConversionHintAttribute] != null &&
            block.attrs[sequenceConversionHintAttribute] !== hint.value)
        )
          return reject();
        if (block.attrs[sequenceConversionHintAttribute] !== hint.value)
          tr.setNodeMarkup(position.before(), undefined, {
            ...block.attrs,
            [sequenceConversionHintAttribute]: hint.value,
          });
      }
      if (
        listItems.length &&
        ((normalizedFlatOrdered.size > 0 && target && !preservedSelectedHeadings(tr, originalBlocks, target)) ||
          ((restartHeading || firstContinueHeading) && !preservedParagraphHostAttributes(tr, originalBlocks[0])) ||
          !preservedListBlocks(tr, preserved) ||
          !preservedListContainers(tr, preservedContainers) ||
          !preservedListOrder(tr, preserved, preservedContainers) ||
          !restoreListIndent(tr, listItems, selectedPositions) ||
          !preservedListContainers(tr, preservedRestartLists) ||
          !preservedListContainers(tr, preservedFirstContinueLists) ||
          (firstContinueHeading && !preservedFirstContinueHeading(tr, firstContinueHeading)))
      ) {
        tr.setMeta("preventDispatch", true);
        return false;
      }
      const typeName = target ? "heading" : "paragraph";
      if (target) {
        const updated = new Set<number>();
        for (const block of originalBlocks) {
          const mapped = tr.mapping.map(block.pos + 1, 1);
          const resolved = tr.doc.resolve(mapped);
          if (resolved.parent.type.name !== "heading") continue;
          const headingPos = resolved.before();
          if (updated.has(headingPos)) continue;
          updated.add(headingPos);
          const heading = resolved.parent;
          const numbering = nestedQuoteHeading
            ? null
            : block.type === "heading"
              ? block.numbering
              : block.listItem
                ? (inheritedHeadingNumbering(tr.doc, headingPos, target) ?? "mixed")
                : block.type === "paragraph"
                  ? inheritedHeadingNumbering(tr.doc, headingPos, target)
                  : null;
          if (heading.attrs.semloEditorHeadingNumbering !== numbering)
            tr.setNodeMarkup(headingPos, undefined, { ...heading.attrs, semloEditorHeadingNumbering: numbering });
        }
      }
      const blocks = new Map<number, number>();
      for (const range of tr.selection.ranges) {
        const from = range.$from.pos;
        const to = range.$to.pos;
        if (from === to) {
          if (range.$from.parent.type.name === typeName) blocks.set(range.$from.start(), range.$from.end());
        } else {
          tr.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name !== typeName) return !node.isTextblock;
            blocks.set(pos + 1, pos + node.nodeSize - 1);
            return false;
          });
        }
      }
      if (!blocks.size) {
        tr.setMeta("preventDispatch", true);
        return false;
      }
      // Block-menu list extraction retains its inline formatting; toolbar and
      // keyboard paragraph conversion continue to use the existing cleanup.
      if (options.preserveInlineMarks && flatOrderedParagraphs) return true;
      clearHeadingInlineFormat(tr, blocks);
      if (joinQuoteHistory) markJoinedQuoteHeading(tr);
      return true;
    })
    .run();
  // A host filterTransaction may reject the candidate despite a successful
  // Tiptap command result. Keep the block menu and current selection intact.
  if (result && attempted?.docChanged && !editor.isDestroyed && editor.state.doc.eq(initialDoc)) return false;
  if (result && !editor.isDestroyed && !joinQuoteHistory)
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  return result;
}
