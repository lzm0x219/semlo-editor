import { TextSelection } from "@tiptap/pm/state";
import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, ref } from "vue";

import { createDemoToolbar } from "../../../demo/custom-toolbar";
import {
  createEditor,
  getListState,
  toggleList,
  type EditorContent,
  type EditorController,
  type EditorSnapshot,
  type ListKind,
  type ToolbarFactory,
} from "../../../packages/core/dist/index.js";
import { SemloEditor as ReactEditor } from "../../../packages/react/dist/index.js";
import { SemloEditor as SolidEditor } from "../../../packages/solid/dist/index.js";
import { SemloEditor as VueEditor } from "../../../packages/vue/dist/index.js";

import "../../../packages/core/dist/style.css";

type Framework = "core" | "react" | "vue" | "solid";
let controller: EditorController;
let host: HTMLElement;
let echoes = 0;
let mount: HTMLElement | null = null;
let dispose: () => void;
let secondController: EditorController;
let secondHost: HTMLElement;

declare global {
  interface Window {
    listCommandFixture: {
      mount(mode: "default" | "custom", content: EditorContent, controlled?: boolean, framework?: Framework): void;
      ready(): boolean;
      select(text: string, start: number, end: number, reverse?: boolean): void;
      selectBetween(first: string, last: string, reverse?: boolean): void;
      selection(): { text: string; backward: boolean; empty: boolean };
      snapshot(): ReturnType<EditorController["getSnapshot"]>["json"];
      state(kind: ListKind): { active: boolean; enabled: boolean };
      toggle(kind: ListKind): boolean;
      editable(value: boolean): void;
      undo(): boolean;
      redo(): boolean;
      echoCount(): number;
      unmount(): void;
      remount(): void;
      destroy(): void;
      mountSecond(content: EditorContent): void;
      selectSecond(text: string, start: number, end: number): void;
      snapshotSecond(): ReturnType<EditorController["getSnapshot"]>["json"];
      stateSecond(kind: ListKind): { active: boolean; enabled: boolean };
      toggleSecond(kind: ListKind): boolean;
      undoSecond(): boolean;
      destroySecond(): void;
    };
  }
}

function selectText(current: EditorController, text: string, start: number, end: number, reverse = false) {
  const editor = current.editor;
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) position = pos;
  });
  if (position === undefined) throw new Error(`找不到文字：${text}`);
  const anchor = position + (reverse ? end : start);
  const head = position + (reverse ? start : end);
  editor.view.focus();
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)));
}

const customToolbar: ToolbarFactory = (context) => {
  const cleanup = createDemoToolbar(context);
  const { element, controller, subscribe, syncSelection } = context;
  const button = element.ownerDocument.createElement("button");
  button.type = "button";
  button.textContent = "待办事项";
  const preserve = (event: MouseEvent) => {
    event.preventDefault();
    syncSelection();
  };
  const execute = () => toggleList(controller.editor, "taskList");
  button.addEventListener("mousedown", preserve);
  button.addEventListener("click", execute);
  element.append(button);
  const refresh = () => {
    const state = getListState(controller.editor, "taskList");
    button.disabled = !state.enabled;
    button.setAttribute("aria-pressed", String(state.active));
  };
  const unsubscribe = subscribe(refresh);
  refresh();
  return () => {
    unsubscribe();
    button.removeEventListener("mousedown", preserve);
    button.removeEventListener("click", execute);
    cleanup?.();
  };
};

window.listCommandFixture = {
  mount(mode, content, controlled = false, framework = "core") {
    host = document.createElement("div");
    host.id = "list-command-host";
    document.body.append(host);
    echoes = 0;
    controller = undefined!;
    const props = {
      content,
      outline: false,
      toolbar: mode === "custom" ? customToolbar : true,
      onReady: (current: EditorController) => {
        controller = current;
      },
    };
    if (framework === "core") {
      controller = createEditor({
        element: host,
        ...props,
        onChange: controlled
          ? (snapshot) =>
              queueMicrotask(() => {
                if (!controller.editor.isDestroyed) controller.setContent(snapshot.json);
                echoes++;
              })
          : undefined,
      });
      dispose = () => controller.destroy();
    } else if (framework === "react") {
      const root = createRoot(host);
      const App = () => {
        const [value, setValue] = useState<EditorContent>(content);
        useEffect(() => {
          if (value !== content) echoes++;
        }, [value]);
        return createElement(ReactEditor, {
          ...props,
          content: value,
          onChange: controlled ? (snapshot: EditorSnapshot) => setValue(snapshot.json) : undefined,
        });
      };
      root.render(createElement(App));
      dispose = () => root.unmount();
    } else if (framework === "vue") {
      const value = ref<EditorContent>(content);
      const app = createApp({
        render: () =>
          h(VueEditor, {
            ...props,
            content: value.value,
            onChange: controlled
              ? (snapshot: EditorSnapshot) => {
                  value.value = snapshot.json;
                  void nextTick(() => echoes++);
                }
              : undefined,
          }),
      });
      app.mount(host);
      dispose = () => app.unmount();
    } else {
      dispose = render(() => {
        const [value, setValue] = createSignal<EditorContent>(content);
        return createComponent(SolidEditor, {
          ...props,
          get content() {
            return value();
          },
          onChange: controlled
            ? (snapshot: EditorSnapshot) => {
                setValue(snapshot.json);
                queueMicrotask(() => echoes++);
              }
            : undefined,
        });
      }, host);
    }
  },
  ready() {
    return Boolean(controller);
  },
  select(text, start, end, reverse = false) {
    selectText(controller, text, start, end, reverse);
  },
  selectBetween(first, last, reverse = false) {
    const editor = controller.editor;
    const positions = new Map<string, number>();
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text && (node.text === first || node.text === last)) positions.set(node.text, pos);
    });
    const from = positions.get(first);
    const lastPosition = positions.get(last);
    if (from === undefined || lastPosition === undefined) throw new Error("找不到选区文字");
    const to = lastPosition + last.length;
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, reverse ? to : from, reverse ? from : to)),
    );
  },
  selection() {
    const { doc, selection } = controller.editor.state;
    return {
      text: doc.textBetween(selection.from, selection.to),
      backward: selection.anchor > selection.head,
      empty: selection.empty,
    };
  },
  snapshot() {
    return controller.getSnapshot().json;
  },
  state(kind) {
    return getListState(controller.editor, kind);
  },
  toggle(kind) {
    return toggleList(controller.editor, kind);
  },
  editable(value) {
    controller.setEditable(value);
  },
  undo() {
    return controller.editor.commands.undo();
  },
  redo() {
    return controller.editor.commands.redo();
  },
  echoCount() {
    return echoes;
  },
  unmount() {
    mount = controller.editor.view.dom.parentElement;
    controller.editor.unmount();
  },
  remount() {
    if (!mount) throw new Error("编辑器挂载节点不存在");
    controller.editor.mount(mount);
  },
  destroy() {
    dispose();
    host.remove();
  },
  mountSecond(content) {
    secondHost = document.createElement("div");
    secondHost.id = "second-list-command-host";
    document.body.append(secondHost);
    secondController = createEditor({ element: secondHost, content, outline: false, toolbar: false });
  },
  selectSecond(text, start, end) {
    selectText(secondController, text, start, end);
  },
  snapshotSecond() {
    return secondController.getSnapshot().json;
  },
  stateSecond(kind) {
    return getListState(secondController.editor, kind);
  },
  toggleSecond(kind) {
    return toggleList(secondController.editor, kind);
  },
  undoSecond() {
    return secondController.editor.commands.undo();
  },
  destroySecond() {
    secondController.destroy();
    secondHost.remove();
  },
};
