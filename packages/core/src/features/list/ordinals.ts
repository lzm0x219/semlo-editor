import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { MAX_INDENT, safeIndent } from "../../shared/indent";

/** Validate sparse first values without trusting JSON or HTML supplied by a host. */
export function normalizeOrderedListLevelStarts(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (!keys.length || keys.length > MAX_INDENT + 1 || Object.getOwnPropertySymbols(value).length) return null;
    const result: Record<string, number> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!/^[0-8]$/.test(key) || !("value" in descriptor)) return null;
      const start = descriptor.value;
      if (typeof start !== "number" || !Number.isSafeInteger(start) || start < -2147483648 || start > 2147483647)
        return null;
      result[key] = start;
    }
    return result;
  } catch {
    return null;
  }
}

const orderedMarkerTypes: Readonly<Record<string, string>> = {
  "1": "decimal",
  a: "lower-alpha",
  A: "upper-alpha",
  i: "lower-roman",
  I: "upper-roman",
};
const orderedMarkers = ["decimal", "lower-alpha", "lower-roman"] as const;

export function validOrderedListStart(value: unknown): number | null {
  const parsed =
    typeof value === "number" || (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= -2147483648 && parsed <= 2147483647 ? parsed : null;
}

type RebasedOrderedListStarts =
  | { ok: true; attrs: { start: number; semloEditorListLevelStarts: Record<string, number> | null } | null }
  | { ok: false };

/** Re-encode a split list's absolute level seeds when its first level changes. */
export function rebaseOrderedListLevelStarts(
  list: ProseMirrorNode,
  nextFirstIndent: unknown,
): RebasedOrderedListStarts {
  if (list.type.name !== "orderedList" || !list.firstChild) return { ok: false };
  const current = safeIndent(list.firstChild.attrs.semloEditorListIndent);
  const next = safeIndent(nextFirstIndent);
  const rawStarts = list.attrs.semloEditorListLevelStarts;
  // A plain list's start follows its first item; only split lists have
  // absolute per-level baselines that need to be retained.
  if (current === next || rawStarts == null) return { ok: true, attrs: null };
  const oldStart = validOrderedListStart(list.attrs.start);
  const starts = normalizeOrderedListLevelStarts(rawStarts);
  if (oldStart === null || !starts) return { ok: false };
  const seeds = { ...starts, [String(current)]: oldStart };
  const start = seeds[String(next)] ?? 1;
  delete seeds[String(next)];
  for (const level of Object.keys(seeds)) if (seeds[level] === 1) delete seeds[level];
  return { ok: true, attrs: { start, semloEditorListLevelStarts: Object.keys(seeds).length ? seeds : null } };
}

type OrderedListLayout = {
  node: ProseMirrorNode;
  pos: number;
  ancestorLevel: number;
  parentList: "bulletList" | "orderedList" | null;
};

function orderedLists(doc: ProseMirrorNode): OrderedListLayout[] {
  const lists: OrderedListLayout[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "orderedList") return;
    const position = doc.resolve(pos);
    let ancestorLevel = 0;
    let parentList: OrderedListLayout["parentList"] = null;
    for (let depth = 1; depth <= position.depth; depth += 1) {
      const ancestor = position.node(depth);
      // Both unordered and ordered list ancestors contribute to marker level.
      if (ancestor.type.name === "bulletList" || ancestor.type.name === "orderedList") {
        ancestorLevel += 1;
        parentList = ancestor.type.name;
      }
      if (ancestor.type.name === "listItem") ancestorLevel += safeIndent(ancestor.attrs.semloEditorListIndent);
    }
    lists.push({ node, pos, ancestorLevel, parentList });
  });
  return lists;
}

function orderedListMarker(list: OrderedListLayout, item: ProseMirrorNode): string | null {
  const type = list.node.attrs.type;
  if (type !== null && type !== undefined && type !== "") {
    const key = String(type);
    return Object.hasOwn(orderedMarkerTypes, key) ? orderedMarkerTypes[key] : null;
  }
  const level = list.ancestorLevel + safeIndent(item.attrs.semloEditorListIndent);
  return level ? orderedMarkers[level % orderedMarkers.length] : null;
}

/** Derive the values of one flat list using the first item's actual level. */
export function deriveOrderedListValues(
  indents: readonly unknown[],
  start: unknown,
  levelStarts?: unknown,
  restarts?: readonly unknown[],
): number[] {
  if (!indents.length) return [];
  const counters: number[] = Array(MAX_INDENT + 1).fill(0);
  const started: boolean[] = Array(MAX_INDENT + 1).fill(false);
  const starts = normalizeOrderedListLevelStarts(levelStarts);
  const initialLevel = safeIndent(indents[0]);
  const first = validOrderedListStart(start) ?? 1;
  let restartValues: readonly unknown[] | undefined;
  try {
    if (Array.isArray(restarts)) restartValues = restarts;
  } catch {
    // A malformed host value must not interrupt numbering.
  }
  return indents.map((indent, index) => {
    const level = safeIndent(indent);
    let restart = false;
    try {
      if (restartValues) {
        const descriptor = Object.getOwnPropertyDescriptor(restartValues, String(index));
        restart = !!descriptor && "value" in descriptor && descriptor.value === true;
      }
    } catch {
      // A malformed host value must not interrupt numbering.
    }
    if (restart) {
      counters[level] = 0;
      started[level] = true;
    } else if (!started[level]) {
      counters[level] = (level === initialLevel ? first : (starts?.[String(level)] ?? 1)) - 1;
      started[level] = true;
    }
    // HTML list values are signed 32-bit integers; native markers saturate at
    // the upper bound rather than advancing into an invalid `value` attribute.
    counters[level] = Math.min(2147483647, counters[level] + 1);
    for (let deeper = level + 1; deeper <= MAX_INDENT; deeper += 1) if (started[deeper]) counters[deeper] = 0;
    return counters[level];
  });
}

/** Return the visible numbers of a flat or nested ordered list when needed. */
function orderedListOrdinals(list: OrderedListLayout): number[] | null {
  const indents: unknown[] = [];
  const restarts: unknown[] = [];
  list.node.forEach((item) => {
    indents.push(item.attrs.semloEditorListIndent);
    restarts.push(item.attrs.semloEditorListRestart);
  });
  // A nested ordered list starts its visible sequence at one while it remains
  // inside another ordered list; its stored start is used again after lifting.
  const resetStart = list.parentList === "orderedList";
  const hasRestart = restarts.some((restart) => restart === true);
  if (!indents.some((indent) => safeIndent(indent)) && !resetStart && !hasRestart) return null;
  return deriveOrderedListValues(
    indents,
    resetStart ? 1 : list.node.attrs.start,
    list.node.attrs.semloEditorListLevelStarts,
    hasRestart ? restarts : undefined,
  );
}

/** Derive per-level numbers for flat ordered items without persisting derived values. */
export function listOrdinals(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  for (const list of orderedLists(doc)) {
    const values = orderedListOrdinals(list);
    list.node.forEach((item, offset, index) => {
      const attributes: Record<string, string> = {};
      if (values) attributes.value = String(values[index]);
      const marker = orderedListMarker(list, item);
      if (marker) attributes["data-semlo-editor-ordered-marker"] = marker;
      if (Object.keys(attributes).length) {
        const from = list.pos + 1 + offset;
        decorations.push(Decoration.node(from, from + item.nodeSize, attributes));
      }
    });
  }
  return DecorationSet.create(doc, decorations);
}

/** Add standard HTML list-item values only to the serialized output. */
export function serializeOrderedListOrdinals(html: string, document: Document, root: ProseMirrorNode): string {
  const lists = orderedLists(root);
  const ordinals = lists.map(orderedListOrdinals);
  const markers = lists.map((list) => {
    const values: Array<string | null> = [];
    list.node.forEach((item) => values.push(orderedListMarker(list, item)));
    return values;
  });
  if (
    !ordinals.some(Boolean) &&
    !markers.some((list) => list.some(Boolean)) &&
    !lists.some((list) => list.node.attrs.type === "1")
  )
    return html;

  const template = document.createElement("template");
  template.innerHTML = html;
  const elements = Array.from(template.content.querySelectorAll("ol"));
  // A custom extension may serialize extra <ol> elements outside the document
  // schema. Do not attach derived values to the wrong list in that case.
  if (elements.length !== lists.length) return html;
  for (let index = 0; index < lists.length; index++) {
    const values = ordinals[index];
    const items = Array.from(elements[index].children).filter((element) => element.localName === "li");
    if (items.length !== lists[index].node.childCount) continue;
    if (lists[index].node.attrs.type === "1") elements[index].setAttribute("type", "1");
    items.forEach((item, itemIndex) => {
      if (values) item.setAttribute("value", String(values[itemIndex]));
      const marker = markers[index][itemIndex];
      if (marker) item.setAttribute("data-semlo-editor-ordered-marker", marker);
    });
  }
  return template.innerHTML;
}
