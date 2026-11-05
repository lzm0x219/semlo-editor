import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, reactive } from "vue";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorContent, EditorController, EditorSnapshot } from "../../../packages/core/src/types";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

import "../../../packages/core/src/styles/style.css";

export type SnapshotFramework = "core" | "react" | "vue" | "solid";
export interface NestedSnapshotFixture {
  controller: EditorController;
  changes: EditorSnapshot[];
  documentChanges: number;
  errors: string[];
  setContent(value: EditorContent): void;
  setEcho(enabled: boolean): void;
  settle(): Promise<void>;
  destroy(): void;
}

declare global {
  interface Window {
    mountNestedSnapshotFixture?(framework: SnapshotFramework): Promise<void>;
    nestedSnapshotFixture?: NestedSnapshotFixture;
  }
}

function initialDocument(): EditorContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "日历之前" }] },
      {
        type: "semloEditorCalendar",
        attrs: {
          events: [
            {
              id: "first",
              title: "原始日程",
              start: "2026-11-05",
              end: "2026-11-05",
              description: "初始说明",
              color: 0,
            },
            {
              id: "second",
              title: "第二日程",
              start: "2026-11-06",
              end: "2026-11-06",
              description: "第二说明",
              color: 1,
            },
          ],
        },
      },
      { type: "paragraph", content: [{ type: "text", text: "日历之后" }] },
    ],
  };
}

window.mountNestedSnapshotFixture = async (framework) => {
  const host = document.createElement("div");
  host.id = "nested-snapshot-fixture";
  host.style.width = "850px";
  document.body.replaceChildren(host);

  let controller: EditorController | undefined;
  let updateContent: (value: EditorContent) => void = () => {
    throw new Error("The controlled editor is not ready");
  };
  let dispose: () => void = () => {};
  let echo = false;
  let documentChanges = 0;
  const changes: EditorSnapshot[] = [];
  const errors: string[] = [];
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  const onReady = (value: EditorController) => {
    controller = value;
    value.editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) documentChanges += 1;
    });
    markReady();
  };
  const onChange = (snapshot: EditorSnapshot) => {
    changes.push(snapshot);
    if (echo) updateContent(snapshot.json);
  };
  const onError = (error: Error) => errors.push(error.message);

  if (framework === "core") {
    const value = createEditor({
      element: host,
      content: initialDocument(),
      outline: false,
      onChange,
      onError,
    });
    updateContent = (content) => value.setContent(content);
    dispose = () => value.destroy();
    onReady(value);
  } else if (framework === "react") {
    function App() {
      const [content, setContent] = useState<EditorContent>(initialDocument);
      updateContent = (value) => setContent(() => value);
      return createElement(ReactEditor, { content, outline: false, onChange, onReady, onError });
    }
    const root = createRoot(host);
    root.render(createElement(App));
    dispose = () => root.unmount();
  } else if (framework === "vue") {
    // Ordinary deep reactivity is intentional: nested document attributes
    // arrive at the component as Vue proxies in this integration.
    const state = reactive<{ content: EditorContent }>({ content: initialDocument() });
    updateContent = (value) => {
      state.content = value;
    };
    const app = createApp({
      render: () => h(VueEditor, { content: state.content, outline: false, onChange, onReady, onError }),
    });
    app.mount(host);
    dispose = () => app.unmount();
  } else {
    dispose = render(() => {
      const [content, setContent] = createSignal<EditorContent>(initialDocument());
      updateContent = (value) => setContent(() => value);
      return createComponent(SolidEditor, {
        get content() {
          return content();
        },
        outline: false,
        onChange,
        onReady,
        onError,
      });
    }, host);
  }
  await ready;
  if (!controller) throw new Error("Missing editor controller");
  window.nestedSnapshotFixture = {
    controller,
    changes,
    get documentChanges() {
      return documentChanges;
    },
    errors,
    setContent: (value) => updateContent(value),
    setEcho: (enabled) => {
      echo = enabled;
    },
    settle: async () => {
      await nextTick();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    destroy: () => {
      dispose();
      host.remove();
      delete window.nestedSnapshotFixture;
    },
  };
};
