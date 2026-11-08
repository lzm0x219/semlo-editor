import type { Range } from "@tiptap/core";
import { Slice, type Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection, TextSelection, type EditorState } from "@tiptap/pm/state";

import type { WritingAcceptMode } from "./types";

/** 闭合块拟合后必须仍能完整找到生成的块序列，不能接受被 fitter 丢弃的结构。 */
function containsBlocks(doc: ProseMirrorNode, content: Fragment, from: number, to: number): boolean {
  let found = false;
  const visit = (parent: ProseMirrorNode, base: number) => {
    parent.forEach((child, offset, index) => {
      if (found) return;
      const position = base + 1 + offset;
      if (position >= from && index + content.childCount <= parent.childCount) {
        let end = position;
        let equal = true;
        for (let part = 0; part < content.childCount; part++) {
          const candidate = parent.child(index + part);
          end += candidate.nodeSize;
          if (!candidate.eq(content.child(part))) equal = false;
        }
        if (equal && end <= to) found = true;
      }
      if (!found && position < to && position + child.nodeSize > from) visit(child, position);
    });
  };
  visit(doc, -1);
  return found;
}

export function acceptWritingSelection(
  state: EditorState,
  generated: ProseMirrorNode,
  range: Range,
  mode: WritingAcceptMode,
) {
  const from = mode === "after" ? range.to : range.from;
  const to = range.to;
  const start = state.doc.resolve(from),
    end = state.doc.resolve(to);
  const paragraph = generated.childCount === 1 ? generated.firstChild : null;
  const defaults = paragraph && Object.entries(paragraph.type.spec.attrs ?? {});
  const defaultAttrs =
    defaults && defaults.every(([, spec]) => Object.hasOwn(spec, "default"))
      ? Object.fromEntries(defaults.map(([name, spec]) => [name, spec.default]))
      : null;
  const inline =
    paragraph?.type.name === "paragraph" &&
    paragraph.marks.length === 0 &&
    start.sameParent(end) &&
    start.parent.type.name === "paragraph" &&
    ((defaultAttrs !== null && paragraph.hasMarkup(paragraph.type, defaultAttrs)) ||
      paragraph.sameMarkup(start.parent));
  const tr = state.tr;
  if (inline && paragraph) {
    // 仅无独立段落格式的单段结果参与行内拟合；原段落及未选文字的标记和属性保留。
    tr.replaceWith(from, to, paragraph.content);
    const end = from + paragraph.content.size;
    tr.setSelection(TextSelection.create(tr.doc, mode === "after" || range.from === range.to ? from : end, end));
  } else {
    tr.replaceRange(from, to, new Slice(generated.content, 0, 0));
    let left = tr.doc.content.size,
      right = 0;
    // fitter 可能把段首替换扩到父块边界，原目标点的映射不等于实际插入范围。
    tr.mapping.maps.forEach((map, index) => {
      const rest = tr.mapping.slice(index + 1);
      map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
        left = Math.min(left, rest.map(newFrom, -1));
        right = Math.max(right, rest.map(newTo, 1));
      });
    });
    if (!containsBlocks(tr.doc, generated.content, left, right))
      throw new Error("当前目标无法完整接纳此结构，草稿已保留");
    // 复杂结构没有已观察的自动扩选规则，只保留单一文本光标，避免选中未操作的后文。
    const point = tr.doc.resolve(Math.min(tr.doc.content.size, tr.mapping.map(state.selection.head, -1)));
    const caret = Selection.findFrom(point, -1, true) ?? Selection.findFrom(point, 1, true);
    if (!caret || !caret.empty) throw new Error("当前目标没有安全的文本光标位置，草稿已保留");
    tr.setSelection(caret);
  }
  tr.doc.check();
  return tr;
}
