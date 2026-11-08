import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, ref } from "vue";

import {
  createEditor,
  getBoldState,
  toggleBold,
  type EditorContent,
  type EditorController,
  type EditorSnapshot,
  type FloatingToolbarContext,
  type FloatingToolbarFactory,
  type ToolbarFactory,
} from "../../../packages/core/dist/index.js";
import { SemloEditor as ReactEditor } from "../../../packages/react/dist/index.js";
import { SemloEditor as SolidEditor } from "../../../packages/solid/dist/index.js";
import { SemloEditor as VueEditor } from "../../../packages/vue/dist/index.js";

import "../../../packages/core/dist/style.css";

type MainMode = "default" | "hidden" | "custom";
type FloatingMode = "default" | "hidden" | "custom" | "inherit";
type FailureMode = "throw" | "destroy" | "unmount" | "invalid" | "cleanup";
type Instance = { controller: EditorController; dispose: () => void };
const instances = new Map<string, Instance>();
const contexts = new Map<string, FloatingToolbarContext>();
const cleanups = new Map<string, number>();
const updates = new Map<string, number>();
const echoes = new Map<string, number>();
const order = new Map<string, string[]>();
const markEcho = (id: string) => echoes.set(id, (echoes.get(id) ?? 0) + 1);
const markOrder = (id: string, event: string) => order.set(id, [...(order.get(id) ?? []), event]);

declare global {
  interface Window {
    floatingToolbarFixture: {
      mount(
        kind: string,
        id: string,
        main?: MainMode,
        floating?: FloatingMode,
        controlled?: boolean,
        writing?: boolean,
      ): void;
      select(id: string): void;
      selectRange(id: string, from: number, to: number): void;
      setContent(id: string, value: string): void;
      collapse(id: string): void;
      openLink(id: string): void;
      editable(id: string, value: boolean): void;
      undo(id: string): void;
      redo(id: string): void;
      remount(id: string): void;
      destroy(id: string): void;
      destroyUnderlying(id: string): void;
      staleContext(id: string): void;
      cleanupCount(id: string): number;
      updateCount(id: string): number;
      echoCount(id: string): number;
      selection(id: string): { from: number; to: number };
      order(id: string): string[];
      failure(mode: FailureMode): {
        message: string;
        empty: boolean;
        destroyed: boolean;
        mainCleanups: number;
        bubbleCleanups: number;
      };
    };
  }
}

function createFloatingToolbar(id: string): FloatingToolbarFactory {
  return (context) => {
    markOrder(id, "floating");
    contexts.set(id, context);
    const { element, controller, syncSelection, subscribe, openLink } = context;
    const { editor } = controller;
    const bold = element.ownerDocument.createElement("button");
    const italic = element.ownerDocument.createElement("button");
    const link = element.ownerDocument.createElement("button");
    bold.type = italic.type = link.type = "button";
    bold.textContent = `自定义加粗 ${id}`;
    italic.textContent = `自定义斜体 ${id}`;
    link.textContent = `自定义链接 ${id}`;
    link.setAttribute("aria-haspopup", "dialog");
    link.setAttribute("aria-expanded", "false");
    element.append(bold, italic, link);
    const preserveSelection = (event: MouseEvent) => event.preventDefault();
    const onBold = () => {
      syncSelection();
      toggleBold(editor);
    };
    const toggleItalic = () => {
      syncSelection();
      editor.chain().focus().toggleItalic().run();
    };
    const showLink = () => openLink(link);
    for (const button of [bold, italic, link]) button.addEventListener("mousedown", preserveSelection);
    bold.addEventListener("click", onBold);
    italic.addEventListener("click", toggleItalic);
    link.addEventListener("click", showLink);
    const update = () => {
      updates.set(id, (updates.get(id) ?? 0) + 1);
      for (const button of [italic, link]) button.disabled = !editor.isEditable;
      const boldState = getBoldState(editor);
      bold.disabled = !boldState.enabled;
      bold.setAttribute("aria-pressed", String(boldState.active));
      italic.setAttribute("aria-pressed", String(editor.isActive("italic")));
    };
    const unsubscribe = subscribe(update);
    update();
    return () => {
      cleanups.set(id, (cleanups.get(id) ?? 0) + 1);
      unsubscribe();
      for (const button of [bold, italic, link]) button.removeEventListener("mousedown", preserveSelection);
      bold.removeEventListener("click", onBold);
      italic.removeEventListener("click", toggleItalic);
      link.removeEventListener("click", showLink);
    };
  };
}

window.floatingToolbarFixture = {
  mount(kind, id, main = "default", floating = "custom", controlled = false, writing = false) {
    const host = document.createElement("div");
    host.id = `floating-host-${id}`;
    document.body.append(host);
    let controller: EditorController | undefined;
    const mainFactory: ToolbarFactory = ({ element }) => {
      markOrder(id, "main");
      element.textContent = `自定义主工具栏 ${id}`;
    };
    const toolbar = main === "custom" ? mainFactory : main !== "hidden";
    const floatingToolbar =
      floating === "custom" ? createFloatingToolbar(id) : floating === "inherit" ? undefined : floating === "default";
    const props = {
      content: "<p>hello world</p>",
      toolbar,
      floatingToolbar,
      writingService: writing ? async () => ({ format: "text" as const, text: "确定性测试草稿" }) : undefined,
      onReady: (current: EditorController) => {
        controller = current;
        markOrder(id, "ready");
      },
    };
    let dispose: () => void;
    if (kind === "core") {
      controller = createEditor({
        element: host,
        content: props.content,
        toolbar,
        floatingToolbar,
        writingService: props.writingService,
        onChange: controlled
          ? (snapshot) =>
              queueMicrotask(() => {
                controller?.setContent(snapshot.json);
                markEcho(id);
              })
          : undefined,
      });
      dispose = () => controller?.destroy();
    } else if (kind === "react") {
      const root = createRoot(host);
      const Controlled = () => {
        const [content, setContent] = useState<EditorContent>(props.content);
        useEffect(() => {
          if (content !== props.content) markEcho(id);
        }, [content]);
        return createElement(ReactEditor, {
          ...props,
          content,
          onChange: (snapshot: EditorSnapshot) => setContent(snapshot.json),
        });
      };
      root.render(controlled ? createElement(Controlled) : createElement(ReactEditor, props));
      dispose = () => root.unmount();
    } else if (kind === "vue") {
      const content = ref<EditorContent>(props.content);
      const app = createApp({
        render: () =>
          h(
            VueEditor,
            controlled
              ? {
                  ...props,
                  content: content.value,
                  onChange: (snapshot: EditorSnapshot) => {
                    content.value = snapshot.json;
                    void nextTick(() => markEcho(id));
                  },
                }
              : props,
          ),
      });
      app.mount(host);
      dispose = () => app.unmount();
    } else if (kind === "solid") {
      dispose = render(() => {
        if (!controlled) return createComponent(SolidEditor, props);
        const [content, setContent] = createSignal<EditorContent>(props.content);
        return createComponent(SolidEditor, {
          ...props,
          get content() {
            return content();
          },
          onChange: (snapshot: EditorSnapshot) => {
            setContent(snapshot.json);
            queueMicrotask(() => markEcho(id));
          },
        });
      }, host);
    } else throw new Error(`未知框架: ${kind}`);
    instances.set(id, {
      get controller() {
        if (!controller) throw new Error("编辑器尚未装配");
        return controller;
      },
      dispose: () => {
        dispose();
        host.remove();
      },
    });
  },
  select(id) {
    const editor = instances.get(id)!.controller.editor;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
      .run();
  },
  selectRange(id, from, to) {
    instances.get(id)!.controller.editor.commands.setTextSelection({ from, to });
  },
  setContent(id, value) {
    instances.get(id)!.controller.setContent(value);
  },
  collapse(id) {
    instances.get(id)!.controller.editor.commands.setTextSelection(1);
  },
  openLink(id) {
    contexts.get(id)!.openLink();
  },
  editable(id, value) {
    instances.get(id)!.controller.setEditable(value);
  },
  undo(id) {
    instances.get(id)!.controller.editor.commands.undo();
  },
  redo(id) {
    instances.get(id)!.controller.editor.commands.redo();
  },
  remount(id) {
    const editor = instances.get(id)!.controller.editor;
    const element = editor.view.dom.parentElement;
    if (!element) throw new Error("编辑器挂载节点不存在");
    editor.unmount();
    editor.mount(element);
  },
  destroy(id) {
    instances.get(id)?.dispose();
    instances.delete(id);
  },
  destroyUnderlying(id) {
    const current = instances.get(id)!.controller;
    current.editor.destroy();
    current.destroy();
  },
  staleContext(id) {
    const context = contexts.get(id)!;
    context.syncSelection();
    context.openLink();
    context.subscribe(() => {
      throw new Error("销毁后不应收到通知");
    })();
  },
  cleanupCount(id) {
    return cleanups.get(id) ?? 0;
  },
  updateCount(id) {
    return updates.get(id) ?? 0;
  },
  echoCount(id) {
    return echoes.get(id) ?? 0;
  },
  selection(id) {
    const { from, to } = instances.get(id)!.controller.editor.state.selection;
    return { from, to };
  },
  order(id) {
    return order.get(id) ?? [];
  },
  failure(mode) {
    const host = document.createElement("div");
    document.body.append(host);
    let captured: EditorController | undefined;
    let mainCleanups = 0;
    let bubbleCleanups = 0;
    let message = "";
    try {
      const created = createEditor({
        element: host,
        toolbar({ subscribe }) {
          subscribe(() => {});
          return () => {
            mainCleanups++;
          };
        },
        floatingToolbar({ controller: current, subscribe }) {
          captured = current;
          subscribe(() => {});
          if (mode === "throw") throw new Error("浮动工具栏装配失败");
          if (mode === "destroy") current.destroy();
          if (mode === "unmount") current.editor.unmount();
          if (mode === "invalid") return 1 as unknown as () => void;
          return () => {
            bubbleCleanups++;
            if (mode === "cleanup") throw new Error("浮动工具栏清理失败");
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
      destroyed: captured?.editor.isDestroyed ?? false,
      mainCleanups,
      bubbleCleanups,
    };
    host.remove();
    return result;
  },
};
