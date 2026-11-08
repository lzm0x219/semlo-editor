import { captureHeadingFoldRevision, createEditor } from "@semlo-editor/core";
import type {
  EditorContent,
  EditorController,
  HeadingFoldPreferencesAdapter,
  HeadingFoldRevisionCapture,
} from "@semlo-editor/core";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h } from "vue";

import { captureHeadingFoldRevision as captureFromDist } from "../../../packages/core/dist/index.js";
import { SemloEditor as ReactEditor } from "../../../packages/react/dist/index.js";
import { SemloEditor as SolidEditor } from "../../../packages/solid/dist/index.js";
import { SemloEditor as VueEditor } from "../../../packages/vue/dist/index.js";

import "../../../demo/editor.css";

type Instance = { controller: EditorController; destroy(): void };
declare global {
  interface Window {
    mountFoldFramework?: (
      framework: string,
      adapter: HeadingFoldPreferencesAdapter,
      content?: EditorContent,
    ) => Promise<Instance>;
    captureFoldFramework?: () => HeadingFoldRevisionCapture | null;
    foldFramework?: Instance;
  }
}
window.captureFoldFramework = () => {
  if (captureHeadingFoldRevision !== captureFromDist) throw new Error("框架没有使用核心包构建入口");
  return window.foldFramework ? captureHeadingFoldRevision(window.foldFramework.controller) : null;
};
window.mountFoldFramework = async (framework, adapter, content = "<h1>标题</h1><p>正文</p>") => {
  const host = document.createElement("div");
  host.id = "fold-framework";
  document.body.append(host);
  let destroy = () => {};
  const controller = await new Promise<EditorController>((resolve, reject) => {
    const props = {
      content,
      headingFoldPreferences: adapter,
      onReady: resolve,
      onError: reject,
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
    } else if (framework === "solid") destroy = render(() => createComponent(SolidEditor, props), host);
    else reject(new Error(`Unknown framework: ${framework}`));
  });
  return (window.foldFramework = {
    controller,
    destroy() {
      destroy();
      host.remove();
    },
  });
};
