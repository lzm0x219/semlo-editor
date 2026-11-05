import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

import type { BlockInsertTarget } from "../blocks/actions/target";
import { isHeadingFolded, setHeadingFolded } from "../heading/fold";

/** Create the insertion point only after an insertion command is chosen. */
export function prepareBlockInsertion(editor: Editor, target: BlockInsertTarget, command: string): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const { state } = editor;
  const node = state.doc.nodeAt(target.pos);
  if (node !== target.node || target.after !== target.pos + node.nodeSize) return false;
  // The new cursor must not be relocated by a collapsed heading section.
  if (node.type.name === "heading" && isHeadingFolded(editor, target.pos)) setHeadingFolded(editor, target.pos, false);
  const resolved = state.doc.resolve(target.pos),
    parent = resolved.parent,
    index = resolved.index() + 1;
  const type = target.kind === "item" ? node.type : state.schema.nodes.paragraph;
  if (!type || !parent.canReplaceWith(index, index, type)) return false;
  const attrs =
    target.kind === "item" ? { ...node.attrs, ...(node.type.name === "taskItem" ? { checked: false } : {}) } : null;
  let inserted = type.createAndFill(attrs);
  if (!inserted) return false;
  const needsFollowingBlock = target.kind === "item" && ["quote", "callout", "code", "details"].includes(command);
  if (needsFollowingBlock) {
    const paragraph = state.schema.nodes.paragraph?.createAndFill();
    if (!paragraph) return false;
    const content = inserted.content.append(Fragment.from(paragraph));
    if (!type.validContent(content)) return false;
    inserted = type.create(attrs, content);
  }
  const tr = state.tr.insert(target.after, inserted);
  const cursor =
    target.after + (target.kind === "item" ? 2 + (needsFollowingBlock ? inserted.firstChild!.nodeSize : 0) : 1);
  if (cursor > tr.doc.content.size || !tr.doc.resolve(cursor).parent.isTextblock) return false;
  tr.setSelection(TextSelection.create(tr.doc, cursor)).scrollIntoView();
  editor.view.dispatch(closeHistory(tr));
  if (!editor.isDestroyed) editor.view.focus();
  return true;
}
