import type { EditorContent, EditorController, EditorSnapshot } from "@semlo-editor/core";
import { SemloEditor as ReactEditor } from "@semlo-editor/react";
import { SemloEditor as SolidEditor } from "@semlo-editor/solid";
import { SemloEditor as VueEditor } from "@semlo-editor/vue";
import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, shallowReactive } from "vue";

import "@semlo-editor/core/style.css";

import { sequencePasteContent } from "./numbering-sequence-paste-content";

export type PasteFramework = "react" | "vue" | "solid";
type Echo = "json" | "html";
interface FrameworkFixture {
  controller: EditorController;
  changes: EditorSnapshot[];
  errors: string[];
  events: { type: string; trusted: boolean }[];
  undoResults: boolean[];
  armUndo(): void;
  setContent(value: EditorContent): void;
  setEditable(value: boolean): void;
  settle(): Promise<void>;
  destroy(): void;
}
declare global {
  interface Window {
    mountSequencePasteFramework(framework: PasteFramework, echo: Echo, initial?: EditorContent): Promise<void>;
    sequencePasteFramework: FrameworkFixture;
  }
}

window.mountSequencePasteFramework = async (framework, echo, initial = sequencePasteContent()) => {
  const host = document.createElement("main");
  host.id = "paste-framework";
  host.style.margin = "40px";
  document.body.replaceChildren(host);
  let controller: EditorController | undefined;
  let updateContent: (content: EditorContent) => void = () => {};
  let updateEditable: (value: boolean) => void = () => {};
  let settle = async () => {};
  let dispose = () => {};
  let undoNext = false;
  let destroyed = false;
  const undoResults: boolean[] = [];
  const changes: EditorSnapshot[] = [];
  const errors: string[] = [];
  const events: { type: string; trusted: boolean }[] = [];
  let markReady = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const onReady = (value: EditorController) => {
    controller = value;
    for (const type of ["copy", "paste"])
      value.editor.view.dom.addEventListener(type, (event) => {
        events.push({ type, trusted: event.isTrusted });
      });
    markReady();
  };
  const onChange = (snapshot: EditorSnapshot) => {
    changes.push(snapshot);
    updateContent(echo === "html" ? snapshot.html : snapshot.json);
    if (undoNext) {
      undoNext = false;
      undoResults.push(controller!.editor.commands.undo());
    }
  };
  const onError = (error: Error) => errors.push(error.message);

  if (framework === "react") {
    let requested = 0,
      committed = 0;
    const waiters = new Set<{ revision: number; resolve(): void }>();
    settle = async () => {
      while (!destroyed && committed < requested) {
        const revision = requested;
        await new Promise<void>((resolve) => waiters.add({ revision, resolve }));
      }
    };
    function App() {
      const [state, setState] = useState(() => ({
        content: initial as EditorContent,
        editable: true,
        revision: 0,
      }));
      updateContent = (content) => {
        const revision = ++requested;
        setState((previous) => ({ ...previous, content, revision }));
      };
      updateEditable = (editable) => {
        const revision = ++requested;
        setState((previous) => ({ ...previous, editable, revision }));
      };
      useEffect(() => {
        // 以实际提交版本确认子适配器effect已执行，不用固定帧或超时掩盖旧回写。
        committed = state.revision;
        for (const waiter of waiters)
          if (waiter.revision <= committed) {
            waiters.delete(waiter);
            waiter.resolve();
          }
      }, [state.revision]);
      return createElement(ReactEditor, {
        content: state.content,
        editable: state.editable,
        outline: false,
        onChange,
        onReady,
        onError,
      });
    }
    const root = createRoot(host);
    root.render(createElement(App));
    dispose = () => {
      root.unmount();
      for (const waiter of waiters) waiter.resolve();
      waiters.clear();
    };
  } else if (framework === "vue") {
    const state = shallowReactive({ content: initial as EditorContent, editable: true });
    updateContent = (content) => {
      state.content = content;
    };
    updateEditable = (editable) => {
      state.editable = editable;
    };
    settle = async () => {
      await nextTick();
    };
    const app = createApp({
      render: () =>
        h(VueEditor, { content: state.content, editable: state.editable, outline: false, onChange, onReady, onError }),
    });
    app.mount(host);
    dispose = () => app.unmount();
  } else {
    dispose = render(() => {
      const [state, setState] = createSignal({ content: initial as EditorContent, editable: true });
      updateContent = (content) => setState((previous) => ({ ...previous, content }));
      updateEditable = (editable) => setState((previous) => ({ ...previous, editable }));
      return createComponent(SolidEditor, {
        get content() {
          return state().content;
        },
        get editable() {
          return state().editable;
        },
        outline: false,
        onChange,
        onReady,
        onError,
      });
    }, host);
  }
  await ready;
  if (!controller) throw new Error("框架控制器未就绪");
  window.sequencePasteFramework = {
    controller,
    changes,
    errors,
    events,
    undoResults,
    armUndo: () => {
      undoNext = true;
    },
    setContent: (content) => updateContent(content),
    setEditable: (editable) => updateEditable(editable),
    settle: () => settle(),
    destroy() {
      destroyed = true;
      dispose();
      host.remove();
    },
  };
};
