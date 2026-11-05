import "../../../packages/core/src/styles/style.css";
import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

const host = document.createElement("div");
document.body.append(host);
Object.assign(window, {
  closeDatePopupHistory: closeHistory,
  datePopupSyncEditor: createEditor({
    element: host,
    outline: false,
    onChange(snapshot) {
      const changes = (Reflect.get(window, "dateObservedChanges") as unknown[] | undefined) ?? [];
      changes.push(snapshot.json);
      Reflect.set(window, "dateObservedChanges", changes);
      if (Reflect.get(window, "destroyDateEditorOnChange")) {
        Reflect.set(window, "destroyDateEditorOnChange", false);
        const controller = Reflect.get(window, "datePopupSyncEditor") as EditorController | undefined;
        controller?.destroy();
      }
    },
    extensions: [
      Extension.create({
        name: "date-reentry-test",
        priority: 2000,
        onTransaction({ transaction, editor }) {
          if (!transaction.getMeta("date-reentry-test")) return;
          Reflect.set(
            window,
            "datePopupDuringReentry",
            !!document.querySelector('[role="dialog"][aria-label="选择日期"]'),
          );
          Reflect.set(window, "dateNestedTransactions", Number(Reflect.get(window, "dateNestedTransactions") ?? 0) + 1);
          editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
        },
      }),
    ],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { date: "2026-11-03", time: null } }] },
      ],
    },
  }),
});
