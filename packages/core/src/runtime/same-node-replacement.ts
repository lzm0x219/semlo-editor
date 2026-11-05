import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

// A node may be removed and reinserted by reference. Identity alone cannot
// distinguish that replacement from an untouched node.
export function replacesSameNode(transaction: Transaction, position: number, node: ProseMirrorNode): boolean {
  let currentPosition = position;
  let removed = false;
  for (const map of transaction.mapping.maps) {
    map.forEach((oldStart, oldEnd) => {
      if (oldStart <= currentPosition && oldEnd >= currentPosition + node.nodeSize) removed = true;
    });
    currentPosition = map.map(currentPosition, -1);
  }
  return removed && transaction.doc.nodeAt(currentPosition) === node;
}

/** Locate a still-shared node backwards through committed appended transactions. */
export function appendedReplacesSameNode(
  transactions: readonly Transaction[],
  finalPosition: number,
  node: ProseMirrorNode,
): boolean {
  let position = finalPosition;
  for (let index = transactions.length - 1; index >= 0; index--) {
    const transaction = transactions[index];
    const before = transaction.mapping.invert().map(position, -1);
    if (transaction.before.nodeAt(before) === node && replacesSameNode(transaction, before, node)) return true;
    position = before;
  }
  return false;
}
