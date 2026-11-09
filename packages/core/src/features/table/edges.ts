import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, type EditorState, type Transaction } from "@tiptap/pm/state";
import {
  CellSelection,
  TableMap,
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  isInTable,
  selectedRect,
} from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";

type Axis = "row" | "column";
type Command = (state: EditorState, dispatch?: (transaction: Transaction) => void) => boolean;
type Target = {
  pos: number;
  node: ProseMirrorNode;
  map: TableMap;
  table: HTMLTableElement;
  wrapper: HTMLElement;
};
type Band = { index: number; start: number; end: number };
type Drag = {
  axis: Axis;
  index: number;
  pointer: number;
  x: number;
  y: number;
  doc: ProseMirrorNode;
  tablePos: number;
  start: number;
  end: number;
  deferSelection: boolean;
  canMove: boolean;
  moved: boolean;
  destination: number | null;
};

function targetAt(view: EditorView, pos: number): Target | null {
  const node = view.state.doc.nodeAt(pos);
  const dom = view.nodeDOM(pos);
  const win = view.dom.ownerDocument.defaultView;
  if (!node || node.type.spec.tableRole !== "table" || !win || !(dom instanceof win.HTMLElement)) return null;
  const table = dom instanceof win.HTMLTableElement ? dom : dom.querySelector<HTMLTableElement>("table");
  if (!table?.isConnected) return null;
  const wrapper = table.closest<HTMLElement>(".tableWrapper") ?? table.parentElement ?? table;
  return { pos, node, map: TableMap.get(node), table, wrapper };
}

function targetFromSelection(view: EditorView): Target | null {
  if (!isInTable(view.state)) return null;
  try {
    return targetAt(view, selectedRect(view.state).tableStart - 1);
  } catch {
    return null;
  }
}

function targetFromElement(view: EditorView, element: Element): Target | null {
  const cell = element.closest("td,th");
  if (!cell || !view.dom.contains(cell)) return null;
  try {
    const position = view.posAtDOM(cell, 0) - 1;
    const $cell = view.state.doc.resolve(position);
    for (let depth = $cell.depth; depth > 0; depth--) {
      if ($cell.node(depth).type.spec.tableRole === "table") return targetAt(view, $cell.before(depth));
    }
  } catch {
    // The DOM may have been replaced between pointer movement and this lookup.
  }
  return null;
}

function selectionFor(
  view: EditorView,
  target: Target,
  axis: Axis,
  index: number,
  anchorIndex = index,
): CellSelection | null {
  if (view.state.doc.nodeAt(target.pos) !== target.node) return null;
  const { map } = target;
  const size = axis === "row" ? map.height : map.width;
  if (index < 0 || index >= size || anchorIndex < 0 || anchorIndex >= size) return null;
  let top = axis === "row" ? Math.min(anchorIndex, index) : 0;
  let bottom = axis === "row" ? Math.max(anchorIndex, index) + 1 : map.height;
  let left = axis === "column" ? Math.min(anchorIndex, index) : 0;
  let right = axis === "column" ? Math.max(anchorIndex, index) + 1 : map.width;
  // A selection cannot contain only part of a merged cell. Expand until every
  // cell intersecting the range is wholly inside it, including chained spans.
  let changed: boolean;
  do {
    changed = false;
    for (let row = top; row < bottom; row++) {
      for (let column = left; column < right; column++) {
        const rect = map.findCell(map.map[row * map.width + column]);
        const nextTop = Math.min(top, rect.top);
        const nextBottom = Math.max(bottom, rect.bottom);
        const nextLeft = Math.min(left, rect.left);
        const nextRight = Math.max(right, rect.right);
        if (nextTop !== top || nextBottom !== bottom || nextLeft !== left || nextRight !== right) changed = true;
        top = nextTop;
        bottom = nextBottom;
        left = nextLeft;
        right = nextRight;
      }
    }
  } while (changed);
  const first = target.pos + 1 + map.map[top * map.width + left];
  const last = target.pos + 1 + map.map[(bottom - 1) * map.width + right - 1];
  const forward = anchorIndex <= index;
  return CellSelection.create(view.state.doc, forward ? first : last, forward ? last : first);
}

function selectBand(view: EditorView, target: Target, axis: Axis, index: number, anchorIndex = index): boolean {
  const selection = selectionFor(view, target, axis, index, anchorIndex);
  if (!selection || !view.editable) return false;
  const doc = view.state.doc;
  view.dispatch(view.state.tr.setSelection(selection).setMeta("addToHistory", false));
  // Host callbacks may replace the document or selection during dispatch or focus.
  if (view.isDestroyed || !view.editable || view.state.doc !== doc || !view.state.selection.eq(selection)) return false;
  view.focus();
  return !view.isDestroyed && view.editable && view.state.doc === doc && view.state.selection.eq(selection);
}

function dispatchChange(view: EditorView, transaction: Transaction) {
  if (view.isDestroyed || !view.editable || !transaction.docChanged) return;
  view.dispatch(closeHistory(transaction.scrollIntoView()));
  if (!view.isDestroyed) {
    view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    view.focus();
  }
}

function runCommand(view: EditorView, command: Command): boolean {
  if (view.isDestroyed || !view.editable) return false;
  return command(view.state, (transaction) => dispatchChange(view, transaction));
}

function rowBands(target: Target): Band[] {
  return Array.from(target.table.rows)
    .slice(0, target.map.height)
    .map((row, index) => {
      const rect = row.getBoundingClientRect();
      return { index, start: rect.top, end: rect.bottom };
    });
}

function columnBands(view: EditorView, target: Target): Band[] {
  const columns = [...target.table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col")];
  if (columns.length >= target.map.width) {
    const bands = columns.slice(0, target.map.width).map((column, index) => {
      const rect = column.getBoundingClientRect();
      return { index, start: rect.left, end: rect.right };
    });
    if (bands.every((band) => band.end > band.start)) return bands;
  }
  // A merged first-row cell may span several logical columns. Its rendered
  // width is split as a fallback when the browser does not expose col geometry.
  return Array.from({ length: target.map.width }, (_, index) => {
    const relative = target.map.map[index];
    const cell = view.nodeDOM(target.pos + 1 + relative);
    const win = view.dom.ownerDocument.defaultView;
    const rect =
      win && cell instanceof win.HTMLElement ? cell.getBoundingClientRect() : target.table.getBoundingClientRect();
    const bounds = target.map.findCell(relative);
    const span = Math.max(1, bounds.right - bounds.left);
    const width = rect.width / span;
    return {
      index,
      start: rect.left + width * (index - bounds.left),
      end: rect.left + width * (index - bounds.left + 1),
    };
  });
}

function expandRange(map: TableMap, axis: Axis, start: number, end: number): { start: number; end: number } {
  let changed: boolean;
  do {
    changed = false;
    for (let index = start; index < end; index++) {
      const crossSize = axis === "row" ? map.width : map.height;
      for (let cross = 0; cross < crossSize; cross++) {
        const offset = axis === "row" ? index * map.width + cross : cross * map.width + index;
        const rect = map.findCell(map.map[offset]);
        const nextStart = Math.min(start, axis === "row" ? rect.top : rect.left);
        const nextEnd = Math.max(end, axis === "row" ? rect.bottom : rect.right);
        if (nextStart !== start || nextEnd !== end) changed = true;
        start = nextStart;
        end = nextEnd;
      }
    }
  } while (changed);
  return { start, end };
}

/** Move whole cells, and reject any permutation that would split or lose one. */
function moveRange(view: EditorView, target: Target, moving: Drag): boolean {
  const { map, node, pos } = target;
  const size = moving.axis === "row" ? map.height : map.width;
  if (
    view.state.doc.nodeAt(pos) !== node ||
    map.problems?.length ||
    moving.destination === null ||
    moving.destination < 0 ||
    moving.destination >= size
  )
    return false;
  const source = expandRange(map, moving.axis, moving.start, moving.end);
  const destination = expandRange(map, moving.axis, moving.destination, moving.destination + 1);
  if (destination.start < source.end && destination.end > source.start) return false;

  const order = Array.from({ length: size }, (_, index) => index);
  const moved = order.splice(source.start, source.end - source.start);
  const insertAt = destination.start < source.start ? destination.start : destination.end - moved.length;
  order.splice(insertAt, 0, ...moved);
  const newIndex = Array.from({ length: size }, () => 0);
  order.forEach((oldIndex, index) => {
    newIndex[oldIndex] = index;
  });

  try {
    let table: ProseMirrorNode;
    if (moving.axis === "row") {
      table = node.type.createChecked(
        node.attrs,
        order.map((index) => node.child(index)),
        node.marks,
      );
    } else {
      const rows: ProseMirrorNode[] = [];
      node.forEach((row, rowOffset) => {
        const cells: { node: ProseMirrorNode; index: number }[] = [];
        row.forEach((cell, cellOffset) => {
          const rect = map.findCell(rowOffset + 1 + cellOffset);
          cells.push({ node: cell, index: newIndex[rect.left] });
        });
        cells.sort((a, b) => a.index - b.index);
        rows.push(row.type.createChecked(row.attrs, Fragment.fromArray(cells.map((cell) => cell.node)), row.marks));
      });
      const savedWidths = node.attrs.semloEditorFitWidths;
      const attrs =
        Array.isArray(savedWidths) && savedWidths.length === size
          ? { ...node.attrs, semloEditorFitWidths: order.map((index) => savedWidths[index]) }
          : node.attrs;
      table = node.type.createChecked(attrs, Fragment.fromArray(rows), node.marks);
    }

    const nextMap = TableMap.get(table);
    if (nextMap.problems?.length || nextMap.width !== map.width || nextMap.height !== map.height) return false;
    // The grid must contain precisely the original cell at each permuted
    // position. This also rejects a destination that would split a span.
    for (let row = 0; row < map.height; row++) {
      for (let column = 0; column < map.width; column++) {
        const nextRow = moving.axis === "row" ? newIndex[row] : row;
        const nextColumn = moving.axis === "column" ? newIndex[column] : column;
        if (
          node.nodeAt(map.map[row * map.width + column]) !== table.nodeAt(nextMap.map[nextRow * map.width + nextColumn])
        )
          return false;
      }
    }
    const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, table);
    const start = insertAt;
    const end = insertAt + moved.length;
    const top = moving.axis === "row" ? start : 0;
    const bottom = moving.axis === "row" ? end : nextMap.height;
    const left = moving.axis === "column" ? start : 0;
    const right = moving.axis === "column" ? end : nextMap.width;
    const first = pos + 1 + nextMap.map[top * nextMap.width + left];
    const last = pos + 1 + nextMap.map[(bottom - 1) * nextMap.width + right - 1];
    tr.setSelection(CellSelection.create(tr.doc, first, last));
    dispatchChange(view, tr);
    return true;
  } catch {
    // Invalid tables or schemas must never cause a partial move.
    return false;
  }
}

function isDropInside(x: number, y: number, target: Target, axis: Axis): boolean {
  const rect = target.table.getBoundingClientRect();
  const wrapper = target.wrapper.getBoundingClientRect();
  const left = Math.max(rect.left, wrapper.left);
  const right = Math.min(rect.right, wrapper.right);
  return axis === "row"
    ? x >= left - 12 && x <= right && y >= rect.top && y <= rect.bottom
    : x >= left && x <= right && y >= rect.top - 12 && y <= rect.bottom;
}

export type TableViewDisposerRegistration = (dispose: () => void) => () => void;

export function runTableViewCleanup(actions: Array<() => void>): void {
  const failures: unknown[] = [];
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Table view cleanup failed");
}

export function rethrowTableViewSetup(error: unknown, destroy: () => void): never {
  try {
    destroy();
  } catch (cleanupError) {
    const failures = cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
    throw new AggregateError([error, ...failures], "Table view setup and cleanup failed", { cause: error });
  }
  throw error;
}

/** A per-editor overlay for selecting, moving and editing table rows and columns. */
export function tableEdgesPlugin(registerViewDisposer?: TableViewDisposerRegistration): Plugin {
  return new Plugin({
    view(view) {
      const doc = view.dom.ownerDocument;
      const win = doc.defaultView;
      const layer = doc.createElement("div");
      layer.className = "semlo-editor-table-edges";
      layer.setAttribute("data-semlo-editor-table-edges", "");
      let target: Target | null = null;
      let drag: Drag | null = null;
      let frame: number | undefined;
      let destroyed = false;
      let lastAxis: Axis | null = null;
      let rangeAnchor: { axis: Axis; index: number; tablePos: number } | null = null;
      let observed: Target | null = null;

      const anchorFor = (current: Target, axis: Axis, index: number, shift: boolean) => {
        if (shift && rangeAnchor?.axis === axis && rangeAnchor.tablePos === current.pos) return rangeAnchor.index;
        rangeAnchor = { axis, index, tablePos: current.pos };
        return index;
      };

      const hide = () => {
        const debug = win as unknown as { __debugEdgeHide?: unknown[] };
        (debug.__debugEdgeHide ??= []).push({
          stack: new Error().stack,
          focused: view.hasFocus(),
          editable: view.editable,
          destroyed,
          target: target?.pos,
        });
        if (debug.__debugEdgeHide.length > 12) debug.__debugEdgeHide.shift();
        target = null;
        observer?.disconnect();
        observed = null;
        layer.replaceChildren();
      };
      const schedule = () => {
        if (destroyed || frame !== undefined || !win) return;
        frame = win.requestAnimationFrame(() => {
          frame = undefined;
          render();
        });
      };
      const observer = win?.ResizeObserver ? new win.ResizeObserver(schedule) : null;
      const currentTarget = () => {
        if (!target) return null;
        return targetAt(view, target.pos);
      };
      const put = (element: HTMLElement, left: number, top: number, width: number, height: number) => {
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.style.width = `${Math.max(0, width)}px`;
        element.style.height = `${Math.max(0, height)}px`;
        layer.append(element);
      };
      const action = (label: string, glyph: string, run: () => void) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "semlo-editor-table-edge-action";
        button.setAttribute("aria-label", label);
        button.title = label;
        button.innerHTML = glyph;
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!drag && view.editable && currentTarget()) run();
        });
        return button;
      };
      const plus = '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>';
      const trash =
        '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 4h10M6 4V2.5h4V4M4.5 4.5l.6 9h5.8l.6-9M7 6v5M9 6v5"/></svg>';
      const dots =
        '<svg aria-hidden="true" viewBox="0 0 12 12"><circle cx="4" cy="3" r=".8"/><circle cx="8" cy="3" r=".8"/><circle cx="4" cy="6" r=".8"/><circle cx="8" cy="6" r=".8"/><circle cx="4" cy="9" r=".8"/><circle cx="8" cy="9" r=".8"/></svg>';
      const showIndicator = (current: Target, moving: Drag) => {
        layer.querySelector(".semlo-editor-table-edge-indicator")?.remove();
        if (moving.destination === null) return;
        const destinationRange = expandRange(current.map, moving.axis, moving.destination, moving.destination + 1);
        if (destinationRange.start < moving.end && destinationRange.end > moving.start) return;
        const bands = moving.axis === "row" ? rowBands(current) : columnBands(view, current);
        const after = destinationRange.start >= moving.end;
        const destination = bands.find(
          (item) => item.index === (after ? destinationRange.end - 1 : destinationRange.start),
        );
        if (!destination) return;
        const rect = current.table.getBoundingClientRect();
        const wrapper = current.wrapper.getBoundingClientRect();
        const edge = after ? destination.end : destination.start;
        const line = doc.createElement("div");
        line.className = "semlo-editor-table-edge-indicator";
        if (moving.axis === "row") {
          const left = Math.max(rect.left, wrapper.left, 0);
          const right = Math.min(rect.right, wrapper.right, win?.innerWidth ?? rect.right);
          if (right > left) put(line, left, edge - 1, right - left, 2);
        } else if (edge >= wrapper.left && edge <= wrapper.right) {
          put(line, edge - 1, rect.top, 2, rect.height);
        }
      };

      const render = () => {
        if (destroyed || view.isDestroyed || !view.editable || !win) {
          hide();
          return;
        }
        target = currentTarget() ?? (view.hasFocus() ? targetFromSelection(view) : null);
        if (!target) {
          hide();
          return;
        }
        if (observed?.table !== target.table || observed?.wrapper !== target.wrapper) {
          observer?.disconnect();
          observer?.observe(target.table);
          if (target.wrapper !== target.table) observer?.observe(target.wrapper);
          observed = target;
        }
        const tableRect = target.table.getBoundingClientRect();
        const wrapperRect = target.wrapper.getBoundingClientRect();
        const left = Math.max(tableRect.left, wrapperRect.left, 0);
        const right = Math.min(tableRect.right, wrapperRect.right, win.innerWidth);
        if (!target.table.isConnected || right <= left || tableRect.bottom < 0 || tableRect.top > win.innerHeight) {
          hide();
          return;
        }
        const rows = rowBands(target);
        const columns = columnBands(view, target);
        const selection = view.state.selection;
        let selected: ReturnType<typeof selectedRect> | null = null;
        if (selection instanceof CellSelection && isInTable(view.state)) {
          const rect = selectedRect(view.state);
          if (rect.tableStart - 1 === target.pos) selected = rect;
        }
        const rowSelected = !!selected && selection instanceof CellSelection && selection.isRowSelection();
        const columnSelected = !!selected && selection instanceof CellSelection && selection.isColSelection();
        layer.replaceChildren();
        const band = (axis: Axis, item: Band, start: number, end: number) => {
          if (end <= start) return;
          const button = doc.createElement("button");
          button.type = "button";
          button.className = `semlo-editor-table-edge-band semlo-editor-table-edge-${axis}`;
          button.setAttribute("aria-label", `选择第 ${item.index + 1} ${axis === "row" ? "行" : "列"}`);
          const active =
            !!selected &&
            (axis === "row"
              ? rowSelected && item.index >= selected.top && item.index < selected.bottom
              : columnSelected && item.index >= selected.left && item.index < selected.right);
          button.setAttribute("aria-pressed", String(active));
          button.innerHTML = dots;
          button.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || !view.editable || !target) return;
            event.preventDefault();
            event.stopPropagation();
            const current = currentTarget();
            if (!current) return;
            const currentSelection = view.state.selection;
            const selectionRect =
              currentSelection instanceof CellSelection && isInTable(view.state) ? selectedRect(view.state) : null;
            const matchingAxis =
              currentSelection instanceof CellSelection &&
              (axis === "row" ? currentSelection.isRowSelection() : currentSelection.isColSelection()) &&
              (!(currentSelection.isRowSelection() && currentSelection.isColSelection()) || lastAxis === axis);
            const selectedStart = axis === "row" ? selectionRect?.top : selectionRect?.left;
            const selectedEnd = axis === "row" ? selectionRect?.bottom : selectionRect?.right;
            const deferSelection =
              !event.shiftKey &&
              matchingAxis &&
              selectionRect !== null &&
              selectionRect.tableStart - 1 === current.pos &&
              selectedStart !== undefined &&
              selectedEnd !== undefined &&
              selectedEnd - selectedStart > 1 &&
              item.index >= selectedStart &&
              item.index < selectedEnd;
            lastAxis = axis;
            if (!deferSelection) {
              const anchor = anchorFor(current, axis, item.index, event.shiftKey);
              if (!selectBand(view, current, axis, item.index, anchor)) return;
            }
            const rect = selectedRect(view.state);
            drag = {
              axis,
              index: item.index,
              pointer: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              doc: view.state.doc,
              tablePos: current.pos,
              start: axis === "row" ? rect.top : rect.left,
              end: axis === "row" ? rect.bottom : rect.right,
              deferSelection,
              canMove: !event.shiftKey,
              moved: false,
              destination: null,
            };
          });
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            // Keyboard activation does not produce pointerdown.
            if (event.detail === 0 && target) {
              lastAxis = axis;
              const anchor = anchorFor(target, axis, item.index, event.shiftKey);
              selectBand(view, target, axis, item.index, anchor);
              schedule();
            }
          });
          if (axis === "row") put(button, left - 12, start, 12, end - start);
          else put(button, start, tableRect.top - 12, end - start, 12);
        };
        for (const row of rows) band("row", row, Math.max(row.start, 0), Math.min(row.end, win.innerHeight));
        for (const column of columns) band("column", column, Math.max(column.start, left), Math.min(column.end, right));

        if (!selected) return;
        const activeAxis =
          rowSelected && columnSelected ? lastAxis : rowSelected ? "row" : columnSelected ? "column" : null;
        if (activeAxis === "row") {
          const first = rows[selected.top],
            last = rows[selected.bottom - 1];
          if (!first || !last) return;
          const add = action("在下方插入行", plus, () => runCommand(view, addRowAfter));
          const remove = action("删除所选行", trash, () => runCommand(view, deleteRow));
          put(add, Math.max(2, left - 25), last.end - 10, 20, 20);
          put(remove, Math.max(2, left + 4), Math.max(2, first.start - 24), 20, 20);
        } else if (activeAxis === "column") {
          const first = columns[selected.left],
            last = columns[selected.right - 1];
          if (!first || !last) return;
          const add = action("在右侧插入列", plus, () => runCommand(view, addColumnAfter));
          const remove = action("删除所选列", trash, () => runCommand(view, deleteColumn));
          put(add, Math.min(win.innerWidth - 22, last.end - 10), Math.max(2, tableRect.top - 32), 20, 20);
          put(
            remove,
            Math.max(2, Math.min(win.innerWidth - 22, (first.start + last.end) / 2 - 10)),
            Math.max(2, tableRect.top - 32),
            20,
            20,
          );
        }
        if (drag?.moved) showIndicator(target, drag);
      };
      const pointerMove = (event: PointerEvent) => {
        if (drag) {
          if (event.pointerId !== drag.pointer || !view.editable || view.state.doc !== drag.doc) return;
          if (!drag.canMove) return;
          if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
          drag.moved = true;
          const current = currentTarget();
          const hitTable = doc.elementFromPoint(event.clientX, event.clientY)?.closest("table");
          if (
            !current ||
            current.pos !== drag.tablePos ||
            (hitTable && hitTable !== current.table) ||
            !isDropInside(event.clientX, event.clientY, current, drag.axis)
          ) {
            drag.destination = null;
            layer.querySelector(".semlo-editor-table-edge-indicator")?.remove();
            return;
          }
          const bands = drag.axis === "row" ? rowBands(current) : columnBands(view, current);
          const coordinate = drag.axis === "row" ? event.clientY : event.clientX;
          const distance = (band: Band) => Math.max(band.start - coordinate, 0, coordinate - band.end);
          // A wide band may extend past the centre of a narrow neighbour. The
          // band under the pointer must win even when its centre is farther away.
          const nearest =
            bands.find((item) => coordinate >= item.start && coordinate < item.end) ??
            bands.reduce<Band | null>((best, item) => {
              if (!best) return item;
              return distance(item) < distance(best) ? item : best;
            }, null);
          drag.destination = nearest?.index ?? null;
          showIndicator(current, drag);
          return;
        }
        if (!view.editable || !win || !(event.target instanceof win.Element) || layer.contains(event.target)) return;
        const next = targetFromElement(view, event.target);
        if (next && (!target || target.pos !== next.pos)) {
          target = next;
          schedule();
        } else if (!next && !view.dom.contains(event.target) && !view.hasFocus()) hide();
      };
      const pointerUp = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.pointer) return;
        const completed = drag;
        drag = null;
        layer.querySelector(".semlo-editor-table-edge-indicator")?.remove();
        if (completed.moved && completed.destination !== null && view.editable && view.state.doc === completed.doc) {
          const current = currentTarget();
          if (current && current.pos === completed.tablePos) {
            if (moveRange(view, current, completed) && isInTable(view.state)) {
              const rect = selectedRect(view.state);
              rangeAnchor = {
                axis: completed.axis,
                index: completed.axis === "row" ? rect.top : rect.left,
                tablePos: rect.tableStart - 1,
              };
            }
          }
        } else if (!completed.moved && completed.deferSelection && view.editable && view.state.doc === completed.doc) {
          const current = currentTarget();
          if (current && current.pos === completed.tablePos) {
            const anchor = anchorFor(current, completed.axis, completed.index, false);
            selectBand(view, current, completed.axis, completed.index, anchor);
          }
        }
        schedule();
      };
      const cancel = () => {
        if (!drag) return;
        drag = null;
        layer.querySelector(".semlo-editor-table-edge-indicator")?.remove();
        schedule();
      };
      const keyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") cancel();
      };
      const editableChanged = () => {
        if (!view.editable) {
          rangeAnchor = null;
          cancel();
          hide();
        } else schedule();
      };
      const pointerDown = (event: PointerEvent) => {
        if (layer.contains(event.target as globalThis.Node) || view.dom.contains(event.target as globalThis.Node))
          return;
        rangeAnchor = null;
        hide();
      };
      let unregister: (() => void) | undefined;
      const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        const detach = unregister;
        unregister = undefined;
        runTableViewCleanup([
          () => detach?.(),
          () => {
            if (frame !== undefined) win?.cancelAnimationFrame(frame);
          },
          () => observer?.disconnect(),
          () => layer.remove(),
          () => doc.removeEventListener("pointermove", pointerMove, true),
          () => doc.removeEventListener("pointerup", pointerUp, true),
          () => doc.removeEventListener("pointercancel", cancel, true),
          () => doc.removeEventListener("pointerdown", pointerDown, true),
          () => doc.removeEventListener("keydown", keyDown, true),
          () => doc.removeEventListener("scroll", schedule, true),
          () => win?.removeEventListener("resize", schedule),
          () => win?.removeEventListener("blur", cancel),
          () => view.dom.removeEventListener("semlo-editor:editable", editableChanged),
        ]);
      };
      unregister = registerViewDisposer?.(destroy);
      if (destroyed) {
        unregister?.();
        return { destroy };
      }
      try {
        doc.body.append(layer);
        doc.addEventListener("pointermove", pointerMove, true);
        doc.addEventListener("pointerup", pointerUp, true);
        doc.addEventListener("pointercancel", cancel, true);
        doc.addEventListener("pointerdown", pointerDown, true);
        doc.addEventListener("keydown", keyDown, true);
        doc.addEventListener("scroll", schedule, true);
        win?.addEventListener("resize", schedule);
        win?.addEventListener("blur", cancel);
        view.dom.addEventListener("semlo-editor:editable", editableChanged);
        target = view.hasFocus() ? targetFromSelection(view) : null;
        schedule();
      } catch (error) {
        rethrowTableViewSetup(error, destroy);
      }
      return {
        update(next, previous) {
          if (!next.editable) {
            rangeAnchor = null;
            cancel();
            hide();
            return;
          }
          if (drag && next.state.doc !== drag.doc) cancel();
          if (next.state.doc !== previous.doc) rangeAnchor = null;
          else if (!drag && rangeAnchor && !next.state.selection.eq(previous.selection)) {
            const selection = next.state.selection;
            if (
              !(selection instanceof CellSelection) ||
              !isInTable(next.state) ||
              selectedRect(next.state).tableStart - 1 !== rangeAnchor.tablePos ||
              !(rangeAnchor.axis === "row" ? selection.isRowSelection() : selection.isColSelection())
            )
              rangeAnchor = null;
          }
          if (next.state.doc !== previous.doc || !next.state.selection.eq(previous.selection))
            target = targetFromSelection(next);
          schedule();
        },
        destroy,
      };
    },
  });
}
