import { Node, type Editor, type Range } from "@tiptap/core";
import { type DOMOutputSpec } from "@tiptap/pm/model";

import { parseData, exportTable, toText } from "./export";
import { createDatabaseData, DatabaseContentError, databaseValueText, type DatabaseView } from "./model";
import { createDatabaseNodeView } from "./node-view";
import { readDatabaseActor, reportDatabaseError, type DatabaseOptions } from "./options";
import { validateDatabaseData } from "./validation";

export { createDatabaseData } from "./model";

/** Insert an independent table; the identifier lets its view reject stale edits. */
export function insertDatabase(editor: Editor, range?: Range, kind: DatabaseView["kind"] = "table"): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const initialState = editor.state;
  const options = editor.extensionManager.extensions.find((extension) => extension.name === "semloEditorDatabase")
    ?.options as DatabaseOptions | undefined;
  let data: ReturnType<typeof createDatabaseData>;
  try {
    data = createDatabaseData(readDatabaseActor(options));
  } catch (error) {
    if (!(error instanceof DatabaseContentError)) throw error;
    reportDatabaseError(options, error);
    return false;
  }
  const active = data.views[0];
  active.kind = kind;
  active.name =
    kind === "gallery"
      ? "画册视图"
      : kind === "kanban"
        ? "看板视图"
        : kind === "calendar"
          ? "日历视图"
          : kind === "chart"
            ? "图表视图"
            : "表格视图";
  if (kind === "kanban") active.groupFieldId = data.fields.find((field) => field.type === "singleSelect")?.id ?? "";
  if (kind === "calendar") {
    active.calendar.titleFieldId = data.fields.find((field) => field.type === "text")?.id ?? "";
    active.calendar.startFieldId = data.fields.find((field) => field.type === "date")?.id ?? "";
    active.calendar.endFieldId = active.calendar.startFieldId;
  }
  // Resolving the host identity can synchronously replace or close the editor.
  if (editor.isDestroyed || !editor.isEditable || editor.state !== initialState) return false;
  const content = { type: "semloEditorDatabase", attrs: { data } };
  const probe = editor.can().chain();
  if (range) probe.deleteRange(range);
  if (!probe.insertContent(content).run()) return false;
  // Tiptap's focus command schedules another focus in the next animation frame.
  // That delayed focus can interrupt a user who has already entered a cell.
  editor.view.focus();
  const chain = editor.chain();
  if (range) chain.deleteRange(range);
  return chain.insertContent(content).run();
}

export const Database = Node.create<DatabaseOptions>({
  name: "semloEditorDatabase",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return {
      getUploadImage: () => undefined,
      getUploadAttachment: () => undefined,
      getSearchMentions: () => undefined,
      getCurrentUser: () => undefined,
      onError: () => {},
    };
  },
  addAttributes() {
    return {
      data: {
        default: null,
        rendered: false,
        parseHTML: (element) => parseData(element.getAttribute("data-database")),
        validate: validateDatabaseData,
      },
    };
  },
  parseHTML() {
    return [{ tag: "section[data-semlo-editor-database]", priority: 100 }];
  },
  renderText({ node }) {
    return toText(validateDatabaseData(node.attrs.data));
  },
  renderHTML({ node }) {
    const data = validateDatabaseData(node.attrs.data);
    const { fields, records } = exportTable(data);
    const head: DOMOutputSpec = ["tr", ...fields.map((field): DOMOutputSpec => ["th", field.name])];
    const rows: DOMOutputSpec[] = records.map((record): DOMOutputSpec => [
      "tr",
      ...fields.map((field): DOMOutputSpec => ["td", databaseValueText(field, record.values[field.id])]),
    ]);
    return [
      "section",
      {
        "data-semlo-editor-database": "",
        "data-database": JSON.stringify(data),
        class: "semlo-editor-database-export",
      },
      ["table", ["thead", head], ["tbody", ...rows]],
    ];
  },
  addNodeView() {
    return createDatabaseNodeView(() => this.options);
  },
});
