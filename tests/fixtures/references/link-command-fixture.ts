import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";

import { createDemoToolbar } from "../../../demo/custom-toolbar";
import {
  createEditor,
  getLinkState,
  normalizeLinkURL,
  startLinkEdit,
  type EditorContent,
  type EditorController,
  type FloatingToolbarFactory,
  type LinkEditResult,
  type LinkEditSession,
  type LinkState,
} from "../../../packages/core/dist/index.js";

import "../../../packages/core/dist/style.css";

interface Instance {
  host: HTMLElement;
  controller: EditorController;
  session: LinkEditSession | null;
  deny: boolean;
  echoes: number;
  invalidations: number;
  mount: HTMLElement | null;
}

const instances = new Map<string, Instance>();
const get = (id: string) => {
  const instance = instances.get(id);
  if (!instance) throw new Error(`编辑器实例不存在：${id}`);
  return instance;
};

declare global {
  interface Window {
    linkCommandFixture: {
      mount(
        id: string,
        content: EditorContent,
        mode?: "default" | "custom" | "hidden" | "custom-floating",
        controlled?: boolean,
      ): void;
      select(id: string, text: string, from: number, to: number, reverse?: boolean): void;
      state(id: string): LinkState;
      start(id: string, throwOnInvalidate?: boolean): boolean;
      session(id: string): {
        text: string;
        href: string | null;
        existing: boolean;
        range: { from: number; to: number };
        valid: boolean;
      } | null;
      apply(id: string, href: string, text: string): LinkEditResult;
      remove(id: string): boolean;
      close(id: string): void;
      normalize(url: string): string | null;
      snapshot(id: string): ReturnType<EditorController["getSnapshot"]>["json"];
      selection(id: string): { text: string; backward: boolean; empty: boolean };
      setContent(id: string, content: EditorContent): void;
      insert(id: string, text: string): void;
      editable(id: string, value: boolean): void;
      deny(id: string, value: boolean): void;
      undo(id: string): boolean;
      redo(id: string): boolean;
      echoes(id: string): number;
      invalidations(id: string): number;
      unmount(id: string): void;
      remount(id: string): void;
      destroy(id: string): void;
    };
  }
}

/** 明确配置格式浮层，单独验证工厂的选区同步和内置链接弹层。 */
const floatingLink: FloatingToolbarFactory = ({ element, controller, syncSelection, subscribe, openLink }) => {
  const button = element.ownerDocument.createElement("button");
  button.type = "button";
  button.textContent = "链接";
  button.className = "semlo-editor-button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  const preserve = (event: MouseEvent) => event.preventDefault();
  const open = () => {
    syncSelection();
    openLink(button);
  };
  button.addEventListener("mousedown", preserve);
  button.addEventListener("click", open);
  element.append(button);
  const update = () => {
    button.disabled = !getLinkState(controller.editor).enabled;
  };
  const unsubscribe = subscribe(update);
  update();
  return () => {
    unsubscribe();
    button.disabled = true;
    button.removeEventListener("mousedown", preserve);
    button.removeEventListener("click", open);
  };
};

window.linkCommandFixture = {
  mount(id, content, mode = "hidden", controlled = false) {
    const host = document.createElement("div");
    host.id = `link-command-${id}`;
    document.body.append(host);
    const instance: Instance = {
      host,
      controller: undefined!,
      session: null,
      deny: false,
      echoes: 0,
      invalidations: 0,
      mount: null,
    };
    const gate = Extension.create({
      name: `linkCommandGate${id}`,
      addProseMirrorPlugins() {
        return [new Plugin({ filterTransaction: (transaction) => !instance.deny || !transaction.docChanged })];
      },
    });
    instance.controller = createEditor({
      element: host,
      outline: false,
      content,
      toolbar: mode === "custom" ? createDemoToolbar : mode !== "hidden",
      floatingToolbar: mode === "custom-floating" ? floatingLink : undefined,
      extensions: [gate],
      onChange: controlled
        ? (snapshot) =>
            queueMicrotask(() => {
              if (!instance.controller.editor.isDestroyed) instance.controller.setContent(snapshot.json);
              instance.echoes++;
            })
        : undefined,
    });
    instances.set(id, instance);
  },
  select(id, text, from, to, reverse = false) {
    const editor = get(id).controller.editor;
    let position: number | undefined;
    editor.state.doc.descendants((node, at) => {
      if (node.isText && node.text === text) position = at;
    });
    if (position === undefined) throw new Error(`找不到选区文字：${text}`);
    const anchor = position + (reverse ? to : from);
    const head = position + (reverse ? from : to);
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)));
  },
  state: (id) => getLinkState(get(id).controller.editor),
  start(id, throwOnInvalidate = false) {
    const instance = get(id);
    instance.session?.close();
    instance.session = startLinkEdit(instance.controller.editor, {
      onInvalidate: () => {
        instance.invalidations++;
        if (throwOnInvalidate) throw new Error("链接会话失效通知失败");
      },
    });
    return Boolean(instance.session);
  },
  session(id) {
    const session = get(id).session;
    return session
      ? {
          text: session.text,
          href: session.href,
          existing: session.existing,
          range: session.range,
          valid: session.isValid(),
        }
      : null;
  },
  apply: (id, href, text) => get(id).session?.apply({ href, text }) ?? "unavailable",
  remove: (id) => get(id).session?.remove() ?? false,
  close(id) {
    get(id).session?.close();
  },
  normalize: normalizeLinkURL,
  snapshot: (id) => get(id).controller.getSnapshot().json,
  selection(id) {
    const { doc, selection } = get(id).controller.editor.state;
    return {
      text: doc.textBetween(selection.from, selection.to, "|"),
      backward: selection.anchor > selection.head,
      empty: selection.empty,
    };
  },
  setContent: (id, content) => get(id).controller.setContent(content),
  insert: (id, text) => void get(id).controller.editor.commands.insertContentAt(1, text),
  editable: (id, value) => get(id).controller.setEditable(value),
  deny: (id, value) => void (get(id).deny = value),
  undo: (id) => get(id).controller.editor.commands.undo(),
  redo: (id) => get(id).controller.editor.commands.redo(),
  echoes: (id) => get(id).echoes,
  invalidations: (id) => get(id).invalidations,
  unmount(id) {
    const instance = get(id);
    instance.mount = instance.controller.editor.view.dom.parentElement;
    instance.controller.editor.unmount();
  },
  remount(id) {
    const instance = get(id);
    if (!instance.mount) throw new Error("编辑器挂载节点不存在");
    instance.controller.editor.mount(instance.mount);
  },
  destroy(id) {
    const instance = get(id);
    instance.controller.destroy();
    instance.host.remove();
  },
};
