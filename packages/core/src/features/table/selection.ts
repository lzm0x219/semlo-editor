import { CellSelection, TableMap } from "@tiptap/pm/tables";

export function selectionContainsCell(selection: CellSelection, position: number): boolean {
  let found = false;
  selection.forEachCell((_cell, pos) => {
    if (pos === position) found = true;
  });
  return found;
}

export function selectedTableText(selection: CellSelection): string {
  const table = selection.$anchorCell.node(-1);
  const start = selection.$anchorCell.start(-1);
  const map = TableMap.get(table);
  const rect = map.rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start);
  const seen = new Set<number>();
  const rows: string[] = [];
  for (let row = rect.top; row < rect.bottom; row++) {
    const cells: string[] = [];
    for (let column = rect.left; column < rect.right; column++) {
      const pos = map.map[row * map.width + column];
      const cell = table.nodeAt(pos);
      if (!seen.has(pos) && cell) cells.push(cell.textBetween(0, cell.content.size, "\n"));
      seen.add(pos);
    }
    rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}
