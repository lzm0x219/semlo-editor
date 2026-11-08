import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { formatChineseNumber } from "../../shared/chinese-number";
import { rejoinSequenceParagraphs } from "./numbering-sequence-bridge";
import { sequenceListValues } from "./numbering-sequence-document";
import { normalizeOrderedAncestorPath } from "./ordered-path";
import { rememberOrderedStyle } from "./ordered-preference";
import { convertOneTask, hasTaskSelection } from "./task-list-conversion";
export { normalizeOrderedAncestorPath } from "./ordered-path";

export type OrderedListStyle = "mixed" | "chinese" | "decimal";
const key = new PluginKey<DecorationSet>("semloEditorOrderedListStyle");

function styleValue(value: unknown): OrderedListStyle | null {
  return value === "mixed" || value === "chinese" || value === "decimal" ? value : null;
}

function parseAncestorPath(element: HTMLElement): number[] | null {
  const raw = element.getAttribute("data-semlo-editor-ordered-ancestor-path");
  if (!raw || raw.length > 128) return null;
  try {
    return normalizeOrderedAncestorPath(JSON.parse(raw));
  } catch {
    return null;
  }
}

type Marker = { listPos: number; itemPos: number; itemIndex: number; label: string };

function markers(doc: ProseMirrorNode): Marker[] {
  const result: Marker[] = [];
  const paths = new Map<number, number[]>();
  const styles = new Map<number, OrderedListStyle>();
  doc.descendants((list, listPos) => {
    if (list.type.name !== "orderedList") return true;
    const resolved = doc.resolve(listPos);
    let parentPath: number[] = [];
    let inherited: OrderedListStyle = "mixed";
    let orderedParent = false;
    for (let depth = resolved.depth; depth > 0; depth--) {
      const ancestor = resolved.node(depth);
      if (ancestor.type.name === "listItem" && !parentPath.length) parentPath = paths.get(resolved.before(depth)) ?? [];
      if (ancestor.type.name === "orderedList") {
        inherited = styles.get(resolved.before(depth)) ?? "mixed";
        orderedParent = true;
        break;
      }
    }
    const style = styleValue(list.attrs.semloEditorOrderedStyle) ?? inherited;
    styles.set(listPos, style);
    const items: ProseMirrorNode[] = [];
    list.forEach((item) => items.push(item));
    const indents = items.map((item) => {
      const indent = Number(item.attrs.semloEditorListIndent);
      return Number.isInteger(indent) ? Math.max(0, Math.min(8, indent)) : 0;
    });
    const values = sequenceListValues(list, orderedParent);
    const explicitPath = normalizeOrderedAncestorPath(list.attrs.semloEditorOrderedAncestorPath);
    const levels: number[] = !parentPath.length && explicitPath?.length === indents[0] ? [...explicitPath] : [];
    list.forEach((item, offset, index) => {
      const level = indents[index];
      levels[level] = values[index];
      levels.length = level + 1;
      const path = [...parentPath, ...Array.from({ length: level + 1 }, (_, depth) => levels[depth] ?? 1)];
      const itemPos = listPos + 1 + offset;
      paths.set(itemPos, path);
      if (style === "mixed") return;
      const depth = path.length - 1;
      const value = values[index];
      const label =
        style === "decimal"
          ? `${path.join(".")}.`
          : depth % 3 === 0
            ? `${formatChineseNumber(value)}、`
            : depth % 3 === 1
              ? `(${formatChineseNumber(value)})`
              : `${value}.`;
      result.push({ listPos, itemPos, itemIndex: index, label });
    });
    return true;
  });
  return result;
}

/** Visible custom labels, indexed by list-item document position. */
export function orderedListLabels(doc: ProseMirrorNode): ReadonlyMap<number, string> {
  return new Map(markers(doc).map(({ itemPos, label }) => [itemPos, label]));
}

function markerStyle(label: string): string {
  return `list-style-type: ${JSON.stringify(`${label} `)}`;
}

function decorations(doc: ProseMirrorNode): DecorationSet {
  return DecorationSet.create(
    doc,
    markers(doc).flatMap(({ itemPos, label }) => {
      const item = doc.nodeAt(itemPos);
      return item ? [Decoration.node(itemPos, itemPos + item.nodeSize, { style: markerStyle(label) })] : [];
    }),
  );
}

export const OrderedListStyles = Extension.create({
  name: "semloEditorOrderedListStyles",
  addGlobalAttributes() {
    return [
      {
        types: ["orderedList"],
        attributes: {
          semloEditorOrderedStyle: {
            default: null,
            parseHTML: (element: HTMLElement) => styleValue(element.getAttribute("data-semlo-editor-ordered-style")),
            renderHTML: (attributes: Record<string, unknown>) => {
              const style = styleValue(attributes.semloEditorOrderedStyle);
              return style ? { "data-semlo-editor-ordered-style": style } : {};
            },
          },
          semloEditorOrderedAncestorPath: {
            default: null,
            parseHTML: parseAncestorPath,
            renderHTML: (attributes: Record<string, unknown>) => {
              const path = normalizeOrderedAncestorPath(attributes.semloEditorOrderedAncestorPath);
              return path ? { "data-semlo-editor-ordered-ancestor-path": JSON.stringify(path) } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (tr, previous) => (tr.docChanged ? decorations(tr.doc) : previous),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

/** Choose a style for the current ordered list, creating one at a paragraph. */
export function setOrderedListStyle(editor: Editor, style: OrderedListStyle): boolean {
  if (!styleValue(style) || editor.isDestroyed || !editor.isEditable) return false;
  const rejoin = rejoinSequenceParagraphs(editor.state, { semloEditorOrderedStyle: style });
  if (rejoin === false) return false;
  if (rejoin) {
    const before = editor.state.doc;
    editor.view.dispatch(rejoin);
    if (editor.isDestroyed || editor.state.doc.eq(before)) return false;
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    rememberOrderedStyle(editor, style);
    editor.view.focus();
    return true;
  }
  const task = convertOneTask(editor, "orderedList", { semloEditorOrderedStyle: style });
  if (task !== null) {
    if (task) rememberOrderedStyle(editor, style);
    return task;
  }
  if (hasTaskSelection(editor, true)) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  let chain = editor.chain().focus();
  if (!editor.isActive("orderedList")) chain = chain.toggleOrderedList();
  const result = chain
    .command(({ tr }) => {
      const { $from } = tr.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        const list = $from.node(depth);
        if (list.type.name !== "orderedList") continue;
        const pos = $from.before(depth);
        tr.setNodeMarkup(pos, undefined, { ...list.attrs, semloEditorOrderedStyle: style });
        return true;
      }
      return false;
    })
    .run();
  if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  if (result) rememberOrderedStyle(editor, style);
  return result;
}

/** Retain visible custom markers in standalone HTML as well as their style metadata. */
export function serializeOrderedListStyles(html: string, document: Document, doc: ProseMirrorNode): string {
  const custom = markers(doc);
  if (!custom.length) return html;
  const lists: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "orderedList") lists.push(pos);
  });
  const template = document.createElement("template");
  template.innerHTML = html;
  const elements = Array.from(template.content.querySelectorAll("ol"));
  if (elements.length !== lists.length) return html;
  for (const marker of custom) {
    const list = elements[lists.indexOf(marker.listPos)];
    const item = list && Array.from(list.children).filter((element) => element.localName === "li")[marker.itemIndex];
    if (item) (item as HTMLElement).style.listStyleType = JSON.stringify(`${marker.label} `);
  }
  return template.innerHTML;
}
