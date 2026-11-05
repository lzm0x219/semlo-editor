import { type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, type Transaction } from "@tiptap/pm/state";
import { CellSelection, TableMap, addColumn, mergeCells, selectedRect } from "@tiptap/pm/tables";
import { type EditorView } from "@tiptap/pm/view";

import { dispatchTableChange, type TableCommand } from "./transactions";

export function hasSequenceColumn(state: EditorState): boolean {
  const { map, table } = selectedRect(state);
  return map.map.some((position) => table.nodeAt(position)?.attrs.semloEditorSequence);
}

/** Renumber an untouched sequence by distinct cells when the first column contains rowspans. */
function normalizeMergedSequence(
  transactions: readonly Transaction[],
  state: EditorState,
  tr: Transaction,
  original: number,
  mapped: number,
  oldTable: ProseMirrorNode,
  table: ProseMirrorNode,
  oldMap: TableMap,
  map: TableMap,
  column: number,
): void {
  const oldCells = [
    ...new Set(Array.from({ length: oldMap.height }, (_, row) => oldMap.map[row * oldMap.width + column])),
  ];
  const newCells = [...new Set(Array.from({ length: map.height }, (_, row) => map.map[row * map.width + column]))];
  const start = Number(oldTable.nodeAt(oldCells[0])?.attrs.semloEditorSequence);
  if (!Number.isSafeInteger(start) || start < 1 || start > oldCells.length) return;
  const plain = (cell: ProseMirrorNode | null, expected: string) =>
    !!cell &&
    cell.childCount === 1 &&
    !!cell.firstChild?.isTextblock &&
    cell.firstChild.textContent === expected &&
    cell.firstChild.childCount <= 1 &&
    (!cell.firstChild.firstChild || (cell.firstChild.firstChild.isText && !cell.firstChild.firstChild.marks.length));
  if (
    !oldCells.every((offset, index) => {
      const cell = oldTable.nodeAt(offset);
      return cell?.attrs.semloEditorSequence === start && (index + 1 < start || plain(cell, String(index + 2 - start)));
    })
  )
    return;
  const survivors = new Map<number, number>();
  for (let index = 0; index < oldCells.length; index++) {
    let position = original + 1 + oldCells[index];
    let deleted = false;
    for (const transaction of transactions) {
      const result = transaction.mapping.mapResult(position, 1);
      deleted ||= result.deleted;
      position = result.pos;
    }
    if (deleted) continue;
    const relative = position - mapped - 1;
    const cell = state.doc.nodeAt(position);
    const oldCell = oldTable.nodeAt(oldCells[index]);
    if (
      !newCells.includes(relative) ||
      !cell ||
      !oldCell ||
      cell.type !== oldCell.type ||
      !cell.content.eq(oldCell.content)
    )
      return;
    survivors.set(relative, index);
  }
  const first = newCells.findIndex((offset) => (survivors.get(offset) ?? -1) >= start - 1);
  if (first < 0) return;
  const generatedAlignment = oldTable.nodeAt(oldCells[start - 1])?.firstChild?.attrs.textAlign;
  if (
    !newCells.every((offset, index) => {
      const cell = table.nodeAt(offset);
      const oldIndex = survivors.get(offset);
      if (!cell) return false;
      if (index < first) return oldIndex !== undefined || plain(cell, "");
      if (oldIndex !== undefined && oldIndex < start - 1) return false;
      return oldIndex === undefined ? plain(cell, "") : plain(cell, cell.textContent);
    })
  )
    return;
  for (let index = 0; index < newCells.length; index++) {
    const position = tr.mapping.map(mapped + 1 + newCells[index]);
    const cell = tr.doc.nodeAt(position);
    if (!cell) return;
    const nextStart = first + 1;
    if (cell.attrs.semloEditorSequence !== nextStart)
      tr.setNodeMarkup(position, undefined, { ...cell.attrs, semloEditorSequence: nextStart });
    if (index >= first && cell.textContent !== String(index - first + 1)) {
      const paragraph = cell.firstChild!;
      const attrs =
        !cell.attrs.semloEditorSequence && paragraph.type.spec.attrs?.textAlign && generatedAlignment
          ? { ...paragraph.attrs, textAlign: generatedAlignment }
          : paragraph.attrs;
      tr.replaceWith(
        position + 1,
        position + cell.nodeSize - 1,
        paragraph.type.create(attrs, state.schema.text(String(index - first + 1))),
      );
    }
  }
}

/** Keep an untouched generated sequence in step with row edits without overwriting user changes. */
export function normalizeSequenceColumns(
  transactions: readonly Transaction[],
  oldState: EditorState,
  state: EditorState,
): Transaction | null {
  if (!transactions.some((transaction) => transaction.docChanged)) return null;
  const positions: number[] = [];
  oldState.doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    positions.push(pos);
    return false;
  });
  const tr = state.tr;
  for (const original of positions) {
    const oldTable = oldState.doc.nodeAt(original);
    if (!oldTable) continue;
    const oldMap = TableMap.get(oldTable);
    const oldColumns = new Set<number>();
    for (const pos of new Set(oldMap.map)) {
      if (oldTable.nodeAt(pos)?.attrs.semloEditorSequence) oldColumns.add(oldMap.findCell(pos).left);
    }
    if (!oldColumns.size) continue;
    let mapped = original;
    let deleted = false;
    for (const transaction of transactions) {
      const result = transaction.mapping.mapResult(mapped, 1);
      mapped = result.pos;
      // A deletion can remove a table exactly at its start without setting
      // deletedAcross. Never treat the node that follows it as that table.
      deleted ||= result.deleted;
    }
    if (deleted) continue;
    const tablePosition = tr.mapping.map(mapped);
    const table = tr.doc.nodeAt(tablePosition);
    if (!table || table.type !== oldTable.type) continue;
    const initialMap = TableMap.get(table);
    const columns = new Set<number>();
    const cellPositions = new Set(initialMap.map);
    for (const pos of cellPositions) {
      const cell = table.nodeAt(pos);
      if (cell?.attrs.semloEditorSequence) columns.add(initialMap.findCell(pos).left);
    }
    if (initialMap.width !== oldMap.width || initialMap.height === oldMap.height) continue;
    for (const column of oldColumns) {
      if (!columns.has(column)) continue;
      if (
        Array.from({ length: oldMap.height }, (_, row) => oldMap.map[row * oldMap.width + column]).some(
          (offset) => (oldTable.nodeAt(offset)?.attrs.rowspan ?? 1) > 1,
        )
      ) {
        normalizeMergedSequence(transactions, state, tr, original, mapped, oldTable, table, oldMap, initialMap, column);
        continue;
      }
      const startRow = Number(oldTable.nodeAt(oldMap.map[column])?.attrs.semloEditorSequence);
      if (!Number.isSafeInteger(startRow) || startRow < 1 || startRow > oldMap.height + 1) continue;
      const originalSequence = Array.from({ length: oldMap.height }, (_, row) => {
        const cell = oldTable.nodeAt(oldMap.map[row * oldMap.width + column]);
        const expected = row + 1 < startRow ? null : String(row + 2 - startRow);
        return (
          cell?.attrs.semloEditorSequence === startRow &&
          (cell.attrs.colspan === 1 || expected === null) &&
          cell.attrs.rowspan === 1 &&
          (expected === null ||
            (cell.childCount === 1 &&
              cell.firstChild?.isTextblock &&
              cell.firstChild.textContent === expected &&
              cell.firstChild.childCount <= 1 &&
              (!cell.firstChild.firstChild ||
                (cell.firstChild.firstChild.isText && !cell.firstChild.firstChild.marks.length))))
        );
      }).every(Boolean);
      if (!originalSequence) continue;
      const survivors = new Map<number, number>();
      const unchanged = Array.from({ length: oldMap.height }, (_, row) => {
        const oldCellPos = original + 1 + oldMap.map[row * oldMap.width + column];
        const oldCell = oldState.doc.nodeAt(oldCellPos);
        let position = oldCellPos;
        let removed = false;
        for (const transaction of transactions) {
          const result = transaction.mapping.mapResult(position, 1);
          position = result.pos;
          removed ||= result.deleted;
        }
        if (removed) return true;
        const newCell = state.doc.nodeAt(position);
        const relative = position - mapped - 1;
        // Check the mapped cell belongs to the same logical column, including
        // when several numbered columns happen to have identical text.
        if (!cellPositions.has(relative) || initialMap.findCell(relative).left !== column) return false;
        if (!oldCell || !newCell || oldCell.type !== newCell.type || !oldCell.content.eq(newCell.content)) return false;
        if (newCell.attrs.semloEditorSequence !== startRow) return false;
        survivors.set(position, row);
        return true;
      }).every(Boolean);
      if (!unchanged || !survivors.size) continue;
      const safe = Array.from({ length: initialMap.height }, (_, row) => {
        const relative = initialMap.map[row * initialMap.width + column];
        const cell = table.nodeAt(relative);
        if (!cell || cell.attrs.rowspan !== 1) return false;
        if (row + 1 < startRow) return !!cell.attrs.semloEditorSequence || !cell.textContent;
        if (cell.attrs.colspan !== 1) return false;
        if (cell.childCount !== 1) return false;
        const paragraph = cell.firstChild;
        if (!paragraph?.isTextblock || paragraph.childCount > 1) return false;
        if (paragraph.firstChild && (!paragraph.firstChild.isText || paragraph.firstChild.marks.length)) return false;
        const previousRow = survivors.get(mapped + 1 + relative);
        // Cells above the numbering start may contain user data, including
        // numbers; a row deletion must not turn that data into a sequence.
        if (previousRow !== undefined && previousRow + 1 < startRow && paragraph.textContent) return false;
        // A newly created row is blank; never replace unmarked user content.
        return cell.attrs.semloEditorSequence ? /^\d*$/.test(paragraph.textContent) : paragraph.textContent === "";
      }).every(Boolean);
      if (!safe) continue;
      const generatedAlignment =
        startRow <= oldMap.height
          ? oldTable.nodeAt(oldMap.map[(startRow - 1) * oldMap.width + column])?.firstChild?.attrs.textAlign
          : null;
      for (let row = 0; row < initialMap.height; row++) {
        const current = tr.doc.nodeAt(tablePosition);
        if (!current) break;
        const map = TableMap.get(current);
        const cellPosition = tablePosition + 1 + map.map[row * map.width + column];
        const cell = tr.doc.nodeAt(cellPosition);
        const paragraph = cell?.firstChild;
        if (!cell) break;
        const expected = row + 1 < startRow ? null : String(row + 2 - startRow);
        if (!cell.attrs.semloEditorSequence)
          tr.setNodeMarkup(cellPosition, undefined, { ...cell.attrs, semloEditorSequence: startRow });
        if (expected !== null && paragraph && paragraph.textContent !== expected) {
          const text = expected ? state.schema.text(expected) : null;
          const attrs =
            !cell.attrs.semloEditorSequence && paragraph.type.spec.attrs?.textAlign && generatedAlignment
              ? { ...paragraph.attrs, textAlign: generatedAlignment }
              : paragraph.attrs;
          tr.replaceWith(cellPosition + 1, cellPosition + cell.nodeSize - 1, paragraph.type.create(attrs, text));
        }
      }
    }
  }
  return tr.docChanged ? tr : null;
}

/** Mark the generated cells, so ordinary user-provided number columns are never mistaken for one. */
export function insertSequenceColumn(view: EditorView): boolean {
  const state = view.state;
  const rect = selectedRect(state);
  const tr = addColumn(state.tr, rect, 0);
  for (let row = 0; row < rect.map.height; row++) {
    const table = tr.doc.nodeAt(rect.tableStart - 1);
    if (!table) return false;
    const map = TableMap.get(table);
    const position = rect.tableStart + map.map[row * map.width];
    const cell = tr.doc.nodeAt(position);
    if (!cell || !cell.firstChild?.isTextblock) return false;
    tr.setNodeMarkup(position, undefined, { ...cell.attrs, semloEditorSequence: 2 });
    const paragraph = cell.firstChild;
    if (row > 0 && paragraph.type.spec.attrs?.textAlign)
      tr.setNodeMarkup(position + 1, undefined, { ...paragraph.attrs, textAlign: "center" });
    if (row > 0) tr.insertText(String(row), position + 2);
  }
  dispatchTableChange(view, tr);
  return true;
}

/** This explicit action replaces cells in the first column from the requested row onward. */
export function numberSequenceColumn(view: EditorView, startRow: number): boolean {
  const state = view.state;
  const rect = selectedRect(state);
  if (rect.left !== 0 || startRow < 1 || startRow > rect.map.height) return false;
  const cells = [...new Set(Array.from({ length: rect.map.height }, (_, row) => rect.map.map[row * rect.map.width]))];
  // The input is a physical row number, while a rowspan contributes only one
  // logical sequence item. Skip a cell that begins above the requested row,
  // and do not overwrite a cell in the requested range that covers other columns.
  const firstIndex = cells.findIndex((offset) => rect.map.findCell(offset).top >= startRow - 1);
  if (
    firstIndex < 0 ||
    cells.some((offset, index) => {
      const cell = rect.table.nodeAt(offset);
      return (
        !cell || (index >= firstIndex && rect.map.findCell(offset).right !== 1) || !cell.type.createAndFill(cell.attrs)
      );
    })
  )
    return false;
  const sequenceStart = firstIndex + 1;
  const tr = state.tr;
  for (let row = 0; row < cells.length; row++) {
    const position = tr.mapping.map(rect.tableStart + cells[row]);
    const cell = tr.doc.nodeAt(position);
    if (!cell) return false;
    tr.setNodeMarkup(position, undefined, { ...cell.attrs, semloEditorSequence: sequenceStart });
    if (row < firstIndex) continue;
    const empty = cell.type.createAndFill(cell.attrs);
    const paragraph = cell.firstChild?.isTextblock ? cell.firstChild : empty?.firstChild;
    if (!paragraph?.isTextblock) return false;
    const text = state.schema.text(String(row - firstIndex + 1));
    tr.replaceWith(position + 1, position + cell.nodeSize - 1, paragraph.type.create(paragraph.attrs, text));
  }
  dispatchTableChange(view, tr);
  return true;
}

/** Merge generated numbers as a single sequence item without discarding edited cell content. */
export const mergeSequenceCells: TableCommand = (state, dispatch) => {
  if (!mergeCells(state)) return false;
  if (!dispatch || !(state.selection instanceof CellSelection)) return mergeCells(state, dispatch);
  const rect = selectedRect(state);
  if (rect.left !== 0 || rect.right !== 1 || rect.bottom - rect.top < 2) return mergeCells(state, dispatch);
  const firstColumn = [
    ...new Set(Array.from({ length: rect.map.height }, (_, row) => rect.map.map[row * rect.map.width])),
  ];
  const start = Number(rect.table.nodeAt(firstColumn[0])?.attrs.semloEditorSequence);
  if (!Number.isSafeInteger(start) || start < 1 || start > firstColumn.length) return mergeCells(state, dispatch);
  if (rect.top < rect.map.findCell(firstColumn[start - 1]).top) return mergeCells(state, dispatch);
  let selectedAttrs: string | null = null;
  const untouched = firstColumn.every((offset, index) => {
    const cell = rect.table.nodeAt(offset);
    if (!cell || cell.attrs.semloEditorSequence !== start) return false;
    if (index + 1 < start) return true;
    if (cell.attrs.colspan !== 1) return false;
    const cellRect = rect.map.findCell(offset);
    const selected = cellRect.top >= rect.top && cellRect.bottom <= rect.bottom;
    const paragraph = cell.firstChild;
    if (
      cell.childCount !== 1 ||
      !paragraph?.isTextblock ||
      paragraph.childCount !== 1 ||
      !paragraph.firstChild?.isText ||
      paragraph.firstChild.marks.length ||
      paragraph.textContent !== String(index + 2 - start)
    )
      return false;
    if (selected) {
      const attrs = JSON.stringify(paragraph.attrs);
      if (selectedAttrs !== null && attrs !== selectedAttrs) return false;
      selectedAttrs = attrs;
    }
    return true;
  });
  if (!untouched) return mergeCells(state, dispatch);
  let transaction: Transaction | undefined;
  if (!mergeCells(state, (part) => (transaction = part)) || !transaction) return false;
  const table = transaction.doc.nodeAt(rect.tableStart - 1);
  if (!table) return false;
  const map = TableMap.get(table);
  const cells = [...new Set(Array.from({ length: map.height }, (_, row) => map.map[row * map.width]))];
  for (let index = start - 1; index < cells.length; index++) {
    const current = transaction.doc.nodeAt(rect.tableStart - 1);
    if (!current) return false;
    const currentMap = TableMap.get(current);
    const currentCells = [
      ...new Set(Array.from({ length: currentMap.height }, (_, row) => currentMap.map[row * currentMap.width])),
    ];
    const position = rect.tableStart + currentCells[index];
    const cell = transaction.doc.nodeAt(position);
    const paragraph = cell?.firstChild;
    if (!cell || !paragraph?.isTextblock) return false;
    const number = String(index + 2 - start);
    if (cell.childCount !== 1 || paragraph.textContent !== number)
      transaction.replaceWith(
        position + 1,
        position + cell.nodeSize - 1,
        paragraph.type.create(paragraph.attrs, state.schema.text(number)),
      );
  }
  dispatch(transaction);
  return true;
};
