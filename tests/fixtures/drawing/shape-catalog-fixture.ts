import { createEditor, type EditorContent, type EditorController } from "@semlo-editor/core";

import "@semlo-editor/core/style.css";

const controllers = new Map<string, EditorController>();
const mounts = new Map<string, HTMLElement>();
const initial: EditorContent = {
  type: "doc",
  content: [
    {
      type: "semloEditorCanvas",
      attrs: {
        kind: "board",
        height: 700,
        data: {
          shapes: [{ id: "original", shape: "rectangle", x: 650, y: 30, width: 120, height: 60, text: "原图形" }],
          edges: [],
        },
      },
    },
    { type: "paragraph", content: [{ type: "text", text: "未选正文" }] },
  ],
};
const current = (id: string) => {
  const result = controllers.get(id);
  if (!result) throw new Error(`实例不存在 ${id}`);
  return result;
};
declare global {
  interface Window {
    shapeCatalogFixture: {
      mount(id: string, content?: EditorContent): void;
      snapshot(id: string): ReturnType<EditorController["getSnapshot"]>;
      setContent(id: string, content: EditorContent): void;
      undo(id: string): boolean;
      redo(id: string): boolean;
      editable(id: string, value: boolean): void;
      unmount(id: string): void;
      remount(id: string): void;
      destroy(id: string): void;
    };
  }
}
document.body.style.cssText = "margin:0;padding:16px";
window.shapeCatalogFixture = {
  mount(id, content = initial) {
    const host = document.createElement("div");
    host.id = `shape-catalog-${id}`;
    host.style.cssText = "width:1000px;max-width:100%;margin-bottom:20px";
    document.body.append(host);
    controllers.set(id, createEditor({ element: host, content, toolbar: false, outline: false }));
  },
  snapshot: (id) => current(id).getSnapshot(),
  setContent: (id, content) => current(id).setContent(content),
  undo: (id) => current(id).editor.commands.undo(),
  redo: (id) => current(id).editor.commands.redo(),
  editable: (id, value) => current(id).setEditable(value),
  unmount(id) {
    mounts.set(id, current(id).editor.view.dom.parentElement!);
    current(id).editor.unmount();
  },
  remount(id) {
    const mount = mounts.get(id);
    if (!mount) throw new Error("尚未卸载");
    current(id).editor.mount(mount);
  },
  destroy(id) {
    current(id).destroy();
    controllers.delete(id);
    mounts.delete(id);
    document.getElementById(`shape-catalog-${id}`)?.remove();
  },
};
