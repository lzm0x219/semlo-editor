import { history, isHistoryTransaction, redoDepth, undoDepth } from "@tiptap/pm/history";
import type { EditorState, Plugin, Transaction } from "@tiptap/pm/state";

// The isolated state only contains this official history plugin. Reconfiguration
// reuses the existing history field and does not run the editor's host plugins.
const historyProbe = history();

export type HistoryPosition = { plugin: Plugin; done: number; undone: number };

export function historyPosition(state: EditorState): HistoryPosition | null {
  try {
    const key = historyProbe.spec.key;
    const matches = state.plugins.filter((plugin) => plugin.spec.key === key);
    if (!key || matches.length !== 1 || !historyProbe.getState(state)) return null;
    return { plugin: matches[0], done: undoDepth(state), undone: redoDepth(state) };
  } catch {
    return null;
  }
}

export function historyDirection(state: EditorState, transaction: Transaction): "redo" | "undo" | null {
  if (!isHistoryTransaction(transaction)) return null;
  try {
    const before = historyPosition(state);
    if (!before) return null;
    const historyState = historyProbe.getState(state);
    const shadow = state.reconfigure({ plugins: [historyProbe] });
    if (
      historyProbe.getState(shadow) !== historyState ||
      undoDepth(shadow) !== before.done ||
      redoDepth(shadow) !== before.undone
    )
      return null;
    const projected = shadow.apply(transaction);
    const afterDone = undoDepth(projected);
    const afterUndone = redoDepth(projected);
    if (before.undone > 0 && afterDone === before.done + 1 && afterUndone === before.undone - 1) return "redo";
    if (before.done > 0 && afterDone === before.done - 1 && afterUndone === before.undone + 1) return "undo";
    return null;
  } catch {
    return null;
  }
}

export function isProvableRedo(state: EditorState, transaction: Transaction): boolean {
  return historyDirection(state, transaction) === "redo";
}
