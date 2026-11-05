import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/** Separate accepted formatting from subsequent edits without changing history for a rejected transaction. */
export function dispatchFormattingWithHistory(editor: Editor, transaction: Transaction): void {
  const view = editor.view;
  let nextState: EditorState | undefined;
  let committed = false;
  let reentered = false;
  const before = (event: { transaction: Transaction; nextState: EditorState }) => {
    if (event.transaction !== transaction || nextState) reentered = true;
    else nextState = event.nextState;
  };
  const after = (event: { transaction: Transaction }) => {
    if (event.transaction !== transaction) reentered = true;
    else committed = !!nextState && view.state === nextState;
  };
  editor.on("beforeTransaction", before);
  editor.on("transaction", after);
  try {
    view.dispatch(transaction);
  } finally {
    editor.off("beforeTransaction", before);
    editor.off("transaction", after);
  }
  if (!view.isDestroyed && view.editable && committed && !reentered && view.state === nextState)
    view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
}
