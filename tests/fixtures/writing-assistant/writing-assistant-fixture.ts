import {
  createEditor,
  getWritingAssistant,
  type EditorContent,
  type EditorController,
  type WritingRequest,
  type WritingResult,
  type WritingService,
  type WritingFeedbackRequest,
  type WritingFeedbackService,
} from "@semlo-editor/core";
import { SemloEditor as ReactEditor } from "@semlo-editor/react";
import { SemloEditor as SolidEditor } from "@semlo-editor/solid";
import { SemloEditor as VueEditor } from "@semlo-editor/vue";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createElement, useEffect, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, shallowRef } from "vue";

type Mode = "core" | "react" | "vue" | "solid";
type Pending = {
  request: WritingRequest;
  version: string;
  resolve(value: WritingResult): void;
  reject(error: Error): void;
};
type PendingFeedback = {
  request: WritingFeedbackRequest;
  version: string;
  resolve(): void;
  reject(error: Error): void;
};
declare global {
  interface Window {
    writingEditor: EditorController;
    writingEditors: EditorController[];
    writingPending: Pending[];
    writingFeedbackPending: PendingFeedback[];
    writingErrors: string[];
    writingChanges: number;
    writingMount(
      mode: Mode,
      enabled?: boolean,
      controlled?: boolean,
      custom?: boolean,
      feedbackEnabled?: boolean,
    ): void;
    writingUpdate(version: "a" | "b" | null): void;
    writingUpdateFeedback(version: "a" | "b" | null): void;
    writingReadonly(value: boolean): void;
    writingSetContent(value: EditorContent): void;
    writingDestroy(): void;
    writingAssistant: typeof getWritingAssistant;
    writingHost(action: "reject" | "rewrite" | "provider" | "readonly" | "reenter" | "none"): void;
    writingSecond(): void;
    writingCommitVersion: number;
    writingCommitted: { version: number; content: EditorContent } | null;
    writingUndoOnCommit: string | null;
    writingCommitUndo: boolean | null;
  }
}
window.writingAssistant = getWritingAssistant;
window.writingMount = (mode, enabled = true, controlled = false, custom = false, feedbackEnabled = false) => {
  window.writingPending = [];
  window.writingFeedbackPending = [];
  window.writingErrors = [];
  window.writingChanges = 0;
  window.writingCommitVersion = 0;
  window.writingCommitted = null;
  window.writingUndoOnCommit = null;
  window.writingCommitUndo = null;
  window.writingEditors = [];
  const root = document.querySelector<HTMLElement>("#editor")!;
  const service =
    (version: string): WritingService =>
    (request) =>
      new Promise((resolve, reject) => {
        window.writingPending.push({ request, version, resolve, reject });
      });
  const a = service("a"),
    b = service("b");
  const feedbackService =
    (version: string): WritingFeedbackService =>
    (request) =>
      new Promise((resolve, reject) => {
        window.writingFeedbackPending.push({ request, version, resolve, reject });
      });
  const feedbackA = feedbackService("a"),
    feedbackB = feedbackService("b");
  type State = {
    service: WritingService | null;
    feedback: WritingFeedbackService | null;
    content: EditorContent;
    editable: boolean;
  };
  let state: State = {
    service: enabled ? a : null,
    feedback: feedbackEnabled ? feedbackA : null,
    content: "<p>原文</p>",
    editable: true,
  };
  let changeState: (value: Partial<State>) => void = () => {};
  const props = {
    outline: false,
    toolbar: custom
      ? ({ element, controller }: { element: HTMLElement; controller: EditorController }) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "自定义写作";
          button.addEventListener("click", () => getWritingAssistant(controller.editor)?.open());
          element.append(button);
        }
      : true,
    onReady: (editor: EditorController) => {
      window.writingEditor = editor;
      window.writingEditors[0] = editor;
    },
    onError: (error: Error) => {
      window.writingErrors.push(error.message);
    },
    onChange: (snapshot: { json: EditorContent }) => {
      window.writingChanges++;
      if (controlled) changeState({ content: snapshot.json });
    },
  };
  if (mode === "core") {
    window.writingEditor = createEditor({
      element: root,
      ...props,
      ...state,
      writingService: state.service,
      writingFeedback: state.feedback,
    });
    window.writingEditors[0] = window.writingEditor;
    changeState = (value) => {
      state = { ...state, ...value };
      if ("service" in value || "feedback" in value)
        window.writingEditor.setIntegrations({ writingService: state.service, writingFeedback: state.feedback });
      if ("content" in value) window.writingEditor.setContent(state.content);
      if ("editable" in value) window.writingEditor.setEditable(state.editable);
    };
    window.writingDestroy = () => {
      for (const editor of window.writingEditors) editor.destroy();
    };
  } else if (mode === "react") {
    const app = createRoot(root);
    const Host = (current: State & { version: number }) => {
      useLayoutEffect(() => {
        const expected = window.writingUndoOnCommit;
        if (expected && window.writingEditor.getSnapshot().text === expected) {
          window.writingUndoOnCommit = null;
          window.writingCommitUndo = window.writingEditor.editor.commands.undo();
        }
      });
      useEffect(() => {
        window.writingCommitted = { version: current.version, content: current.content };
      });
      return createElement(ReactEditor, {
        ...props,
        content: current.content,
        editable: current.editable,
        writingService: current.service,
        writingFeedback: current.feedback,
      });
    };
    const paint = () => {
      app.render(createElement(Host, { ...state, version: ++window.writingCommitVersion }));
    };
    changeState = (value) => {
      state = { ...state, ...value };
      paint();
    };
    paint();
    window.writingDestroy = () => app.unmount();
  } else if (mode === "vue") {
    const current = shallowRef(state);
    const app = createApp({
      render: () =>
        h(VueEditor, {
          ...props,
          content: current.value.content,
          editable: current.value.editable,
          writingService: current.value.service,
          writingFeedback: current.value.feedback,
        }),
    });
    changeState = (value) => {
      state = { ...state, ...value };
      current.value = state;
    };
    app.mount(root);
    window.writingDestroy = () => app.unmount();
  } else {
    const [current, setCurrent] = createSignal(state);
    const dispose = render(
      () =>
        createComponent(SolidEditor, {
          ...props,
          get content() {
            return current().content;
          },
          get editable() {
            return current().editable;
          },
          get writingService() {
            return current().service;
          },
          get writingFeedback() {
            return current().feedback;
          },
        }),
      root,
    );
    changeState = (value) => {
      state = { ...state, ...value };
      setCurrent(state);
    };
    window.writingDestroy = dispose;
  }
  window.writingUpdate = (version) => changeState({ service: version === "a" ? a : version === "b" ? b : null });
  window.writingUpdateFeedback = (version) =>
    changeState({ feedback: version === "a" ? feedbackA : version === "b" ? feedbackB : null });
  window.writingReadonly = (value) => changeState({ editable: !value });
  window.writingSetContent = (content) => changeState({ content });
  window.writingSecond = () => {
    const host = document.createElement("div");
    host.id = "second";
    root.after(host);
    window.writingEditors[1] = createEditor({
      element: host,
      content: "<p>实例二</p>",
      writingService: b,
      writingFeedback: feedbackEnabled ? feedbackB : null,
      outline: false,
    });
  };
  const guardKey = new PluginKey("writingHostTest");
  let before: ((event: { transaction: import("@tiptap/pm/state").Transaction }) => void) | undefined;
  window.writingHost = (action) => {
    const editor = window.writingEditor.editor;
    editor.unregisterPlugin(guardKey);
    if (before) editor.off("beforeTransaction", before);
    before = undefined;
    if (action === "reject" || action === "rewrite")
      editor.registerPlugin(
        new Plugin({
          key: guardKey,
          filterTransaction: (transaction) =>
            action !== "reject" || !transaction.getMeta("semloEditorWritingAssistantAccept"),
          appendTransaction: (transactions, _old, state) => {
            if (
              action === "rewrite" &&
              transactions.some((transaction) => transaction.getMeta("semloEditorWritingAssistantAccept"))
            )
              return state.tr.replaceWith(
                0,
                state.doc.content.size,
                state.schema.nodes.paragraph.create(null, state.schema.text("宿主改写")),
              );
            return null;
          },
        }),
      );
    if (["provider", "readonly", "reenter"].includes(action)) {
      before = ({ transaction }) => {
        if (!transaction.getMeta("semloEditorWritingAssistantAccept")) return;
        if (action === "provider") window.writingUpdate("b");
        else if (action === "readonly") window.writingReadonly(true);
        else {
          if (getWritingAssistant(editor)?.accept() !== "busy") throw new Error("重入接纳未被阻止");
          window.writingEditor.setContent("<p>重入覆盖</p>");
        }
      };
      editor.on("beforeTransaction", before);
    }
  };
};
