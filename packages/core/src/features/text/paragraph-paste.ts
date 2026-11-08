import { Extension } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { AllSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

type PasteCandidate = { doc: ProseMirrorNode; time: number };
type PendingPaste = { before: ProseMirrorNode; expected: ProseMirrorNode };
const paragraphPasteKey = new PluginKey<PasteCandidate | null>("semloEditorRootParagraphPaste");

function blankRoot(state: EditorState): boolean {
  const { doc, selection } = state;
  const paragraph = doc.childCount === 1 ? doc.firstChild : null;
  if (
    !paragraph ||
    paragraph.type.name !== "paragraph" ||
    paragraph.content.size !== 0 ||
    !(selection instanceof TextSelection) ||
    !selection.empty ||
    selection.$from.depth !== 1 ||
    selection.$from.parent !== paragraph ||
    state.storedMarks?.length
  )
    return false;
  try {
    return paragraph.sameMarkup(paragraph.type.create());
  } catch {
    return false;
  }
}

function paragraphSlice(slice: Slice): boolean {
  if (slice.content.childCount < 2 || slice.openStart > 1 || slice.openEnd > 1) return false;
  let valid = true;
  slice.content.forEach((node) => {
    if (node.type.name !== "paragraph") valid = false;
  });
  return valid;
}

export function canJoinRootParagraphPaste(state: EditorState): boolean {
  const candidate = paragraphPasteKey.getState(state);
  const elapsed = candidate ? Date.now() - candidate.time : -1;
  return Boolean(
    candidate &&
    candidate.doc === state.doc &&
    state.selection instanceof AllSelection &&
    elapsed >= 0 &&
    elapsed <= 500,
  );
}

/** 空白根正文粘贴多段带行高的 HTML 时，保留首段原有行高。 */
export const RootParagraphPaste = Extension.create({
  name: "semloEditorRootParagraphPaste",
  // 让接入方和其他粘贴处理器先决定是否接管。
  priority: 1,
  addProseMirrorPlugins() {
    let pending: PendingPaste | null = null;
    let plugin: Plugin<PasteCandidate | null>;
    plugin = new Plugin<PasteCandidate | null>({
      key: paragraphPasteKey,
      state: {
        init: () => null,
        apply(transaction, previous, oldState) {
          if (transaction.docChanged) {
            const input = pending;
            pending = null;
            return input &&
              transaction.before === input.before &&
              oldState.doc === input.before &&
              transaction.doc.eq(input.expected) &&
              transaction.getMeta("uiEvent") === "paste" &&
              transaction.getMeta("paste") === true &&
              transaction.getMeta("addToHistory") !== false &&
              !transaction.getMeta("appendedTransaction")
              ? { doc: transaction.doc, time: transaction.time }
              : null;
          }
          if (!previous || isHistoryTransaction(transaction) || transaction.getMeta("appendedTransaction")) return null;
          return transaction.doc === previous.doc ? previous : null;
        },
      },
      props: {
        handlePaste(view, event, slice) {
          if (!view.editable || event.defaultPrevented || !blankRoot(view.state) || !paragraphSlice(slice))
            return false;
          const index = view.state.plugins.indexOf(plugin);
          if (index < 0 || view.state.plugins.slice(index + 1).some((other) => other.props.handlePaste)) return false;
          let transaction: Transaction;
          let needsClosedSlice: boolean;
          try {
            needsClosedSlice =
              slice.openStart === 1 &&
              slice.content.firstChild?.attrs.semloEditorLineHeight != null &&
              view.state.doc.type.validContent(slice.content);
            transaction = view.state.tr.replaceSelection(needsClosedSlice ? new Slice(slice.content, 0, 0) : slice);
            const expected = transaction.doc;
            if (expected.childCount < 2) return false;
            let paragraphsOnly = true;
            expected.forEach((node) => {
              if (node.type.name !== "paragraph") paragraphsOnly = false;
            });
            if (!paragraphsOnly) return false;
            const input = { before: view.state.doc, expected };
            pending = input;
            queueMicrotask(() => {
              if (pending === input) pending = null;
            });
          } catch {
            // 自定义 schema 无法安全重建粘贴结果时沿用原有处理。
            return false;
          }
          if (needsClosedSlice) {
            view.dispatch(transaction.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
            return true;
          }
          return false;
        },
      },
    });
    return [plugin];
  },
});
