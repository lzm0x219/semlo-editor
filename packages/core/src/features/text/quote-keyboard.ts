import { Extension } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { findWrapping, liftTarget, ReplaceStep } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";

type QuoteHistoryCandidate = { phase: "typing" | "heading"; time: number };
type PendingQuoteInput = { doc: ProseMirrorNode; from: number; to: number; text: string };
const quoteHistoryKey = new PluginKey<QuoteHistoryCandidate | null>("semloEditorQuoteInputHistory");
// 与当前默认历史插件的分组间隔一致；不把它当成语雀的阈值。
const historyGroupDelay = 500;

function soleQuoteChild(doc: ProseMirrorNode, name: "paragraph" | "heading"): ProseMirrorNode | null {
  const root = doc.childCount === 1 ? doc.firstChild : null;
  const child = root?.type.name === "blockquote" && root.childCount === 1 ? root.firstChild : null;
  return child?.type.name === name ? child : null;
}

function recentCandidate(candidate: QuoteHistoryCandidate | null | undefined, time: number): boolean {
  return Boolean(candidate && time >= candidate.time && time - candidate.time <= historyGroupDelay);
}

export function canJoinQuoteHeading(state: EditorState, level: number): boolean {
  const candidate = quoteHistoryKey.getState(state);
  return (
    level === 3 &&
    candidate?.phase === "typing" &&
    recentCandidate(candidate, Date.now()) &&
    state.selection instanceof TextSelection &&
    state.selection.empty &&
    state.selection.$from.parent === soleQuoteChild(state.doc, "paragraph") &&
    state.selection.$from.parentOffset === state.selection.$from.parent.content.size
  );
}

export function canJoinQuoteHeadingDeletion(state: EditorState): boolean {
  const candidate = quoteHistoryKey.getState(state);
  const heading = soleQuoteChild(state.doc, "heading");
  return Boolean(
    candidate?.phase === "heading" &&
    recentCandidate(candidate, Date.now()) &&
    heading?.attrs.level === 3 &&
    state.selection instanceof TextSelection &&
    state.selection.$from.parent === heading &&
    state.selection.$to.parent === heading,
  );
}

export function markJoinedQuoteHeading(transaction: Transaction): void {
  transaction.setMeta(quoteHistoryKey, "heading");
}

function advanceQuoteHistory(
  transaction: Transaction,
  previous: QuoteHistoryCandidate | null,
  state: EditorState,
  input: PendingQuoteInput | null,
): QuoteHistoryCandidate | null {
  const meta = transaction.getMeta(quoteHistoryKey);
  if (meta === "created" && soleQuoteChild(transaction.doc, "paragraph")?.content.size === 0)
    return { phase: "typing", time: transaction.time };
  if (!previous || isHistoryTransaction(transaction) || transaction.getMeta("appendedTransaction")) return null;
  if (!transaction.docChanged) {
    const child = soleQuoteChild(transaction.doc, previous.phase === "typing" ? "paragraph" : "heading");
    return transaction.selection instanceof TextSelection &&
      transaction.selection.$from.parent === child &&
      transaction.selection.$to.parent === child
      ? previous
      : null;
  }
  if (!recentCandidate(previous, transaction.time) || transaction.getMeta("addToHistory") === false) return null;
  if (
    meta === "heading" &&
    previous.phase === "typing" &&
    soleQuoteChild(transaction.doc, "heading")?.attrs.level === 3
  )
    return { phase: "heading", time: transaction.time };
  if (
    previous.phase !== "typing" ||
    !input ||
    input.doc !== state.doc ||
    transaction.getMeta("composition") !== undefined ||
    transaction.getMeta("uiEvent") !== undefined ||
    transaction.steps.length !== 1
  )
    return null;
  const step = transaction.steps[0];
  if (
    !(step instanceof ReplaceStep) ||
    step.from !== step.to ||
    step.from !== input.from ||
    step.to !== input.to ||
    step.from !== state.selection.from ||
    !state.selection.empty ||
    state.selection.$from.parent !== soleQuoteChild(state.doc, "paragraph") ||
    state.selection.$from.parentOffset !== state.selection.$from.parent.content.size ||
    !soleQuoteChild(transaction.doc, "paragraph") ||
    step.slice.openStart !== 0 ||
    step.slice.openEnd !== 0
  )
    return null;
  let plainText = step.slice.content.size > 0;
  step.slice.content.forEach((node) => {
    if (!node.isText || node.marks.length) plainText = false;
  });
  return plainText && step.slice.content.textBetween(0, step.slice.content.size) === input.text
    ? { phase: "typing", time: transaction.time }
    : null;
}

function wrapRootQuote(view: EditorView, from: number, to: number, text: string): boolean {
  let { state } = view;
  const { schema } = state;
  if (view.composing || !view.editable || text !== " " || from !== to || from < 0 || from > state.doc.content.size)
    return false;
  const $from = state.doc.resolve(from);
  const paragraph = $from.parent;
  if (
    $from.depth !== 1 ||
    paragraph.type.name !== "paragraph" ||
    paragraph.textContent !== ">" ||
    paragraph.content.size !== 1 ||
    paragraph.firstChild?.marks.length ||
    state.storedMarks?.length ||
    $from.parentOffset !== 1 ||
    !schema.nodes.blockquote
  )
    return false;
  if (!(state.selection instanceof TextSelection) || !state.selection.empty || state.selection.from !== from) {
    const native = view.dom.ownerDocument.getSelection();
    if (!native?.isCollapsed || !native.anchorNode || !view.dom.contains(native.anchorNode)) return true;
    try {
      if (view.posAtDOM(native.anchorNode, native.anchorOffset) !== from) return true;
    } catch {
      return true;
    }
    const document = state.doc;
    view.dispatch(state.tr.setSelection(TextSelection.create(document, from)));
    state = view.state;
    // 宿主可以拒绝、重定向或替换文档；此时不能继续输入或交给后续规则。
    if (
      view.isDestroyed ||
      !view.editable ||
      state.doc !== document ||
      !(state.selection instanceof TextSelection) ||
      !state.selection.empty ||
      state.selection.from !== from
    )
      return true;
  }
  // 单独的空正文可整体替换，保留段落属性并让后续输入与转换使用正常的历史分组。
  if (
    state.doc.childCount === 1 &&
    !schema.nodes.blockquote.hasRequiredAttrs() &&
    state.doc.canReplaceWith(0, 1, schema.nodes.blockquote)
  ) {
    const emptyParagraph = paragraph.copy(Fragment.empty);
    if (schema.nodes.blockquote.validContent(Fragment.from(emptyParagraph))) {
      const quote = schema.nodes.blockquote.create(null, emptyParagraph);
      const transaction = state.tr.replaceWith(0, state.doc.content.size, quote);
      transaction.setSelection(TextSelection.create(transaction.doc, 2));
      transaction.setMeta(quoteHistoryKey, "created");
      view.dispatch(transaction.scrollIntoView());
      return true;
    }
  }
  // 多块文档沿用原有映射，避免影响相邻内容。
  const transaction = state.tr.insertText(text, from, to).delete(from - 1, from + 1);
  const range = transaction.selection.$from.blockRange();
  const wrapping = range && findWrapping(range, schema.nodes.blockquote);
  if (!range || !wrapping) return false;
  transaction.wrap(range, wrapping);
  view.dispatch(transaction.scrollIntoView());
  return true;
}

function leaveEmptyRootQuote(view: EditorView, event: KeyboardEvent): boolean {
  const { state } = view;
  const { selection } = state;
  if (
    !view.editable ||
    view.composing ||
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.key !== "Backspace" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    !(selection instanceof TextSelection) ||
    !selection.empty
  )
    return false;
  const { $from } = selection;
  if ($from.depth !== 2 || $from.parent.type.name !== "paragraph" || $from.parent.content.size !== 0) return false;
  const quote = $from.node(1);
  if (quote.type.name !== "blockquote" || quote.childCount !== 1 || quote.firstChild !== $from.parent) return false;
  try {
    // 未知的引用属性可能承载宿主数据，不能因退格静默丢弃。
    if (!quote.sameMarkup(quote.type.create())) return false;
  } catch {
    return false;
  }
  const range = $from.blockRange();
  const target = range && liftTarget(range);
  if (!range || target !== 0) return false;
  const transaction = state.tr.lift(range, target);
  if (state.storedMarks) transaction.setStoredMarks(state.storedMarks);
  view.dispatch(transaction.scrollIntoView());
  return true;
}

export const QuoteKeyboard = Extension.create({
  name: "semloEditorQuoteKeyboard",
  priority: 1001,
  addProseMirrorPlugins() {
    let pending: PendingQuoteInput | null = null;
    return [
      new Plugin<QuoteHistoryCandidate | null>({
        key: quoteHistoryKey,
        state: {
          init: () => null,
          apply(transaction, previous, oldState) {
            const input = pending;
            if (transaction.docChanged) pending = null;
            return advanceQuoteHistory(transaction, previous, oldState, input);
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            if (wrapRootQuote(view, from, to, text)) return true;
            const candidate = quoteHistoryKey.getState(view.state);
            if (
              candidate?.phase === "typing" &&
              !view.composing &&
              from === to &&
              from === view.state.selection.from &&
              view.state.selection.empty &&
              view.state.selection.$from.parent === soleQuoteChild(view.state.doc, "paragraph")
            ) {
              const input = { doc: view.state.doc, from, to, text };
              pending = input;
              queueMicrotask(() => {
                if (pending === input) pending = null;
              });
            }
            return false;
          },
          handleKeyDown: leaveEmptyRootQuote,
        },
      }),
    ];
  },
});
