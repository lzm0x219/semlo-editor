import { createEditor, type EditorContent, type EditorController } from "@semlo-editor/core";
import { Extension, Mark } from "@tiptap/core";
import { undoDepth, redoDepth } from "@tiptap/pm/history";
import { Plugin } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

import "@semlo-editor/core/style.css";

const sample =
  '<h3><strong>标题样本</strong></h3><p><strong>正文加粗</strong>与<a href="https://example.com/">示例链接</a>后文</p>';
const instances = new Map<string, EditorController>();
type Echo = false | "json" | "html";
const controls = new Map<
  string,
  { echo: Echo; reject: boolean; rejected: number; changes: ReturnType<EditorController["getSnapshot"]>[] }
>();
const semantic = Mark.create({
  name: "domainToken",
  addAttributes: () => ({
    token: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("data-domain-token") },
  }),
  parseHTML: () => [{ tag: "span[data-domain-token]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", { "data-domain-token": HTMLAttributes.token }, 0],
});
const current = (id: string) => {
  const result = instances.get(id);
  if (!result) throw new Error(`实例不存在 ${id}`);
  return result;
};
function snapshot(id: string) {
  const controller = current(id);
  const editor = controller.editor;
  return {
    ...controller.getSnapshot(),
    selection: editor.state.selection.toJSON(),
    selected: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "\n"),
    storedMarks: editor.state.storedMarks?.map((mark) => ({ type: mark.type.name, attrs: mark.attrs })) ?? null,
    undo: undoDepth(editor.state),
    redo: redoDepth(editor.state),
    changes: controls.get(id)!.changes,
    rejected: controls.get(id)!.rejected,
  };
}
declare global {
  interface Window {
    clearFormatFixture: {
      mount(id: string, content?: EditorContent, echo?: Echo): void;
      snapshot: typeof snapshot;
      select(id: string, from: number, to?: number): void;
      selectText(id: string, text: string, from?: number, to?: number): void;
      selectColumn(id: string, column: number): void;
      reject(id: string, value: boolean): void;
      editable(id: string, value: boolean): void;
      undo(id: string): boolean;
      redo(id: string): boolean;
      destroy(id: string): void;
      destroyAll(): void;
    };
  }
}
document.body.style.cssText = "margin:0;padding:16px";
window.clearFormatFixture = {
  mount(id, content = sample, echo = false) {
    if (instances.has(id)) window.clearFormatFixture.destroy(id);
    const element = document.createElement("div");
    element.id = `clear-format-${id}`;
    element.style.cssText = "width:1100px;max-width:100%;margin-bottom:24px";
    document.body.append(element);
    const control = { echo, reject: false, rejected: 0, changes: [] as ReturnType<EditorController["getSnapshot"]>[] };
    controls.set(id, control);
    const guard = Extension.create({
      name: "clearFormatHostGuard",
      addProseMirrorPlugins: () => [
        new Plugin({
          filterTransaction(tr) {
            if (control.reject && tr.docChanged) {
              control.rejected++;
              return false;
            }
            return true;
          },
        }),
      ],
    });
    instances.set(
      id,
      createEditor({
        element,
        content,
        outline: false,
        extensions: [semantic, guard],
        onChange(value) {
          control.changes.push(value);
          if (control.echo) instances.get(id)?.setContent(control.echo === "json" ? value.json : value.html);
        },
      }),
    );
  },
  snapshot,
  select(id, from, to = from) {
    const editor = current(id).editor;
    editor.view.focus();
    editor.commands.setTextSelection({ from, to });
  },
  selectText(id, text, from = 0, to = text.length) {
    let position = -1;
    current(id).editor.state.doc.descendants((node, pos) => {
      if (position < 0 && node.isText && node.text?.includes(text)) position = pos + node.text.indexOf(text);
    });
    if (position < 0) throw new Error(`找不到文字 ${text}`);
    window.clearFormatFixture.select(id, position + from, position + to);
  },
  selectColumn(id, column) {
    const editor = current(id).editor;
    const rows: number[][] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "table" || rows.length) return true;
      node.forEach((row, rowOffset) => {
        const cells: number[] = [];
        row.forEach((_cell, cellOffset) => cells.push(pos + 2 + rowOffset + cellOffset));
        rows.push(cells);
      });
      return false;
    });
    const first = rows[0]?.[column],
      last = rows.at(-1)?.[column];
    if (first === undefined || last === undefined) throw new Error("不存在该列");
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(new CellSelection(editor.state.doc.resolve(first), editor.state.doc.resolve(last))),
    );
  },
  reject: (id, value) => {
    controls.get(id)!.reject = value;
  },
  editable: (id, value) => current(id).setEditable(value),
  undo: (id) => current(id).editor.commands.undo(),
  redo: (id) => current(id).editor.commands.redo(),
  destroy(id) {
    current(id).destroy();
    instances.delete(id);
    controls.delete(id);
    document.getElementById(`clear-format-${id}`)?.remove();
  },
  destroyAll() {
    for (const id of instances.keys()) window.clearFormatFixture.destroy(id);
  },
};
