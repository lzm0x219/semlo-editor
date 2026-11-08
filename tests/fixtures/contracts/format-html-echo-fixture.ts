import {
  createEditor,
  type ContentReplacementResult,
  type EditorContent,
  type EditorController,
  type EditorSnapshot,
} from "@semlo-editor/core";
import { SemloEditor as ReactEditor } from "@semlo-editor/react";
import { SemloEditor as SolidEditor } from "@semlo-editor/solid";
import { SemloEditor as VueEditor } from "@semlo-editor/vue";
import { Mark } from "@tiptap/core";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, reactive } from "vue";

import "@semlo-editor/core/style.css";
import "./slash-html-echo-fixture";

export type FormatEchoMode = "core" | "react" | "vue" | "solid";
type Capture = {
  view: object;
  from: number;
  to: number;
  anchor: Node | null;
  anchorOffset: number;
  focus: Node | null;
  focusOffset: number;
};
type Instance = {
  controller: EditorController;
  errors: string[];
  changes: EditorSnapshot[];
  effects: { parse(): void; parses: number; renders: number };
  replacements(): number;
  selectionUnchanged(): boolean;
  echoes(): number;
  update(content: EditorContent): void;
  tryUpdate?: (content: EditorContent) => ContentReplacementResult;
  destroy(): void;
};

const instances = new Map<string, Instance>();
function required(id: string) {
  const instance = instances.get(id);
  if (!instance) throw new Error(`缺少 HTML 回写夹具：${id}`);
  return instance;
}

function content(): EditorContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "FIRST",
            marks: [
              { type: "bold" },
              { type: "textStyle", attrs: { color: "#aabbcc" } },
              { type: "formatEchoSemantic", attrs: { ticket: "selectedCase" } },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "SECOND",
            marks: [
              { type: "textStyle", attrs: { color: "#334455" } },
              { type: "formatEchoSemantic", attrs: { ticket: "unselectedCase" } },
            ],
          },
        ],
      },
    ],
  };
}

function capture(controller: EditorController): Capture {
  const { view, state } = controller.editor;
  const native = view.dom.ownerDocument.getSelection();
  return {
    view,
    from: state.selection.from,
    to: state.selection.to,
    anchor: native?.anchorNode ?? null,
    anchorOffset: native?.anchorOffset ?? 0,
    focus: native?.focusNode ?? null,
    focusOffset: native?.focusOffset ?? 0,
  };
}
function sameSelection(controller: EditorController, saved: Capture | undefined) {
  if (!saved) return false;
  const now = capture(controller);
  return Object.entries(saved).every(([key, value]) => now[key as keyof Capture] === value);
}
function nativeSelection(controller: EditorController) {
  const { view } = controller.editor;
  const native = view.dom.ownerDocument.getSelection();
  const position = (node: Node | null, offset: number) => {
    if (!node || !view.dom.contains(node)) return null;
    try {
      return view.posAtDOM(node, offset);
    } catch {
      return null;
    }
  };
  return {
    anchor: position(native?.anchorNode ?? null, native?.anchorOffset ?? 0),
    focus: position(native?.focusNode ?? null, native?.focusOffset ?? 0),
    text: native?.toString() ?? "",
  };
}
async function settle() {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function mount(mode: FormatEchoMode, id: string) {
  if (instances.has(id)) throw new Error(`重复的 HTML 回写夹具：${id}`);
  const host = document.createElement("div");
  host.id = id;
  host.style.cssText = "width:780px;max-width:calc(100% - 32px);margin:24px auto";
  document.body.append(host);
  const errors: string[] = [];
  const changes: EditorSnapshot[] = [];
  const effects = { parse: () => {}, parses: 0, renders: 0 };
  const semantic = Mark.create({
    name: "formatEchoSemantic",
    addAttributes: () => ({
      ticket: {
        default: "mixedCase",
        rendered: false,
        parseHTML: (element: HTMLElement) => {
          effects.parses++;
          effects.parse();
          return element.getAttribute("data-format-echo-host");
        },
      },
    }),
    parseHTML: () => [{ tag: "span[data-format-echo-host]" }],
    renderHTML({ mark }) {
      effects.renders++;
      return ["span", { "data-format-echo-host": String(mark.attrs.ticket).toUpperCase() }, 0];
    },
  });
  let controller: EditorController | undefined;
  let echoSelectionUnchanged = false;
  let echoes = 0;
  let update: (value: EditorContent) => void = () => {
    throw new Error("HTML 回写尚未挂载");
  };
  let tryUpdate: Instance["tryUpdate"];
  let dispose = () => {};
  let ready = () => {};
  const mounted = new Promise<void>((resolve) => (ready = resolve));
  const onReady = (value: EditorController) => {
    const setContent = value.setContent.bind(value);
    // 只在真实 API echo 的前后观察，排除首次格式操作自身的 DOM 选区同步。
    value.setContent = (next) => {
      if (typeof next !== "string") return setContent(next);
      const before = capture(value);
      echoes++;
      try {
        setContent(next);
      } finally {
        echoSelectionUnchanged = sameSelection(value, before);
      }
    };
    controller = value;
    ready();
  };
  const common = {
    outline: false,
    extensions: [semantic],
    onError: (error: Error) => errors.push(error.message),
    onChange: (snapshot: EditorSnapshot) => {
      changes.push(snapshot);
      update(snapshot.html);
    },
  };
  const initial = content();
  if (mode === "core") {
    const value = createEditor({ element: host, content: initial, ...common });
    update = (next) => value.setContent(next);
    tryUpdate = (next) => value.trySetContent(next);
    dispose = () => value.destroy();
    onReady(value);
  } else if (mode === "react") {
    function App() {
      const [value, setValue] = useState<EditorContent>(() => initial);
      update = (next) => setValue(() => next);
      return createElement(ReactEditor, { ...common, content: value, onReady });
    }
    const root = createRoot(host);
    root.render(createElement(App));
    dispose = () => root.unmount();
  } else if (mode === "vue") {
    const state = reactive<{ content: EditorContent }>({ content: initial });
    update = (next) => (state.content = next);
    const app = createApp({ render: () => h(VueEditor, { ...common, content: state.content, onReady }) });
    app.mount(host);
    dispose = () => app.unmount();
  } else {
    dispose = render(() => {
      const [value, setValue] = createSignal<EditorContent>(initial);
      update = (next) => setValue(() => next);
      return createComponent(SolidEditor, {
        ...common,
        get content() {
          return value();
        },
        onReady,
      });
    }, host);
  }
  await mounted;
  if (!controller) throw new Error("HTML 回写夹具缺少控制器");
  const value = controller;
  let replacements = 0;
  const replaced = () => replacements++;
  const observedDOM = value.editor.view.dom;
  observedDOM.addEventListener("semlo-editor:document-replace", replaced);
  instances.set(id, {
    controller: value,
    errors,
    changes,
    effects,
    replacements: () => replacements,
    selectionUnchanged: () => echoSelectionUnchanged,
    echoes: () => echoes,
    update,
    tryUpdate,
    destroy() {
      observedDOM.removeEventListener("semlo-editor:document-replace", replaced);
      dispose();
      host.remove();
    },
  });
  await settle();
}

const fixture = {
  mount,
  settle,
  raw: (id: string) => required(id).controller.editor.getJSON(),
  snapshot: (id: string) => required(id).controller.getSnapshot(),
  errors: (id: string) => required(id).errors,
  stats(id: string) {
    const instance = required(id);
    const selection = instance.controller.editor.state.selection;
    return {
      replacements: instance.replacements(),
      changes: instance.changes.length,
      echoes: instance.echoes(),
      selection: { from: selection.from, to: selection.to },
      nativeSelection: nativeSelection(instance.controller),
      selectionUnchanged: instance.selectionUnchanged(),
    };
  },
  select(id: string) {
    return required(id).controller.editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
  },
  async format(id: string) {
    const result = required(id).controller.editor.commands.unsetBold();
    await settle();
    return result;
  },
  async history(id: string, action: "undo" | "redo") {
    const result = required(id).controller.editor.commands[action]();
    await settle();
    return result;
  },
  async replace(id: string, next: EditorContent) {
    required(id).update(next);
    await settle();
  },
  unmountedReplace(id: string) {
    const instance = required(id);
    if (!instance.tryUpdate) throw new Error("卸载替换探针仅用于核心入口");
    const { editor } = instance.controller;
    editor.unmount();
    const replacement = instance.tryUpdate("<p>未挂载期间的外部正文</p>");
    const target = document.createElement("div");
    document.querySelector(`#${id} .semlo-editor-content`)!.append(target);
    editor.mount(target);
    return {
      replacement,
      mounted: !editor.isDestroyed,
      text: instance.controller.getSnapshot().text,
      errors: instance.errors,
    };
  },
  async selectionControl(id: string) {
    const instance = required(id);
    const before = capture(instance.controller);
    instance.controller.editor.chain().focus().setTextSelection({ from: 2, to: 4 }).run();
    await settle();
    return { unchanged: sameSelection(instance.controller, before), native: nativeSelection(instance.controller) };
  },
  probe(id: string, format: "html" | "json", failParse = false) {
    const instance = required(id);
    if (!instance.tryUpdate) throw new Error("替换结果探针仅用于核心入口");
    const { editor } = instance.controller;
    const beforeState = editor.state;
    const beforeView = editor.view;
    const next = format === "html" ? instance.controller.getSnapshot().html : editor.getJSON();
    const parses = instance.effects.parses;
    const renders = instance.effects.renders;
    if (failParse) {
      instance.effects.parse = () => {
        instance.effects.parse = () => {};
        throw new Error("host parseHTML failed");
      };
    }
    const result = instance.tryUpdate(next);
    instance.effects.parse = () => {};
    return {
      status: result.status,
      error: "error" in result ? (result.error?.message ?? null) : null,
      sameState: editor.state === beforeState,
      sameDoc: editor.state.doc === beforeState.doc,
      sameView: editor.view === beforeView,
      parses: instance.effects.parses - parses,
      renders: instance.effects.renders - renders,
      replacements: instance.replacements(),
      errors: instance.errors,
    };
  },
  dispose() {
    for (const instance of instances.values()) instance.destroy();
    instances.clear();
    window.slashHTMLEcho?.dispose();
  },
};
declare global {
  interface Window {
    formatHTMLEcho?: typeof fixture;
  }
}
window.formatHTMLEcho = fixture;
