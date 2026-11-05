import "../contracts/content-safety-fixture";
import type { DatabaseData } from "../../../packages/core/src/features/database/model";
import { createEditor } from "../../../packages/core/src/index";

declare global {
  interface Window {
    databaseContentSafetyFixture?: {
      mount(data: DatabaseData): void;
      snapshot(): ReturnType<ReturnType<typeof createEditor>["getSnapshot"]>;
      errors: string[];
      uploads: number;
      undo(): boolean;
      redo(): boolean;
    };
  }
}

let controller: ReturnType<typeof createEditor>;
const fixture: NonNullable<Window["databaseContentSafetyFixture"]> = {
  errors: [],
  uploads: 0,
  mount(data) {
    const host = document.createElement("div");
    host.id = "database-content-safety";
    document.body.append(host);
    controller = createEditor({
      element: host,
      content: { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }] },
      toolbar: false,
      outline: false,
      uploadAttachment: async (file) => {
        fixture.uploads++;
        return `/files/${encodeURIComponent(file.name)}`;
      },
      searchMentions: async () => [{ kind: "person", id: "p".repeat(501), label: "超长人员" }],
      onError: (error) => fixture.errors.push(error.message),
    });
  },
  snapshot: () => controller.getSnapshot(),
  undo: () => controller.editor.commands.undo(),
  redo: () => controller.editor.commands.redo(),
};
window.databaseContentSafetyFixture = fixture;
