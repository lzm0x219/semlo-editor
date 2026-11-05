import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, defineComponent, h, shallowRef } from "vue";

import {
  createEditor,
  type EditorContent,
  type EditorController,
  type EditorOptions,
} from "../../../packages/core/src/index";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

type Resolver = NonNullable<EditorOptions["resolveEmbedMetadata"]>;
type Pending = {
  label: string;
  url: string;
  canonicalUrl?: string;
  signal: AbortSignal;
  resolve: (value: { title: string } | null) => void;
};
const pending: Pending[] = [];
const pendingUploads: Array<{ label: string; name: string; resolve: (url: string) => void }> = [];
type Upload = NonNullable<EditorOptions["uploadAttachment"]>;
const makeUpload =
  (label: string): Upload =>
  (file) =>
    new Promise((resolve) => pendingUploads.push({ label, name: file.name, resolve }));
const uploadAttachment = makeUpload("first");
const content = {
  type: "doc",
  content: [
    { type: "paragraph" },
    { type: "semloEditorEmbed", attrs: { provider: "codepen", url: "https://codepen.io/Mamboleoo/pen/XWJPxpZ" } },
  ],
};
let controller: EditorController | undefined;
let setResolver: ((resolver: Resolver | undefined) => void) | undefined;
let setUpload: ((upload: Upload) => void) | undefined;
let writeContent: ((value: EditorContent) => void) | undefined;
let contentWrites = 0;
let integrationWrites = 0;
function recordController(instance: EditorController) {
  controller = instance;
  const original = instance.setContent.bind(instance);
  instance.setContent = (value) => {
    contentWrites++;
    original(value);
  };
  const originalIntegrations = instance.setIntegrations.bind(instance);
  instance.setIntegrations = (value) => {
    integrationWrites++;
    originalIntegrations(value);
  };
}
const makeResolver =
  (label: string): Resolver =>
  (url, { signal, canonicalUrl }) =>
    new Promise((resolve) => pending.push({ label, url, canonicalUrl, signal, resolve }));
const initial = makeResolver("first");

function mount(kind: "core" | "react" | "vue" | "solid") {
  const host = document.createElement("div");
  host.id = "framework-bookmark";
  document.body.append(host);
  if (kind === "core") {
    const instance = createEditor({
      element: host,
      outline: false,
      content,
      resolveEmbedMetadata: initial,
      uploadAttachment,
    });
    recordController(instance);
    setResolver = (value) => instance.setIntegrations({ resolveEmbedMetadata: value });
    setUpload = (value) => instance.setIntegrations({ uploadAttachment: value });
    writeContent = (value) => instance.setContent(value);
  } else if (kind === "react") {
    const root = createRoot(host);
    let currentContent: EditorContent = content;
    let currentResolver: Resolver | undefined = initial;
    let currentUpload: Upload = uploadAttachment;
    const update = (value: Resolver | undefined) =>
      root.render(
        createElement(ReactEditor, {
          content: currentContent,
          outline: false,
          resolveEmbedMetadata: value,
          uploadAttachment: currentUpload,
          onReady: (instance: EditorController) => {
            recordController(instance);
          },
        }),
      );
    setResolver = (value) => {
      currentResolver = value;
      update(value);
    };
    writeContent = (value) => {
      currentContent = value;
      update(currentResolver);
    };
    setUpload = (value) => {
      currentUpload = value;
      update(currentResolver);
    };
    update(initial);
  } else if (kind === "vue") {
    const state = shallowRef<Resolver | undefined>(initial);
    const upload = shallowRef<Upload>(uploadAttachment);
    const document = shallowRef<EditorContent>(content);
    const App = defineComponent({
      setup: () => () =>
        h(VueEditor, {
          content: document.value,
          outline: false,
          resolveEmbedMetadata: state.value,
          uploadAttachment: upload.value,
          onReady: (instance: EditorController) => {
            recordController(instance);
          },
        }),
    });
    createApp(App).mount(host);
    setResolver = (value) => {
      state.value = value;
    };
    writeContent = (value) => {
      document.value = value;
    };
    setUpload = (value) => {
      upload.value = value;
    };
  } else {
    const [value, setValue] = createSignal<Resolver | undefined>(initial);
    const [upload, updateUpload] = createSignal<Upload>(uploadAttachment);
    const [document, setDocument] = createSignal<EditorContent>(content);
    render(
      () =>
        createComponent(SolidEditor, {
          get content() {
            return document();
          },
          outline: false,
          get uploadAttachment() {
            return upload();
          },
          get resolveEmbedMetadata() {
            return value();
          },
          onReady: (instance: EditorController) => {
            recordController(instance);
          },
        }),
      host,
    );
    setResolver = (next) => {
      setValue(() => next);
    };
    writeContent = (next) => setDocument(() => next);
    setUpload = (next) => updateUpload(() => next);
  }
}

Object.assign(window, {
  bookmarkFramework: {
    mount,
    pending,
    pendingUploads,
    get contentWrites() {
      return contentWrites;
    },
    get integrationWrites() {
      return integrationWrites;
    },
    get controller() {
      return controller;
    },
    replace() {
      if (!setResolver) throw new Error("Bookmark framework is not mounted");
      setResolver(makeResolver("second"));
    },
    remove() {
      if (!setResolver) throw new Error("Bookmark framework is not mounted");
      setResolver(undefined);
    },
    writeContent(value: EditorContent) {
      if (!writeContent) throw new Error("Bookmark framework is not mounted");
      writeContent(value);
    },
    replaceUpload() {
      if (!setUpload) throw new Error("Bookmark framework is not mounted");
      setUpload(makeUpload("second"));
    },
    appendReplacement(equal = false, clone = false) {
      if (!controller) throw new Error("Bookmark framework is not mounted");
      const editor = controller.editor;
      const key = new PluginKey("bookmark-appended-replacement-test");
      editor.registerPlugin(
        new Plugin({
          key,
          appendTransaction(transactions, _oldState, state) {
            if (!transactions.some((transaction) => transaction.getMeta(key))) return null;
            const paragraph = state.schema.nodes.paragraph.create(null, state.schema.text("追加替换"));
            const replacement = equal
              ? clone
                ? state.schema.nodeFromJSON(state.doc.toJSON()).content
                : state.doc.content
              : state.doc.content.append(state.schema.nodes.doc.create(null, [paragraph]).content);
            return state.tr.replaceWith(0, state.doc.content.size, replacement);
          },
        }),
      );
      editor.view.dispatch(editor.state.tr.setMeta(key, true));
    },
    appendNetEqual(clone = false) {
      if (!controller) throw new Error("Bookmark framework is not mounted");
      const editor = controller.editor;
      const key = new PluginKey("bookmark-appended-net-equal-test");
      editor.registerPlugin(
        new Plugin({
          key,
          appendTransaction(transactions, oldState, state) {
            if (!transactions.some((transaction) => transaction.getMeta(key))) return null;
            const replacement = clone ? state.schema.nodeFromJSON(oldState.doc.toJSON()).content : oldState.doc.content;
            return state.tr.replaceWith(0, state.doc.content.size, replacement);
          },
        }),
      );
      editor.view.dispatch(editor.state.tr.insertText("临时", 1).setMeta(key, true));
    },
    rebuildBookmarkAndEdit() {
      if (!controller) throw new Error("Bookmark framework is not mounted");
      const editor = controller.editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorEmbedBookmarkInline") position = pos;
      });
      const old = editor.state.doc.nodeAt(position)!;
      const clone = editor.schema.nodeFromJSON(old.toJSON());
      const tr = editor.state.tr.replaceWith(position, position + old.nodeSize, clone).insertText("外部", 1);
      editor.view.dispatch(tr);
    },
    registerReentrantEdit() {
      if (!controller) throw new Error("Bookmark framework is not mounted");
      const editor = controller.editor;
      editor.on("transaction", ({ transaction }) => {
        if (transaction.getMeta("bookmark-reentrant-test")) {
          editor.view.dispatch(editor.state.tr.insertText("内", 1));
        }
      });
    },
    registerReentrantRebuild() {
      if (!controller) throw new Error("Bookmark framework is not mounted");
      const editor = controller.editor;
      editor.on("transaction", ({ transaction }) => {
        if (!transaction.getMeta("bookmark-reentrant-test")) return;
        let position = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "semloEditorEmbedBookmarkInline") position = pos;
        });
        const node = editor.state.doc.nodeAt(position)!;
        editor.view.dispatch(
          editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
        );
      });
    },
    duplicateBookmarkReference() {
      if (!controller) throw new Error("Bookmark framework is not mounted");
      const editor = controller.editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorEmbedBookmarkInline" && position < 0) position = pos;
      });
      const node = editor.state.doc.nodeAt(position)!;
      editor.view.dispatch(editor.state.tr.insert(position + node.nodeSize, node));
    },
    rebuildFirstDuplicate() {
      if (!controller) throw new Error("Bookmark framework is not mounted");
      const editor = controller.editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorEmbedBookmarkInline" && position < 0) position = pos;
      });
      const node = editor.state.doc.nodeAt(position)!;
      editor.view.dispatch(
        editor.state.tr
          .replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON()))
          .insertText("外", 1),
      );
    },
    triggerReentrantEdit() {
      if (!controller) throw new Error("Bookmark framework is not mounted");
      const editor = controller.editor;
      editor.view.dispatch(editor.state.tr.insertText("外", 1).setMeta("bookmark-reentrant-test", true));
    },
    moveBookmark() {
      if (!controller) throw new Error("Bookmark framework is not mounted");
      const editor = controller.editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorEmbedBookmarkInline") position = pos;
      });
      editor.view.dispatch(editor.state.tr.insertText("ABC", position + 1));
      const node = editor.state.doc.nodeAt(position)!;
      editor.view.dispatch(editor.state.tr.delete(position, position + node.nodeSize).insert(position + 2, node));
    },
  },
});
