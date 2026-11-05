import { Extension, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/index";

type Timing = "none" | "before original" | "after original";
type Result = {
  setupTriggered: boolean;
  cleanupTriggered: boolean;
  setupPreserved: boolean;
  cleanupPreserved: boolean;
  errorCount: number;
  isAggregate: boolean;
  destroyEvents: number;
  shell: boolean;
  editorDestroyed: boolean;
  activeObservers: number;
};
declare global {
  interface Window {
    runInitializationFailure?: (timing: Timing) => Result;
    runRefreshFailure?: (cleanupFails: boolean) => {
      originalError: boolean;
      cleanupError: boolean;
      errorCount: number;
      destroyed: boolean;
      destroyEvents: number;
      shellRemoved: boolean;
      otherEditorUsable: boolean;
    };
  }
}

window.runInitializationFailure = (timing) => {
  const host = document.createElement("div");
  host.id = "initialization-failure";
  document.body.replaceChildren(host);
  const setupError = new Error("outline setup failure");
  const cleanupError = new Error("observer disconnect failure");
  const NativeResizeObserver = window.ResizeObserver;
  const nativeCreateElement = document.createElement;
  const active = new Set<ResizeObserver>();
  let setupTriggered = false;
  let cleanupTriggered = false;
  let editor: Editor | undefined;
  let destroyEvents = 0;
  class HostObserver implements ResizeObserver {
    private readonly delegate: ResizeObserver;
    constructor(callback: ResizeObserverCallback) {
      this.delegate = new NativeResizeObserver(callback);
      active.add(this);
    }
    observe(target: Element, options?: ResizeObserverOptions) {
      this.delegate.observe(target, options);
    }
    unobserve(target: Element) {
      this.delegate.unobserve(target);
    }
    disconnect() {
      const fail = setupTriggered && timing !== "none" && !cleanupTriggered;
      if (!fail || timing === "after original") {
        this.delegate.disconnect();
        active.delete(this);
      }
      if (fail) {
        cleanupTriggered = true;
        throw cleanupError;
      }
    }
  }
  const hostExtension = Extension.create({
    name: "initializationFailureHost",
    priority: 2000,
    addProseMirrorPlugins() {
      const tiptap = this.editor;
      return [
        new Plugin({
          view: () => {
            editor = tiptap;
            return {};
          },
        }),
      ];
    },
    onDestroy() {
      destroyEvents++;
    },
  });
  window.ResizeObserver = HostObserver;
  document.createElement = function (name: string, options?: ElementCreationOptions) {
    if (name === "nav") {
      setupTriggered = true;
      throw setupError;
    }
    return nativeCreateElement.call(document, name, options);
  } as typeof document.createElement;
  let error: unknown;
  try {
    createEditor({ element: host, extensions: [hostExtension], content: "<p>test</p>" });
  } catch (cause) {
    error = cause;
  } finally {
    document.createElement = nativeCreateElement;
    window.ResizeObserver = NativeResizeObserver;
  }
  const leaves = (cause: unknown): unknown[] =>
    cause instanceof AggregateError ? cause.errors.flatMap(leaves) : [cause];
  const failures = leaves(error);
  return {
    setupTriggered,
    cleanupTriggered,
    setupPreserved: failures.includes(setupError),
    cleanupPreserved: failures.includes(cleanupError),
    errorCount: failures.length,
    isAggregate: error instanceof AggregateError,
    destroyEvents,
    shell: !!host.querySelector(".semlo-editor"),
    editorDestroyed: editor?.isDestroyed ?? false,
    activeObservers: active.size,
  };
};

window.runRefreshFailure = (cleanupFails) => {
  const host = document.createElement("div");
  const otherHost = document.createElement("div");
  document.body.replaceChildren(host, otherHost);
  const other = createEditor({ element: otherHost, content: "<p>other</p>" });
  const failure = new Error("undo capability failed");
  const cleanupFailure = new Error("destroy callback failed");
  let editor: Editor | undefined;
  let destroyEvents = 0;
  const extension = Extension.create({
    name: "refreshFailure",
    onBeforeCreate() {
      editor = this.editor;
    },
    onDestroy() {
      destroyEvents++;
      if (cleanupFails) throw cleanupFailure;
    },
    addCommands() {
      return {
        undo: () => () => {
          throw failure;
        },
      };
    },
  });
  let caught: unknown;
  try {
    createEditor({ element: host, outline: false, extensions: [extension] });
  } catch (error) {
    caught = error;
  }
  const otherEditorUsable = other.editor.commands.insertContent("X") && other.getSnapshot().text.includes("X");
  other.destroy();
  const leaves = (error: unknown): unknown[] =>
    error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
  const failures = leaves(caught);
  return {
    originalError: failures.includes(failure),
    cleanupError: failures.includes(cleanupFailure),
    errorCount: failures.length,
    destroyed: editor?.isDestroyed ?? false,
    destroyEvents,
    shellRemoved: !host.querySelector(".semlo-editor"),
    otherEditorUsable,
  };
};
