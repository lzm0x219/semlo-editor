import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";

import { MAX_INDENT, safeIndent } from "../../shared/indent";
import { normalizeOrderedAncestorPath } from "../list/ordered-path";
import {
  listOrdinals,
  normalizeOrderedListLevelStarts,
  rebaseOrderedListLevelStarts,
  validOrderedListStart,
} from "../list/ordinals";

/** Supported multipliers mirror the choices in the editor's line-height menu. */
export const LINE_HEIGHT_VALUES = ["1", "1.15", "1.5", "2", "2.5", "3"] as const;
export type LineHeight = (typeof LINE_HEIGHT_VALUES)[number];
const textblockNames = new Set(["paragraph", "heading"]);
const listItemNames = new Set(["listItem", "taskItem"]);

function safeLineHeight(value: unknown): LineHeight | null {
  const normalized = typeof value === "number" ? String(value) : value;
  return typeof normalized === "string" && (LINE_HEIGHT_VALUES as readonly string[]).includes(normalized)
    ? (normalized as LineHeight)
    : null;
}

function parseOrderedListLevelStarts(element: HTMLElement): Record<string, number> | null {
  const serialized = element.getAttribute("data-semlo-editor-list-level-starts");
  if (!serialized || serialized.length > 256) return null;
  try {
    return normalizeOrderedListLevelStarts(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function parseIndent(element: HTMLElement, attribute = "data-semlo-editor-indent"): number {
  const stored = element.getAttribute(attribute);
  if (stored !== null) return safeIndent(stored);
  const match = /^(\d+(?:\.\d+)?)em$/.exec(element.style.marginLeft.trim());
  return match ? safeIndent(Number(match[1]) / 2) : 0;
}
function parseLineHeight(element: HTMLElement): LineHeight | null {
  const stored = element.getAttribute("data-semlo-editor-line-height");
  return safeLineHeight(stored === null ? element.style.lineHeight.trim() : stored);
}

const listOrdinalsKey = new PluginKey<DecorationSet>("semloEditorListOrdinals");
type SelectedBlock = { node: ProseMirrorNode; pos: number };
function selectedBlocks(editor: Editor): SelectedBlock[] {
  const { doc, selection } = editor.state;
  const blocks: SelectedBlock[] = [];
  const positions = new Set<number>();
  const add = (node: ProseMirrorNode, pos: number) => {
    if (textblockNames.has(node.type.name) && !positions.has(pos)) {
      positions.add(pos);
      blocks.push({ node, pos });
    }
  };
  for (const range of selection.ranges) {
    const from = range.$from.pos,
      to = range.$to.pos;
    if (from === to) {
      for (let depth = range.$from.depth; depth > 0; depth--) {
        const node = range.$from.node(depth);
        if (textblockNames.has(node.type.name)) {
          add(node, range.$from.before(depth));
          break;
        }
      }
    } else
      doc.nodesBetween(from, to, (node, pos) => {
        add(node, pos);
      });
  }
  return blocks;
}

/** List levels are independent item attributes so even the first item can be indented. */
function indentTargets(editor: Editor): SelectedBlock[] {
  const targets = new Map<number, SelectedBlock>();
  for (const block of selectedBlocks(editor)) {
    const $inside = editor.state.doc.resolve(block.pos + 1);
    let target = block;
    for (let depth = $inside.depth; depth > 0; depth--) {
      const node = $inside.node(depth);
      if (listItemNames.has(node.type.name)) {
        target = { node, pos: $inside.before(depth) };
        break;
      }
    }
    targets.set(target.pos, target);
  }
  return [...targets.values()];
}

function updateNodes(
  editor: Editor,
  nodes: SelectedBlock[],
  attrsFor: (node: ProseMirrorNode, pos: number) => Record<string, unknown> | null,
): boolean {
  if (!editor.isEditable || editor.isDestroyed) return false;
  let transaction = closeHistory(editor.state.tr);
  let changed = false;
  for (const { node, pos } of nodes) {
    const attrs = attrsFor(node, pos);
    if (!attrs) continue;
    transaction = transaction.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
    changed = true;
  }
  if (!changed) return false;
  editor.view.dispatch(transaction);
  // Isolate the toolbar action from adjacent typing and other layout changes.
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  return true;
}

/** Increase or decrease selected paragraphs or entire list items without changing list order. */
export function adjustParagraphIndent(editor: Editor, direction: -1 | 1): boolean {
  if (editor.isDestroyed || !editor.isEditable || (direction !== -1 && direction !== 1)) return false;
  const targets = indentTargets(editor);
  const listChanges = new Map<number, { node: ProseMirrorNode; attrs: Record<string, unknown> }>();
  const checkedPaths = new Map<number, number[]>();
  for (const target of targets) {
    if (target.node.type.name !== "listItem") continue;
    const position = editor.state.doc.resolve(target.pos);
    const list = position.parent;
    if (list.type.name !== "orderedList" || position.depth < 1) continue;
    const listPos = position.before(position.depth);
    const rawPath = list.attrs.semloEditorOrderedAncestorPath;
    if (rawPath != null && !checkedPaths.has(listPos)) {
      const path = normalizeOrderedAncestorPath(rawPath);
      const firstIndent = safeIndent(list.firstChild?.attrs.semloEditorListIndent);
      let nested = false;
      list.descendants((node) => {
        if (["bulletList", "orderedList", "taskList"].includes(node.type.name)) nested = true;
        return !nested && !node.isTextblock;
      });
      const rawStarts = list.attrs.semloEditorListLevelStarts;
      const start = validOrderedListStart(list.attrs.start);
      if (
        !path ||
        path.length !== firstIndent ||
        position.depth !== 1 ||
        nested ||
        start === null ||
        (rawStarts != null && !normalizeOrderedListLevelStarts(rawStarts)) ||
        (rawStarts == null && start !== 1)
      )
        return false;
      checkedPaths.set(listPos, path);
    }
    if (position.index() !== 0) continue;
    const current = safeIndent(target.node.attrs.semloEditorListIndent);
    const next = Math.max(0, Math.min(MAX_INDENT, current + direction));
    if (next === current) continue;
    const rebased = rebaseOrderedListLevelStarts(list, next);
    if (!rebased.ok) return false;
    const attrs: Record<string, unknown> = { ...rebased.attrs };
    const path = checkedPaths.get(listPos);
    if (path) {
      const nextPath = next > current ? [...path, 1] : path.slice(0, next);
      attrs.semloEditorOrderedAncestorPath = nextPath.length ? nextPath : null;
    }
    if (Object.keys(attrs).length) listChanges.set(listPos, { node: list, attrs });
  }
  const lists = [...listChanges].map(([pos, change]) => ({ node: change.node, pos }));
  return updateNodes(editor, [...targets, ...lists], (node, pos) => {
    const listChange = listChanges.get(pos);
    if (listChange) return listChange.attrs;
    const attribute = listItemNames.has(node.type.name) ? "semloEditorListIndent" : "semloEditorIndent";
    const current = safeIndent(node.attrs[attribute]);
    const next = Math.max(0, Math.min(MAX_INDENT, current + direction));
    return next === current ? null : { [attribute]: next };
  });
}

/** Apply a listed multiplier or null for the editor's default. */
export function setParagraphLineHeight(editor: Editor, value: LineHeight | null): boolean {
  if (editor.isDestroyed || !editor.isEditable || (value !== null && safeLineHeight(value) === null)) return false;
  return updateNodes(editor, selectedBlocks(editor), (node) =>
    safeLineHeight(node.attrs.semloEditorLineHeight) === value ? null : { semloEditorLineHeight: value },
  );
}

/** Undefined represents a mixed selection or one without a paragraph/heading. */
export function getParagraphLineHeight(editor: Editor): LineHeight | null | undefined {
  if (editor.isDestroyed) return undefined;
  const blocks = selectedBlocks(editor);
  if (!blocks.length) return undefined;
  const first = safeLineHeight(blocks[0].node.attrs.semloEditorLineHeight);
  return blocks.every(({ node }) => safeLineHeight(node.attrs.semloEditorLineHeight) === first) ? first : undefined;
}

function stepLineHeight(editor: Editor, direction: -1 | 1): boolean {
  const current = getParagraphLineHeight(editor);
  if (current === undefined) return false;
  // Yuque's first downward step from default is 1.5 in observed selections.
  if (current === null && direction === -1) {
    const { selection } = editor.state;
    const { $from, $to } = selection;
    if (selection instanceof TextSelection && selection.ranges.length === 1) {
      if (
        $from.depth === 1 &&
        $to.depth === 1 &&
        $from.start() === $to.start() &&
        $from.parent.type.name === "heading"
      ) {
        const level = $from.parent.attrs.level;
        if (Number.isInteger(level) && level >= 1 && level <= 6) return setParagraphLineHeight(editor, "1.5");
      }
      if (
        selection.empty &&
        $from.depth === 2 &&
        $from.parent.type.name === "paragraph" &&
        $from.node(1).type.name === "blockquote" &&
        $from.node(1).childCount === 1
      )
        return setParagraphLineHeight(editor, "1.5");
      if (
        selection.empty &&
        $from.depth === 3 &&
        $from.parent.type.name === "paragraph" &&
        $from.node(1).type.name === "details" &&
        $from.node(1).attrs.open === true &&
        $from.node(2).type.name === "detailsContent" &&
        $from.node(2).childCount === 1
      )
        return setParagraphLineHeight(editor, "1.5");
    }
    if (
      selection instanceof TextSelection &&
      selection.ranges.length === 1 &&
      $from.parent.type.name === "paragraph" &&
      $to.parent.type.name === "paragraph"
    ) {
      if ($from.depth === 1 && $to.depth === 1) {
        let paragraphsOnly = true;
        for (let index = $from.index(0); index <= $to.index(0); index++) {
          if (editor.state.doc.child(index).type.name !== "paragraph") {
            paragraphsOnly = false;
            break;
          }
        }
        if (paragraphsOnly) return setParagraphLineHeight(editor, "1.5");
      }
      if (
        $from.depth === 3 &&
        $to.depth === 3 &&
        $from.before(1) === $to.before(1) &&
        $from.index(2) === 0 &&
        $to.index(2) === 0 &&
        (($from.node(2).type.name === "listItem" &&
          $to.node(2).type.name === "listItem" &&
          ($from.node(1).type.name === "orderedList" || $from.node(1).type.name === "bulletList")) ||
          ($from.node(2).type.name === "taskItem" &&
            $to.node(2).type.name === "taskItem" &&
            $from.node(1).type.name === "taskList" &&
            $from.start() === $to.start() &&
            (selection.empty || ($from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size))))
      ) {
        const list = $from.node(1);
        let simpleItems = true;
        if ($from.before(2) !== $to.before(2)) {
          for (let index = $from.index(1); index <= $to.index(1); index++) {
            const item = list.child(index);
            if (item.type.name !== "listItem" || item.childCount !== 1 || item.firstChild?.type.name !== "paragraph") {
              simpleItems = false;
              break;
            }
          }
        }
        let nested = false;
        list.descendants((node) => {
          if (["bulletList", "orderedList", "taskList"].includes(node.type.name)) nested = true;
          return !nested && !node.isTextblock;
        });
        if (simpleItems && !nested) return setParagraphLineHeight(editor, "1.5");
      }
    }
  }
  // The default sits between 1.15 and 2 for relative keyboard adjustments.
  const currentIndex = current === null ? 2 : LINE_HEIGHT_VALUES.indexOf(current);
  const nextIndex = Math.max(0, Math.min(LINE_HEIGHT_VALUES.length - 1, currentIndex + direction));
  if (nextIndex === currentIndex) return false;
  return setParagraphLineHeight(editor, LINE_HEIGHT_VALUES[nextIndex]);
}

export const ParagraphLayout = Extension.create({
  name: "semloEditorParagraphLayout",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          semloEditorIndent: {
            default: 0,
            parseHTML: (element) => parseIndent(element),
            renderHTML: (attributes) => {
              const indent = safeIndent(attributes.semloEditorIndent);
              return indent ? { "data-semlo-editor-indent": indent, style: `margin-left: ${indent * 2}em` } : {};
            },
          },
          semloEditorLineHeight: {
            default: null,
            parseHTML: (element) => parseLineHeight(element),
            renderHTML: (attributes) => {
              const height = safeLineHeight(attributes.semloEditorLineHeight);
              return height ? { "data-semlo-editor-line-height": height, style: `line-height: ${height}` } : {};
            },
          },
        },
      },
      {
        types: ["listItem", "taskItem"],
        attributes: {
          semloEditorListIndent: {
            default: 0,
            parseHTML: (element) => parseIndent(element, "data-semlo-editor-list-indent"),
            renderHTML: (attributes) => {
              const indent = safeIndent(attributes.semloEditorListIndent);
              return indent ? { "data-semlo-editor-list-indent": indent, style: `margin-left: ${indent * 2}em` } : {};
            },
          },
        },
      },
      {
        types: ["orderedList"],
        attributes: {
          semloEditorListLevelStarts: {
            default: null,
            parseHTML: (element) => parseOrderedListLevelStarts(element),
            renderHTML: (attributes) => {
              const starts = normalizeOrderedListLevelStarts(attributes.semloEditorListLevelStarts);
              return starts ? { "data-semlo-editor-list-level-starts": JSON.stringify(starts) } : {};
            },
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-[": () => stepLineHeight(this.editor, -1),
      "Mod-Alt-]": () => stepLineHeight(this.editor, 1),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: listOrdinalsKey,
        state: {
          init: (_config, state) => listOrdinals(state.doc),
          apply: (transaction, previous) => (transaction.docChanged ? listOrdinals(transaction.doc) : previous),
        },
        props: { decorations: (state) => listOrdinalsKey.getState(state) },
      }),
    ];
  },
});
