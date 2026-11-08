import "../../../demo/editor.css";
import { Extension, type JSONContent } from "@tiptap/core";
import { closeHistory, isHistoryTransaction, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, type Transaction } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/editor/create-editor";
import type { EditorController } from "../../../packages/core/src/types";

type RecordEntry = {
  phase: string;
  key?: string;
  inputType?: string;
  time: number;
  html: string;
  json: JSONContent;
  selection: { anchor: number; head: number; empty: boolean; text: string };
  dom: { text: string; collapsed: boolean };
  focused: boolean;
  undoDepth: number;
  redoDepth: number;
  docChanged?: boolean;
  isHistory?: boolean;
  rejected?: boolean;
  prevented?: boolean;
  ledger?: { slots: readonly number[]; pending: string | null };
};
type HistoryFixture = {
  editor: EditorController;
  records: RecordEntry[];
  rejectNextHistory(): void;
  fillHistory(count: number): void;
  historyDepth(): number;
  hostDelete(preventClear?: boolean): void;
  hostDeleteRange(): void;
  hostRestoreHeading(): void;
  hostNoHistoryRoot(): void;
};
type HostOptions = {
  rejectHeading?: boolean;
  append?: "metadata" | "history" | "nohistory" | "nohistory-attr" | "paragraph" | "number";
  dispatch?: "metadata" | "nohistory";
  replaceHistoryInAppend?: boolean;
  rootNoHistoryAppend?: boolean | "attribute";
  normalizeNoHistory?: boolean;
  appendOnRedo?: boolean;
  appendSelectionThenDocument?: boolean;
  priority?: number;
};

declare global {
  interface Window {
    quickHistoryFixture?: HistoryFixture;
    mountQuickHistoryFixture?(content: string, options: HostOptions): void;
  }
}

window.mountQuickHistoryFixture = (content, options) => {
  document.body.replaceChildren();
  const host = document.createElement("div");
  document.body.append(host);
  const records: RecordEntry[] = [];
  let controller: EditorController | undefined;
  let rejectHistory = false;
  const headingIn = (doc: ProseMirrorNode) => {
    const root = doc.firstChild;
    if (doc.childCount !== 1 || !root) return null;
    if (root.type.name === "heading") return { node: root, pos: 0 };
    if (root.type.name === "blockquote" && root.childCount === 1 && root.firstChild?.type.name === "heading")
      return { node: root.firstChild, pos: 1 };
    return null;
  };
  const record = (phase: string, extra: Partial<RecordEntry> = {}) => {
    if (!controller) return;
    const editor = controller.editor;
    const selection = editor.state.selection;
    const dom = window.getSelection();
    const headingHistory = editor.state.plugins
      .map((plugin) => plugin.getState(editor.state))
      .find(
        (value): value is { recent: unknown; ledger: { slots: readonly number[]; pending: { kind: string } | null } } =>
          !!value && typeof value === "object" && "recent" in value && "ledger" in value,
      );
    records.push({
      phase,
      time: performance.now(),
      html: editor.getHTML(),
      json: editor.getJSON(),
      selection: {
        anchor: selection.anchor,
        head: selection.head,
        empty: selection.empty,
        text: editor.state.doc.textBetween(selection.from, selection.to, "|"),
      },
      dom: { text: dom?.toString() ?? "", collapsed: dom?.isCollapsed ?? true },
      focused: editor.view.hasFocus(),
      undoDepth: undoDepth(editor.state),
      redoDepth: redoDepth(editor.state),
      ledger: headingHistory
        ? { slots: headingHistory.ledger.slots, pending: headingHistory.ledger.pending?.kind ?? null }
        : undefined,
      ...extra,
    });
  };
  const observer = Extension.create({
    name: "quickHistoryHostProbe",
    priority: options.priority ?? 2000,
    addProseMirrorPlugins() {
      let replaced = false;
      let selectionAppended = false;
      const selectionStage = new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!options.appendSelectionThenDocument || selectionAppended || !transactions.some(isHistoryTransaction))
            return null;
          const heading = headingIn(newState.doc);
          if (!heading?.node.textContent) return null;
          selectionAppended = true;
          return newState.tr.setSelection(newState.selection).setMeta("quickHistorySelectionStage", true);
        },
      });
      const documentStage = new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.getMeta("quickHistorySelectionStage"))) return null;
          const heading = headingIn(newState.doc);
          if (!heading) return null;
          return newState.tr.setNodeMarkup(heading.pos, undefined, { ...heading.node.attrs, textAlign: "center" });
        },
      });
      const hostUndo = new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!options.replaceHistoryInAppend || replaced) return null;
          const ownDeletion = transactions.some(
            (tr) => tr.docChanged && tr.getMeta("preventClearDocument") && !isHistoryTransaction(tr),
          );
          if (!ownDeletion) return null;
          replaced = true;
          let transaction: Transaction | undefined;
          undo(newState, (tr) => {
            transaction = tr;
          });
          return transaction?.setMeta("quickHistoryHostUndo", true) ?? null;
        },
      });
      const hostReplace = new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.getMeta("quickHistoryHostUndo"))) return null;
          return closeHistory(newState.tr)
            .deleteSelection()
            .setMeta("preventClearDocument", true)
            .setMeta("quickHistoryHostReplacement", true);
        },
      });
      return [
        new Plugin({
          filterTransaction(tr, state) {
            if (
              options.normalizeNoHistory &&
              tr.docChanged &&
              headingIn(tr.before)?.node.content.size === 0 &&
              tr.doc.firstChild?.type.name === "paragraph" &&
              tr.getMeta("appendedTransaction")
            )
              tr.setMeta("addToHistory", false);
            const rejected =
              (options.rejectHeading &&
                tr.docChanged &&
                state.doc.firstChild?.type.name === "paragraph" &&
                tr.doc.firstChild?.type.name === "heading") ||
              (rejectHistory && tr.docChanged && isHistoryTransaction(tr));
            if (rejected && isHistoryTransaction(tr)) rejectHistory = false;
            if (tr.docChanged)
              record("filter", {
                docChanged: true,
                rejected,
                isHistory: isHistoryTransaction(tr),
                prevented: !!tr.getMeta("preventClearDocument"),
              });
            return !rejected;
          },
          appendTransaction(transactions, oldState, newState) {
            if (options.rootNoHistoryAppend && transactions.some((tr) => tr.getMeta("quickNoHistoryRoot"))) {
              const heading = headingIn(newState.doc);
              if (!heading) return null;
              if (options.rootNoHistoryAppend === "attribute")
                return newState.tr.setNodeAttribute(heading.pos, "textAlign", "center");
              return newState.tr.setNodeMarkup(heading.pos, undefined, { ...heading.node.attrs, textAlign: "center" });
            }
            if ((!options.append && !options.appendOnRedo) || !transactions.some((tr) => tr.docChanged)) return null;
            const before = headingIn(oldState.doc);
            const after = headingIn(newState.doc);
            if (!before?.node.textContent || !after || after.node.content.size !== 0) return null;
            if (
              options.appendOnRedo &&
              transactions.some(isHistoryTransaction) &&
              after.node.attrs.textAlign !== "center"
            )
              return newState.tr.setNodeMarkup(after.pos, undefined, { ...after.node.attrs, textAlign: "center" });
            if (options.append === "metadata") return newState.tr.setMeta("quickHistoryHost", true);
            if (options.append === "paragraph") {
              const paragraph = newState.schema.nodes.paragraph;
              return paragraph
                ? newState.tr.setNodeMarkup(after.pos, paragraph).setMeta("quickHistoryHost", true)
                : null;
            }
            if (options.append === "number") {
              if (after.node.attrs.level === 4 && after.node.attrs.semloEditorHeadingNumbering === "mixed") return null;
              return newState.tr
                .setNodeMarkup(after.pos, undefined, {
                  ...after.node.attrs,
                  level: 4,
                  semloEditorHeadingNumbering: "mixed",
                })
                .setMeta("quickHistoryHost", true);
            }
            if (after.node.attrs.textAlign === "center") return null;
            const tr =
              options.append === "nohistory-attr"
                ? newState.tr.setNodeAttribute(after.pos, "textAlign", "center")
                : newState.tr.setNodeMarkup(after.pos, undefined, { ...after.node.attrs, textAlign: "center" });
            if (options.append === "nohistory" || options.append === "nohistory-attr")
              tr.setMeta("addToHistory", false);
            return tr.setMeta("quickHistoryHost", true);
          },
        }),
        selectionStage,
        documentStage,
        hostUndo,
        hostReplace,
      ];
    },
  });
  controller = createEditor({
    element: host,
    outline: false,
    toolbar: false,
    content,
    extensions: [observer],
    onChange: () => record("change"),
  });
  controller.editor.on("transaction", ({ transaction }) => {
    record("transaction", {
      docChanged: transaction.docChanged,
      isHistory: isHistoryTransaction(transaction),
    });
    if (!controller || !options.dispatch || !transaction.docChanged || transaction.getMeta("quickHistoryDirect"))
      return;
    const before = headingIn(transaction.before);
    const after = headingIn(controller.editor.state.doc);
    if (!before?.node.textContent || !after || after.node.content.size !== 0) return;
    let tr = controller.editor.state.tr.setMeta("quickHistoryDirect", true).setMeta("addToHistory", false);
    if (options.dispatch === "nohistory" && after.node.attrs.textAlign !== "center")
      tr = tr.setNodeMarkup(after.pos, undefined, { ...after.node.attrs, textAlign: "center" });
    controller.editor.view.dispatch(tr);
  });
  const view = controller.editor.view.dom;
  view.addEventListener("keydown", (event) => record("keydown", { key: event.key }), true);
  view.addEventListener("keyup", (event) => record("keyup", { key: event.key }), true);
  view.addEventListener("beforeinput", (event) => record("beforeinput", { inputType: event.inputType }), true);
  window.quickHistoryFixture = {
    editor: controller,
    records,
    rejectNextHistory: () => {
      rejectHistory = true;
    },
    fillHistory: (count) => {
      const editor = window.__semloRequireFixture("quickHistoryFixture").editor.editor;
      for (let i = 0; i < count; i += 1) {
        const tr = closeHistory(editor.state.tr);
        if (i % 2 === 0) tr.insertText("x", 1);
        else tr.delete(1, 2);
        editor.view.dispatch(tr);
      }
    },
    historyDepth: () => undoDepth(window.__semloRequireFixture("quickHistoryFixture").editor.editor.state),
    hostDelete: (preventClear = true) => {
      const editor = window.__semloRequireFixture("quickHistoryFixture").editor.editor;
      const tr = closeHistory(editor.state.tr).deleteSelection();
      if (preventClear) tr.setMeta("preventClearDocument", true);
      editor.view.dispatch(tr);
    },
    hostDeleteRange: () => {
      const editor = window.__semloRequireFixture("quickHistoryFixture").editor.editor;
      const start = editor.state.selection.$from.start();
      const size = editor.state.selection.$from.parent.content.size;
      editor.view.dispatch(closeHistory(editor.state.tr).delete(start, start + size));
      editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    },
    hostRestoreHeading: () => {
      const editor = window.__semloRequireFixture("quickHistoryFixture").editor.editor;
      editor.view.dispatch(
        editor.state.tr
          .setNodeMarkup(0, editor.state.schema.nodes.heading, { level: 3 })
          .setMeta("addToHistory", false),
      );
    },
    hostNoHistoryRoot: () => {
      const editor = window.__semloRequireFixture("quickHistoryFixture").editor.editor;
      editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false).setMeta("quickNoHistoryRoot", true));
    },
  };
  record("mounted");
};
