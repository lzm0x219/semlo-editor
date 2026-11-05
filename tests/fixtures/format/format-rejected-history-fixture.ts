import { Extension } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { setFontSizeOutsideHeadings } from "../../../packages/core/src/features/text/font-size-shortcuts";
import { createEditor, toggleBold } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";
type Mode =
  | "reject"
  | "allow"
  | "reenter"
  | "append"
  | "readonly"
  | "destroy-accept"
  | "destroy-reject"
  | "throw-filter"
  | "throw-append"
  | "throw-before"
  | "throw-after";
interface Fixture {
  controller: EditorController;
  arm(mode?: Mode): void;
  disarm(): void;
  invoke(command: "bold" | "size"): boolean;
  enableEditing(): void;
  beginListenerAudit(): void;
  endListenerAudit(): { added: number; remaining: number };
  reenter(): void;
  trace: Array<{ steps: string[]; history: boolean; rejected: boolean; docChanged: boolean; reentry: boolean }>;
  events: KeyboardEvent[];
  undoDepth(): number;
  pluginOrder(): { host: number; history: number };
  appendCount(): number;
}
declare global {
  interface Window {
    mountFormatRejectedHistory?(order: "early" | "late"): void;
    formatRejectedHistory?: Fixture;
  }
}
window.mountFormatRejectedHistory = (order) => {
  const element = document.createElement("div");
  element.id = "format-rejected-history";
  document.body.replaceChildren(element);
  let armed = false;
  let mode: Mode = "reject";
  let controller: EditorController;
  let appended = 0;
  const historyTime = Date.now();
  const trace: Fixture["trace"] = [];
  const hostKey = new PluginKey("formatRejectedHistoryHost");
  const reenter = () => {
    const { editor } = controller;
    editor.view.dispatch(editor.state.tr.setSelection(editor.state.selection).setMeta("host-reentry", true));
  };
  const host = Extension.create({
    name: "formatRejectedHistoryHost",
    priority: order === "early" ? 2000 : 1,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: hostKey,
          filterTransaction(tr) {
            // Stabilize only ProseMirror history grouping, not browser event timing.
            tr.setTime(historyTime);
            const steps = tr.steps.map((step) => String(step.toJSON().stepType));
            const marked = steps.some((name) => name === "addMark" || name === "removeMark");
            const rejected = armed && marked && (mode === "reject" || mode === "reenter" || mode === "destroy-reject");
            if (armed)
              trace.push({
                steps,
                history: tr.getMeta("addToHistory") === false,
                rejected,
                docChanged: tr.docChanged,
                reentry: tr.getMeta("host-reentry") === true,
              });
            if (rejected && mode === "reenter") reenter();
            if (rejected && mode === "destroy-reject") controller.editor.destroy();
            if (armed && marked && mode === "throw-filter") throw new Error("host filter error");
            return !rejected;
          },
          appendTransaction(transactions, _oldState, newState) {
            const marked = transactions.some((tr) => tr.steps.some((step) => step.toJSON().stepType === "addMark"));
            if (armed && marked && mode === "throw-append") throw new Error("host append error");
            if (armed && mode === "append" && marked)
              return newState.tr.setMeta("host-append", true).setMeta("addToHistory", false);
            return null;
          },
        }),
      ];
    },
  });
  controller = createEditor({
    element,
    outline: false,
    toolbar: false,
    content: "<p>abc</p><h3>head</h3><p>tail</p>",
    extensions: [host],
  });
  controller.editor.on("transaction", ({ appendedTransactions }) => {
    appended += appendedTransactions.filter((tr) => tr.getMeta("host-append") === true).length;
  });
  controller.editor.on("beforeTransaction", ({ transaction }) => {
    if (armed && mode === "throw-before" && transaction.steps.some((step) => step.toJSON().stepType === "addMark"))
      throw new Error("host before error");
  });
  controller.editor.on("transaction", ({ transaction }) => {
    if (armed && mode === "throw-after" && transaction.steps.some((step) => step.toJSON().stepType === "addMark"))
      throw new Error("host transaction error");
    if (armed && mode === "readonly" && transaction.steps.some((step) => step.toJSON().stepType === "addMark"))
      controller.editor.setEditable(false, false);
    if (armed && mode === "destroy-accept" && transaction.steps.some((step) => step.toJSON().stepType === "addMark"))
      controller.editor.destroy();
  });
  const editor = controller.editor,
    originalOn = editor.on,
    originalOff = editor.off,
    pendingListeners = new Set<unknown>();
  let addedListeners = 0;
  const events: KeyboardEvent[] = [];
  controller.editor.view.dom.addEventListener(
    "keydown",
    (event) => {
      if (event.key.toLowerCase() === "b" || event.code === "Equal") events.push(event);
    },
    true,
  );
  window.formatRejectedHistory = {
    controller,
    arm: (nextMode = "reject") => {
      mode = nextMode;
      armed = true;
      trace.length = 0;
    },
    disarm: () => {
      armed = false;
    },
    invoke: (command) =>
      command === "bold"
        ? toggleBold(controller.editor, { focus: false })
        : setFontSizeOutsideHeadings(controller.editor, "22px"),
    enableEditing: () => controller.editor.setEditable(true, false),
    beginListenerAudit: () => {
      pendingListeners.clear();
      addedListeners = 0;
      editor.on = ((name: unknown, callback: unknown) => {
        if (name === "beforeTransaction" || name === "transaction") {
          addedListeners++;
          pendingListeners.add(callback);
        }
        return Reflect.apply(originalOn, editor, [name, callback]);
      }) as typeof editor.on;
      editor.off = ((name: unknown, callback: unknown) => {
        if (name === "beforeTransaction" || name === "transaction") pendingListeners.delete(callback);
        return Reflect.apply(originalOff, editor, [name, callback]);
      }) as typeof editor.off;
    },
    endListenerAudit: () => {
      editor.on = originalOn;
      editor.off = originalOff;
      return { added: addedListeners, remaining: pendingListeners.size };
    },
    reenter,
    trace,
    events,
    undoDepth: () => undoDepth(controller.editor.state),
    pluginOrder: () => {
      const state = controller.editor.state;
      return {
        host: state.plugins.indexOf(hostKey.get(state)!),
        history: state.plugins.findIndex((plugin) =>
          ((plugin.spec.key as unknown as { key?: string } | undefined)?.key ?? "").startsWith("history$"),
        ),
      };
    },
    appendCount: () => appended,
  };
};
