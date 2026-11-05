import type { Range } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

/** Match observed slash input in list paragraphs through the eighth nested level. */
export function isListSlashSuppressed(state: EditorState, range: Range): boolean {
  if (range.from < 0 || range.to < range.from || range.to > state.doc.content.size) return false;
  const $from = state.doc.resolve(range.from);
  const $to = state.doc.resolve(range.to);
  if (
    !$from.sameParent($to) ||
    $from.parent.type.name !== "paragraph" ||
    $from.parentOffset !== 0 ||
    $from.depth < 3 ||
    $from.depth > 19 ||
    $from.depth % 2 !== 1 ||
    !$from.parent.textContent.startsWith("/")
  )
    return false;
  const isPair = (list: string, item: string) =>
    (item === "listItem" && (list === "bulletList" || list === "orderedList")) ||
    (item === "taskItem" && list === "taskList");
  const item = $from.node($from.depth - 1);
  const list = $from.node($from.depth - 2);
  if (!isPair(list.type.name, item.type.name) || $from.index($from.depth - 1) !== 0) return false;
  if (item.childCount > 1) {
    for (let index = 1; index < item.childCount; index++) {
      if (!["bulletList", "orderedList", "taskList"].includes(item.child(index).type.name)) return false;
    }
  }
  for (let depth = 1; depth < $from.depth - 2; depth += 2) {
    if (!isPair($from.node(depth).type.name, $from.node(depth + 1).type.name)) return false;
  }
  return true;
}
