import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h } from "vue";

import { createEditor } from "../../../packages/core/src/editor/create-editor";
import type { EditorController } from "../../../packages/core/src/types";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

type Framework = "core" | "react" | "vue" | "solid";
type Request = { name: string; signal: AbortSignal; resolve: (url: string) => void };
declare global {
  interface Window {
    uploadAbortFramework?: {
      mount(framework: Framework): Promise<void>;
      controller(): EditorController;
      requests(): Request[];
      destroy(): void;
    };
  }
}

let current: { controller: EditorController; destroy(): void } | undefined;
const requests: Request[] = [];
window.uploadAbortFramework = {
  async mount(framework) {
    current?.destroy();
    requests.length = 0;
    const host = document.createElement("div");
    host.id = "upload-abort-framework";
    document.body.replaceChildren(host);
    const upload = (file: File, context?: { signal: AbortSignal }) => {
      if (!context) throw new Error("upload signal missing");
      return new Promise<string>((resolve) => requests.push({ name: file.name, signal: context.signal, resolve }));
    };
    let destroy = () => {};
    const controller = await new Promise<EditorController>((resolve) => {
      const props = {
        content: "<p>content</p>",
        outline: false,
        uploadImage: upload,
        uploadAttachment: upload,
        onReady: resolve,
      };
      if (framework === "core") {
        const editor = createEditor({ element: host, ...props });
        destroy = () => editor.destroy();
        resolve(editor);
      } else if (framework === "react") {
        const root = createRoot(host);
        destroy = () => root.unmount();
        root.render(createElement(ReactEditor, props));
      } else if (framework === "vue") {
        const app = createApp({ render: () => h(VueEditor, props) });
        destroy = () => app.unmount();
        app.mount(host);
      } else {
        destroy = render(() => createComponent(SolidEditor, props), host);
      }
    });
    current = {
      controller,
      destroy: () => {
        destroy();
        host.remove();
      },
    };
  },
  controller() {
    if (!current) throw new Error("framework fixture missing");
    return current.controller;
  },
  requests: () => requests,
  destroy() {
    current?.destroy();
    current = undefined;
  },
};
