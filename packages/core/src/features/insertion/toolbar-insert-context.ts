import type { Range } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

// Observed in an empty paragraph in a details body. Keep this scoped to that
// ancestor: other containers may accept the same nodes and need separate checks.
const detailsBodyRestricted = new Set([
  "table",
  "database",
  "album",
  "kanban",
  "details",
  "columns",
  "columns2",
  "columns3",
  "columns4",
]);

// Both menus in the observed root-table cells show this subset.
const tableCellAllowed = new Set([
  "image",
  "attachment",
  "status",
  "ai",
  "math",
  "callout",
  "quote",
  "divider",
  "emoji",
  "gallery",
  "mention",
  "yuque",
  "date",
  "localFile",
  "audio",
  "video",
  "link",
  "bulletList",
  "orderedList",
  "taskList",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "inlineCode",
  "paragraph",
]);

export function isObservedTableCellInsert(state: EditorState, from = state.selection.from): boolean {
  if (from < 0 || from > state.doc.content.size) return false;
  const position = state.doc.resolve(from);
  return (
    (position.depth === 4 || position.depth === 6) &&
    position.node(1).type.name === "table" &&
    position.node(2).type.name === "tableRow" &&
    position.node(3).type.name === "tableCell" &&
    ((position.depth === 4 &&
      (position.parent.type.name === "paragraph" ||
        (position.parent.type.name === "heading" &&
          Number.isInteger(position.parent.attrs.level) &&
          position.parent.attrs.level >= 1 &&
          position.parent.attrs.level <= 6))) ||
      (position.depth === 6 &&
        ((["bulletList", "orderedList"].includes(position.node(4).type.name) &&
          position.node(5).type.name === "listItem") ||
          (position.node(4).type.name === "taskList" && position.node(5).type.name === "taskItem")) &&
        position.index(5) === 0 &&
        position.parent.type.name === "paragraph"))
  );
}

/** An empty first cell paragraph omits quick formats; observed later paragraphs show them. */
export function isTableCellQuickSuppressed(state: EditorState, from = state.selection.from): boolean {
  if (!isObservedTableCellInsert(state, from)) return false;
  const position = state.doc.resolve(from);
  return position.depth === 4 && position.parent.type.name === "paragraph" && position.index(3) === 0;
}

/** Slash before cell text and in its observed list items remains literal. */
export function isTableCellSlashSuppressed(state: EditorState, range: Range): boolean {
  if (!isObservedTableCellInsert(state, range.from) || range.to < range.from || range.to > state.doc.content.size)
    return false;
  const from = state.doc.resolve(range.from);
  const to = state.doc.resolve(range.to);
  return (
    from.sameParent(to) && from.parentOffset === 0 && (from.depth === 6 || to.parentOffset < to.parent.content.size)
  );
}

export function isDetailsBodyInsert(state: EditorState, from = state.selection.from): boolean {
  if (from < 0 || from > state.doc.content.size) return false;
  const position = state.doc.resolve(from);
  for (let depth = position.depth; depth > 0; depth--) {
    if (position.node(depth).type.name === "detailsContent") return true;
  }
  return false;
}

/** Apply at display and again immediately before execution, using the current position. */
export function isInsertCommandAllowed(state: EditorState, id: string, from = state.selection.from): boolean {
  return (
    (!isDetailsBodyInsert(state, from) || !detailsBodyRestricted.has(id)) &&
    (!isObservedTableCellInsert(state, from) || tableCellAllowed.has(id))
  );
}

export function filterInsertCommands<T extends { id: string }>(
  state: EditorState,
  commands: readonly T[],
  from = state.selection.from,
): T[] {
  return commands.filter((command) => isInsertCommandAllowed(state, command.id, from));
}
