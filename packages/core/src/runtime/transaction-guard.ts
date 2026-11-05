import { Editor, Extension, type EditorEvents, type EditorOptions } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Protect dispatches through the editor view and its dispatchTransaction props.
// Replacing view.dispatch itself or applying state directly bypasses this boundary.
export class ReentrantTransactionError extends Error {
  constructor() {
    super("A transaction cannot be dispatched before the current transaction commits");
    this.name = "ReentrantTransactionError";
  }
}
export class TransactionAbortedError extends Error {
  constructor() {
    super("The editor was destroyed or unmounted before the transaction committed");
    this.name = "TransactionAbortedError";
  }
}

type Frame = {
  transaction: Transaction;
  previous: Frame | null;
  committed: boolean;
  blocking: boolean;
  conflict: Error | null;
  inBefore: boolean;
  nextState: EditorState | null;
  bridgePending: boolean;
};
const frames = new WeakMap<Editor, { frame: Frame | null }>();
const wrappedViews = new WeakSet<EditorView>();
const sentinels = new WeakMap<Editor, Plugin>();
const destroyingEditors = new WeakSet<Editor>();
function gate(editor: Editor) {
  let state = frames.get(editor);
  if (!state) frames.set(editor, (state = { frame: null }));
  return state;
}
export function assertTransactionMayStart(editor: Editor) {
  const state = gate(editor);
  if (state.frame?.blocking) {
    const frame = state.frame;
    if (!frame.inBefore && frame.nextState && editor.state === frame.nextState) {
      frame.blocking = false;
      frame.committed = true;
    } else {
      const error = new ReentrantTransactionError();
      frame.conflict = error;
      throw error;
    }
  }
}
function guarded(editor: Editor, transaction: Transaction, next: (tr: Transaction) => void, bridgePending = false) {
  const state = gate(editor);
  assertTransactionMayStart(editor);
  const frame: Frame = {
    transaction,
    previous: state.frame,
    committed: false,
    blocking: true,
    conflict: null,
    inBefore: false,
    nextState: null,
    bridgePending,
  };
  state.frame = frame;
  try {
    next(transaction);
    if (frame.conflict && !frame.committed) throw frame.conflict;
  } finally {
    state.frame = frame.previous;
  }
}
function protectView(editor: Editor, view: EditorView) {
  if (wrappedViews.has(view)) return;
  const dispatch = view.dispatch;
  wrappedViews.add(view);
  view.dispatch = (transaction) => guarded(editor, transaction, dispatch, true);
}
function sentinel(editor: Editor) {
  let plugin = sentinels.get(editor);
  if (!plugin) {
    const deferFocusEvent = (focused: boolean, event: Event) => {
      if (!gate(editor).frame?.blocking) return false;
      editor.isFocused = focused;
      if (!destroyingEditors.has(editor)) {
        const view = editor.view;
        queueMicrotask(() => {
          if (editor.isDestroyed || editor.view !== view) return;
          view.dispatch(editor.state.tr.setMeta(focused ? "focus" : "blur", { event }).setMeta("addToHistory", false));
        });
      }
      return true;
    };
    plugin = new Plugin({
      props: {
        handleDOMEvents: {
          // 宿主可能在事务回调中移动焦点；状态先同步，通知在当前事务结束后发送。
          focus: (_view, event) => deferFocusEvent(true, event),
          blur: (_view, event) => deferFocusEvent(false, event),
        },
      },
      view(view) {
        protectView(editor, view);
        return {};
      },
    });
    sentinels.set(editor, plugin);
  }
  return plugin;
}

export const TransactionGuard = Extension.create({
  name: "semloEditorTransactionGuard",
  priority: Infinity,
  addProseMirrorPlugins() {
    return [sentinel(this.editor)];
  },
  dispatchTransaction({ transaction, next }) {
    const frame = gate(this.editor).frame;
    if (frame?.bridgePending && frame.transaction === transaction) {
      frame.bridgePending = false;
      return next(transaction);
    }
    guarded(this.editor, transaction, next);
  },
});

export class TransactionGuardEditor extends Editor {
  override destroy() {
    const alreadyDestroying = destroyingEditors.has(this);
    destroyingEditors.add(this);
    try {
      return super.destroy();
    } finally {
      if (!alreadyDestroying) destroyingEditors.delete(this);
    }
  }

  override mount(element: NonNullable<EditorOptions["element"]> & {}) {
    const view = super.view;
    const state = view.state;
    const guardPlugin = sentinel(this);
    if (state.plugins[0] !== guardPlugin)
      view.updateState(
        state.reconfigure({ plugins: [guardPlugin, ...state.plugins.filter((p) => p !== guardPlugin)] }),
      );
    return super.mount(element);
  }

  override get view() {
    const view = super.view;
    if (!super.isDestroyed) {
      protectView(this, view);
      return view;
    }
    return new Proxy(view, {
      get: (target, property, receiver) => {
        if (property !== "dispatch") return Reflect.get(target, property, receiver);
        return (transaction: Transaction) => {
          if (!this.isDestroyed) return target.dispatch(transaction);
          return guarded(this, transaction, (tr) => target.dispatch(tr));
        };
      },
    });
  }

  override emit<K extends keyof EditorEvents>(
    event: K,
    ...args: EditorEvents[K] extends any[] ? EditorEvents[K] : [EditorEvents[K]]
  ): this {
    const frame = gate(this).frame;
    const payload = args[0] as { transaction?: Transaction; nextState?: EditorState } | undefined;
    if (event === "beforeTransaction" && frame && payload?.transaction === frame.transaction) {
      frame.nextState = payload.nextState ?? null;
      frame.inBefore = true;
      const wasDestroyed = this.isDestroyed;
      try {
        const result = super.emit(event, ...args);
        if (!wasDestroyed && this.isDestroyed) {
          const error = new TransactionAbortedError();
          frame.conflict = error;
          throw error;
        }
        return result;
      } finally {
        frame.inBefore = false;
      }
    }
    if (event === "transaction" && frame && payload?.transaction === frame.transaction) {
      frame.committed = true;
      frame.blocking = false;
    }
    return super.emit(event, ...args);
  }
}
