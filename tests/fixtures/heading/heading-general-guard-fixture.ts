import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";

interface Probe {
  controller: EditorController;
  mismatchBefore: { anchor: number; head: number; domCollapsed: boolean } | null;
  mismatchAfter: { anchor: number; head: number; domCollapsed: boolean } | null;
  installMismatch(): void;
  setNoWrap(): void;
  keyTime(): { elapsed: number; prevented: boolean; trusted: boolean } | null;
  settle(): Promise<void>;
}
declare global {
  interface Window {
    mountHeadingGeneralGuard?(content: EditorContent, native: boolean, widget: boolean): void;
    headingGeneralGuard?: Probe;
  }
}

window.mountHeadingGeneralGuard = (content, native, widget) => {
  const host = document.createElement("div");
  host.id = "heading-general-guard";
  host.style.width = "850px";
  document.body.replaceChildren(host);
  const controller = createEditor({ element: host, content, toolbar: false, outline: false });
  const editor = controller.editor;
  if (native) {
    const plugin = editor.state.plugins.find((item) =>
      (item as unknown as { key: string }).key.startsWith("semloEditorHeadingEndSelection$"),
    );
    if (!plugin) throw new Error("Missing heading-end plugin");
    plugin.props.handleKeyDown = () => false;
  }
  if (widget) {
    editor.registerPlugin(
      new Plugin({
        key: new PluginKey("headingGeneralHostWidget"),
        props: {
          decorations(state) {
            return DecorationSet.create(state.doc, [
              Decoration.widget(3, () => {
                const span = document.createElement("span");
                span.contentEditable = "false";
                span.textContent = "HOST";
                return span;
              }),
            ]);
          },
        },
      }),
    );
  }
  let inject = false;
  let mismatchBefore: Probe["mismatchBefore"] = null;
  let mismatchAfter: Probe["mismatchAfter"] = null;
  const readMismatch = () => ({
    anchor: editor.state.selection.anchor,
    head: editor.state.selection.head,
    domCollapsed: document.getSelection()!.isCollapsed,
  });
  editor.registerPlugin(
    new Plugin({
      key: new PluginKey("headingGeneralInjection"),
      props: {
        handleKeyDown(view, event) {
          if (!inject || event.key !== "End" || !event.shiftKey) return false;
          inject = false;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 11)));
          const node = view.dom.querySelector("h3")!.lastChild!;
          document.getSelection()!.setBaseAndExtent(node, 0, node, 0);
          mismatchBefore = readMismatch();
          return false;
        },
      },
    }),
    (plugin, plugins) => [plugin, ...plugins],
  );
  editor.registerPlugin(
    new Plugin({
      key: new PluginKey("headingGeneralObservation"),
      props: {
        handleKeyDown(_view, event) {
          if (mismatchBefore && event.key === "End" && event.shiftKey) mismatchAfter = readMismatch();
          return false;
        },
      },
    }),
    (plugin, plugins) => [...plugins, plugin],
  );
  let started = 0;
  let timing: ReturnType<Probe["keyTime"]> = null;
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "End" && event.shiftKey) started = performance.now();
    },
    true,
  );
  editor.view.dom.addEventListener("keydown", (event) => {
    if (event.key === "End" && event.shiftKey)
      timing = { elapsed: performance.now() - started, prevented: event.defaultPrevented, trusted: event.isTrusted };
  });
  window.headingGeneralGuard = {
    controller,
    get mismatchBefore() {
      return mismatchBefore;
    },
    get mismatchAfter() {
      return mismatchAfter;
    },
    installMismatch() {
      inject = true;
    },
    setNoWrap() {
      const style = document.createElement("style");
      style.textContent =
        "#heading-general-guard .semlo-editor-prose h3 { white-space: nowrap !important; overflow-wrap: normal !important; }";
      document.head.append(style);
    },
    keyTime: () => timing,
    settle: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  };
};
