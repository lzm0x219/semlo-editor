import type { JSONContent } from "@tiptap/core";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, reactive, shallowReactive } from "vue";

import type { EditorController, EditorOptions, MentionItem, MentionSearch } from "../../../packages/core/src/types";
import { SemloEditor as ReactEditor } from "../../../packages/react/dist/index.js";
import { SemloEditor as SolidEditor } from "../../../packages/solid/dist/index.js";
import { SemloEditor as VueEditor } from "../../../packages/vue/dist/index.js";

import "../../../packages/core/dist/style.css";
const seed = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "semloEditorStatus", attrs: { label: "初始", color: 0 } },
        { type: "text", text: " " },
        { type: "semloEditorFormula", attrs: { id: "controlled", latex: "x^2" } },
      ],
    },
    {
      type: "semloEditorColumns",
      content: [
        { type: "semloEditorColumn", content: [{ type: "paragraph" }] },
        { type: "semloEditorColumn", content: [{ type: "paragraph" }] },
      ],
    },
  ],
};
function requireHost(id: string) {
  const host = document.getElementById(id);
  if (!host) throw new Error(`Missing fixture host: ${id}`);
  return host;
}
const copy = () => JSON.parse(JSON.stringify(seed));
const uploadAttachment = async (file: File) => URL.createObjectURL(file);
const people: MentionItem[] = [{ id: "controlled-person", label: "测试用户", kind: "person" }];
const searchMentions: MentionSearch = (query) => people.filter((item) => item.label.includes(query));
function ControlledReact() {
  const [content, setContent] = useState(copy);
  return createElement(ReactEditor, { content, uploadAttachment, searchMentions, onChange: (s) => setContent(s.json) });
}
createRoot(requireHost("react")).render(createElement(ControlledReact));
const state = shallowReactive({ content: copy() });
createApp({
  render: () =>
    h(VueEditor, {
      content: state.content,
      uploadAttachment,
      searchMentions,
      onChange: (s) => {
        state.content = s.json;
      },
    }),
}).mount("#vue");
render(() => {
  const [content, setContent] = createSignal(copy());
  return createComponent(SolidEditor, {
    get content() {
      return content();
    },
    uploadAttachment,
    searchMentions,
    onChange: (s) => setContent(s.json),
  });
}, requireHost("solid"));

// A separate editor lets browser tests exercise callback prop changes without
// changing the controlled-content fixtures above.
window.mountDynamicEditor = async (framework) => {
  const host = document.createElement("div");
  host.id = "dynamic-editor";
  document.body.prepend(host);
  type Integrations = Pick<
    EditorOptions,
    "content" | "uploadImage" | "uploadAttachment" | "searchMentions" | "currentUser" | "databaseAiFill"
  >;
  let update: (next: Integrations) => void = () => {
    throw new Error("Dynamic editor is not mounted");
  };
  let dispose: () => void = () => {
    throw new Error("Dynamic editor is not mounted");
  };
  const errors: string[] = [];
  let markReady: (editor: EditorController) => void = () => {
    throw new Error("Ready callback is not initialized");
  };
  const ready = new Promise<EditorController>((resolve) => (markReady = resolve));
  const onReady = (editor: EditorController) => markReady(editor);
  const onError = (error: Error) => errors.push(error.message);
  if (framework === "react") {
    function DynamicReact() {
      const [integrations, setIntegrations] = useState<Integrations>({});
      update = (next) => setIntegrations(next);
      return createElement(ReactEditor, { ...integrations, onReady, onError });
    }
    const root = createRoot(host);
    root.render(createElement(DynamicReact));
    dispose = () => root.unmount();
  } else if (framework === "vue") {
    const state = shallowReactive<{ integrations: Integrations }>({ integrations: {} });
    const app = createApp({ render: () => h(VueEditor, { ...state.integrations, onReady, onError }) });
    app.mount(host);
    update = (next) => (state.integrations = next);
    dispose = () => app.unmount();
  } else if (framework === "solid") {
    dispose = render(() => {
      const [integrations, setIntegrations] = createSignal<Integrations>({});
      update = (next) => setIntegrations(next);
      return createComponent(SolidEditor, {
        get content() {
          return integrations().content;
        },
        get uploadImage() {
          return integrations().uploadImage;
        },
        get uploadAttachment() {
          return integrations().uploadAttachment;
        },
        get searchMentions() {
          return integrations().searchMentions;
        },
        get currentUser() {
          return integrations().currentUser;
        },
        get databaseAiFill() {
          return integrations().databaseAiFill;
        },
        onReady,
        onError,
      });
    }, host);
  } else throw new Error(`Unknown framework: ${framework}`);
  const controller = await ready;
  window.dynamicEditor = {
    get controller() {
      return controller;
    },
    setIntegrations: (next) => update(next),
    settle: async () => {
      await nextTick();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
    errors,
    destroy: () => {
      dispose();
      host.remove();
    },
  };
};

// Isolated fixture for checking DOM props passed to the Solid adapter.
window.mountSolidAttributesEditor = async () => {
  const fixture = document.createElement("div");
  fixture.id = "solid-attributes-fixture";
  document.body.prepend(fixture);
  const clicks: string[] = [];
  let update: () => void = () => {
    throw new Error("Solid editor is not mounted");
  };
  let hostRef: HTMLDivElement | undefined;
  let markReady: (editor: EditorController) => void = () => {
    throw new Error("Ready callback is not initialized");
  };
  const ready = new Promise<EditorController>((resolve) => (markReady = resolve));
  const dispose = render(() => {
    const [attributes, setAttributes] = createSignal({
      id: "solid-editor-initial",
      class: "initial-class",
      title: "初始标题",
      label: "初始编辑器",
      data: "initial",
      onClick: () => clicks.push("initial"),
    });
    update = () =>
      setAttributes({
        id: "solid-editor-updated",
        class: "updated-class",
        title: "更新标题",
        label: "更新编辑器",
        data: "updated",
        onClick: () => clicks.push("updated"),
      });
    return createComponent(SolidEditor, {
      get id() {
        return attributes().id;
      },
      get class() {
        return attributes().class;
      },
      get title() {
        return attributes().title;
      },
      get "aria-label"() {
        return attributes().label;
      },
      get "data-test-state"() {
        return attributes().data;
      },
      get onClick() {
        return attributes().onClick;
      },
      ref: (element) => (hostRef = element),
      onReady: (editor) => {
        markReady(editor);
      },
    });
  }, fixture);
  const controller = await ready;
  window.solidAttributesEditor = {
    controller,
    clicks,
    get hostRef() {
      return hostRef;
    },
    update,
    destroy: () => {
      dispose();
      fixture.remove();
    },
  };
};

// A deeply reactive document exercises Vue's ordinary ref/reactive usage.
window.mountVueMutableContentEditor = async () => {
  const fixture = document.createElement("div");
  fixture.id = "vue-mutable-content-fixture";
  document.body.prepend(fixture);
  const state = reactive<{ content: JSONContent }>({
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "初始" }] }],
    },
  });
  const changes: string[] = [];
  let markReady: (editor: EditorController) => void = () => {
    throw new Error("Ready callback is not initialized");
  };
  const ready = new Promise<EditorController>((resolve) => (markReady = resolve));
  const app = createApp({
    render: () =>
      h(VueEditor, {
        content: state.content,
        onChange: (snapshot) => {
          changes.push(snapshot.text);
          state.content = snapshot.json;
        },
        onReady: (editor) => {
          markReady(editor);
        },
      }),
  });
  app.mount(fixture);
  const controller = await ready;
  window.vueMutableContentEditor = {
    controller,
    changes,
    updateNested: () => {
      const text = state.content.content?.[0]?.content?.[0];
      if (!text) throw new Error("Mutable fixture text is missing");
      text.text = "外部更改";
    },
    replaceEquivalent: () => {
      state.content = JSON.parse(JSON.stringify(controller.getSnapshot().json));
    },
    settle: () => nextTick(),
    destroy: () => {
      app.unmount();
      fixture.remove();
    },
  };
};
