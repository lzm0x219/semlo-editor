import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, shallowReactive } from "vue";

import { createEditor } from "../../../packages/core/dist/index.js";
import type { CodeBlockPreferencesAdapter, CodeRunner, EditorController } from "../../../packages/core/src/index";
import { SemloEditor as ReactEditor } from "../../../packages/react/dist/index.js";
import { SemloEditor as SolidEditor } from "../../../packages/solid/dist/index.js";
import { SemloEditor as VueEditor } from "../../../packages/vue/dist/index.js";

interface MountResult {
  controller: EditorController;
  setRunner: (runner: CodeRunner | undefined) => void;
  destroy: () => void;
}
declare global {
  interface Window {
    mountCodePreferencesFixture?: (
      framework: string,
      id: string,
      adapter?: CodeBlockPreferencesAdapter,
      runCode?: CodeRunner,
      onError?: (error: Error) => void,
    ) => Promise<MountResult>;
    codePreferencesFixtures?: Partial<Record<string, MountResult>>;
    codePreferencesSaved?: unknown;
  }
}
const fixtures: Partial<Record<string, MountResult>> = {};
window.codePreferencesFixtures = fixtures;
window.mountCodePreferencesFixture = async (framework, id, adapter, runCode, onError) => {
  const host = document.createElement("div");
  host.id = id;
  document.body.prepend(host);
  let destroy = () => {};
  let setRunner: (runner: CodeRunner | undefined) => void = () => {};
  const controller = await new Promise<EditorController>((resolve, reject) => {
    const props = {
      codeBlockPreferences: adapter,
      runCode,
      outline: false,
      toolbar: false,
      onReady: resolve,
      onError: onError ?? reject,
    };
    if (framework === "core") {
      const current = createEditor({
        element: host,
        codeBlockPreferences: adapter,
        runCode,
        onError,
        outline: false,
        toolbar: false,
      });
      destroy = () => current.destroy();
      setRunner = (next) => current.setIntegrations({ runCode: next });
      resolve(current);
    } else if (framework === "react") {
      const root = createRoot(host);
      destroy = () => root.unmount();
      function Fixture() {
        const [runner, update] = useState<CodeRunner | undefined>(() => runCode);
        setRunner = (next) => update(() => next);
        return createElement(ReactEditor, { ...props, runCode: runner });
      }
      root.render(createElement(Fixture));
    } else if (framework === "vue") {
      const state = shallowReactive({ runner: runCode });
      setRunner = (next) => {
        state.runner = next;
      };
      const app = createApp({ render: () => h(VueEditor, { ...props, runCode: state.runner }) });
      destroy = () => app.unmount();
      app.mount(host);
    } else if (framework === "solid") {
      destroy = render(() => {
        const [runner, update] = createSignal(runCode);
        setRunner = (next) => update(() => next);
        return createComponent(SolidEditor, {
          ...props,
          get runCode() {
            return runner();
          },
        });
      }, host);
    } else reject(new Error(`Unknown framework ${framework}`));
  });
  const result = {
    controller,
    setRunner,
    destroy: () => {
      destroy();
      host.remove();
    },
  };
  fixtures[id] = result;
  return result;
};
