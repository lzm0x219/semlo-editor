import { createEditor, type EditorContent, type EditorController, type EditorSnapshot } from "@semlo-editor/core";
import { SemloEditor as ReactEditor } from "@semlo-editor/react";
import { SemloEditor as SolidEditor } from "@semlo-editor/solid";
import { SemloEditor as VueEditor } from "@semlo-editor/vue";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h, nextTick, reactive } from "vue";

export type SlashTableMode = "core" | "react" | "vue" | "solid";
type CellType = "tableCell" | "tableHeader";
type MountOptions = { cell?: CellType; content?: EditorContent; literal?: string };
type Instance = {
  controller: EditorController;
  changes: EditorSnapshot[];
  errors: string[];
  update(content: EditorContent): void;
  destroy(): void;
};

function initialDocument(cell: CellType, literal?: string): EditorContent {
  const paragraph = (text?: string) => ({
    type: "paragraph",
    ...(text ? { content: [{ type: "text", text }] } : {}),
  });
  return {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { semloEditorHeaderColumn: true, semloEditorHeaderBackground: "#E7EFFF" },
        content: [
          {
            type: "tableRow",
            content: [
              { type: cell, attrs: { colwidth: [180] }, content: [paragraph("单元格甲")] },
              {
                type: cell,
                attrs: {
                  colwidth: [220],
                  semloEditorCellBackground: "rgb(255, 242, 204)",
                  semloEditorCellVerticalAlign: "top",
                },
                content: [paragraph(literal)],
              },
            ],
          },
        ],
      },
      paragraph("表外后文"),
    ],
  };
}

const instances = new Map<string, Instance>();
const required = (id: string) => {
  const instance = instances.get(id);
  if (!instance) throw new Error(`表格查询夹具未挂载：${id}`);
  return instance;
};

async function settle() {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function mount(mode: SlashTableMode, id: string, options: MountOptions = {}) {
  if (instances.has(id)) throw new Error(`表格查询夹具重复挂载：${id}`);
  const host = document.createElement("div");
  host.id = id;
  host.style.cssText = "width:780px;max-width:calc(100% - 32px);margin:24px auto";
  document.body.append(host);
  const content = options.content ?? initialDocument(options.cell ?? "tableCell", options.literal);
  const changes: EditorSnapshot[] = [];
  const errors: string[] = [];
  let controller: EditorController | undefined;
  let update: (value: EditorContent) => void = () => {
    throw new Error("受控内容尚未挂载");
  };
  let dispose: () => void = () => {};
  let ready: () => void = () => {};
  const mounted = new Promise<void>((resolve) => (ready = resolve));
  const onReady = (value: EditorController) => {
    controller = value;
    ready();
  };
  const common = {
    outline: false,
    onError: (error: Error) => errors.push(error.message),
    onChange: (snapshot: EditorSnapshot) => {
      changes.push(snapshot);
      update(snapshot.json);
    },
  };

  if (mode === "core") {
    const value = createEditor({ element: host, content, ...common });
    update = (next) => value.setContent(next);
    dispose = () => value.destroy();
    onReady(value);
  } else if (mode === "react") {
    function App() {
      const [value, setValue] = useState<EditorContent>(() => content);
      update = (next) => setValue(() => next);
      return createElement(ReactEditor, { ...common, content: value, onReady });
    }
    const root = createRoot(host);
    root.render(createElement(App));
    dispose = () => root.unmount();
  } else if (mode === "vue") {
    const state = reactive<{ content: EditorContent }>({ content });
    update = (next) => (state.content = next);
    const app = createApp({ render: () => h(VueEditor, { ...common, content: state.content, onReady }) });
    app.mount(host);
    dispose = () => app.unmount();
  } else {
    dispose = render(() => {
      const [value, setValue] = createSignal<EditorContent>(content);
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
  if (!controller) throw new Error("表格查询夹具缺少控制器");
  instances.set(id, {
    controller,
    changes,
    errors,
    update,
    destroy() {
      dispose();
      host.remove();
    },
  });
  await settle();
}

const fixture = {
  mount,
  settle,
  snapshot: (id: string) => required(id).controller.getSnapshot(),
  raw: (id: string) => required(id).controller.editor.getJSON(),
  changes: (id: string) => required(id).changes,
  errors: (id: string) => required(id).errors,
  async echo(id: string, format: "json" | "html") {
    const instance = required(id);
    instance.update(instance.controller.getSnapshot()[format]);
    await settle();
  },
  async replace(id: string, content: EditorContent) {
    required(id).update(content);
    await settle();
  },
  dispose() {
    for (const instance of instances.values()) instance.destroy();
    instances.clear();
  },
};

declare global {
  interface Window {
    slashTableFixture?: typeof fixture;
  }
}
window.slashTableFixture = fixture;
