import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, shallowRef } from "vue";

import { createEditor, type ContentPickerProvider, type EditorController } from "../../../packages/core/src/index";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

type Mode = "core" | "react" | "vue" | "solid";
declare global {
  interface Window {
    yuqueEditor?: EditorController;
    yuqueMount(mode: Mode, enabled: boolean): void;
    yuqueReplace(enabled: boolean): void;
    yuqueSetContent(content: string): void;
    yuqueDestroy(): void;
    yuquePending: Array<{
      signal: AbortSignal;
      resolve: (value: readonly { id: string; title: string; href: string; kind: "document" | "table" }[]) => void;
    }>;
  }
}
window.yuqueMount = (mode, enabled) => {
  window.yuquePending = [];
  const provider: ContentPickerProvider = {
    search: async (query, signal) => {
      if (query === "pending") return await new Promise((resolve) => window.yuquePending.push({ signal, resolve }));
      if (query === "unsafe") return [{ id: "unsafe", title: "不安全", kind: "document", href: "javascript:alert(1)" }];
      return [{ id: "doc", title: "测试文档", kind: "document", href: "https://example.invalid/doc" }];
    },
    resolveLink: async (link) =>
      link === "table"
        ? { id: "table", title: "测试表格", kind: "table", href: "https://example.invalid/table" }
        : null,
  };
  const root = document.querySelector<HTMLElement>("#editor")!;
  const props = {
    content: "<p></p>",
    toolbar: true,
    yuqueContentProvider: enabled ? provider : null,
    onReady: (editor: EditorController) => {
      window.yuqueEditor = editor;
    },
  };
  if (mode === "core") {
    window.yuqueEditor = createEditor({ element: root, ...props });
    window.yuqueReplace = (active) =>
      window.yuqueEditor!.setIntegrations({ yuqueContentProvider: active ? provider : null });
    window.yuqueSetContent = (content) => window.yuqueEditor!.setContent(content);
    window.yuqueDestroy = () => window.yuqueEditor!.destroy();
  } else if (mode === "react") {
    const app = createRoot(root);
    let state = { active: enabled, content: "<p></p>" };
    const paint = () =>
      app.render(
        createElement(ReactEditor, {
          ...props,
          content: state.content,
          yuqueContentProvider: state.active ? provider : null,
        }),
      );
    paint();
    window.yuqueReplace = (active) => {
      state = { ...state, active };
      paint();
    };
    window.yuqueSetContent = (content) => {
      state = { ...state, content };
      paint();
    };
    window.yuqueDestroy = () => app.unmount();
  } else if (mode === "vue") {
    const current = shallowRef({ active: enabled, content: "<p></p>" });
    const app = createApp({
      render: () =>
        h(VueEditor, {
          ...props,
          content: current.value.content,
          yuqueContentProvider: current.value.active ? provider : null,
        }),
    });
    app.mount(root);
    window.yuqueReplace = (active) => {
      current.value = { ...current.value, active };
    };
    window.yuqueSetContent = (content) => {
      current.value = { ...current.value, content };
    };
    window.yuqueDestroy = () => app.unmount();
  } else {
    const [current, setCurrent] = createSignal({ active: enabled, content: "<p></p>" });
    const dispose = render(
      () =>
        createComponent(SolidEditor, {
          ...props,
          get content() {
            return current().content;
          },
          get yuqueContentProvider() {
            return current().active ? provider : null;
          },
        }),
      root,
    );
    window.yuqueReplace = (active) => setCurrent((value) => ({ ...value, active }));
    window.yuqueSetContent = (content) => setCurrent((value) => ({ ...value, content }));
    window.yuqueDestroy = dispose;
  }
};
