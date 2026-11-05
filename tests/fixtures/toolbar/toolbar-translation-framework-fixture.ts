import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, shallowReactive } from "vue";

import { createEditor } from "../../../packages/core/src/editor/create-editor";
import type { EditorController } from "../../../packages/core/src/types";
import type { TranslationService } from "../../../packages/core/src/ui/toolbar/translation";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

import "../../../demo/editor.css";

const requests: { signal: AbortSignal; resolve(value: string): void }[] = [];
const services: Record<string, TranslationService | undefined> = {
  pending: ({ signal }) => new Promise((resolve) => requests.push({ signal, resolve })),
  fast: async () => "translated",
  fail: async () => {
    throw new Error("service failed");
  },
  none: undefined,
};
let current:
  | { controller: EditorController; setService(value: TranslationService | undefined): void; destroy(): void }
  | undefined;

Object.assign(window, {
  translationFramework: {
    async mount(framework: string) {
      current?.destroy();
      requests.length = 0;
      const host = document.createElement("div");
      host.id = "translation-framework-host";
      document.body.append(host);
      let destroy = () => {};
      let setService: (value: TranslationService | undefined) => void = () => {};
      const controller = await new Promise<EditorController>((resolve) => {
        const props = { content: "<p>测试文字</p>", outline: false, onReady: resolve };
        if (framework === "core") {
          const editor = createEditor({ element: host, ...props });
          setService = (translate) => editor.setIntegrations({ translate });
          destroy = () => editor.destroy();
          resolve(editor);
        } else if (framework === "react") {
          const root = createRoot(host);
          destroy = () => root.unmount();
          function Fixture() {
            const [service, set] = useState<TranslationService | undefined>();
            setService = (next) => set(() => next);
            return createElement(ReactEditor, { ...props, translate: service });
          }
          root.render(createElement(Fixture));
        } else if (framework === "vue") {
          const state = shallowReactive<{ service?: TranslationService }>({});
          setService = (next) => {
            state.service = next;
          };
          const app = createApp({ render: () => h(VueEditor, { ...props, translate: state.service }) });
          destroy = () => app.unmount();
          app.mount(host);
        } else {
          destroy = render(() => {
            const [service, set] = createSignal<TranslationService | undefined>();
            setService = (next) => set(() => next);
            return createComponent(SolidEditor, {
              ...props,
              get translate() {
                return service();
              },
            });
          }, host);
        }
      });
      current = {
        controller,
        setService,
        destroy: () => {
          destroy();
          host.remove();
        },
      };
    },
    setService(mode: string) {
      current?.setService(services[mode]);
    },
    select() {
      current?.controller.editor.commands.setTextSelection({ from: 1, to: 5 });
    },
    setEditable(value: boolean) {
      current?.controller.setEditable(value);
    },
    requests: () => requests.map(({ signal }) => ({ aborted: signal.aborted })),
    resolve(index: number, value: string) {
      requests[index]?.resolve(value);
    },
    snapshot: () => current?.controller.getSnapshot().text,
    destroy: () => current?.destroy(),
  },
});
