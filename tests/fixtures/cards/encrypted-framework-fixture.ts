import "../../../packages/core/src/styles/style.css";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, shallowReactive } from "vue";

import type { EncryptedTextProvider } from "../../../packages/core/src/features/cards/encrypted-text";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

const provider: EncryptedTextProvider = {
  async encrypt({ plaintext }) {
    return btoa(plaintext);
  },
  async decrypt({ ciphertext }) {
    return atob(ciphertext);
  },
};
Reflect.set(window, "mountEncryptedFramework", (framework: "react" | "vue" | "solid") => {
  const host = document.createElement("div");
  host.id = "framework-encrypted";
  document.body.append(host);
  let setProvider: (next: EncryptedTextProvider | null) => void;
  let markReady!: (value: unknown) => void;
  const ready = new Promise((resolve) => {
    markReady = resolve;
  });
  if (framework === "react") {
    const root = createRoot(host);
    function Component() {
      const [value, setValue] = useState<EncryptedTextProvider | null>(null);
      setProvider = setValue;
      return createElement(ReactEditor, { encryptedTextProvider: value, onReady: markReady });
    }
    root.render(createElement(Component));
  } else if (framework === "vue") {
    const state = shallowReactive<{ value: EncryptedTextProvider | null }>({ value: null });
    setProvider = (next) => {
      state.value = next;
    };
    createApp({ render: () => h(VueEditor, { encryptedTextProvider: state.value, onReady: markReady }) }).mount(host);
  } else {
    render(() => {
      const [value, setValue] = createSignal<EncryptedTextProvider | null>(null);
      setProvider = setValue;
      return createComponent(SolidEditor, {
        get encryptedTextProvider() {
          return value();
        },
        onReady: markReady,
      });
    }, host);
  }
  return ready.then((controller) => ({
    controller,
    enable: () => setProvider(provider),
    disable: () => setProvider(null),
  }));
});
