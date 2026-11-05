import type { Range } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

/** A slash before existing root paragraph text remains literal. */
export function isRootParagraphSlashSuppressed(state: EditorState, range: Range): boolean {
  if (range.from < 0 || range.to < range.from || range.to > state.doc.content.size) return false;
  const from = state.doc.resolve(range.from);
  const to = state.doc.resolve(range.to);
  return (
    from.sameParent(to) &&
    from.depth === 1 &&
    from.parent.type.name === "paragraph" &&
    from.parentOffset === 0 &&
    to.parentOffset < to.parent.content.size
  );
}

/** The same behavior was observed in a paragraph directly inside a root quote. */
export function isQuoteParagraphSlashSuppressed(state: EditorState, range: Range): boolean {
  if (range.from < 0 || range.to < range.from || range.to > state.doc.content.size) return false;
  const from = state.doc.resolve(range.from);
  const to = state.doc.resolve(range.to);
  return (
    from.sameParent(to) &&
    from.depth === 2 &&
    from.node(1).type.name === "blockquote" &&
    from.parent.type.name === "paragraph" &&
    from.parentOffset === 0 &&
    to.parentOffset < to.parent.content.size
  );
}

/** Direct paragraphs in observed callouts and fold bodies also retain literal slash. */
export function isCardParagraphSlashSuppressed(state: EditorState, range: Range): boolean {
  if (range.from < 0 || range.to < range.from || range.to > state.doc.content.size) return false;
  const from = state.doc.resolve(range.from);
  const to = state.doc.resolve(range.to);
  return (
    from.sameParent(to) &&
    ((from.depth === 2 && from.node(1).type.name === "callout") ||
      (from.depth === 3 && from.node(1).type.name === "details" && from.node(2).type.name === "detailsContent") ||
      (from.depth === 4 &&
        from.node(1).type.name === "details" &&
        from.node(2).type.name === "detailsContent" &&
        from.node(3).type.name === "callout")) &&
    from.parent.type.name === "paragraph" &&
    from.parentOffset === 0 &&
    to.parentOffset < to.parent.content.size
  );
}
