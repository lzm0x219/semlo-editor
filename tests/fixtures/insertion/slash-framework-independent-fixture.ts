import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, reactive } from "vue";

import type { EditorController } from "../../../packages/core/src/types";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

import "../../../demo/editor.css";
const editors: Record<string, EditorController> = {};
const changes: Record<string, string[]> = {};
const disposers: Array<() => void> = [];
const initial = "<p>前文</p><p></p><p>乙</p>";
async function mount(name: string, id: string) {
  const host = document.createElement("div");
  host.id = id;
  document.body.append(host);
  changes[id] = [];
  await new Promise<void>((resolve) => {
    const common = {
      outline: false,
      onReady: (editor: EditorController) => {
        editors[id] = editor;
        resolve();
      },
    };
    if (name === "react") {
      const root = createRoot(host);
      function Fixture() {
        const [content, setContent] = useState(initial);
        return createElement(ReactEditor, {
          ...common,
          content,
          onChange: (s) => {
            changes[id].push(s.html);
            setContent(s.html);
          },
        });
      }
      root.render(createElement(Fixture));
      disposers.push(() => {
        root.unmount();
        host.remove();
      });
    } else if (name === "vue") {
      const state = reactive({ content: initial });
      const app = createApp({
        render: () =>
          h(VueEditor, {
            ...common,
            content: state.content,
            onChange: (s: { html: string }) => {
              changes[id].push(s.html);
              state.content = s.html;
            },
          }),
      });
      app.mount(host);
      disposers.push(() => {
        app.unmount();
        host.remove();
      });
    } else {
      const dispose = render(() => {
        const [content, setContent] = createSignal(initial);
        return createComponent(SolidEditor, {
          ...common,
          get content() {
            return content();
          },
          onChange: (s) => {
            changes[id].push(s.html);
            setContent(s.html);
          },
        });
      }, host);
      disposers.push(() => {
        dispose();
        host.remove();
      });
    }
  });
}
Object.assign(window, {
  slashFrameworkIndependent: {
    mount,
    html: (id: string) => editors[id].editor.getHTML(),
    snapshot: (id: string) => editors[id].getSnapshot().html,
    changes: (id: string) => changes[id],
    dispose: () => disposers.splice(0).forEach((dispose) => dispose()),
  },
});
