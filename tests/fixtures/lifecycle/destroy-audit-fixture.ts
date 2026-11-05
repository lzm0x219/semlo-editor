import "../../../demo/editor.css";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { columnResizingPluginKey } from "@tiptap/pm/tables";

import { createEditor } from "../../../packages/core/src/editor/create-editor";
import type { EditorController } from "../../../packages/core/src/types";

type Mode =
  | "none"
  | "editor-transaction"
  | "controller-transaction"
  | "editor-change"
  | "controller-change"
  | "controller-in-editor-destroy"
  | "mutations-in-editor-destroy"
  | "throw-in-editor-destroy"
  | "recursive-editor-destroy"
  | "read-in-editor-destroy"
  | "throwing-serializer";
type Fixture = {
  first: EditorController;
  second: EditorController;
  changes: string[];
  errors: string[];
  translationSignals: AbortSignal[];
  rejectNextResize(): void;
  destroyCallbacks(): number;
  failNextResizeDisconnect(): void;
  expectedFailures(): { resize: Error; host: Error };
  armHostSerializer(): void;
  serializerAttempts(): number;
  destroyRead(): { value: unknown; error: string };
  listenerCounts(): Record<string, number>;
  observerCounts(): Record<string, number>;
};
declare global {
  interface Window {
    destroyAuditFixture?: Fixture;
    mountDestroyAudit?(mode?: Mode): void;
    destroyAuditRaw?(controller: EditorController): {
      json: ReturnType<EditorController["editor"]["getJSON"]>;
      text: string;
    };
  }
}

window.destroyAuditRaw = (controller) => ({
  json: controller.editor.getJSON(),
  text: controller.editor.state.doc.textContent,
});
window.mountDestroyAudit = (mode = "none") => {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  for (const [name, target] of [
    ["document", document],
    ["window", window],
  ] as const) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (listener) {
        const capture = typeof options === "boolean" ? options : !!options?.capture;
        const key = `${name}:${type}:${capture}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key)!.add(listener);
      }
      if (listener) add(type, listener, options);
    }) as typeof target.addEventListener;
    target.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => {
      if (listener) {
        const capture = typeof options === "boolean" ? options : !!options?.capture;
        listeners.get(`${name}:${type}:${capture}`)?.delete(listener);
      }
      if (listener) remove(type, listener, options);
    }) as typeof target.removeEventListener;
  }
  const mutations = new Set<MutationObserver>();
  const resizes = new Set<ResizeObserver>();
  let throwResizeDisconnect = false;
  const resizeFailure = new Error("host ResizeObserver disconnect failure");
  const hostDestroyFailure = new Error("host destroy failure");
  const NativeMutationObserver = window.MutationObserver;
  const NativeResizeObserver = window.ResizeObserver;
  window.MutationObserver = class extends NativeMutationObserver {
    override observe(target: Node, options?: MutationObserverInit) {
      mutations.add(this);
      return super.observe(target, options);
    }
    override disconnect() {
      mutations.delete(this);
      return super.disconnect();
    }
  };
  window.ResizeObserver = class extends NativeResizeObserver {
    override observe(target: Element, options?: ResizeObserverOptions) {
      resizes.add(this);
      return super.observe(target, options);
    }
    override disconnect() {
      resizes.delete(this);
      super.disconnect();
      if (throwResizeDisconnect) {
        throwResizeDisconnect = false;
        throw resizeFailure;
      }
    }
  };
  const changes: string[] = [];
  const errors: string[] = [];
  const translationSignals: AbortSignal[] = [];
  let first: EditorController | undefined;
  let fired = false;
  let rejectResize = false;
  let destroyCallbacks = 0;
  let serializerArmed = false;
  let serializations = 0;
  let readDuringDestroy: { value: unknown; error: string } = { value: null, error: "not read" };
  const badSerializer = Extension.create({
    name: "destroyAuditHostSerializer",
    addGlobalAttributes() {
      return [
        {
          types: ["heading"],
          attributes: {
            destroyAuditAttribute: {
              default: null,
              renderHTML: () => {
                if (serializerArmed) {
                  serializations++;
                  throw new Error("host serialization failure");
                }
                return {};
              },
            },
          },
        },
      ];
    },
  });
  const observer = Extension.create({
    name: "destroyAuditHost",
    priority: 2000,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction(transaction) {
            const action = transaction.getMeta(columnResizingPluginKey) as { setDragging?: unknown } | undefined;
            if (rejectResize && action?.setDragging) {
              rejectResize = false;
              return false;
            }
            return true;
          },
        }),
      ];
    },
    onTransaction({ editor, transaction }) {
      if (fired || !transaction.getMeta("destroyAudit")) return;
      if (mode === "editor-transaction" || mode === "controller-transaction") {
        fired = true;
        if (mode === "editor-transaction") editor.destroy();
        else first?.destroy();
      }
    },
    onDestroy() {
      destroyCallbacks++;
      if (mode === "read-in-editor-destroy" && first) {
        try {
          readDuringDestroy = { value: first.getSnapshot(), error: "" };
        } catch (error) {
          readDuringDestroy = { value: null, error: String(error) };
        }
      }
      if (mode === "recursive-editor-destroy") first?.editor.destroy();
      if (mode === "controller-in-editor-destroy") first?.destroy();
      if (mode === "throw-in-editor-destroy") throw hostDestroyFailure;
      if (mode === "mutations-in-editor-destroy") {
        first?.setContent("<p>unexpected</p>");
        first?.setEditable(false);
        first?.setIntegrations({ searchMentions: async () => [] });
        first?.focus();
      }
    },
  });
  const firstHost = document.createElement("div");
  const secondHost = document.createElement("div");
  firstHost.id = "destroy-first";
  secondHost.id = "destroy-second";
  document.body.replaceChildren(firstHost, secondHost);
  const onChange = () => {
    changes.push("first");
    if (fired || (mode !== "editor-change" && mode !== "controller-change")) return;
    fired = true;
    if (mode === "editor-change") first?.editor.destroy();
    else first?.destroy();
  };
  first = createEditor({
    element: firstHost,
    content: "<h3>first</h3><table><tbody><tr><td><p>cell</p></td><td><p>cell 2</p></td></tr></tbody></table>",
    extensions: mode === "throwing-serializer" ? [observer, badSerializer] : [observer],
    onChange,
    onError: (error) => errors.push(error.message),
    translate: ({ signal }) => {
      translationSignals.push(signal);
      return new Promise<string>(() => {});
    },
  });
  const second = createEditor({
    element: secondHost,
    content: "<h3>second</h3>",
    onChange: () => changes.push("second"),
    onError: (error) => errors.push(error.message),
  });
  window.destroyAuditFixture = {
    first,
    second,
    changes,
    errors,
    translationSignals,
    rejectNextResize: () => {
      rejectResize = true;
    },
    destroyCallbacks: () => destroyCallbacks,
    failNextResizeDisconnect: () => {
      throwResizeDisconnect = true;
    },
    expectedFailures: () => ({ resize: resizeFailure, host: hostDestroyFailure }),
    armHostSerializer: () => {
      serializerArmed = true;
    },
    serializerAttempts: () => serializations,
    destroyRead: () => readDuringDestroy,
    listenerCounts: () =>
      Object.fromEntries([...listeners].filter(([, set]) => set.size).map(([key, set]) => [key, set.size])),
    observerCounts: () => ({ mutations: mutations.size, resizes: resizes.size }),
  };
};
