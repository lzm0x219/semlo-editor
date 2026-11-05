import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, shallowRef, type App } from "vue";

import {
  createEditor,
  type EditorController,
  type InteractiveCardHost,
  type InteractiveInsertOptions,
} from "../../../packages/core/src/index";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

type Mode = "core" | "react" | "vue" | "solid";
type Report = Parameters<InteractiveInsertOptions["onAbandoned"]>[0];
const makeHost = (name: string): InteractiveCardHost => ({
  createActivity: (_config, _from, signal) =>
    new Promise((resolve, reject) =>
      window.__semloRequireFixture("activityPending").push({ name, signal, resolve, reject }),
    ),
  verifyConfiguration: async () => true,
  syncConfiguration: async () => {},
  checkin: { getStatus: async () => ({ checkedIn: name === "second" }), checkIn: async () => ({ checkedIn: true }) },
  vote: {
    getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
    submitVote: async (_id, ids) => ({ canVote: false, selectedOptionIds: ids }),
  },
});
declare global {
  interface Window {
    publicEditor?: EditorController;
    activityPending?: Array<{
      name: string;
      signal: AbortSignal;
      resolve: (value: { cardId: string }) => void;
      reject: (error: Error) => void;
    }>;
    activityReports?: Array<{ cardId: string; callback: string; reason: string }>;
    publicMount?(mode: Mode, enabled: boolean): void;
    publicReplace?(enabled: boolean): void;
    publicDestroy?(): void;
  }
}
window.publicMount = (mode, enabled) => {
  window.activityPending = [];
  window.activityReports = [];
  const first = makeHost("first"),
    second = makeHost("second");
  const callback = (name: string) => (value: Report) =>
    window
      .__semloRequireFixture("activityReports")
      .push({ cardId: value.cardId, callback: name, reason: value.reason });
  const original = callback("first"),
    next = callback("second");
  const root = document.querySelector<HTMLElement>("#editor")!;
  const props = {
    content: "<p></p>",
    toolbar: true,
    interactiveCardHost: enabled ? first : null,
    onInteractiveCardAbandoned: enabled ? original : undefined,
    onReady: (controller: EditorController) => {
      window.publicEditor = controller;
    },
  };
  if (mode === "core") {
    window.publicEditor = createEditor({ element: root, ...props });
    window.publicReplace = (active) =>
      window.__semloRequireFixture("publicEditor").setIntegrations({
        interactiveCardHost: active ? second : null,
        onInteractiveCardAbandoned: active ? next : undefined,
      });
    window.publicDestroy = () => window.__semloRequireFixture("publicEditor").destroy();
  } else if (mode === "react") {
    const app: Root = createRoot(root);
    const paint = (active: boolean, initial = false) =>
      app.render(
        createElement(ReactEditor, {
          ...props,
          interactiveCardHost: active ? (initial ? first : second) : null,
          onInteractiveCardAbandoned: active ? (initial ? original : next) : undefined,
        }),
      );
    paint(enabled, true);
    window.publicReplace = (active) => paint(active);
    window.publicDestroy = () => app.unmount();
  } else if (mode === "vue") {
    const current = shallowRef({ host: enabled ? first : null, callback: enabled ? original : undefined });
    const app: App = createApp({
      render: () =>
        h(VueEditor, {
          ...props,
          interactiveCardHost: current.value.host,
          onInteractiveCardAbandoned: current.value.callback,
        }),
    });
    app.mount(root);
    window.publicReplace = (active) => {
      current.value = { host: active ? second : null, callback: active ? next : undefined };
    };
    window.publicDestroy = () => app.unmount();
  } else {
    const [current, setCurrent] = createSignal({
      host: enabled ? first : null,
      callback: enabled ? original : undefined,
    });
    const dispose = render(
      () =>
        createComponent(SolidEditor, {
          ...props,
          get interactiveCardHost() {
            return current().host;
          },
          get onInteractiveCardAbandoned() {
            return current().callback;
          },
        }),
      root,
    );
    window.publicReplace = (active) =>
      setCurrent({ host: active ? second : null, callback: active ? next : undefined });
    window.publicDestroy = dispose;
  }
};
