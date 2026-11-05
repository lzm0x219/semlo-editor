import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h } from "vue";

import {
  createEditor,
  getBoldState,
  isEditorControllerWithResults,
  toggleBold,
  type EditorController,
  type EditorControllerWithResults,
  type ToolbarFactory,
} from "../../../packages/core/dist/index.js";
import { SemloEditor as ReactEditor } from "../../../packages/react/dist/index.js";
import { SemloEditor as SolidEditor } from "../../../packages/solid/dist/index.js";
import { SemloEditor as VueEditor } from "../../../packages/vue/dist/index.js";

import "../../../packages/core/dist/style.css";

const instances = new Map<string, { controller: EditorControllerWithResults; dispose: () => void }>();
const cleanups = new Map<string, number>();
const updates = new Map<string, number>();
const unsubscribers = new Map<string, () => void>();

declare global {
  interface Window {
    customToolbarFixture: {
      mount(kind: string, id: string, mode?: "default" | "hidden"): void;
      ready(id: string): boolean;
      probeDefaultControls(custom: boolean): string[];
      probeHiddenToolbar(floating: "inherit" | "default" | "hidden" | "custom"): {
        roots: number;
        floatingRoots: number;
        labels: string[];
      };
      select(id: string): void;
      selectText(id: string): void;
      setContent(id: string, value: string): void;
      selectRange(id: string, from: number, to: number): void;
      editable(id: string, value: boolean): void;
      undo(id: string): void;
      redo(id: string): void;
      destroy(id: string): void;
      destroyUnderlying(id: string): void;
      remount(id: string): void;
      unsubscribe(id: string): void;
      cleanupCount(id: string): number;
      updateCount(id: string): number;
      failure(mode: "throw" | "destroy" | "unmount" | "cleanup"): {
        message: string;
        empty: boolean;
        destroyed: boolean;
        cleanups: number;
      };
    };
  }
}

window.customToolbarFixture = {
  probeDefaultControls(custom) {
    const original = Element.prototype.setAttribute;
    const labels: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    Element.prototype.setAttribute = function (name, value) {
      if (
        this.tagName === "BUTTON" &&
        name === "aria-label" &&
        ["段落样式", "格式刷", "高亮颜色", "查找替换"].includes(value)
      )
        labels.push(value);
      return original.call(this, name, value);
    };
    try {
      const controller = createEditor({ element: host, toolbar: custom ? () => {} : true });
      controller.destroy();
    } finally {
      Element.prototype.setAttribute = original;
      host.remove();
    }
    return labels;
  },
  probeHiddenToolbar(floating) {
    const originalCreate = document.createElement;
    const originalAttribute = Element.prototype.setAttribute;
    const created: Element[] = [];
    const labels: string[] = [];
    const host = originalCreate.call(document, "div");
    document.body.append(host);
    document.createElement = new Proxy(originalCreate, {
      apply(target, receiver, args) {
        const element: Element = Reflect.apply(target, receiver, args);
        created.push(element);
        return element;
      },
    });
    Element.prototype.setAttribute = function (name, value) {
      if (
        this.tagName === "BUTTON" &&
        name === "aria-label" &&
        ["段落样式", "格式刷", "高亮颜色", "查找替换"].includes(value)
      )
        labels.push(value);
      return originalAttribute.call(this, name, value);
    };
    try {
      const controller = createEditor({
        element: host,
        toolbar: false,
        floatingToolbar: floating === "inherit" ? undefined : floating === "custom" ? () => {} : floating === "default",
      });
      controller.destroy();
      return {
        roots: created.filter((element) => element.classList.contains("semlo-editor-toolbar")).length,
        floatingRoots: created.filter((element) => element.classList.contains("semlo-editor-bubble")).length,
        labels,
      };
    } finally {
      document.createElement = originalCreate;
      Element.prototype.setAttribute = originalAttribute;
      host.remove();
    }
  },
  mount(kind, id, mode) {
    const host = document.createElement("div");
    host.id = `custom-host-${id}`;
    document.body.append(host);
    let controller: EditorControllerWithResults | undefined;
    const toolbar: ToolbarFactory = ({ element, controller: current, syncSelection, subscribe }) => {
      controller = current;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `加粗 ${id}`;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        syncSelection();
        toggleBold(current.editor);
      });
      element.append(button);
      const update = () => {
        updates.set(id, (updates.get(id) ?? 0) + 1);
        const bold = getBoldState(current.editor);
        button.disabled = !bold.enabled;
        button.setAttribute("aria-pressed", String(bold.active));
      };
      unsubscribers.set(id, subscribe(update));
      update();
      return () => {
        cleanups.set(id, (cleanups.get(id) ?? 0) + 1);
      };
    };
    const props = {
      content: "<p>hello world</p>",
      toolbar: mode === "default" ? true : mode === "hidden" ? false : toolbar,
      onReady(current: EditorController) {
        if (!isEditorControllerWithResults(current)) throw new Error("控制器未提供内容替换结果");
        controller = current;
      },
    };
    let dispose: () => void;
    if (kind === "core") {
      controller = createEditor({
        element: host,
        ...props,
      });
      dispose = () => controller?.destroy();
    } else if (kind === "react") {
      const root = createRoot(host);
      root.render(createElement(ReactEditor, props));
      dispose = () => root.unmount();
    } else if (kind === "vue") {
      const app = createApp({ render: () => h(VueEditor, props) });
      app.mount(host);
      dispose = () => app.unmount();
    } else if (kind === "solid") {
      dispose = render(() => createComponent(SolidEditor, props), host);
    } else throw new Error(`未知框架: ${kind}`);
    const getController = () => {
      if (!controller) throw new Error("编辑器尚未装配");
      return controller;
    };
    instances.set(id, {
      get controller() {
        return getController();
      },
      dispose: () => {
        dispose();
        host.remove();
      },
    });
  },
  ready(id) {
    try {
      return Boolean(instances.get(id)?.controller);
    } catch {
      return false;
    }
  },
  select(id) {
    instances.get(id)!.controller.editor.chain().focus().selectAll().run();
  },
  setContent(id, value) {
    instances.get(id)!.controller.setContent(value);
  },
  selectRange(id, from, to) {
    instances.get(id)!.controller.editor.commands.setTextSelection({ from, to });
  },
  selectText(id) {
    const editor = instances.get(id)!.controller.editor;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
      .run();
  },
  undo(id) {
    instances.get(id)!.controller.editor.commands.undo();
  },
  redo(id) {
    instances.get(id)!.controller.editor.commands.redo();
  },
  editable(id, value) {
    instances.get(id)!.controller.setEditable(value);
  },
  destroy(id) {
    instances.get(id)?.dispose();
    instances.delete(id);
  },
  destroyUnderlying(id) {
    const controller = instances.get(id)!.controller;
    controller.editor.destroy();
    controller.destroy();
  },
  remount(id) {
    const editor = instances.get(id)!.controller.editor;
    const element = editor.view.dom.parentElement;
    if (!element) throw new Error("编辑器挂载节点不存在");
    editor.unmount();
    editor.mount(element);
  },
  unsubscribe(id) {
    unsubscribers.get(id)?.();
  },
  cleanupCount(id) {
    return cleanups.get(id) ?? 0;
  },
  updateCount(id) {
    return updates.get(id) ?? 0;
  },
  failure(mode) {
    const host = document.createElement("div");
    document.body.append(host);
    let captured: EditorControllerWithResults | undefined;
    let count = 0;
    let message = "";
    try {
      const created = createEditor({
        element: host,
        toolbar({ controller, subscribe }) {
          captured = controller;
          subscribe(() => {});
          if (mode === "throw") throw new Error("工具栏装配失败");
          if (mode === "destroy") controller.destroy();
          if (mode === "unmount") controller.editor.unmount();
          return () => {
            count++;
            if (mode === "cleanup") throw new Error("工具栏清理失败");
          };
        },
      });
      if (mode === "cleanup") created.destroy();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    const result = {
      message,
      empty: host.childElementCount === 0,
      destroyed: Boolean(captured?.editor.isDestroyed),
      cleanups: count,
    };
    host.remove();
    return result;
  },
};
