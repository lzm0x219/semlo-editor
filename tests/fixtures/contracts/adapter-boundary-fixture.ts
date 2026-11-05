import { Component, Suspense, createElement, startTransition, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, reactive } from "vue";

import type { EditorContent, EditorController, EditorSnapshot } from "../../../packages/core/src/types";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

import "../../../packages/core/src/styles/style.css";

export type BoundaryFramework = "react" | "vue" | "solid";
export interface BoundaryFixture {
  controllers: EditorController[];
  snapshots: number[];
  changes: string[];
  clicks: string[];
  listen(value: boolean): void;
  content(value: EditorContent): void;
  unsafe(): void;
  settle(): Promise<void>;
  destroy(): void;
}

export interface ConcurrentFixture {
  controller: EditorController;
  callbacks: number[];
  errors: number[];
  attempts: number[];
  suspend(): void;
  release(): void;
  destroy(): void;
}

declare global {
  interface Window {
    mountBoundaryFixture?(framework: BoundaryFramework): Promise<void>;
    boundaryFixture?: BoundaryFixture;
    mountConcurrentFixture?(): Promise<void>;
    concurrentFixture?: ConcurrentFixture;
    mountFailingReadyFixture?(): Promise<{ controller: EditorController; errors: string[] }>;
  }
}

const settle = async () => {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};

window.mountBoundaryFixture = async (framework) => {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const controllers: EditorController[] = [];
  const snapshots = [0, 0];
  const changes: string[] = [];
  const clicks: string[] = [];
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  const onReady = (index: number) => (controller: EditorController) => {
    controllers[index] = controller;
    const getHTML = controller.editor.getHTML.bind(controller.editor);
    controller.editor.getHTML = () => {
      snapshots[index]++;
      return getHTML();
    };
    if (controllers[0] && controllers[1]) markReady();
  };
  let update!: (state: Partial<State>) => void;
  let dispose!: () => void;
  const onChange = (snapshot: EditorSnapshot) => {
    changes.push(snapshot.text);
    update({ content: snapshot.json });
  };
  type State = { listening: boolean; content: EditorContent | undefined; unsafe: boolean };
  const initial: State = { listening: false, content: undefined, unsafe: false };

  if (framework === "react") {
    function App() {
      const [state, setState] = useState(initial);
      update = (value) => setState((previous) => ({ ...previous, ...value }));
      return createElement(
        "main",
        null,
        createElement(ReactEditor, {
          id: "editor-a",
          title: state.unsafe ? "更新后" : "初始",
          onClick: () => clicks.push(state.unsafe ? "更新后" : "初始"),
          content: state.content,
          toolbar: false,
          outline: false,
          onReady: onReady(0),
          onChange: state.listening ? onChange : undefined,
          ...(state.unsafe ? { dangerouslySetInnerHTML: { __html: "<p>覆盖内容</p>" }, children: "覆盖子节点" } : {}),
        }),
        createElement(ReactEditor, { id: "editor-b", toolbar: false, outline: false, onReady: onReady(1) }),
      );
    }
    const root = createRoot(host);
    root.render(createElement(App));
    dispose = () => root.unmount();
  } else if (framework === "vue") {
    const state = reactive<State>({ ...initial });
    update = (value) => Object.assign(state, value);
    const app = createApp({
      render: () =>
        h("main", [
          h(VueEditor, {
            id: "editor-a",
            title: state.unsafe ? "更新后" : "初始",
            onClick: () => clicks.push(state.unsafe ? "更新后" : "初始"),
            content: state.content,
            toolbar: false,
            outline: false,
            onReady: onReady(0),
            onChange: state.listening ? onChange : undefined,
            innerHTML: state.unsafe ? "<p>覆盖内容</p>" : undefined,
            textContent: state.unsafe ? "覆盖文本" : undefined,
            ".innerHTML": state.unsafe ? "<p>强制覆盖</p>" : undefined,
            ".textContent": state.unsafe ? "强制文本" : undefined,
            ".outerHTML": state.unsafe ? "<p>替换宿主</p>" : undefined,
            outerText: state.unsafe ? "替换宿主文本" : undefined,
          }),
          h(VueEditor, { id: "editor-b", toolbar: false, outline: false, onReady: onReady(1) }),
        ]),
    });
    app.mount(host);
    dispose = () => app.unmount();
  } else {
    dispose = render(() => {
      const [state, setState] = createSignal<State>({ ...initial });
      update = (value) => setState((previous) => ({ ...previous, ...value }));
      return [
        createComponent(SolidEditor, {
          id: "editor-a",
          get title() {
            return state().unsafe ? "更新后" : "初始";
          },
          onClick: () => clicks.push(state().unsafe ? "更新后" : "初始"),
          get content() {
            return state().content;
          },
          toolbar: false,
          outline: false,
          onReady: onReady(0),
          get onChange() {
            return state().listening ? onChange : undefined;
          },
          get innerHTML() {
            return state().unsafe ? "<p>覆盖内容</p>" : undefined;
          },
          get textContent() {
            return state().unsafe ? "覆盖文本" : undefined;
          },
          get "prop:innerHTML"() {
            return state().unsafe ? "<p>强制覆盖</p>" : undefined;
          },
          get "prop:textContent"() {
            return state().unsafe ? "强制文本" : undefined;
          },
          get "prop:outerHTML"() {
            return state().unsafe ? "<p>替换宿主</p>" : undefined;
          },
          get "prop:outerText"() {
            return state().unsafe ? "替换宿主文本" : undefined;
          },
          get children() {
            return state().unsafe ? "覆盖子节点" : undefined;
          },
        } as Parameters<typeof SolidEditor>[0]),
        createComponent(SolidEditor, { id: "editor-b", toolbar: false, outline: false, onReady: onReady(1) }),
      ];
    }, host);
  }
  await ready;
  window.boundaryFixture = {
    controllers,
    snapshots,
    changes,
    clicks,
    listen: (value) => update({ listening: value }),
    content: (value) => update({ content: value }),
    unsafe: () => update({ unsafe: true }),
    settle,
    destroy: () => {
      dispose();
      host.remove();
    },
  };
};

window.mountConcurrentFixture = async () => {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const callbacks: number[] = [];
  const errors: number[] = [];
  const attempts: number[] = [];
  let controller!: EditorController;
  let markReady!: () => void;
  let resume!: () => void;
  let resumed = false;
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  const pending = new Promise<void>((resolve) => (resume = resolve));
  let suspend!: () => void;
  function Block({ version }: { version: number }) {
    attempts.push(version);
    if (version === 1 && !resumed) throw pending;
    return null;
  }
  function App() {
    const [version, setVersion] = useState(0);
    suspend = () => startTransition(() => setVersion(1));
    return createElement(
      Suspense,
      { fallback: "加载中" },
      createElement(ReactEditor, {
        toolbar: false,
        outline: false,
        onReady: (value) => {
          controller = value;
          markReady();
        },
        onChange: () => callbacks.push(version),
        onError: () => errors.push(version),
      }),
      createElement(Block, { version }),
    );
  }
  const root = createRoot(host);
  root.render(createElement(App));
  await ready;
  window.concurrentFixture = {
    controller,
    callbacks,
    errors,
    attempts,
    suspend: () => suspend(),
    release: () => {
      resumed = true;
      resume();
    },
    destroy: () => {
      root.unmount();
      host.remove();
    },
  };
};

window.mountFailingReadyFixture = async () => {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const errors: string[] = [];
  let controller!: EditorController;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error: Error) {
      errors.push(error.message);
      finish();
    }
    render() {
      return this.state.failed ? "初始化失败" : this.props.children;
    }
  }
  const root = createRoot(host);
  root.render(
    createElement(
      Boundary,
      null,
      createElement(ReactEditor, {
        toolbar: false,
        outline: false,
        onReady: (value) => {
          controller = value;
          throw new Error("ready 故障");
        },
      }),
    ),
  );
  await done;
  root.unmount();
  return { controller, errors };
};
