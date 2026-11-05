import {
  createEditor,
  type EditorContent,
  type EditorController,
  type EditorSnapshot,
  type MentionItem,
} from "@semlo-editor/core";
import { SemloEditor as ReactEditor } from "@semlo-editor/react";
import { SemloEditor as SolidEditor } from "@semlo-editor/solid";
import { SemloEditor as VueEditor } from "@semlo-editor/vue";
import { createElement as reactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createComponent, createSignal } from "solid-js";
import { render as solidRender } from "solid-js/web";
import { createApp, h, shallowReactive, type App } from "vue";

import { createDatabaseId } from "../packages/core/src/features/database/model";
import { createDemoToolbar } from "./custom-toolbar";
import { demoExamples } from "./examples";

import "@semlo-editor/core/style.css";
import "./style.css";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// A reset is a fresh example, including transient calendar month navigation.
function resetContent(content: EditorContent): EditorContent {
  const result = clone(content);
  if (typeof result === "string") return result;
  const renewDatabaseIds = (node: Exclude<EditorContent, string>) => {
    if (node.type === "semloEditorDatabase" && node.attrs?.data) node.attrs.data.id = createDatabaseId();
    node.content?.forEach(renewDatabaseIds);
  };
  renewDatabaseIds(result);
  return result;
}
const exampleById = new Map(demoExamples.map((example) => [example.id, example]));
const firstExample = exampleById.get("start") ?? demoExamples[0];
if (!firstExample) throw new Error("预览示例不能为空");
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <div class="top-info">
      <div class="document-name">未命名文档 <span>本地体验</span></div>
      <label class="example-picker"><span>示例</span><select id="example-select" aria-label="选择示例"></select></label>
      <button id="show-all-examples" class="show-all-examples" type="button">查看全部示例</button>
      <span id="example-description" class="example-description"></span>
    </div>
    <div class="top-actions"><div class="frame-switch" role="group" aria-label="框架切换"><button data-framework="vue" class="selected" type="button" aria-pressed="true">Vue</button><button data-framework="react" type="button" aria-pressed="false">React</button><button data-framework="solid" type="button" aria-pressed="false">SolidJS</button><button data-framework="native" type="button" aria-pressed="false">原生 JS</button></div><div class="actions"><button id="reset" type="button">恢复示例</button><button id="readonly" type="button" aria-pressed="false">只读预览</button></div></div>
  </header>
  <main class="workspace"><div id="editor-host"></div><div class="footer"><span id="count">0 字</span><span id="demo-error" role="status" aria-live="polite" hidden></span></div></main>`;
const host = document.querySelector<HTMLDivElement>("#editor-host")!;
const topbar = document.querySelector<HTMLElement>(".topbar")!;
// Keep the editor toolbar below the preview header, including when that
// header wraps at narrow widths. Hosts without a header can use the default 0.
const syncToolbarOffset = () => host.style.setProperty("--semlo-editor-toolbar-sticky-top", `${topbar.offsetHeight}px`);
syncToolbarOffset();
new ResizeObserver(syncToolbarOffset).observe(topbar);
const count = document.querySelector<HTMLElement>("#count")!;
const readOnlyButton = document.querySelector<HTMLButtonElement>("#readonly")!;
const exampleSelect = document.querySelector<HTMLSelectElement>("#example-select")!;
const exampleDescription = document.querySelector<HTMLElement>("#example-description")!;
const errorMessage = document.querySelector<HTMLElement>("#demo-error")!;
for (const example of demoExamples) {
  const option = document.createElement("option");
  option.value = example.id;
  option.textContent = example.title;
  exampleSelect.append(option);
}
let currentExampleId = firstExample.id;
let currentContent: EditorContent = clone(firstExample.content);
const editedExamples = new Map<string, EditorContent>();
let editable = true;
let controller: EditorController | undefined;
let framework: "vue" | "react" | "solid" | "native" = "vue";
let dispose: (() => void) | undefined;
let updateExternal: ((value: EditorContent, isEditable: boolean) => void) | undefined;
let mountGeneration = 0;
const updateCount = (value: EditorSnapshot) => {
  // Image alt text remains useful in exported plain text, but it is not
  // document body text and should not increase the preview's word count.
  const text = controller?.editor.getText({ textSerializers: { image: () => "" } }) ?? value.text;
  count.textContent = `${Array.from(text.replace(/\s/g, "")).length} 字`;
};
const updateExampleLabel = () => {
  const example = exampleById.get(currentExampleId);
  exampleSelect.value = currentExampleId;
  exampleDescription.textContent = example?.description ?? "";
  exampleSelect.title = example?.description ?? "";
};
const rememberCurrent = () => {
  if (controller) currentContent = controller.getSnapshot().json;
  editedExamples.set(currentExampleId, clone(currentContent));
};
updateExampleLabel();
const uploadAttachment = async (file: File) => URL.createObjectURL(file);
const uploadImage = async (file: File) => URL.createObjectURL(file);
const mentionExamples: MentionItem[] = [
  { id: "example-person", label: "小语（示例）", kind: "person" },
  { id: "example-document", label: "入门文档（示例）", kind: "document" },
];
const searchMentions = (query: string) =>
  mentionExamples.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
function mount() {
  const generation = ++mountGeneration;
  const mountedExampleId = currentExampleId;
  const toolbar = mountedExampleId === "custom-toolbar" ? createDemoToolbar : undefined;
  dispose?.();
  controller = undefined;
  updateExternal = undefined;
  host.replaceChildren();
  const element = document.createElement("div");
  host.append(element);
  const onChange = (value: EditorSnapshot) => {
    // 切换框架或示例后，旧实例迟到的回调不能覆盖当前内容。
    if (generation !== mountGeneration || mountedExampleId !== currentExampleId) return;
    currentContent = value.json;
    editedExamples.set(mountedExampleId, clone(value.json));
    updateCount(value);
  };
  const onReady = (value: EditorController) => {
    if (generation !== mountGeneration || mountedExampleId !== currentExampleId) return;
    controller = value;
    updateCount(value.getSnapshot());
  };
  const onError = (error: Error) => {
    if (generation !== mountGeneration || mountedExampleId !== currentExampleId) return;
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
  };
  if (framework === "native") {
    const instance = createEditor({
      element,
      content: currentContent,
      editable,
      toolbar,
      uploadImage,
      uploadAttachment,
      searchMentions,
      onChange,
      onError,
    });
    onReady(instance);
    updateExternal = (_content, active) => instance.setEditable(active);
    dispose = () => instance.destroy();
  } else if (framework === "vue") {
    const state = shallowReactive({ content: currentContent, editable });
    const app: App = createApp({
      render: () =>
        h(VueEditor, {
          content: state.content,
          editable: state.editable,
          toolbar,
          uploadImage,
          uploadAttachment,
          searchMentions,
          onChange,
          onReady,
          onError,
        }),
    });
    app.mount(element);
    updateExternal = (content, active) => {
      state.content = content;
      state.editable = active;
    };
    dispose = () => app.unmount();
  } else if (framework === "react") {
    const root: Root = createRoot(element);
    const update = (content: EditorContent, active: boolean) =>
      root.render(
        reactElement(ReactEditor, {
          content,
          editable: active,
          toolbar,
          uploadImage,
          uploadAttachment,
          searchMentions,
          onChange,
          onReady,
          onError,
        }),
      );
    update(currentContent, editable);
    updateExternal = update;
    dispose = () => root.unmount();
  } else {
    let setContent!: (value: EditorContent) => EditorContent;
    let setEditable!: (value: boolean) => boolean;
    dispose = solidRender(() => {
      const [content, changeContent] = createSignal(currentContent);
      const [active, changeEditable] = createSignal(editable);
      setContent = changeContent;
      setEditable = changeEditable;
      return createComponent(SolidEditor, {
        get content() {
          return content();
        },
        get editable() {
          return active();
        },
        toolbar,
        uploadImage,
        uploadAttachment,
        searchMentions,
        onChange,
        onReady,
        onError,
      });
    }, element);
    updateExternal = (content, active) => {
      setContent(content);
      setEditable(active);
    };
  }
}
document.querySelectorAll<HTMLButtonElement>("[data-framework]").forEach((button) =>
  button.addEventListener("click", () => {
    const next = button.dataset.framework as typeof framework;
    if (next === framework) return;
    rememberCurrent();
    framework = next;
    document.querySelectorAll("[data-framework]").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    mount();
  }),
);
function selectExample(id: string) {
  const next = exampleById.get(id);
  if (!next || next.id === currentExampleId) return;
  rememberCurrent();
  currentExampleId = next.id;
  currentContent = clone(editedExamples.get(next.id) ?? next.content);
  errorMessage.hidden = true;
  updateExampleLabel();
  // A fresh editor isolates this example's undo history from the previous one.
  mount();
}
exampleSelect.addEventListener("change", () => selectExample(exampleSelect.value));
document.querySelector<HTMLButtonElement>("#show-all-examples")!.addEventListener("click", () => selectExample("all"));
readOnlyButton.addEventListener("click", () => {
  editable = !editable;
  readOnlyButton.setAttribute("aria-pressed", String(!editable));
  readOnlyButton.textContent = editable ? "只读预览" : "继续编辑";
  updateExternal?.(currentContent, editable);
});
document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => {
  const example = exampleById.get(currentExampleId);
  if (!example) return;
  currentContent = resetContent(example.content);
  editedExamples.set(currentExampleId, clone(currentContent));
  errorMessage.hidden = true;
  // Remount so undo cannot restore the edited content after a reset.
  mount();
});
mount();
