import "../../../packages/core/src/styles/style.css";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    cardMultiEditors?: EditorController[];
    appendCalendarDocumentReplacement?: (changed?: boolean, rootEdit?: boolean, reuseNodes?: boolean) => void;
    replaceEqualCalendarNode?: (nested?: boolean) => void;
    cardNestedTransactions?: number;
    cardPopupDuringReentry?: boolean;
  }
}

window.cardMultiEditors = ["甲", "乙"].map((name) => {
  const host = document.createElement("div");
  host.dataset.editorName = name;
  host.style.width = "850px";
  document.body.append(host);
  return createEditor({
    element: host,
    outline: false,
    onChange() {
      if (Reflect.get(window, "destroyFormulaEditor") === name) {
        Reflect.set(window, "destroyFormulaEditor", null);
        window.cardMultiEditors?.[name === "甲" ? 0 : 1]?.destroy();
      }
    },
    extensions: [
      Extension.create({
        name: "card-reentry-test",
        priority: 2000,
        onTransaction({ transaction, editor }) {
          if (!transaction.getMeta("card-reentry-test")) return;
          window.cardPopupDuringReentry = !!document.querySelector('[role="dialog"][aria-label="编辑日程"]');
          window.cardNestedTransactions = (window.cardNestedTransactions ?? 0) + 1;
          editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
        },
      }),
    ],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: `${name}正文` }] },
        {
          type: "paragraph",
          content: [
            { type: "semloEditorDate", attrs: { id: "same-date", date: "2026-11-03" } },
            { type: "semloEditorStatus", attrs: { label: `${name}状态`, color: 0 } },
            { type: "semloEditorFormula", attrs: { latex: name === "甲" ? "x" : "y", id: name } },
          ],
        },
        {
          type: "semloEditorCalendar",
          attrs: {
            events: [
              { id: "same", title: `${name}日程`, start: "2026-11-05", end: "2026-11-05", description: "", color: 0 },
            ],
          },
        },
      ],
    },
  });
});

window.appendCalendarDocumentReplacement = (changed = true, rootEdit = false, reuseNodes = false) => {
  const controller = window.cardMultiEditors![0];
  const editor = controller.editor;
  const next = controller.getSnapshot().json;
  if (changed) next.content![0].content![0].text = "插件替换正文";
  const replacement = reuseNodes ? editor.state.doc : editor.schema.nodeFromJSON(next);
  const key = new PluginKey("calendar-append-replacement-test");
  editor.registerPlugin(
    new Plugin({
      key,
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some((transaction) => transaction.getMeta(key))) return null;
        return state.tr.replaceWith(0, state.doc.content.size, replacement.content);
      },
    }),
  );
  const transaction = editor.state.tr.setMeta(key, true);
  if (rootEdit) transaction.insertText("临时", 1);
  editor.view.dispatch(transaction);
  editor.unregisterPlugin(key);
};

window.replaceEqualCalendarNode = (nested = false) => {
  const editor = window.cardMultiEditors![0].editor;
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "semloEditorCalendar") position = pos;
  });
  const oldNode = editor.state.doc.nodeAt(position)!;
  const replacement = editor.schema.nodeFromJSON(oldNode.toJSON());
  const transaction = editor.state.tr.replaceWith(position, position + oldNode.nodeSize, replacement);
  if (nested) transaction.setMeta("card-reentry-test", true);
  editor.view.dispatch(transaction);
};
