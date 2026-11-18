import type { EditorView } from "@tiptap/pm/view";

export function deferDomSelectionUntilKey(view: EditorView, key: string): void {
  // 鼠标点击和 DOM 观察器的回调是独立任务。暂停后者，直到真实按键到达。
  const observer = Reflect.get(view, "domObserver") as { flush: () => void };
  const flush = observer.flush;
  observer.flush = () => {};
  const restore = (event: KeyboardEvent) => {
    if (event.key !== key) return;
    observer.flush = flush;
    view.dom.removeEventListener("keydown", restore, true);
  };
  view.dom.addEventListener("keydown", restore, true);
}
