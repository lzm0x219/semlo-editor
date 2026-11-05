import { TableView } from "@tiptap/extension-table";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { TableMap, columnResizingPluginKey, updateColumnsOnResize, selectedRect } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";

import { syncFittedTable } from "./toolbar";

type ResizeSession = { stop: (restore: boolean) => void };
const resizing = new WeakMap<EditorView, ResizeSession>();

/** Cancel a preview without changing the document or its undo history. */
export function cancelTableResize(view: EditorView) {
  resizing.get(view)?.stop(true);
  const state = columnResizingPluginKey.getState(view.state);
  if (!view.isDestroyed && state && (state.activeHandle !== -1 || state.dragging)) {
    view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: -1 }).setMeta("addToHistory", false));
  }
}

// ProseMirror's resizing plugin does not remove its window listeners until
// mouseup. Own the drag lifecycle so read-only changes and destruction can
// cancel it immediately, while retaining the plugin's handle and decorations.
export function managedResize(cellMinWidth: number) {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          const state = columnResizingPluginKey.getState(view.state);
          if (!view.editable || !state || state.activeHandle === -1 || state.dragging) return false;
          if (event.button !== 0) return true;
          const $cell = view.state.doc.resolve(state.activeHandle);
          const cell = $cell.nodeAfter;
          if (!cell || $cell.depth < 1) return false;
          const tableNode = $cell.node(-1),
            tableStart = $cell.start(-1);
          const map = TableMap.get(tableNode);
          const column = map.colCount($cell.pos - tableStart) + cell.attrs.colspan - 1;
          let dom: globalThis.Node | null = view.domAtPos(tableStart).node;
          while (dom && dom.nodeName !== "TABLE") dom = dom.parentNode;
          if (!dom) return false;
          const table = dom as HTMLTableElement;
          const colgroup = table.querySelector(":scope > colgroup") as HTMLTableColElement | null;
          if (!colgroup) return false;
          const before = [...colgroup.children].map((col) => col.getAttribute("style"));
          const tableWidth = table.style.width,
            tableMinWidth = table.style.minWidth;
          const measured = Array.from(colgroup.children, (col) => col.getBoundingClientRect().width);
          const fittedWidths =
            tableNode.attrs.semloEditorFitWidth === true &&
            measured.length === map.width &&
            measured.every((value) => Number.isFinite(value) && value > 0)
              ? measured
              : null;
          const startDoc = view.state.doc;
          const domCell = view.domAtPos(state.activeHandle);
          let width = fittedWidths?.[column] || (cell.attrs.colwidth as number[] | null)?.[cell.attrs.colspan - 1];
          if (!width) {
            const element = domCell.node.childNodes[domCell.offset] as HTMLElement | undefined;
            if (!element) return false;
            let remaining = element.offsetWidth,
              parts = cell.attrs.colspan;
            for (const value of (cell.attrs.colwidth as number[] | null) ?? [])
              if (value) {
                remaining -= value;
                parts--;
              }
            width = remaining / parts;
          }
          const startX = event.clientX,
            startWidth = width;
          const win = view.dom.ownerDocument.defaultView;
          if (!win) return false;
          const cleanup = () => {
            win.removeEventListener("mousemove", move);
            win.removeEventListener("mouseup", finish);
            resizing.delete(view);
          };
          const restore = () => {
            if (!view.dom.contains(table)) return;
            if (view.state.doc.eq(startDoc)) {
              Array.from(colgroup.children).forEach((col, index) => {
                const style = before[index];
                if (style == null) col.removeAttribute("style");
                else col.setAttribute("style", style);
              });
              table.style.width = tableWidth;
              table.style.minWidth = tableMinWidth;
            } else {
              view.state.doc.descendants((node, pos) => {
                if (node.type.name !== "table") return true;
                const tableDOM = view.nodeDOM(pos);
                if (tableDOM !== table && tableDOM?.firstChild !== table) return true;
                updateColumnsOnResize(node, colgroup, table, cellMinWidth);
                syncFittedTable(node, table, colgroup);
                return false;
              });
            }
          };
          const stop = (shouldRestore: boolean) => {
            cleanup();
            if (shouldRestore) restore();
          };
          const draggedWidth = (mouse: MouseEvent) => {
            const total = fittedWidths && column + 1 < map.width ? startWidth + fittedWidths[column + 1] : Infinity;
            const minimum = Math.min(cellMinWidth, total / 2);
            return Math.min(total - minimum, Math.max(minimum, startWidth + mouse.clientX - startX));
          };
          const adjustedWidths = (width: number) => {
            const next = fittedWidths!.slice();
            if (column + 1 < next.length) next[column + 1] += next[column] - width;
            next[column] = width;
            return next;
          };
          const preview = (width: number) => {
            if (!fittedWidths) {
              updateColumnsOnResize(tableNode, colgroup, table, cellMinWidth, column, width);
              return;
            }
            const next = adjustedWidths(width);
            const total = next.reduce((sum, value) => sum + value, 0);
            table.style.width = "100%";
            table.style.minWidth = "0";
            Array.from(colgroup.children).forEach((col, index) => {
              const element = col as HTMLElement;
              element.style.width = `${(next[index] / total) * 100}%`;
              element.style.minWidth = "0";
            });
          };
          const finish = (mouse: MouseEvent) => {
            const current = columnResizingPluginKey.getState(view.state);
            if (view.isDestroyed || !view.editable || !current?.dragging || !view.state.doc.eq(startDoc)) {
              if (!view.isDestroyed) cancelTableResize(view);
              else stop(false);
              return;
            }
            const nextWidth = draggedWidth(mouse);
            if (Math.abs(mouse.clientX - startX) < 0.5 || (fittedWidths && Math.abs(nextWidth - startWidth) < 0.5)) {
              stop(true);
              view.dispatch(
                view.state.tr.setMeta(columnResizingPluginKey, { setDragging: null }).setMeta("addToHistory", false),
              );
              return;
            }
            const tr = closeHistory(view.state.tr);
            if (fittedWidths) {
              const next = adjustedWidths(nextWidth).map((width) => Math.max(1, Math.round(width)));
              for (const offset of new Set(map.map)) {
                const rowCell = tableNode.nodeAt(offset);
                if (!rowCell) continue;
                const bounds = map.findCell(offset);
                tr.setNodeMarkup(tableStart + offset, undefined, {
                  ...rowCell.attrs,
                  colwidth: next.slice(bounds.left, bounds.right),
                });
              }
              tr.setNodeMarkup(tableStart - 1, undefined, { ...tableNode.attrs, semloEditorFitWidths: next });
            } else
              for (let row = 0; row < map.height; row++) {
                const index = row * map.width + column;
                if (row && map.map[index] === map.map[index - map.width]) continue;
                const pos = map.map[index],
                  rowCell = tableNode.nodeAt(pos);
                if (!rowCell) continue;
                const offset = rowCell.attrs.colspan === 1 ? 0 : column - map.colCount(pos);
                if (rowCell.attrs.colwidth?.[offset] === nextWidth) continue;
                const widths = rowCell.attrs.colwidth
                  ? rowCell.attrs.colwidth.slice()
                  : Array(rowCell.attrs.colspan).fill(0);
                widths[offset] = nextWidth;
                tr.setNodeMarkup(tableStart + pos, undefined, { ...rowCell.attrs, colwidth: widths });
              }
            stop(false);
            view.dispatch(tr.setMeta(columnResizingPluginKey, { setDragging: null }));
            if (!view.isDestroyed) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
          };
          const move = (mouse: MouseEvent) => {
            if (!mouse.which) {
              finish(mouse);
              return;
            }
            if (!view.editable || !view.state.doc.eq(startDoc)) {
              cancelTableResize(view);
              return;
            }
            preview(draggedWidth(mouse));
          };
          const session = { stop };
          resizing.set(view, session);
          event.preventDefault();
          try {
            view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setDragging: { startX, startWidth } }));
          } catch (error) {
            if (resizing.get(view) === session) stop(!view.isDestroyed);
            throw error;
          }
          // Host callbacks may synchronously cancel or destroy the editor during dispatch.
          if (view.isDestroyed || resizing.get(view) !== session) return true;
          if (
            !view.editable ||
            !view.state.doc.eq(startDoc) ||
            !columnResizingPluginKey.getState(view.state)?.dragging
          ) {
            cancelTableResize(view);
            return true;
          }
          preview(startWidth);
          win.addEventListener("mousemove", move);
          win.addEventListener("mouseup", finish);
          return true;
        },
      },
    },
    view(view) {
      let destroyed = false;
      return {
        update(next, previous) {
          const state = columnResizingPluginKey.getState(next.state);
          if (
            (!next.editable && state && state.activeHandle !== -1) ||
            (resizing.has(next) && !next.state.doc.eq(previous.doc))
          ) {
            resizing.get(next)?.stop(true);
            // Dispatch after the current ProseMirror view update completes.
            queueMicrotask(() => {
              if (!destroyed && !next.isDestroyed) cancelTableResize(next);
            });
          }
        },
        destroy() {
          destroyed = true;
          resizing.get(view)?.stop(false);
        },
      };
    },
  });
}

// Tiptap's TableView leaves an old inline width behind when a column changes
// from a fixed width back to an automatic width (for example, on undo).
export class SemloEditorTableView extends TableView {
  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    view?: EditorView,
    HTMLAttributes?: Record<string, unknown>,
  ) {
    super(node, cellMinWidth, view, HTMLAttributes);
    syncFittedTable(node, this.table, this.colgroup);
  }
  update(node: ProseMirrorNode) {
    if (!super.update(node)) return false;
    const row = node.firstChild;
    let column = 0;
    if (row)
      for (let i = 0; i < row.childCount; i++) {
        const { colspan, colwidth } = row.child(i).attrs;
        for (let j = 0; j < colspan; j++, column++) {
          const col = this.colgroup.children[column] as HTMLElement | undefined;
          if (col && !colwidth?.[j]) {
            col.style.removeProperty("width");
            col.style.minWidth = `${this.cellMinWidth}px`;
          }
        }
      }
    syncFittedTable(node, this.table, this.colgroup);
    return true;
  }
}

/** Preserve the fitted width of surviving columns when a table gains or loses columns. */
export function fitColumnChanges(cellMinWidth: number) {
  return new Plugin({
    appendTransaction(transactions, oldState, state) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const tr = state.tr;
      oldState.doc.descendants((oldTable, original) => {
        if (oldTable.type.spec.tableRole !== "table") return true;
        const oldWidths = oldTable.attrs.semloEditorFitWidths;
        const oldMap = TableMap.get(oldTable);
        if (
          oldTable.attrs.semloEditorFitWidth !== true ||
          !Array.isArray(oldWidths) ||
          oldWidths.length !== oldMap.width ||
          !oldWidths.every((width) => typeof width === "number" && Number.isFinite(width) && width > 0)
        )
          return true;
        let mapped = original;
        for (const transaction of transactions) {
          const result = transaction.mapping.mapResult(mapped, 1);
          if (result.deleted) return true;
          mapped = result.pos;
        }
        const table = state.doc.nodeAt(mapped);
        if (
          !table ||
          table.type !== oldTable.type ||
          table.attrs.semloEditorFitWidth !== true ||
          JSON.stringify(table.attrs.semloEditorFitWidths) !== JSON.stringify(oldWidths)
        )
          return true;
        const map = TableMap.get(table);
        if (map.width === oldMap.width || map.problems?.length || oldMap.problems?.length) return true;
        const currentCells = new Set(map.map);
        const nextWidths = Array.from({ length: map.width }, (_, column) => {
          const offset = map.map[column];
          const cell = table.nodeAt(offset);
          const bounds = map.findCell(offset);
          const width = Number(cell?.attrs.colwidth?.[column - bounds.left]);
          return Number.isFinite(width) && width > 0 ? width : cellMinWidth;
        });
        const assigned = new Set<number>();
        const oldToNew = new Map<number, number>();
        for (let column = 0; column < oldMap.width; column++) {
          for (let row = 0; row < oldMap.height; row++) {
            const offset = oldMap.map[row * oldMap.width + column];
            const bounds = oldMap.findCell(offset);
            const oldCell = oldTable.nodeAt(offset);
            let position = original + 1 + offset;
            let deleted = false;
            for (const transaction of transactions) {
              const result = transaction.mapping.mapResult(position, 1);
              deleted ||= result.deleted;
              position = result.pos;
            }
            const relative = position - mapped - 1;
            if (deleted || !currentCells.has(relative)) continue;
            const cell = state.doc.nodeAt(position);
            const target = map.findCell(relative);
            const targetColumn = target.left + column - bounds.left;
            if (
              !cell ||
              !oldCell ||
              cell.type !== oldCell.type ||
              !cell.content.eq(oldCell.content) ||
              target.right - target.left !== bounds.right - bounds.left ||
              assigned.has(targetColumn)
            )
              continue;
            nextWidths[targetColumn] = oldWidths[column];
            assigned.add(targetColumn);
            oldToNew.set(column, targetColumn);
            break;
          }
        }
        if (map.width > oldMap.width) {
          let selection: ReturnType<typeof selectedRect> | null = null;
          try {
            const rect = selectedRect(oldState);
            if (rect.tableStart - 1 === original) selection = rect;
          } catch {
            // A programmatic table edit may not have a table selection.
          }
          const selectedLeft = selection ? oldToNew.get(selection.left) : undefined;
          const selectedRight = selection ? oldToNew.get(selection.right - 1) : undefined;
          for (let column = 0; column < map.width; column++) {
            if (assigned.has(column) || !selection || selectedLeft === undefined || selectedRight === undefined)
              continue;
            const sourceColumn =
              column < selectedLeft ? selection.left : column > selectedRight ? selection.right - 1 : -1;
            if (sourceColumn < 0) continue;
            const offsets = [
              ...new Set(Array.from({ length: map.height }, (_, row) => map.map[row * map.width + column])),
            ];
            if (
              offsets.some((offset) => {
                const cell = table.nodeAt(offset);
                const bounds = map.findCell(offset);
                return !cell || bounds.right - bounds.left !== 1 || !!cell.textContent;
              })
            )
              continue;
            nextWidths[column] = oldWidths[sourceColumn];
            const oldOffset = oldMap.map[sourceColumn];
            const oldBounds = oldMap.findCell(oldOffset);
            const storedWidth = Number(oldTable.nodeAt(oldOffset)?.attrs.colwidth?.[sourceColumn - oldBounds.left]);
            const originalWidth = Math.round(
              Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : oldWidths[sourceColumn],
            );
            for (const offset of offsets) {
              const position = tr.mapping.map(mapped + 1 + offset);
              const cell = tr.doc.nodeAt(position);
              if (cell) tr.setNodeMarkup(position, undefined, { ...cell.attrs, colwidth: [originalWidth] });
            }
          }
          const hadAutomaticWidth = Array.from({ length: oldMap.width }, (_, column) => {
            const offset = oldMap.map[column];
            const bounds = oldMap.findCell(offset);
            return !(Number(oldTable.nodeAt(offset)?.attrs.colwidth?.[column - bounds.left]) > 0);
          }).some(Boolean);
          if (hadAutomaticWidth) {
            for (const offset of new Set(map.map)) {
              const position = tr.mapping.map(mapped + 1 + offset);
              const cell = tr.doc.nodeAt(position);
              if (!cell) continue;
              const bounds = map.findCell(offset);
              const sizes = Array.from({ length: bounds.right - bounds.left }, (_, index) => {
                const existing = Number(cell.attrs.colwidth?.[index]);
                return existing > 0 ? existing : Math.max(1, Math.round(nextWidths[bounds.left + index]));
              });
              tr.setNodeMarkup(position, undefined, { ...cell.attrs, colwidth: sizes });
            }
          }
        }
        tr.setNodeMarkup(tr.mapping.map(mapped), undefined, { ...table.attrs, semloEditorFitWidths: nextWidths });
        return true;
      });
      return tr.docChanged ? tr : null;
    },
  });
}
