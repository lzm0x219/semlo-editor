import { TextSelection } from "@tiptap/pm/state";
import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, ref } from "vue";

import { createDemoToolbar } from "../../../demo/custom-toolbar";
import {
  createEditor,
  getHeadingStyleState,
  setHeadingStyle,
  toggleHeadingStyle,
  type EditorContent,
  type EditorController,
  type EditorSnapshot,
  type HeadingStyleLevel,
  type HeadingStyleState,
} from "../../../packages/core/dist/index.js";
import { SemloEditor as ReactEditor } from "../../../packages/react/dist/index.js";
import { SemloEditor as SolidEditor } from "../../../packages/solid/dist/index.js";
import { SemloEditor as VueEditor } from "../../../packages/vue/dist/index.js";

import "../../../packages/core/dist/style.css";

type Framework = "core" | "react" | "vue" | "solid";
type ToolbarMode = "default" | "custom" | "hidden";
let controller: EditorController;
let host: HTMLElement;
let dispose: () => void;
let mountElement: HTMLElement | null = null;
let echoes = 0;
let second: EditorController;
let secondHost: HTMLElement;

declare global {
  interface Window {
    headingCommandFixture: {
      mount(mode: ToolbarMode, content: EditorContent, framework?: Framework, controlled?: boolean): void;
      ready(): boolean;
      select(first: string, last?: string, reverse?: boolean): void;
      selection(): { text: string; backward: boolean; empty: boolean };
      snapshot(): ReturnType<EditorController["getSnapshot"]>["json"];
      state(): HeadingStyleState;
      set(level: number): boolean;
      toggle(level: number): boolean;
      editable(value: boolean): void;
      undo(): boolean;
      redo(): boolean;
      echoCount(): number;
      unmount(): void;
      remount(): void;
      destroy(): void;
      mountSecond(content: EditorContent): void;
      selectSecond(text: string): void;
      stateSecond(): HeadingStyleState;
      toggleSecond(level: number): boolean;
      snapshotSecond(): ReturnType<EditorController["getSnapshot"]>["json"];
      destroySecond(): void;
    };
  }
}

window.headingCommandFixture = {
  mount(mode, content, framework = "core", controlled = false) {
    host = document.createElement("div");
    host.id = "heading-command-host";
    document.body.append(host);
    controller = undefined!;
    echoes = 0;
    const props = {
      content,
      outline: false,
      toolbar: mode === "custom" ? createDemoToolbar : mode === "default",
      onReady(current: EditorController) {
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
  ready: () => Boolean(controller),
  select(first, last = first, reverse = false) {
    const editor = controller.editor;
    const positions = new Map<string, number>();
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text && (node.text === first || node.text === last)) positions.set(node.text, position);
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
      text: doc.textBetween(selection.from, selection.to, "|"),
      backward: selection.anchor > selection.head,
      empty: selection.empty,
    };
  },
  snapshot: () => controller.getSnapshot().json,
  state: () => getHeadingStyleState(controller.editor),
  set: (level) => setHeadingStyle(controller.editor, level as HeadingStyleLevel),
  toggle: (level) => toggleHeadingStyle(controller.editor, level as HeadingStyleLevel),
  editable: (value) => controller.setEditable(value),
  undo: () => controller.editor.commands.undo(),
  redo: () => controller.editor.commands.redo(),
  echoCount: () => echoes,
  unmount() {
    mountElement = controller.editor.view.dom.parentElement;
    controller.editor.unmount();
  },
  remount() {
    if (!mountElement) throw new Error("编辑器挂载节点不存在");
    controller.editor.mount(mountElement);
  },
  destroy() {
    dispose();
    host.remove();
  },
  mountSecond(content) {
    secondHost = document.createElement("div");
    document.body.append(secondHost);
    second = createEditor({ element: secondHost, toolbar: false, outline: false, content });
  },
  selectSecond(text) {
    const editor = second.editor;
    let position: number | undefined;
    editor.state.doc.descendants((node, at) => {
      if (node.isText && node.text === text) position = at;
    });
    if (position === undefined) throw new Error("找不到选区文字");
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position, position + text.length)),
    );
  },
  stateSecond: () => getHeadingStyleState(second.editor),
  toggleSecond: (level) => toggleHeadingStyle(second.editor, level as HeadingStyleLevel),
  snapshotSecond: () => second.getSnapshot().json,
  destroySecond() {
    second.destroy();
    secondHost.remove();
  },
};
