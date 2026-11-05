import "../../../demo/editor.css";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, shallowReactive } from "vue";

import type { EditorController, EditorSnapshot } from "../../../packages/core/src/types";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

type Framework = "react" | "vue" | "solid";
type State = { content: string; editable: boolean };
type FrameworkFixture = {
  controller: EditorController;
  errors: string[];
  changes: EditorSnapshot[];
  update(): void;
  settle(): Promise<void>;
  unmount(): void;
};
declare global {
  interface Window {
    mountDestroyFramework?(framework: Framework): Promise<void>;
    destroyFrameworkFixture?: FrameworkFixture;
  }
}
window.mountDestroyFramework = async (framework) => {
  const host = document.createElement("div");
  host.id = "destroy-framework";
  document.body.append(host);
  const errors: string[] = [];
  const changes: EditorSnapshot[] = [];
  let update: (() => void) | undefined;
  let unmount: (() => void) | undefined;
  let markReady: ((controller: EditorController) => void) | undefined;
  const ready = new Promise<EditorController>((resolve) => {
    markReady = resolve;
  });
  const onReady = (controller: EditorController) => markReady?.(controller);
  const onError = (error: Error) => errors.push(error.message);
  const onChange = (snapshot: EditorSnapshot) => changes.push(snapshot);
  const next: State = { content: "<p>replacement</p>", editable: false };
  if (framework === "react") {
    function App() {
      const [state, setState] = useState<State>({ content: "<h3>framework</h3>", editable: true });
      update = () => setState(next);
      return createElement(ReactEditor, { ...state, onReady, onError, onChange });
    }
    const root = createRoot(host);
    root.render(createElement(App));
    unmount = () => root.unmount();
  } else if (framework === "vue") {
    const state = shallowReactive<{ value: State }>({ value: { content: "<h3>framework</h3>", editable: true } });
    const app = createApp({ render: () => h(VueEditor, { ...state.value, onReady, onError, onChange }) });
    app.mount(host);
    update = () => {
      state.value = next;
    };
    unmount = () => app.unmount();
  } else {
    unmount = render(() => {
      const [state, setState] = createSignal<State>({ content: "<h3>framework</h3>", editable: true });
      update = () => setState(next);
      return createComponent(SolidEditor, {
        get content() {
          return state().content;
        },
        get editable() {
          return state().editable;
        },
        onReady,
        onError,
        onChange,
      });
    }, host);
  }
  const controller = await ready;
  window.destroyFrameworkFixture = {
    controller,
    errors,
    changes,
    update: () => {
      if (!update) throw new Error("Framework not mounted");
      update();
    },
    settle: async () => {
      await nextTick();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    unmount: () => {
      unmount?.();
      host.remove();
    },
  };
};
