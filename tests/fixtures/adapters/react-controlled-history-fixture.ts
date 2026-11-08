import type { EditorContent, EditorController, EditorSnapshot } from "@semlo-editor/core";
import { SemloEditor } from "@semlo-editor/react";
import { createElement, StrictMode, useEffect, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";

import "@semlo-editor/core/style.css";

interface MountOptions {
  content?: EditorContent;
  readyContent?: EditorContent;
  undoOnBold?: boolean;
  strict?: boolean;
  editable?: boolean;
}
interface HostState {
  content: EditorContent | undefined;
  editable: boolean;
  key: number;
  version: number;
}
interface FixtureState {
  controller: EditorController | null;
  controllers: EditorController[];
  readyText: string[];
  changes: EditorSnapshot[];
  undoResult: boolean | null;
  textAfterUndo: string | null;
  requestedVersion: number;
  committedVersion: number;
}

declare global {
  interface Window {
    reactHistory: {
      mount(options?: MountOptions): void;
      patch(value: Partial<Pick<HostState, "content" | "editable">>): void;
      remount(): void;
      destroy(): void;
      state: FixtureState;
    };
  }
}

const initialContent = "<p>alpha beta</p><p>未选正文</p>";
let patch: (value: Partial<Omit<HostState, "version">>) => void = () => {};
let dispose: () => void = () => {};
const state: FixtureState = {
  controller: null,
  controllers: [],
  readyText: [],
  changes: [],
  undoResult: null,
  textAfterUndo: null,
  requestedVersion: 0,
  committedVersion: 0,
};

document.body.style.cssText = "margin:0;padding:24px";
window.reactHistory = {
  state,
  mount(options = {}) {
    const element = document.createElement("div");
    element.id = "react-history-root";
    document.body.append(element);
    const root = createRoot(element);
    let current: HostState = {
      content: Object.hasOwn(options, "content") ? options.content : initialContent,
      editable: options.editable !== false,
      key: 0,
      version: 0,
    };
    let undoOnBold = Boolean(options.undoOnBold);
    function Host(props: HostState) {
      useLayoutEffect(() => {
        const controller = state.controller;
        if (!undoOnBold || !controller?.getSnapshot().html.includes("<strong>")) return;
        undoOnBold = false;
        state.undoResult = controller.editor.commands.undo();
        state.textAfterUndo = controller.getSnapshot().text;
      });
      useEffect(() => {
        state.committedVersion = props.version;
      });
      return createElement(SemloEditor, {
        key: props.key,
        id: "react-history-editor",
        content: props.content,
        editable: props.editable,
        outline: false,
        onReady(controller) {
          state.controller = controller;
          state.controllers.push(controller);
          state.readyText.push(controller.getSnapshot().text);
          if (options.readyContent !== undefined) controller.setContent(options.readyContent);
        },
        onChange(snapshot) {
          state.changes.push(snapshot);
          patch({ content: snapshot.json });
        },
      });
    }
    const paint = () => {
      current = { ...current, version: ++state.requestedVersion };
      const host = createElement(Host, current);
      root.render(options.strict ? createElement(StrictMode, null, host) : host);
    };
    patch = (value) => {
      current = { ...current, ...value };
      paint();
    };
    window.reactHistory.remount = () => patch({ key: current.key + 1 });
    dispose = () => {
      root.unmount();
      element.remove();
    };
    paint();
  },
  patch: (value) => patch(value),
  remount() {},
  destroy: () => dispose(),
};
