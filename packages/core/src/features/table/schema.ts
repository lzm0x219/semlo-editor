import type { Attributes } from "@tiptap/core";
import { TableCell, TableHeader } from "@tiptap/extension-table";
import type { TagParseRule } from "@tiptap/pm/model";

// Table serialization includes structural HTML elements which are transparent
// to ProseMirror's normal parser but otherwise trip Tiptap's strict catch-all.
export const tableValidationRules: TagParseRule[] = [
  ...["colgroup", "thead", "tbody", "tfoot"].map((tag) => ({ tag: `table > ${tag}`, skip: true })),
  { tag: "table > colgroup > col", ignore: true },
];

const importedColumnWidths = new WeakMap<HTMLTableElement, Map<HTMLElement, number[]>>();

export function readTableColumnWidths(table: HTMLTableElement) {
  const widths = Array.from(table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col")).flatMap((col) => {
    const style = col.style.width;
    const pixels = /^\d*\.?\d+px$/.test(style) ? Math.round(Number.parseFloat(style)) : 0;
    const width = pixels || Number.parseInt(col.getAttribute("width") ?? "", 10);
    // 缺省列跨度为 1，并按 HTML 表格布局限制单个 col 的跨度。
    const span = Number.parseInt(col.getAttribute("span") ?? "", 10);
    return Array<number>(span > 0 ? Math.min(span, 1000) : 1).fill(
      Number.isSafeInteger(width) && width > 0 ? width : 0,
    );
  });
  // 每次进入表格解析时重新计算，单元格规则只读本次表格的列宽。
  importedColumnWidths.delete(table);
  if (!widths.some((width) => width > 0)) return;

  const cells = new Map<HTMLElement, number[]>();
  const occupiedUntil: number[] = [];
  let previousSection: Element | null = null;
  Array.from(table.rows).forEach((row, rowIndex) => {
    if (row.parentElement !== previousSection) occupiedUntil.length = 0;
    previousSection = row.parentElement;
    let column = 0;
    for (const cell of row.cells) {
      // 先越过仍被上方单元格占用的列，再按当前格的跨度读取实际列宽。
      while (occupiedUntil[column] > rowIndex) column++;
      if (column >= widths.length) break;
      const end = Math.min(column + cell.colSpan, widths.length);
      const cellWidths = widths.slice(column, end);
      if (cellWidths.some((width) => width > 0)) {
        while (cellWidths.length < cell.colSpan) cellWidths.push(0);
        cells.set(cell, cellWidths);
      }
      for (let index = column; index < end; index++) occupiedUntil[index] = rowIndex + cell.rowSpan;
      column = end;
    }
  });
  importedColumnWidths.set(table, cells);
}

function withImportedColumnWidths(attrs: Attributes): Attributes {
  return {
    ...attrs,
    colwidth: {
      ...attrs.colwidth,
      parseHTML: (cell) => {
        const table = cell.closest("table");
        const widths = table && importedColumnWidths.get(table);
        if (!widths || cell.getAttribute("colwidth")) return attrs.colwidth?.parseHTML?.(cell) ?? null;
        return widths.get(cell) ?? null;
      },
    },
  };
}

export const SemloEditorTableCell = TableCell.extend({
  addAttributes() {
    return withImportedColumnWidths(this.parent?.() ?? {});
  },
});

export const SemloEditorTableHeader = TableHeader.extend({
  addAttributes() {
    return withImportedColumnWidths(this.parent?.() ?? {});
  },
});
