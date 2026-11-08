import { createEditor, type EditorContent, type EditorControllerWithResults } from "@semlo-editor/core";
import { CellSelection, TableMap } from "@tiptap/pm/tables";

import "@semlo-editor/core/style.css";

export type SequenceVariant = "native" | "marked" | "unmarked" | "other-column" | "partial" | "invalid" | "rowspan";
type Instance = { controller: EditorControllerWithResults; host: HTMLElement; errors: string[] };
const instances = new Map<string, Instance>();
const required = (id: string) => {
  const instance = instances.get(id);
  if (!instance) throw new Error(`缺少跨列序号夹具：${id}`);
  return instance;
};
const marker = (value: number | null) => (value === null ? "" : ` data-semlo-editor-sequence="${value}"`);

function content(variant: SequenceVariant) {
  const prefix = "<p>原有前文</p><table><tbody>";
  const suffix = "</tbody></table><p>原有后文</p>";
  if (variant === "native") {
    return (
      prefix +
      '<tr><td colspan="2"><p>跨列标题</p></td><td><p>第三列表头</p></td></tr>' +
      "<tr><td>左一</td><td>中一</td><td>右一</td></tr><tr><td>左二</td><td>中二</td><td>右二</td></tr>" +
      suffix
    );
  }
  const start = variant === "invalid" ? 99 : variant === "unmarked" || variant === "other-column" ? null : 2;
  if (variant === "rowspan") {
    return (
      prefix +
      `<tr><td colspan="2" rowspan="2"${marker(start)}><p>跨列标题</p><p>第三列表头</p></td><td>表头甲</td><td>表头乙</td></tr>` +
      "<tr><td>跨行旁甲</td><td>跨行旁乙</td></tr>" +
      `<tr><td${marker(start)}>1</td><td>左一</td><td>中一</td><td>右一</td></tr>` +
      `<tr><td${marker(start)}>2</td><td>左二</td><td>中二</td><td>右二</td></tr>` +
      suffix
    );
  }
  const other = variant === "other-column" ? marker(2) : "";
  return (
    prefix +
    `<tr><td colspan="4"${marker(start)}><p>跨列标题</p><p>第三列表头</p></td></tr>` +
    `<tr><td${marker(start)}>1</td><td${other}>左一</td><td>中一</td><td>右一</td></tr>` +
    `<tr><td${marker(variant === "partial" ? null : start)}>2</td><td${other}>左二</td><td>中二</td><td>右二</td></tr>` +
    suffix
  );
}

async function settle() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
function tableInfo(id: string) {
  const { editor } = required(id).controller;
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    position = pos;
    return false;
  });
  if (position < 0) throw new Error("夹具缺少表格");
  const table = editor.state.doc.nodeAt(position);
  if (!table) throw new Error("夹具缺少表格");
  return { editor, table, position, map: TableMap.get(table) };
}

const fixture = {
  async mount(id: string, echo: "json" | "html", variant: SequenceVariant = "marked") {
    if (instances.has(id)) throw new Error(`重复跨列序号夹具：${id}`);
    const host = document.createElement("div");
    host.id = id;
    host.style.cssText = "width:860px;max-width:calc(100% - 32px);margin:24px auto";
    document.body.append(host);
    const errors: string[] = [];
    let controller: EditorControllerWithResults;
    controller = createEditor({
      element: host,
      outline: false,
      content: content(variant),
      onChange: (snapshot) => controller.setContent(snapshot[echo]),
      onError: (error) => errors.push(error.message),
    });
    instances.set(id, { controller, host, errors });
    await settle();
  },
  snapshot: (id: string) => required(id).controller.getSnapshot(),
  errors: (id: string) => required(id).errors,
  selectHeader(id: string) {
    const { editor, position, map } = tableInfo(id);
    const start = position + 1;
    editor.view.dispatch(
      editor.state.tr
        .setSelection(CellSelection.create(editor.state.doc, start + map.map[0], start + map.map[map.width - 1]))
        .setMeta("addToHistory", false),
    );
  },
  async selectNumber(id: string, physicalRow: number) {
    const { editor, table, position, map } = tableInfo(id);
    const offset = map.map[physicalRow * map.width];
    const cell = table.nodeAt(offset);
    if (!cell) throw new Error("缺少序号格");
    const from = position + 1 + offset + 2;
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to: position + 1 + offset + cell.nodeSize - 2 })
      .run();
    await settle();
  },
  async history(id: string, action: "undo" | "redo") {
    const result = required(id).controller.editor.commands[action]();
    await settle();
    return result;
  },
  async replace(id: string, value: EditorContent) {
    required(id).controller.setContent(value);
    await settle();
  },
  dispose() {
    for (const instance of instances.values()) {
      instance.controller.destroy();
      instance.host.remove();
    }
    instances.clear();
  },
};
declare global {
  interface Window {
    colspanSequenceFixture?: typeof fixture;
  }
}
window.colspanSequenceFixture = fixture;
