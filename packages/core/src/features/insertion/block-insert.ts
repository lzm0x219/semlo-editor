import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

import type { BlockInsertTarget } from "../blocks/actions/target";
import { headingFoldAttribute, isHeadingFolded, setHeadingFolded } from "../heading/fold";
import { siblingItemAttrs } from "./sibling-item-attrs";

/** Create the insertion point only after an insertion command is chosen. */
export function prepareBlockInsertion(editor: Editor, target: BlockInsertTarget, command: string): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const initial = editor.state;
  const original = initial.doc.nodeAt(target.pos);
  if (original !== target.node || target.after !== target.pos + original.nodeSize) return false;
  // 展开可能写入文档并触发宿主回写；确认只有预期变化后再从当前状态创建插入事务。
  if (original.type.name === "heading" && isHeadingFolded(editor, target.pos)) {
    const view = editor.view;
    const expanded = initial.tr.setNodeMarkup(target.pos, undefined, {
      ...original.attrs,
      [headingFoldAttribute]: false,
    }).doc;
    if (!setHeadingFolded(editor, target.pos, false)) return false;
    if (editor.isDestroyed || !editor.isEditable || editor.view !== view || isHeadingFolded(editor, target.pos))
      return false;
    if (!editor.state.doc.eq(initial.doc) && !editor.state.doc.eq(expanded)) return false;
  }
  const state = editor.state;
  const node = state.doc.nodeAt(target.pos);
  if (!node || target.after !== target.pos + node.nodeSize) return false;
  const resolved = state.doc.resolve(target.pos),
    parent = resolved.parent,
    index = resolved.index() + 1;
  const type = target.kind === "item" ? node.type : state.schema.nodes.paragraph;
  if (!type || !parent.canReplaceWith(index, index, type)) return false;
  const attrs = target.kind === "item" ? siblingItemAttrs(node) : null;
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
