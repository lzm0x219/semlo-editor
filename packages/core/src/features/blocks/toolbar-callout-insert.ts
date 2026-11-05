import type { Editor, Range } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

/** Split a callout around an otherwise empty slash paragraph and insert a sibling callout. */
export function insertCalloutSiblingFromSlash(
  editor: Editor,
  range: Range | undefined,
  attrs?: Record<string, unknown>,
): "inserted" | "blocked" | "not-applicable" {
  if (!range || range.from < 0 || range.to < range.from || range.to > editor.state.doc.content.size)
    return "not-applicable";
  const { doc, schema } = editor.state;
  const $from = doc.resolve(range.from);
  const $to = doc.resolve(range.to);
  if (
    !$from.sameParent($to) ||
    $from.parent.type.name !== "paragraph" ||
    $from.depth < 2 ||
    $from.node($from.depth - 1).type.name !== "callout"
  )
    return "not-applicable";
  const paragraph = $from.parent;
  if ($from.parentOffset !== 0 || $to.parentOffset !== paragraph.content.size || !paragraph.textContent.startsWith("/"))
    return "not-applicable";
  if (!editor.isEditable) return "blocked";

  const calloutDepth = $from.depth - 1;
  const callout = $from.node(calloutDepth);
  const parent = $from.node(calloutDepth - 1);
  const childIndex = $from.index(calloutDepth);
  const calloutIndex = $from.index(calloutDepth - 1);
  const children: (typeof callout)[] = [];
  callout.forEach((child) => children.push(child));
  const before = Fragment.fromArray(children.slice(0, childIndex));
  const after = Fragment.fromArray(children.slice(childIndex + 1));
  const inserted = schema.nodes.callout?.createAndFill(attrs);
  if (
    !inserted ||
    (before.size && !callout.type.validContent(before)) ||
    (after.size && !callout.type.validContent(after))
  )
    return "blocked";
  const nodes = [];
  if (before.size) nodes.push(callout.copy(before));
  nodes.push(inserted);
  if (after.size) nodes.push(callout.copy(after));
  const replacement = Fragment.fromArray(nodes);
  if (!parent.canReplace(calloutIndex, calloutIndex + 1, replacement)) return "blocked";
  const from = $from.before(calloutDepth);
  const to = $from.after(calloutDepth);
  const insertedStart = from + (before.size ? nodes[0].nodeSize : 0);
  const transaction = closeHistory(editor.state.tr).replaceWith(from, to, replacement);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertedStart + 2)));
  const view = editor.view;
  const focused = view.dom.ownerDocument.activeElement;
  view.dispatch(transaction.scrollIntoView());
  if (
    !editor.isDestroyed &&
    editor.view === view &&
    view.dom.isConnected &&
    view.dom.ownerDocument.activeElement === focused
  )
    view.focus();
  return "inserted";
}
