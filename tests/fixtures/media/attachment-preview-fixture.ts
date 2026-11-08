import {
  createEditor,
  type AttachmentInfo,
  type AttachmentPreviewResolver,
  type EditorContent,
  type EditorController,
} from "@semlo-editor/core";
import { SemloEditor as ReactEditor } from "@semlo-editor/react";
import { SemloEditor as SolidEditor } from "@semlo-editor/solid";
import { SemloEditor as VueEditor } from "@semlo-editor/vue";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, shallowRef } from "vue";

type Mode = "core" | "react" | "vue" | "solid";
type Behavior = "ok" | "null" | "undefined" | "unsafe" | "throw" | "promise";
export const attachmentDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "文件 " },
        {
          type: "semloEditorAttachment",
          attrs: {
            href: "https://semlo-preview.invalid/files/fixture.pdf",
            name: "附件样本.pdf",
            size: 655,
            mimeType: "application/pdf",
          },
        },
        { type: "text", text: " 后文" },
      ],
    },
  ],
};
declare global {
  interface Window {
    attachmentEditor: EditorController;
    attachmentSecond: EditorController;
    attachmentErrors: string[];
    attachmentCalls: { version: string; info: AttachmentInfo }[];
    attachmentBehavior: Behavior;
    attachmentOnResolve?: () => void;
    attachmentMount(mode: Mode, enabled?: boolean, controlled?: boolean): void;
    attachmentUpdate(version: "a" | "b" | null): Promise<void>;
    attachmentReadonly(value: boolean): Promise<void>;
    attachmentSetContent(content: EditorContent): Promise<void>;
    attachmentDestroy(): void;
    attachmentCreateSecond(): void;
    attachmentChanges: number;
  }
}

window.attachmentMount = (mode, enabled = true, controlled = false) => {
  const root = document.querySelector<HTMLElement>("#editor")!;
  window.attachmentErrors = [];
  window.attachmentCalls = [];
  window.attachmentBehavior = "ok";
  window.attachmentOnResolve = undefined;
  window.attachmentChanges = 0;
  const resolver =
    (version: string): AttachmentPreviewResolver =>
    (info) => {
      window.attachmentCalls.push({ version, info });
      window.attachmentOnResolve?.();
      switch (window.attachmentBehavior) {
        case "null":
          return null;
        case "undefined":
          return undefined;
        case "unsafe":
          return "javascript:window.attachmentUnsafe=true";
        case "promise":
          return Promise.resolve("https://semlo-preview.invalid/late") as unknown as string;
        case "throw":
          throw new Error("宿主预览失败");
        default:
          return `https://semlo-preview.invalid/viewer/${version}?file=${encodeURIComponent(info.href)}`;
      }
    };
  const a = resolver("a"),
    b = resolver("b");
  type State = { resolve: AttachmentPreviewResolver | null; content: EditorContent; editable: boolean };
  let state: State = { resolve: enabled ? a : null, content: attachmentDocument, editable: true };
  let changeState: (value: Partial<State>) => Promise<void> = async () => {};
  const props = {
    toolbar: false,
    outline: false,
    onReady: (controller: EditorController) => {
      window.attachmentEditor = controller;
    },
    onError: (error: Error) => {
      window.attachmentErrors.push(error.message);
    },
    onChange: (snapshot: { json: EditorContent }) => {
      window.attachmentChanges++;
      if (controlled) void changeState({ content: snapshot.json });
    },
  };
  if (mode === "core") {
    window.attachmentEditor = createEditor({
      ...props,
      element: root,
      content: state.content,
      resolveAttachmentPreview: state.resolve,
    });
    changeState = async (next) => {
      state = { ...state, ...next };
      if ("resolve" in next) window.attachmentEditor.setIntegrations({ resolveAttachmentPreview: state.resolve });
      if ("content" in next) window.attachmentEditor.setContent(state.content);
      if ("editable" in next) window.attachmentEditor.setEditable(state.editable);
    };
    window.attachmentDestroy = () => window.attachmentEditor.destroy();
  } else if (mode === "react") {
    const app = createRoot(root);
    const paint = () =>
      app.render(
        createElement(ReactEditor, {
          ...props,
          content: state.content,
          editable: state.editable,
          resolveAttachmentPreview: state.resolve,
        }),
      );
    paint();
    changeState = async (next) => {
      state = { ...state, ...next };
      flushSync(paint);
    };
    window.attachmentDestroy = () => app.unmount();
  } else if (mode === "vue") {
    const current = shallowRef(state);
    const app = createApp({
      render: () =>
        h(VueEditor, {
          ...props,
          content: current.value.content,
          editable: current.value.editable,
          resolveAttachmentPreview: current.value.resolve,
        }),
    });
    app.mount(root);
    changeState = async (next) => {
      state = { ...state, ...next };
      current.value = state;
      await nextTick();
    };
    window.attachmentDestroy = () => app.unmount();
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
          get resolveAttachmentPreview() {
            return current().resolve;
          },
        }),
      root,
    );
    changeState = async (next) => {
      state = { ...state, ...next };
      setCurrent(state);
    };
    window.attachmentDestroy = dispose;
  }
  window.attachmentUpdate = (version) => changeState({ resolve: version === "a" ? a : version === "b" ? b : null });
  window.attachmentReadonly = (value) => changeState({ editable: !value });
  window.attachmentSetContent = (content) => changeState({ content });
  window.attachmentCreateSecond = () => {
    const host = document.createElement("div");
    host.id = "second";
    root.after(host);
    window.attachmentSecond = createEditor({
      ...props,
      element: host,
      content: attachmentDocument,
      resolveAttachmentPreview: b,
    });
  };
};
