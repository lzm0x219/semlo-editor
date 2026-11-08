import { createEditor, type EditorContent, type EditorController } from "@semlo-editor/core";

import "@semlo-editor/core/style.css";

const controllers = new Map<string, EditorController>();
const initial: EditorContent = {
  type: "doc",
  content: [
    {
      type: "semloEditorCanvas",
      attrs: {
        kind: "uml",
        data: {
          shapes: [
            { id: "existing-actor", shape: "actor", x: 60, y: 40, width: 120, height: 60, text: "原参与者" },
            { id: "existing-usecase", shape: "ellipse", x: 280, y: 40, width: 120, height: 60, text: "原用例" },
          ],
          edges: [],
        },
      },
    },
    { type: "paragraph", content: [{ type: "text", text: "保留正文" }] },
  ],
};

function current(id: string) {
  const controller = controllers.get(id);
  if (!controller) throw new Error(`未挂载实例 ${id}`);
  return controller;
}

declare global {
  interface Window {
    umlActorFixture: {
      mount(id: string, content?: EditorContent): void;
      snapshot(id: string): ReturnType<EditorController["getSnapshot"]>;
      undo(id: string): boolean;
      redo(id: string): boolean;
      editable(id: string, value: boolean): void;
      destroy(id: string): void;
    };
  }
}

document.body.style.cssText = "margin:0;padding:20px";
window.umlActorFixture = {
  mount(id, content = initial) {
    if (controllers.has(id)) throw new Error(`实例已挂载 ${id}`);
    const host = document.createElement("div");
    host.id = `uml-actor-${id}`;
    host.style.cssText = "width:1000px;max-width:100%;margin-bottom:20px";
    document.body.append(host);
    controllers.set(id, createEditor({ element: host, content, toolbar: false, outline: false }));
  },
  snapshot: (id) => current(id).getSnapshot(),
  undo: (id) => current(id).editor.commands.undo(),
  redo: (id) => current(id).editor.commands.redo(),
  editable: (id, value) => current(id).setEditable(value),
  destroy(id) {
    current(id).destroy();
    controllers.delete(id);
    document.getElementById(`uml-actor-${id}`)?.remove();
  },
};
