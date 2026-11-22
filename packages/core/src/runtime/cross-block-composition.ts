import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

type Composition = {
  token: object;
  viewToken: object;
  original: EditorState;
  selection: TextSelection;
  id: number | null;
  size: number;
};

const key = new PluginKey<Composition | null>("semloEditorCrossBlockComposition");
const confirmationKeys = new WeakSet<object>();

/** 候选文字尚未提交时，宿主快照仍以原文为准。 */
export function committedCompositionState(state: EditorState) {
  return key.getState(state)?.original ?? state;
}

/** 记录组合期间的确认键，按键本身仍交给系统输入法。 */
export function recordCompositionConfirmation(view: EditorView, event: KeyboardEvent) {
  const session = key.getState(view.state);
  if (!session || !event.isTrusted) return;
  if (event.key === "Enter" || event.key === " " || /^[1-9]$/.test(event.key)) confirmationKeys.add(session.token);
  else confirmationKeys.delete(session.token);
}

/** DOM 已由宿主更换或转为只读时，结束旧浏览器组合会话。 */
export function endObsoleteComposition(view: EditorView) {
  const Event = view.dom.ownerDocument.defaultView?.CompositionEvent;
  if (!view.isDestroyed && view.composing && Event) view.dispatchEvent(new Event("compositionend"));
}

function containsBlockAtom(selection: TextSelection) {
  const { from, to, $from, $to } = selection;
  if ($from.sameParent($to)) return false;
  let found = false;
  $from.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isBlock && node.isAtom && pos >= from && pos + node.nodeSize <= to) found = true;
    return !found;
  });
  return found;
}

function provisionalSize(doc: ProseMirrorNode, session: Composition): number | null {
  const from = session.selection.from;
  const size = doc.content.size - session.original.doc.content.size;
  if (size < 0) return null;
  if (!size) return doc.eq(session.original.doc) ? 0 : null;
  try {
    const inserted = doc.slice(from, from + size);
    if (inserted.openStart || inserted.openEnd || !inserted.content.content.every((node) => node.isText)) return null;
    // 只保护起点新增的候选文字。宿主若同时改了别处，交由宿主管理，不能回写旧选区。
    return doc.replace(from, from + size, Slice.empty).eq(session.original.doc) ? size : null;
  } catch {
    return null;
  }
}

function finish(view: EditorView, token: object, data: string) {
  if (view.isDestroyed || view.composing) return;
  const state = view.state;
  const session = key.getState(state);
  if (!session || session.token !== token) return;
  const original = session.selection;
  const from = original.from;
  const accepted = data && session.size && state.doc.textBetween(from, from + session.size, "", "") === data;
  const rollback = state.tr;
  if (session.size) rollback.delete(from, from + session.size);
  if (!rollback.doc.eq(session.original.doc)) return;
  const restored = TextSelection.create(rollback.doc, original.anchor, original.head);
  rollback.setSelection(restored).setMeta(key, null).setMeta("addToHistory", false).setMeta("preventUpdate", true);
  view.dispatch(rollback);

  if (
    !accepted ||
    view.isDestroyed ||
    !view.editable ||
    view.composing ||
    view.state.doc !== rollback.doc ||
    !view.state.selection.eq(restored)
  )
    return;
  // 从原反向选区生成唯一一条历史记录，取消及候选更新不占用历史。
  view.dispatch(closeHistory(view.state.tr.insertText(data)).scrollIntoView());
}

export const CrossBlockComposition = Extension.create<{ syncSelection: () => boolean }>({
  name: "semloEditorCrossBlockComposition",
  addProseMirrorPlugins() {
    const syncSelection = this.options.syncSelection;
    const viewTokens = new WeakMap<EditorView, object>();
    return [
      new Plugin<Composition | null>({
        key,
        view(view) {
          const viewToken = viewTokens.get(view) ?? {};
          viewTokens.set(view, viewToken);
          const session = key.getState(view.state);
          if (session && session.viewToken !== viewToken) queueMicrotask(() => finish(view, session.token, ""));
          return {};
        },
        state: {
          init: () => null,
          apply(transaction, session) {
            const next = transaction.getMeta(key) as Composition | null | undefined;
            if (next !== undefined) return next;
            return transaction.docChanged ? null : session;
          },
        },
        filterTransaction(transaction, state) {
          const session = key.getState(state);
          if (!session || !transaction.docChanged || transaction.getMeta(key) !== undefined) return true;
          const id = transaction.getMeta("composition");
          if (typeof id !== "number" || (session.id !== null && session.id !== id)) return true;
          const size = provisionalSize(transaction.doc, session);
          if (size !== null) transaction.setMeta(key, { ...session, id, size }).setMeta("addToHistory", false);
          return true;
        },
        props: {
          handleDOMEvents: {
            compositionstart(view, event) {
              const viewToken = viewTokens.get(view);
              if (
                !viewToken ||
                !event.isTrusted ||
                !view.editable ||
                view.composing ||
                key.getState(view.state) ||
                !syncSelection()
              )
                return false;
              const state = view.state;
              const selection = state.selection;
              if (!(selection instanceof TextSelection) || selection.empty || !containsBlockAtom(selection))
                return false;
              // 跨块选区会被浏览器先删除。把候选文字移到单一文本起点，确认时才真正替换选区。
              view.dispatch(
                state.tr
                  .setSelection(TextSelection.create(state.doc, selection.from))
                  .setMeta(key, {
                    token: {},
                    viewToken,
                    original: state,
                    selection,
                    id: null,
                    size: 0,
                  } satisfies Composition)
                  .setMeta("addToHistory", false),
              );
              return false;
            },
            compositionend(view, event) {
              const session = key.getState(view.state);
              if (session) {
                const { token } = session;
                // 桌面拼音有时以仍在编辑的拉丁候选结束。缺少确认键时保留原跨块选区。
                const interrupted =
                  !event.isTrusted && !confirmationKeys.has(token) && /^[a-z]+(?:'[a-z]+)*$/i.test(event.data);
                // 等待 ProseMirror 刷新 compositionend 之前的 DOM 改动。
                queueMicrotask(() => queueMicrotask(() => finish(view, token, interrupted ? "" : event.data)));
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
