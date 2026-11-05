import { Extension, type Editor } from "@tiptap/core";
import { Plugin, TextSelection, type Selection, type Transaction } from "@tiptap/pm/state";

import { runCleanupSteps } from "./cleanup";

export function createSelectionSync({
  getEditor,
  registerViewDisposer,
}: {
  getEditor: () => Editor | undefined;
  registerViewDisposer: (dispose: () => void) => () => void;
}) {
  let pointerStart: { selection: Selection; x: number; y: number; id: number } | undefined;
  let draggedFromSelection: Selection | undefined;
  let pointerViewDOM: HTMLElement | undefined;

  const syncTextSelection = () => {
    const editor = getEditor();
    if (!editor || editor.isDestroyed || !editor.view.hasFocus() || editor.view.composing) return;
    const selection = editor.view.dom.ownerDocument.getSelection();
    if (
      !selection?.anchorNode ||
      !selection.focusNode ||
      !editor.view.dom.contains(selection.anchorNode) ||
      !editor.view.dom.contains(selection.focusNode)
    )
      return;
    const current = editor.state.selection;
    // Browser ranges are unreliable for cell, node and all-document selections.
    // A real subsequent text drag is the one case where its range is newer than
    // a still-unsynchronized non-text ProseMirror selection.
    if (
      !(current instanceof TextSelection) &&
      !(draggedFromSelection?.eq(current) && !selection.isCollapsed && selection.toString().length)
    )
      return;
    draggedFromSelection = undefined;
    let next: Selection | undefined;
    try {
      const anchor = editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset);
      const head = editor.view.posAtDOM(selection.focusNode, selection.focusOffset);
      const { doc: pmDoc } = editor.state;
      if (current.anchor !== anchor || current.head !== head)
        next = TextSelection.between(pmDoc.resolve(anchor), pmDoc.resolve(head));
    } catch {
      /* DOM can change while a selection is being updated */
      return;
    }
    if (next) editor.view.dispatch(editor.state.tr.setSelection(next));
  };

  function pointerDown(event: PointerEvent) {
    const editor = getEditor();
    if (
      !editor ||
      editor.isDestroyed ||
      event.button !== 0 ||
      !editor.view.dom.contains(event.target as globalThis.Node)
    )
      return;
    pointerStart = undefined;
    draggedFromSelection = undefined;
    const blocked = (event.target as Element).closest?.('[contenteditable="false"]');
    if (blocked && editor.view.dom.contains(blocked)) return;
    pointerStart = { selection: editor.state.selection, x: event.clientX, y: event.clientY, id: event.pointerId };
  }
  function pointerUp(event: PointerEvent) {
    const editor = getEditor()!;
    if (pointerStart?.id !== event.pointerId) return;
    if (
      pointerStart.selection.eq(editor.state.selection) &&
      Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 3
    )
      draggedFromSelection = pointerStart.selection;
    pointerStart = undefined;
  }
  function pointerCancel() {
    pointerStart = undefined;
    draggedFromSelection = undefined;
  }

  const createPointerExtension = () =>
    Extension.create({
      name: "semloEditorPointerSelectionLifecycle",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            view(view) {
              const dom = view.dom;
              const owner = dom.ownerDocument;
              if (pointerViewDOM && pointerViewDOM !== dom) pointerCancel();
              pointerViewDOM = dom;
              let disposed = false;
              let unregister: (() => void) | undefined;
              const dispose = () => {
                if (disposed) return;
                disposed = true;
                const detach = unregister;
                unregister = undefined;
                runCleanupSteps(
                  [
                    () => detach?.(),
                    () => dom.removeEventListener("pointerdown", pointerDown, true),
                    () => owner.removeEventListener("pointerup", pointerUp, true),
                    () => owner.removeEventListener("pointercancel", pointerCancel, true),
                  ],
                  "Pointer listener cleanup failed",
                );
              };
              unregister = registerViewDisposer(dispose);
              if (disposed) {
                unregister();
                return { destroy: dispose };
              }
              try {
                dom.addEventListener("pointerdown", pointerDown, true);
                owner.addEventListener("pointerup", pointerUp, true);
                owner.addEventListener("pointercancel", pointerCancel, true);
              } catch (error) {
                runCleanupSteps(
                  [
                    () => {
                      throw error;
                    },
                    dispose,
                  ],
                  "Pointer listener setup failed",
                );
              }
              return { destroy: dispose };
            },
          }),
        ];
      },
    });

  const onTransaction = (transaction: Transaction, appendedTransactions: Transaction[]) => {
    const editor = getEditor()!;
    if ([transaction, ...appendedTransactions].some((part) => part.docChanged)) {
      pointerStart = undefined;
      draggedFromSelection = undefined;
    } else if (draggedFromSelection && !draggedFromSelection.eq(editor.state.selection))
      draggedFromSelection = undefined;
  };
  const reset = () => {
    pointerCancel();
    pointerViewDOM = undefined;
  };
  return { syncTextSelection, createPointerExtension, onTransaction, reset };
}
