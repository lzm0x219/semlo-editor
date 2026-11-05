import "../../../packages/core/src/styles/bundle.css";
import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseRecord,
} from "../../../packages/core/src/features/database/model";
import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    databasePerformanceFixture?: {
      measure(
        rows: number,
        history?: boolean,
      ): {
        mountMs: number;
        editMs: number[];
        elements: number;
        rows: number;
        finalValue: string;
        history?: {
          undo: boolean;
          undoMs: number;
          undoValue: unknown;
          redo: boolean;
          redoMs: number;
          redoValue: unknown;
        };
      };
      mountPair(rows: number, metadata: boolean): void;
      editors: EditorController[];
      errors: string[];
    };
  }
}

function makeData(rows: number, metadata = false) {
  const data = createDatabaseData();
  if (metadata) data.fields.push(createDatabaseField("修改时间", "modifiedTime"));
  data.records = Array.from({ length: rows }, (_, index) => {
    const record = createDatabaseRecord(data.fields);
    record.id = `record-${index}`;
    record.values[data.fields[0].id] = `记录 ${index}`;
    if (metadata) {
      record.modifiedAt = "2020-01-01T00:00:00.000Z";
      record.values[data.fields[3].id] = record.modifiedAt;
    }
    return record;
  });
  return data;
}

window.databasePerformanceFixture = {
  editors: [],
  errors: [],
  mountPair(rows, metadata) {
    const fixture = window.databasePerformanceFixture!;
    const data = makeData(rows, metadata);
    fixture.editors = [0, 1].map((index) => {
      const host = document.createElement("div");
      host.id = `database-performance-${index}`;
      document.body.append(host);
      return createEditor({
        element: host,
        content: { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }] },
        toolbar: false,
        outline: false,
        onError: (error) => fixture.errors.push(error.message),
      });
    });
  },
  measure(rows, history = false) {
    const data = makeData(rows);
    const host = document.createElement("div");
    document.body.append(host);
    const started = performance.now();
    const editor = createEditor({
      element: host,
      content: { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }] },
      toolbar: false,
      outline: false,
    });
    host.getBoundingClientRect();
    const mountMs = performance.now() - started;
    const input = host.querySelector<HTMLInputElement>(".semlo-editor-database-cell input:not([type=checkbox])");
    if (!input) throw new Error("没有找到可编辑的数据表单元格");
    input.focus();
    const editMs = Array.from({ length: 8 }, (_, index) => {
      input.value = `编辑 ${index}`;
      const before = performance.now();
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      host.getBoundingClientRect();
      return performance.now() - before;
    });
    const result: ReturnType<NonNullable<Window["databasePerformanceFixture"]>["measure"]> = {
      mountMs,
      editMs,
      elements: host.querySelectorAll("*").length,
      rows: host.querySelectorAll(".semlo-editor-database-row").length,
      finalValue: input.value,
    };
    if (history) {
      input.blur();
      const undoStarted = performance.now();
      const undo = editor.editor.commands.undo();
      host.getBoundingClientRect();
      const undoMs = performance.now() - undoStarted;
      const undoValue = editor.editor.state.doc.firstChild?.attrs.data.records[0].values[data.fields[0].id];
      const redoStarted = performance.now();
      const redo = editor.editor.commands.redo();
      host.getBoundingClientRect();
      const redoMs = performance.now() - redoStarted;
      const redoValue = editor.editor.state.doc.firstChild?.attrs.data.records[0].values[data.fields[0].id];
      result.history = { undo, undoMs, undoValue, redo, redoMs, redoValue };
    }
    editor.destroy();
    host.remove();
    return result;
  },
};
