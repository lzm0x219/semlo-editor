import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { CellSelection, selectedRect } from "@tiptap/pm/tables";
import { type EditorView } from "@tiptap/pm/view";

export type TableCommand = (state: EditorState, dispatch?: (transaction: Transaction) => void) => boolean;
/** Group a menu operation into one undo event, separate from surrounding typing. */
export function dispatchTableChange(view: EditorView, transaction: Transaction) {
  if (view.isDestroyed || !view.editable || !transaction.docChanged) return;
  view.dispatch(closeHistory(transaction.scrollIntoView()));
  if (!view.isDestroyed) {
    view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    view.focus();
  }
}

export function clearTableCells(view: EditorView, collapsePartial = false): boolean {
  const state = view.state;
  const rect = selectedRect(state);
  const selection =
    state.selection instanceof CellSelection
      ? state.selection
      : CellSelection.create(state.doc, rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left]);
  const tr = state.tr;
  const cells: Array<{ cell: ProseMirrorNode; position: number; empty: ProseMirrorNode }> = [];
  selection.forEachCell((cell, position) => {
    const empty = cell.type.createAndFill(cell.attrs);
    if (empty) cells.push({ cell, position, empty });
  });
  const changed = cells.some(({ cell, empty }) => !cell.content.eq(empty.content));
  const first = rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left];
  for (const { cell, position, empty } of cells.reverse()) {
    // End at the first cell so subsequent typing joins this deletion in history,
    // including when that cell was already empty.
    if (!cell.content.eq(empty.content) || (changed && position === first))
      tr.replaceWith(tr.mapping.map(position + 1), tr.mapping.map(position + cell.nodeSize - 1), empty.content);
  }
  if (state.selection instanceof CellSelection) {
    const all = rect.left === 0 && rect.top === 0 && rect.right === rect.map.width && rect.bottom === rect.map.height;
    if (collapsePartial && !all) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(first + 1)), 1));
    } else if (tr.docChanged) tr.setSelection(state.selection.getBookmark().map(tr.mapping).resolve(tr.doc));
  }
  if (tr.docChanged) {
    view.dispatch(closeHistory(tr).scrollIntoView());
    if (!view.isDestroyed) view.focus();
  } else if (tr.selectionSet) view.dispatch(tr);
  return true;
}
