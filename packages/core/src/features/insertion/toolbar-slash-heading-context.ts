import type { Range } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

/** Observed root, quote, callout, fold-body and root-table H1–H6 keep slash as title text. */
export function isHeadingSlashSuppressed(state: EditorState, range: Range): boolean {
  if (range.from < 0 || range.to < range.from || range.to > state.doc.content.size) return false;
  const $from = state.doc.resolve(range.from);
  const $to = state.doc.resolve(range.to);
  return (
    $from.sameParent($to) &&
    ($from.depth === 1 ||
      ($from.depth === 2 && ["blockquote", "callout"].includes($from.node(1).type.name)) ||
      ($from.depth === 3 && $from.node(1).type.name === "details" && $from.node(2).type.name === "detailsContent") ||
      ($from.depth === 4 &&
        $from.node(1).type.name === "details" &&
        $from.node(2).type.name === "detailsContent" &&
        $from.node(3).type.name === "callout") ||
      ($from.depth === 4 &&
        $from.node(1).type.name === "table" &&
        $from.node(2).type.name === "tableRow" &&
        $from.node(3).type.name === "tableCell")) &&
    $from.parent.type.name === "heading" &&
    Number.isInteger($from.parent.attrs.level) &&
    $from.parent.attrs.level >= 1 &&
    $from.parent.attrs.level <= 6 &&
    $from.parentOffset === 0 &&
    $from.parent.textContent.startsWith("/")
  );
}
