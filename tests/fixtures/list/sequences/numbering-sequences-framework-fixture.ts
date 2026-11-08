import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, reactive } from "vue";

import { createEditor, getWritingAssistant } from "../../../../packages/core/src/index";
import type { EditorContent, EditorController, EditorSnapshot } from "../../../../packages/core/src/types";
import { SemloEditor as ReactEditor } from "../../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../../packages/vue/src/index";

import "../../../../packages/core/src/styles/style.css";
import "../../../../packages/core/src/features/blocks/actions/block-actions.css";
import "../../../../packages/core/src/features/list/ordered-numbering.css";

export type SequenceFramework = "core" | "react" | "vue" | "solid";
export type SequenceDocument = "three" | "five";

interface SequenceFixture {
  controller: EditorController;
  changes: EditorSnapshot[];
  documentChanges: number;
  errors: string[];
  writing: ReturnType<typeof getWritingAssistant>;
  mountSibling(content: EditorContent): EditorController;
  siblings: EditorController[];
  setContent(value: EditorContent): void;
  settle(): Promise<void>;
  destroy(): void;
}

declare global {
  interface Window {
    mountSequenceFixture?(
      framework: SequenceFramework,
      document: SequenceDocument,
      echo?: "json" | "html",
    ): Promise<void>;
    sequenceFixture?: SequenceFixture;
  }
}

function initialDocument(variant: SequenceDocument): EditorContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "列表之前" }] },
      {
        type: "orderedList",
        attrs: { semloEditorOrderedStyle: "mixed" },
        content: ["父", "甲", "乙", "丙", ...(variant === "five" ? ["丁", "戊"] : [])].map((text, index) => ({
          type: "listItem",
          attrs: {
            semloEditorListIndent: index === 0 ? 0 : 1,
            semloEditorListRestart: index === 2 || (variant === "five" && index === 4),
          },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text, ...(text === "乙" ? { marks: [{ type: "bold" }] } : {}) }],
            },
          ],
        })),
      },
      { type: "paragraph", content: [{ type: "text", text: "列表之后" }] },
    ],
  };
}

window.mountSequenceFixture = async (framework, variant, echo = "json") => {
  const host = document.createElement("div");
  host.id = "sequence-fixture";
  host.style.width = "850px";
  document.body.replaceChildren(host);

  let controller: EditorController | undefined;
  let updateContent: (value: EditorContent) => void = () => {
    throw new Error("受控编辑器尚未就绪");
  };
  let waitForControlledUpdate: () => Promise<void> = () => Promise.resolve();
  let dispose: () => void = () => {};
  let documentChanges = 0;
  const changes: EditorSnapshot[] = [];
  const errors: string[] = [];
  const siblings: EditorController[] = [];
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
    // 三个框架的实际受控 prop 接收同一快照投影，验证异步回写后的身份。
    updateContent(echo === "html" ? snapshot.html : snapshot.json);
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
  if (!controller) throw new Error("编辑器控制器缺失");
  window.sequenceFixture = {
    controller,
    changes,
    get documentChanges() {
      return documentChanges;
    },
    errors,
    writing: getWritingAssistant(controller.editor),
    siblings,
    mountSibling: (content) => {
      const element = document.createElement("div");
      element.id = "sequence-sibling";
      document.body.append(element);
      const sibling = createEditor({ element, content, outline: false });
      siblings.push(sibling);
      return sibling;
    },
    setContent: (value) => updateContent(value),
    settle: async () => {
      await nextTick();
      await waitForControlledUpdate();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await waitForControlledUpdate();
    },
    destroy: () => {
      for (const sibling of siblings) sibling.destroy();
      document.querySelectorAll("#sequence-sibling").forEach((node) => node.remove());
      dispose();
      host.remove();
      delete window.sequenceFixture;
    },
  };
};
