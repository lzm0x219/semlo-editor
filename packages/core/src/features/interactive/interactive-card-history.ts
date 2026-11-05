import { isHistoryTransaction } from "@tiptap/pm/history";
import type { Node } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/** Only a local history operation on the same unique activity warrants a host sync. */
export function restoresInteractiveActivity(transaction: Transaction, current: Node, previous: Node): boolean {
  if (!transaction.docChanged || !isHistoryTransaction(transaction)) return false;
  const id = typeof current.attrs.cardId === "string" ? current.attrs.cardId.trim() : "";
  if (!id) return false;
  const matching = (doc: Node) => {
    const nodes: Node[] = [];
    doc.descendants((node) => {
      if (node.type === current.type && typeof node.attrs.cardId === "string" && node.attrs.cardId.trim() === id)
        nodes.push(node);
    });
    return nodes;
  };
  const before = matching(transaction.before);
  const after = matching(transaction.doc);
  return (
    before.length === 1 &&
    after.length === 1 &&
    after[0].eq(current) &&
    before[0].eq(previous) &&
    JSON.stringify(before[0].attrs) !== JSON.stringify(after[0].attrs)
  );
}
