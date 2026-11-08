import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { safeIndent } from "../../shared/indent";
import { mixedRomanLabel, mixedRomanMarker } from "./mixed-roman";
import { hasNumberingSequences, sequenceListValues } from "./numbering-sequence-document";
import { deriveOrderedListValues, normalizeOrderedListLevelStarts, validOrderedListStart } from "./numbering-values";
export { deriveOrderedListValues, normalizeOrderedListLevelStarts, validOrderedListStart } from "./numbering-values";

const orderedMarkerTypes: Readonly<Record<string, string>> = {
  "1": "decimal",
  a: "lower-alpha",
  A: "upper-alpha",
  i: "lower-roman",
  I: "upper-roman",
};
const orderedMarkers = ["decimal", "lower-alpha", mixedRomanMarker] as const;

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

/** 原生 CSS counter 的文字投影只负责格式化，不另建编号状态。 */
function counterLabel(value: number, marker: string): string {
  if (marker === mixedRomanMarker) return mixedRomanLabel(value);
  if ((marker === "lower-alpha" || marker === "upper-alpha") && value >= 1) {
    let label = "";
    for (let remaining = value; remaining > 0; remaining = Math.floor((remaining - 1) / 26))
      label = String.fromCharCode(97 + ((remaining - 1) % 26)) + label;
    return marker === "upper-alpha" ? label.toUpperCase() : label;
  }
  if ((marker === "lower-roman" || marker === "upper-roman") && value >= 1 && value <= 3999) {
    let remaining = value,
      label = "";
    for (const [number, digit] of [
      [1000, "M"],
      [900, "CM"],
      [500, "D"],
      [400, "CD"],
      [100, "C"],
      [90, "XC"],
      [50, "L"],
      [40, "XL"],
      [10, "X"],
      [9, "IX"],
      [5, "V"],
      [4, "IV"],
      [1, "I"],
    ] as const)
      while (remaining >= number) {
        label += digit;
        remaining -= number;
      }
    return marker === "lower-roman" ? label.toLowerCase() : label;
  }
  return String(value);
}

/** 供剪贴板读取当前可见原生编号；自定义样式仍由 orderedListLabels 覆盖。 */
export function orderedListPlainLabels(doc: ProseMirrorNode): ReadonlyMap<number, string> {
  const result = new Map<number, string>();
  for (const list of orderedLists(doc)) {
    const values = sequenceListValues(list.node, list.parentList === "orderedList");
    list.node.forEach((item, offset, index) => {
      if (list.node.attrs.type && !Object.hasOwn(orderedMarkerTypes, String(list.node.attrs.type))) return;
      result.set(list.pos + 1 + offset, `${counterLabel(values[index], orderedListMarker(list, item) ?? "decimal")}.`);
    });
  }
  return result;
}

/** Return the visible numbers of a flat or nested ordered list when needed. */
function orderedListOrdinals(list: OrderedListLayout): number[] | null {
  if (hasNumberingSequences(list.node)) return sequenceListValues(list.node);
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
