import type { Editor, Range } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import type { BlockInsertTarget } from "../blocks/actions/target";
import { isHeadingFolded, setHeadingFolded } from "../heading/fold";
import {
  InteractiveCardHostController,
  type InteractiveCardConfig,
  type InteractiveCardHost,
} from "./interactive-card-host";

export function defaultCheckinConfig(): InteractiveCardConfig & { kind: "checkin" } {
  return { kind: "checkin", title: "阅读后请点击打卡", buttonLabel: "我已读", deadline: null };
}
export function defaultVoteConfig(): InteractiveCardConfig & { kind: "vote" } {
  return {
    kind: "vote",
    title: "",
    options: [
      { id: "option-1", label: "" },
      { id: "option-2", label: "" },
    ],
    multiple: false,
    deadline: null,
  };
}

export type InteractiveInsertReason = "cancelled" | "target-changed" | "host-changed" | "insert-failed" | "id-conflict";
export type InteractiveInsertResult =
  | { status: "inserted"; cardId: string }
  | { status: "cancelled"; reason: InteractiveInsertReason }
  | { status: "failed"; error: unknown };
export type InteractiveInsertTarget =
  | { kind: "selection" }
  | { kind: "slash"; range: Range }
  | { kind: "below"; target: Pick<BlockInsertTarget, "pos" | "after" | "node" | "kind"> };

export interface InteractiveInsertOptions {
  editor: Editor;
  host: InteractiveCardHostController;
  config: InteractiveCardConfig;
  signal?: AbortSignal;
  copiedFrom?: string | null;
  target?: InteractiveInsertTarget;
  /**
   * Called once for an ID returned after cancellation or an unsuccessful insertion, possibly after the result resolves.
   * The host must verify ownership and references before cleanup; the editor cannot detect every external reference.
   */
  onAbandoned: (activity: {
    cardId: string;
    config: InteractiveCardConfig;
    reason: InteractiveInsertReason;
    originHost: InteractiveCardHost | null;
  }) => void;
}

/** Creates first; only the original, unchanged selection may receive the new node. */
export async function insertInteractiveCard({
  editor,
  host,
  config,
  signal,
  copiedFrom = null,
  target = { kind: "selection" },
  onAbandoned,
}: InteractiveInsertOptions): Promise<InteractiveInsertResult> {
  if (signal?.aborted) return { status: "cancelled", reason: "cancelled" };
  if (editor.isDestroyed || !editor.isEditable) return { status: "cancelled", reason: "target-changed" };
  const snapshot = structuredClone(config);
  const originHost = host.getHost();
  const selection = editor.state.selection;
  const originalDoc = editor.state.doc;
  let lastDoc = originalDoc;
  const insertionTarget: InteractiveInsertTarget =
    target.kind === "slash"
      ? { kind: "slash", range: { ...target.range } }
      : target.kind === "below"
        ? { kind: "below", target: { ...target.target } }
        : { kind: "selection" };
  const validTarget = () => {
    if (insertionTarget.kind === "selection") return true;
    if (insertionTarget.kind === "slash") {
      const { from, to } = insertionTarget.range;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to || to > originalDoc.content.size)
        return false;
      const start = originalDoc.resolve(from),
        end = originalDoc.resolve(to);
      return start.sameParent(end) && start.parent.isTextblock && originalDoc.textBetween(from, to).startsWith("/");
    }
    const { pos, after, node } = insertionTarget.target;
    return (
      Number.isInteger(pos) &&
      pos >= 0 &&
      pos < originalDoc.content.size &&
      originalDoc.nodeAt(pos) === node &&
      after === pos + node.nodeSize
    );
  };
  if (!validTarget()) return { status: "cancelled", reason: "target-changed" };
  const viewDom = editor.view.dom;
  const active = new AbortController();
  let reason: InteractiveInsertReason | undefined;
  let resolveCancelled!: (value: InteractiveInsertResult) => void;
  const cancelled = new Promise<InteractiveInsertResult>((resolve) => {
    resolveCancelled = resolve;
  });
  const cancel = (why: InteractiveInsertReason) => {
    if (reason) return;
    reason = why;
    active.abort();
    resolveCancelled({ status: "cancelled", reason: why });
  };
  const transaction = ({ transaction }: { transaction: Transaction }) => {
    lastDoc = editor.state.doc;
    if (transaction.docChanged || (insertionTarget.kind !== "below" && !editor.state.selection.eq(selection)))
      cancel("target-changed");
  };
  const update = () => {
    if (editor.isDestroyed || !editor.isEditable) cancel("target-changed");
  };
  const destroyed = () => cancel("target-changed");
  const aborted = () => cancel("cancelled");
  editor.on("transaction", transaction);
  editor.on("update", update);
  editor.on("destroy", destroyed);
  viewDom.addEventListener("semlo-editor:editable", update);
  signal?.addEventListener("abort", aborted, { once: true });
  const unsubscribe = host.subscribe((cardId) => {
    if (cardId === null) cancel("host-changed");
  });
  const dispose = () => {
    editor.off("transaction", transaction);
    editor.off("update", update);
    editor.off("destroy", destroyed);
    viewDom.removeEventListener("semlo-editor:editable", update);
    signal?.removeEventListener("abort", aborted);
    unsubscribe();
  };
  const containsActivity = (doc: typeof originalDoc, cardId: string) => {
    let exists = false;
    doc.descendants((node) => {
      if (
        (node.type.name === "semloEditorVote" || node.type.name === "semloEditorCheckin") &&
        typeof node.attrs.cardId === "string" &&
        node.attrs.cardId.trim() === cardId
      )
        exists = true;
    });
    return exists;
  };
  const report = (cardId: string, why: InteractiveInsertReason) =>
    onAbandoned({
      cardId,
      config: structuredClone(snapshot),
      reason:
        containsActivity(originalDoc, cardId) ||
        containsActivity(lastDoc, cardId) ||
        (!editor.isDestroyed && containsActivity(editor.state.doc, cardId))
          ? "id-conflict"
          : why,
      originHost,
    });
  const creation = host
    .create(snapshot, active.signal, copiedFrom, (cardId) => report(cardId, reason ?? "host-changed"))
    .then(
      (cardId): InteractiveInsertResult => {
        if (
          reason ||
          active.signal.aborted ||
          editor.isDestroyed ||
          !editor.isEditable ||
          editor.state.doc !== originalDoc ||
          (insertionTarget.kind !== "below" && !editor.state.selection.eq(selection)) ||
          !validTarget()
        ) {
          report(cardId, reason ?? "target-changed");
          return { status: "cancelled", reason: reason ?? "target-changed" };
        }
        if (containsActivity(editor.state.doc, cardId)) {
          report(cardId, "id-conflict");
          return { status: "failed", error: new Error("活动 ID 已存在于文档") };
        }
        dispose();
        const type = snapshot.kind === "vote" ? "semloEditorVote" : "semloEditorCheckin";
        const { kind: _kind, ...attrs } = snapshot;
        const hasInsertedCard = () => {
          let found = false;
          editor.state.doc.descendants((node) => {
            if (node.type.name === type && node.attrs.cardId === cardId) found = true;
          });
          return found;
        };
        try {
          let inserted: boolean;
          if (insertionTarget.kind === "below") {
            const target = insertionTarget.target;
            const nodeType = editor.schema.nodes[type];
            if (!nodeType) throw new Error("未注册互动卡片");
            const card = nodeType.create({ ...attrs, cardId });
            const $pos = editor.state.doc.resolve(target.pos);
            const index = $pos.index() + 1;
            const parent = $pos.parent;
            const item = target.kind === "item";
            const insertType = item ? target.node.type : nodeType;
            if (!parent.canReplaceWith(index, index, insertType)) throw new Error("目标位置不支持互动卡片");
            let insertNode = card;
            if (item) {
              const paragraph = editor.schema.nodes.paragraph?.createAndFill();
              const children = paragraph && Fragment.fromArray([paragraph, card]);
              if (!children || !insertType.validContent(children)) throw new Error("列表项不支持互动卡片");
              insertNode = insertType.create(
                { ...target.node.attrs, ...(target.node.type.name === "taskItem" ? { checked: false } : {}) },
                children,
              );
            }
            editor.view.dispatch(closeHistory(editor.state.tr.insert(target.after, insertNode)));
            inserted = true;
          } else {
            const range =
              insertionTarget.kind === "slash" ? insertionTarget.range : { from: selection.from, to: selection.to };
            inserted = editor.commands.insertContentAt(range, { type, attrs: { ...attrs, cardId } });
          }
          if (!inserted || !hasInsertedCard()) throw new Error("无法在目标位置插入互动卡片");
          if (
            insertionTarget.kind === "below" &&
            insertionTarget.target.node.type.name === "heading" &&
            isHeadingFolded(editor, insertionTarget.target.pos)
          )
            setHeadingFolded(editor, insertionTarget.target.pos, false);
          return { status: "inserted", cardId };
        } catch (error) {
          // Dispatch may succeed before an observer throws. Never tell the host to
          // clean up an activity that is already present in the document.
          if (hasInsertedCard()) return { status: "inserted", cardId };
          report(cardId, "insert-failed");
          return { status: "failed", error };
        }
      },
      (error): InteractiveInsertResult => (reason ? { status: "cancelled", reason } : { status: "failed", error }),
    );
  try {
    return await Promise.race([creation, cancelled]);
  } finally {
    dispose();
  }
}
