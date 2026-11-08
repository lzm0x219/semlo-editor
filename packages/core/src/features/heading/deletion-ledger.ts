import { isHistoryTransaction } from "@tiptap/pm/history";
import { Transaction, type EditorState, type Plugin } from "@tiptap/pm/state";
import { AttrStep } from "@tiptap/pm/transform";

import { historyDirection, historyPosition } from "../../runtime/history-redo-probe";

type Pending = {
  plugin: Plugin;
  beforeDone: number;
  beforeUndone: number;
  root?: Transaction;
  kind: "delete" | "edit" | "unchanged" | "redo" | "undo" | "history-append";
};

export type HeadingDeletionLedger = { slots: readonly number[]; pending: Pending | null };
export const emptyHeadingDeletionLedger = (): HeadingDeletionLedger => ({ slots: [], pending: null });

function isSameHistoryRoot(root: unknown, previous: Pending | null): boolean {
  return (
    root instanceof Transaction &&
    root === previous?.root &&
    isHistoryTransaction(root) &&
    (previous.kind === "redo" || previous.kind === "undo" || previous.kind === "history-append")
  );
}

function isUnmappedNonhistoricalAttributeChange(transaction: Transaction): boolean {
  if (transaction.getMeta("rebased") || !transaction.steps.length) return false;
  const root: unknown = transaction.getMeta("appendedTransaction");
  if (root !== undefined && (!(root instanceof Transaction) || isHistoryTransaction(root))) return false;
  if (transaction.getMeta("addToHistory") !== false && root?.getMeta("addToHistory") !== false) return false;
  // 属性步骤不移动文档位置，不会替换既有撤销事件。
  return transaction.steps.every((step) => step instanceof AttrStep);
}

// This observes the next fully applied state, never the partially initialized
// newState passed to a ProseMirror plugin's state.apply callback.
export function settleHeadingDeletionLedger(ledger: HeadingDeletionLedger, state: EditorState): HeadingDeletionLedger {
  const position = historyPosition(state);
  const pending = ledger.pending;
  if (!position || (pending && position.plugin !== pending.plugin)) return emptyHeadingDeletionLedger();
  if (!pending) return ledger;
  const { beforeDone, beforeUndone, kind } = pending;
  const same = position.done === beforeDone && position.undone === beforeUndone;
  if (kind === "unchanged") return same ? { slots: ledger.slots, pending: null } : emptyHeadingDeletionLedger();
  if (kind === "history-append") return same ? { slots: ledger.slots, pending: null } : emptyHeadingDeletionLedger();
  if (kind === "redo")
    return position.done === beforeDone + 1 && position.undone === beforeUndone - 1
      ? { slots: ledger.slots, pending: null }
      : emptyHeadingDeletionLedger();
  if (kind === "undo")
    return position.done === beforeDone - 1 && position.undone === beforeUndone + 1
      ? { slots: ledger.slots, pending: null }
      : emptyHeadingDeletionLedger();
  const newEvent = position.done === beforeDone + 1 && position.undone === 0;
  const groupedEdit = kind === "edit" && position.done === beforeDone && position.undone === 0;
  if (!newEvent && !groupedEdit) return emptyHeadingDeletionLedger();
  // A fresh edit discards the redo branch. Existing events within the current
  // branch retain their positions even if the edit joins the latest event.
  const slots = ledger.slots.filter((slot) => slot <= beforeDone);
  if (kind === "delete") slots.push(position.done);
  return { slots, pending: null };
}

export function advanceHeadingDeletionLedger(
  ledger: HeadingDeletionLedger,
  state: EditorState,
  transaction: Transaction,
  ownDeletion: boolean,
): HeadingDeletionLedger {
  if (!ledger.slots.length && !ledger.pending && !ownDeletion) return ledger;
  const settled = settleHeadingDeletionLedger(ledger, state);
  const position = historyPosition(state);
  if (!position) return emptyHeadingDeletionLedger();
  let kind: Pending["kind"];
  if (isHistoryTransaction(transaction)) {
    const direction = historyDirection(state, transaction);
    // An unrecognized history transition must never preserve provenance.
    if (!direction) return emptyHeadingDeletionLedger();
    kind = direction;
  } else if (transaction.docChanged) {
    if (isUnmappedNonhistoricalAttributeChange(transaction))
      return {
        slots: settled.slots,
        pending: {
          plugin: position.plugin,
          beforeDone: position.done,
          beforeUndone: position.undone,
          kind: "unchanged",
        },
      };
    if (transaction.getMeta("addToHistory") === false) return emptyHeadingDeletionLedger();
    // In the locked ProseMirror version, an appended transaction inherits the
    // root transaction's addToHistory=false even when its own metadata is
    // unset. Treat malformed or nonhistorical roots as untrusted provenance.
    const root: unknown = transaction.getMeta("appendedTransaction");
    if (root !== undefined) {
      if (!root || typeof root !== "object" || !("getMeta" in root) || typeof root.getMeta !== "function")
        return emptyHeadingDeletionLedger();
      try {
        if (root.getMeta("addToHistory") === false) return emptyHeadingDeletionLedger();
      } catch {
        return emptyHeadingDeletionLedger();
      }
    }
    kind = isSameHistoryRoot(root, ledger.pending) ? "history-append" : ownDeletion ? "delete" : "edit";
  } else {
    const root: unknown = transaction.getMeta("appendedTransaction");
    kind = isSameHistoryRoot(root, ledger.pending) ? "history-append" : "unchanged";
  }
  return {
    slots: settled.slots,
    pending: {
      plugin: position.plugin,
      beforeDone: position.done,
      beforeUndone: position.undone,
      root:
        kind === "redo" || kind === "undo" || kind === "history-append"
          ? (transaction.getMeta("appendedTransaction") ?? transaction)
          : undefined,
      kind,
    },
  };
}
