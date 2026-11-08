import type { ResolvedPos } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";

import { slashHistoryProbeKey, slashSuggestionKey } from "./keys";

/** 限定保存投影的正文上下文；标题、列表和未核对的嵌套结构仍作为正文保留。 */
export function isSlashDraftParagraph(position: ResolvedPos): boolean {
  if (position.parent.type.name !== "paragraph" || position.parentOffset !== 0) return false;
  if (position.depth === 1) return true;
  if (position.depth === 2) return ["blockquote", "callout"].includes(position.node(1).type.name);
  if (position.depth === 3)
    return position.node(1).type.name === "details" && position.node(2).type.name === "detailsContent";
  if (
    position.depth === 4 &&
    position.node(1).type.name === "table" &&
    position.node(2).type.name === "tableRow" &&
    ["tableCell", "tableHeader"].includes(position.node(3).type.name)
  )
    return true;
  return (
    position.depth === 4 &&
    position.node(1).type.name === "details" &&
    position.node(2).type.name === "detailsContent" &&
    position.node(3).type.name === "callout"
  );
}

/** 原生删除不经过文字输入钩子；只保留始终位于已确认查询内的纯删除。 */
export function isSlashDraftDeletion(transaction: Transaction, from: number): boolean {
  if (!transaction.steps.length || from < 0 || from >= transaction.before.content.size) return false;
  const position = transaction.before.resolve(from);
  if (!isSlashDraftParagraph(position)) return false;
  let end = position.end();
  for (const step of transaction.steps) {
    if (
      !(step instanceof ReplaceStep) ||
      step.slice.content.size !== 0 ||
      step.from <= from ||
      step.to <= step.from ||
      step.to > end
    )
      return false;
    // 每步都更新边界，避免后续步骤沿用旧长度而越过查询。
    end -= step.to - step.from;
  }
  return true;
}

/** 只投影已支持正文中由本次真实输入建立的活动查询，不修改编辑文档、选区或历史。 */
export function documentWithoutSlashDraft(state: EditorState) {
  const draftFrom = slashHistoryProbeKey.getState(state)?.draftFrom;
  const suggestion = slashSuggestionKey.getState(state);
  if (typeof draftFrom !== "number" || !suggestion?.active) return state.doc;
  const { from, to } = suggestion.range;
  if (from !== draftFrom || from < 0 || to < from || to > state.doc.content.size) return state.doc;
  const position = state.doc.resolve(from);
  if (
    !isSlashDraftParagraph(position) ||
    to !== position.end() ||
    !suggestion.text?.startsWith("/") ||
    state.doc.textBetween(from, to) !== suggestion.text
  )
    return state.doc;
  return state.tr.delete(from, to).doc;
}

/** 退出查询只有状态变化，需补发一次保存通知；普通文档变更仍由 Tiptap 通知。 */
export function createSlashDraftCommitObserver(initial: EditorState, notify: () => void) {
  let previous = documentWithoutSlashDraft(initial);
  return (state: EditorState, transactions: readonly Transaction[]) => {
    const content = documentWithoutSlashDraft(state);
    const changed = !content.eq(previous);
    previous = content;
    if (
      changed &&
      transactions.length &&
      transactions.every((transaction) => !transaction.docChanged && !transaction.getMeta("preventUpdate"))
    )
      notify();
  };
}
