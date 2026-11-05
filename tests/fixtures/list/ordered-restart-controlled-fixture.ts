import { createElement, useEffect, useState } from "react";
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
import "../../../packages/core/src/features/blocks/actions/block-actions.css";
import "../../../packages/core/src/features/list/ordered-numbering.css";

export type RestartFramework = "core" | "react" | "vue" | "solid";
export type RestartDocument = "legacy" | "restarted";

interface RestartControlledFixture {
  controller: EditorController;
  changes: EditorSnapshot[];
  documentChanges: number;
  errors: string[];
  setContent(value: EditorContent): void;
  settle(): Promise<void>;
  destroy(): void;
}

declare global {
  interface Window {
    mountRestartControlledFixture?(framework: RestartFramework, document: RestartDocument): Promise<void>;
    restartControlledFixture?: RestartControlledFixture;
  }
}

function initialDocument(variant: RestartDocument): EditorContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "列表之前" }] },
      {
        type: "orderedList",
        attrs: { start: 7 },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "第一项" }] }] },
          {
            type: "listItem",
            ...(variant === "restarted" ? { attrs: { semloEditorListRestart: true } } : {}),
            content: [{ type: "paragraph", content: [{ type: "text", text: "第二项" }] }],
          },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "第三项" }] }] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "列表之后" }] },
    ],
  };
}

window.mountRestartControlledFixture = async (framework, variant) => {
  const host = document.createElement("div");
  host.id = "restart-controlled-fixture";
  host.style.width = "850px";
  document.body.replaceChildren(host);

  let controller: EditorController | undefined;
  let updateContent: (value: EditorContent) => void = () => {
    throw new Error("The controlled editor is not ready");
  };
  let waitForControlledUpdate: () => Promise<void> = () => Promise.resolve();
  let dispose: () => void = () => {};
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
    // The core setter and each framework's public controlled prop all receive
    // the emitted JSON, exercising normalization and any resulting re-entry.
    updateContent(snapshot.json);
  };
  const onError = (error: Error) => errors.push(error.message);

  if (framework === "core") {
    const value = createEditor({ element: host, content: initialDocument(variant), outline: false, onChange, onError });
    updateContent = (content) => value.setContent(content);
    dispose = () => value.destroy();
    onReady(value);
  } else if (framework === "react") {
    let requestedRevision = 0;
    let committedRevision = 0;
    const waiters = new Set<{ revision: number; resolve: () => void }>();
    waitForControlledUpdate = async () => {
      while (committedRevision < requestedRevision) {
        const revision = requestedRevision;
        await new Promise<void>((resolve) => waiters.add({ revision, resolve }));
      }
    };
    function App() {
      const [{ content, revision }, setContent] = useState(() => ({ content: initialDocument(variant), revision: 0 }));
      updateContent = (value) => {
        const nextRevision = ++requestedRevision;
        setContent({ content: value, revision: nextRevision });
      };
      useEffect(() => {
        // 子组件的内容 effect 已执行；仅等待动画帧不能保证 React 完成提交。
        committedRevision = revision;
        for (const waiter of waiters) {
          if (waiter.revision > committedRevision) continue;
          waiters.delete(waiter);
          waiter.resolve();
        }
      }, [revision]);
      return createElement(ReactEditor, { content, outline: false, onChange, onReady, onError });
    }
    const root = createRoot(host);
    root.render(createElement(App));
    dispose = () => root.unmount();
  } else if (framework === "vue") {
    const state = reactive<{ content: EditorContent }>({ content: initialDocument(variant) });
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
      const [content, setContent] = createSignal<EditorContent>(initialDocument(variant));
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
  window.restartControlledFixture = {
    controller,
    changes,
    get documentChanges() {
      return documentChanges;
    },
    errors,
    setContent: (value) => updateContent(value),
    settle: async () => {
      await nextTick();
      await waitForControlledUpdate();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await waitForControlledUpdate();
    },
    destroy: () => {
      dispose();
      host.remove();
      delete window.restartControlledFixture;
    },
  };
};
