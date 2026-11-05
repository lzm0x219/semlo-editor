import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";

type Fixture = {
  first: EditorController;
  second: EditorController;
  metrics(): { headObservers: number; selection: number; scroll: number };
  settle(): Promise<void>;
};
declare global {
  interface Window {
    mountHomeLifecycle?(): void;
    homeLifecycle?: Fixture;
  }
}
window.mountHomeLifecycle = () => {
  document.body.replaceChildren();
  const nativeObserver = window.MutationObserver;
  const headObservers = new Set<MutationObserver>();
  window.MutationObserver = class extends nativeObserver {
    override observe(target: Node, options?: MutationObserverInit) {
      if (target === document.head) headObservers.add(this);
      super.observe(target, options);
    }
    override disconnect() {
      headObservers.delete(this);
      super.disconnect();
    }
  };
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const originalAdd = document.addEventListener.bind(document);
  const originalRemove = document.removeEventListener.bind(document);
  document.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (listener && (type === "selectionchange" || type === "scroll")) {
      let values = listeners.get(type);
      if (!values) listeners.set(type, (values = new Set()));
      values.add(listener);
    }
    if (listener) originalAdd(type, listener, options);
  }) as typeof document.addEventListener;
  document.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => {
    if (listener) listeners.get(type)?.delete(listener);
    if (listener) originalRemove(type, listener, options);
  }) as typeof document.removeEventListener;
  const content = {
    type: "doc" as const,
    content: [
      {
        type: "heading" as const,
        attrs: { level: 3 },
        content: [{ type: "text" as const, text: "alpha beta gamma delta epsilon zeta eta theta ".repeat(8) }],
      },
      { type: "paragraph" as const, content: [{ type: "text" as const, text: "NEXT" }] },
    ],
  };
  const create = (id: string) => {
    const element = document.createElement("div");
    element.id = id;
    element.style.width = "260px";
    document.body.append(element);
    return createEditor({ element, toolbar: false, outline: false, content });
  };
  const first = create("heading-home-life-a"),
    second = create("heading-home-life-b");
  window.homeLifecycle = {
    first,
    second,
    metrics: () => ({
      headObservers: headObservers.size,
      selection: listeners.get("selectionchange")?.size ?? 0,
      scroll: listeners.get("scroll")?.size ?? 0,
    }),
    settle: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  };
};
