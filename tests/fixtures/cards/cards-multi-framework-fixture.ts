import "../../../packages/core/src/styles/style.css";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, reactive } from "vue";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

type Framework = "react" | "vue" | "solid";
type Instance = { controller: EditorController; setContent(value: EditorContent): void; destroy(): void };
declare global {
  interface Window {
    mountMultiCardFramework?: (framework: Framework) => Promise<void>;
    multiCardFrameworks?: Instance[];
    settleMultiCardFramework?: () => Promise<void>;
  }
}

function content(name: string): EditorContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: `${name}正文` }] },
      { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { id: "same-date", date: "2026-11-03" } }] },
      {
        type: "semloEditorCalendar",
        attrs: {
          events: [
            { id: "same", title: `${name}日程`, start: "2026-11-05", end: "2026-11-05", description: "", color: 0 },
          ],
        },
      },
    ],
  };
}

window.settleMultiCardFramework = async () => {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};
window.mountMultiCardFramework = async (framework) => {
  window.multiCardFrameworks = [];
  for (const name of ["甲", "乙"]) {
    const host = document.createElement("div");
    host.dataset.editorName = name;
    host.style.width = "850px";
    document.body.append(host);
    let controller: EditorController | undefined;
    let setContent: (value: EditorContent) => void = () => {
      throw new Error("Editor is not ready");
    };
    let dispose = () => {};
    let ready!: () => void;
    const mounted = new Promise<void>((resolve) => (ready = resolve));
    const onReady = (value: EditorController) => {
      controller = value;
      ready();
    };
    if (framework === "react") {
      function App() {
        const [value, setValue] = useState<EditorContent>(() => content(name));
        setContent = (next) => setValue(() => next);
        return createElement(ReactEditor, { content: value, outline: false, onReady });
      }
      const root = createRoot(host);
      root.render(createElement(App));
      dispose = () => root.unmount();
    } else if (framework === "vue") {
      const state = reactive<{ content: EditorContent }>({ content: content(name) });
      setContent = (next) => {
        state.content = next;
      };
      const app = createApp({ render: () => h(VueEditor, { content: state.content, outline: false, onReady }) });
      app.mount(host);
      dispose = () => app.unmount();
    } else {
      dispose = render(() => {
        const [value, setValue] = createSignal<EditorContent>(content(name));
        setContent = (next) => setValue(() => next);
        return createComponent(SolidEditor, {
          get content() {
            return value();
          },
          outline: false,
          onReady,
        });
      }, host);
    }
    await mounted;
    if (!controller) throw new Error("Missing editor controller");
    window.multiCardFrameworks.push({ controller, setContent: (next) => setContent(next), destroy: dispose });
  }
  await window.settleMultiCardFramework!();
};
