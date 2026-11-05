import { Plugin } from "@tiptap/pm/state";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, shallowReactive, shallowRef } from "vue";

import { createEditor, isEditorControllerWithResults } from "../../../packages/core/src/index";
import type {
  EditorContent,
  EditorController,
  EditorControllerWithResults,
  EditorSnapshot,
} from "../../../packages/core/src/types";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

type Framework = "core" | "react" | "vue" | "solid";
type Fixture = {
  controller: EditorControllerWithResults;
  other: EditorController;
  changes: EditorSnapshot[];
  errors: Error[];
  getVueEditor(): EditorControllerWithResults | undefined;
  setOnError(callback: (error: Error) => void): void;
  settle(): Promise<void>;
  destroy(): void;
};
declare global {
  interface Window {
    mountReplacementResult?: (framework: Framework) => Promise<void>;
    replacementResultFixture?: Fixture;
    replacementResultPlugin?: typeof Plugin;
  }
}

window.mountReplacementResult = async (framework) => {
  const host = document.createElement("div");
  const otherHost = document.createElement("div");
  host.id = "replacement-result";
  document.body.replaceChildren(host, otherHost);
  const changes: EditorSnapshot[] = [];
  const errors: Error[] = [];
  let onErrorAction: ((error: Error) => void) | undefined;
  let dispose = () => {};
  let vueExposed: { getEditor(): EditorControllerWithResults | undefined } | undefined;
  const controller = await new Promise<EditorControllerWithResults>((resolve) => {
    const props = {
      toolbar: false,
      outline: false,
      onReady: (value: EditorController) => {
        if (!isEditorControllerWithResults(value)) throw new Error("result API missing");
        resolve(value);
      },
      onError: (error: Error) => {
        errors.push(error);
        onErrorAction?.(error);
      },
    };
    if (framework === "core") {
      const editor = createEditor({
        element: host,
        ...props,
        content: "<p>original</p>",
        onChange: (value) => changes.push(value),
      });
      dispose = () => editor.destroy();
      resolve(editor);
    } else if (framework === "react") {
      const root = createRoot(host);
      function FixtureComponent() {
        const [content, setContent] = useState<EditorContent>("<p>original</p>");
        return createElement(ReactEditor, {
          ...props,
          content,
          onChange: (value) => {
            changes.push(value);
            setContent(value.json);
          },
        });
      }
      dispose = () => root.unmount();
      root.render(createElement(FixtureComponent));
    } else if (framework === "vue") {
      const state = shallowReactive<{ content: EditorContent }>({ content: "<p>original</p>" });
      const exposed = shallowRef<{ getEditor(): EditorControllerWithResults | undefined }>();
      const app = createApp({
        render: () =>
          h(VueEditor, {
            ...props,
            ref: exposed,
            content: state.content,
            onChange: (value: EditorSnapshot) => {
              changes.push(value);
              state.content = value.json;
            },
          }),
      });
      dispose = () => app.unmount();
      app.mount(host);
      vueExposed = exposed.value;
    } else {
      dispose = render(() => {
        const [content, setContent] = createSignal<EditorContent>("<p>original</p>");
        return createComponent(SolidEditor, {
          ...props,
          get content() {
            return content();
          },
          onChange: (value) => {
            changes.push(value);
            setContent(value.json);
          },
        });
      }, host);
    }
  });
  const other = createEditor({ element: otherHost, content: "<p>other</p>" });
  window.replacementResultFixture = {
    controller,
    other,
    changes,
    errors,
    getVueEditor() {
      return vueExposed?.getEditor();
    },
    setOnError(callback) {
      onErrorAction = callback;
    },
    async settle() {
      await nextTick();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    destroy() {
      dispose();
      other.destroy();
    },
  };
};
window.replacementResultPlugin = Plugin;
