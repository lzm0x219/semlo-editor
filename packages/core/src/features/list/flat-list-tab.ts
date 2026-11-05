import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";

import { adjustParagraphIndent } from "../text/paragraph-layout";

type FlatItem = { list: ProseMirrorNode; listPos: number; itemPos: number; indent: number };

/** Only top-level, flattened ordinary lists have been observed. */
function flatItem(position: ResolvedPos): FlatItem | null {
  if (position.depth !== 3 || position.parent.type.name !== "paragraph") return null;
  const list = position.node(1);
  const item = position.node(2);
  if (
    !["orderedList", "bulletList"].includes(list.type.name) ||
    item.type.name !== "listItem" ||
    item.firstChild !== position.parent
  )
    return null;
  const indent = Number(item.attrs.semloEditorListIndent);
  if (!Number.isInteger(indent) || indent < 0 || indent > 8) return null;
  return { list, listPos: position.before(1), itemPos: position.before(2), indent };
}

function isFlatList(list: ProseMirrorNode): boolean {
  let nested = false;
  list.descendants((node) => {
    if (["bulletList", "orderedList", "taskList"].includes(node.type.name)) nested = true;
    return !nested && !node.isTextblock;
  });
  return !nested;
}

function selectedItems(state: EditorState): { selection: TextSelection; items: FlatItem[] } | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return null;
  const first = flatItem(selection.$from);
  const last = flatItem(selection.$to);
  if (!first || !last || first.listPos !== last.listPos || first.list !== last.list || !isFlatList(first.list))
    return null;

  if (selection.empty) return { selection, items: [first] };
  const selected = new Map<number, FlatItem>();
  let invalid = false;
  state.doc.nodesBetween(selection.from, selection.to, (node, position) => {
    if (!node.isTextblock) return true;
    const item = flatItem(state.doc.resolve(position + 1));
    if (!item || item.listPos !== first.listPos || item.list !== first.list) invalid = true;
    else selected.set(item.itemPos, item);
    return false;
  });
  const items = [...selected.values()];
  return invalid || !items.length ? null : { selection, items };
}

/** Reproduce the observed Tab behavior without intercepting other editor controls. */
export const FlatListTab = Extension.create({
  name: "semloEditorFlatListTab",
  priority: 1002,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("semloEditorFlatListTab"),
        props: {
          handleDOMEvents: {
            keydown(view, event) {
              if (
                event.key !== "Tab" ||
                event.defaultPrevented ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                !view.editable ||
                !view.hasFocus()
              )
                return false;
              const target = selectedItems(view.state);
              if (!target) return false;
              if (event.isComposing || event.keyCode === 229 || view.composing) return true;
              const { selection } = target;
              if (!selection.empty || selection.$from.parentOffset === 0) {
                const direction = event.shiftKey ? -1 : 1;
                // Consume this key even when every item is already at its
                // limit or invalid metadata prevents the command from running.
                // The command clamps each item independently in one transaction.
                event.preventDefault();
                adjustParagraphIndent(editor, direction);
                return true;
              }
              const transaction = closeHistory(view.state.tr).insertText("\t", selection.from);
              transaction.setSelection(TextSelection.create(transaction.doc, selection.from + 1));
              view.dispatch(transaction.scrollIntoView());
              if (!view.isDestroyed) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});
