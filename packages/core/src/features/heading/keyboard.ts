import { Extension } from "@tiptap/core";
import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { historyPosition, isProvableRedo } from "../../runtime/history-redo-probe";
import { rejoinSequenceParagraphs } from "../list/numbering-sequence-bridge";
import { getBoldState, toggleBold } from "../text/bold-command";
import { canJoinQuoteHeadingDeletion } from "../text/quote-keyboard";
import { setHeadingStyle as convertHeadingStyle } from "./conversion";
import {
  advanceHeadingDeletionLedger,
  emptyHeadingDeletionLedger,
  settleHeadingDeletionLedger,
  type HeadingDeletionLedger,
} from "./deletion-ledger";
import { headingNumberingStyle } from "./numbering";
import { selectedHeadingPosition, toggleHeadingNumbering } from "./numbering-toggle";
import { getHeadingSelection, type HeadingStyleLevel } from "./selection";

type EmptyHeadingHistory = { before: ProseMirrorNode; after: ProseMirrorNode; phase: "deleted" | "undone" };
type HeadingHistoryState = { recent: EmptyHeadingHistory | null; ledger: HeadingDeletionLedger };
const emptyHeadingHistoryKey = new PluginKey<HeadingHistoryState>("semloEditorEmptyHeadingHistory");

function selectedWholeSupportedHeading(state: EditorState): boolean {
  const { selection, doc } = state;
  if (!(selection instanceof TextSelection) || selection.empty || selection.ranges.length !== 1) return false;
  const { $from, $to } = selection;
  const heading = $from.parent;
  const root = doc.firstChild;
  const supportedContainer =
    root === heading ||
    (root?.type.name === "blockquote" &&
      root.childCount === 1 &&
      root.firstChild === heading &&
      heading.attrs.semloEditorHeadingNumbering == null);
  return (
    $from.sameParent($to) &&
    heading.type.name === "heading" &&
    doc.childCount === 1 &&
    supportedContainer &&
    $from.parentOffset === 0 &&
    $to.parentOffset === heading.content.size
  );
}

function leavesSupportedEmptyHeading(state: EditorState, doc: ProseMirrorNode): boolean {
  if (!selectedWholeSupportedHeading(state) || doc.childCount !== 1) return false;
  const oldRoot = state.doc.firstChild;
  const root = doc.firstChild;
  if (!oldRoot || !root || root.type !== oldRoot.type) return false;
  const heading = oldRoot === state.selection.$from.parent ? root : root.childCount === 1 ? root.firstChild : null;
  return heading?.type === state.selection.$from.parent.type && heading.content.size === 0;
}

function isMac(view: EditorView) {
  const platform = view.dom.ownerDocument.defaultView?.navigator.platform ?? "";
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function hasMod(view: EditorView, event: KeyboardEvent) {
  return isMac(view) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

function isAltGraph(view: EditorView, event: KeyboardEvent) {
  return !isMac(view) && event.getModifierState("AltGraph");
}

export function isBoldShortcut(view: EditorView, event: KeyboardEvent) {
  return hasMod(view, event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b";
}

function isHeadingNumberingShortcut(view: EditorView, event: KeyboardEvent) {
  return hasMod(view, event) && event.shiftKey && !event.altKey && (event.code === "Digit7" || event.key === "7");
}

export function headingStyleShortcut(
  view: EditorView,
  event: KeyboardEvent,
  allowAltGraph = false,
): HeadingStyleLevel | null {
  if (!hasMod(view, event) || !event.altKey || event.shiftKey) return null;
  if (!allowAltGraph && isAltGraph(view, event)) return null;
  // On some keyboard layouts Alt changes event.key (for example, 3 → £).
  const digit = /^Digit([0-6])$/.exec(event.code)?.[1] ?? (/^[0-6]$/.test(event.key) ? event.key : undefined);
  return digit === undefined ? null : (Number(digit) as HeadingStyleLevel);
}

/** Keep heading keyboard behavior consistent with the document editor. */
export const HeadingKeyboard = Extension.create({
  name: "semloEditorHeadingKeyboard",
  // Run before the starter kit's Backspace input-rule undo and bold keymaps.
  priority: 1001,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<HeadingHistoryState>({
        key: emptyHeadingHistoryKey,
        state: {
          init: () => ({ recent: null, ledger: emptyHeadingDeletionLedger() }),
          apply(transaction, previous, oldState) {
            const ownDeletion = transaction.getMeta(emptyHeadingHistoryKey) === "delete";
            const ledger = advanceHeadingDeletionLedger(previous.ledger, oldState, transaction, ownDeletion);
            let recent = previous.recent;
            if (ownDeletion) recent = { before: transaction.before, after: transaction.doc, phase: "deleted" };
            else if (transaction.docChanged && recent) {
              if (
                isHistoryTransaction(transaction) &&
                recent.phase === "deleted" &&
                transaction.before.eq(recent.after) &&
                transaction.doc.eq(recent.before)
              )
                recent = { ...recent, phase: "undone" };
              else if (
                isHistoryTransaction(transaction) &&
                recent.phase === "undone" &&
                transaction.before.eq(recent.before) &&
                transaction.doc.eq(recent.after)
              )
                recent = { ...recent, phase: "deleted" };
              else recent = null;
            }
            return { recent, ledger };
          },
        },
        filterTransaction(transaction, state) {
          // History transactions do not retain the original metadata. Retag
          // only the exact replay of this plugin's own selected-text deletion
          // before Tiptap's clearDocument append hook can inspect it.
          const previous = emptyHeadingHistoryKey.getState(state);
          const recent = previous?.recent;
          // Settling is read-only here: a later host filter can reject this
          // transaction, in which case plugin state must remain untouched.
          const ledger = previous && settleHeadingDeletionLedger(previous.ledger, state);
          const position = ledger?.slots.length ? historyPosition(state) : null;
          if (
            (recent?.phase === "undone" &&
              isHistoryTransaction(transaction) &&
              selectedWholeSupportedHeading(state) &&
              transaction.before.eq(recent.before) &&
              transaction.doc.eq(recent.after)) ||
            (position &&
              ledger?.slots.includes(position.done + 1) &&
              leavesSupportedEmptyHeading(state, transaction.doc) &&
              isProvableRedo(state, transaction))
          )
            transaction.setMeta("preventClearDocument", true);
          return true;
        },
        props: {
          handleDOMEvents: {
            keydown(view, event) {
              // Do not let later keymaps consume an IME key while leaving the
              // browser's default composition handling untouched.
              if (!view.editable || event.defaultPrevented || !(view.state.selection instanceof TextSelection))
                return false;
              // AltGr can look like Ctrl+Alt on Windows. Leave its character
              // input to the browser instead of invoking the default keymap.
              if (isAltGraph(view, event) && headingStyleShortcut(view, event, true) !== null) return true;
              if (!event.isComposing && event.keyCode !== 229) return false;
              if (headingStyleShortcut(view, event) !== null) return true;
              if (
                isHeadingNumberingShortcut(view, event) &&
                (selectedHeadingPosition(view.state) !== null || rejoinSequenceParagraphs(view.state, null) !== null)
              )
                return true;
              if (event.key !== "Backspace" && event.key !== "Delete" && !isBoldShortcut(view, event)) return false;
              return getHeadingSelection(view.state).headingsOnly;
            },
          },
          handleKeyDown(view, event) {
            if (
              event.defaultPrevented ||
              event.isComposing ||
              event.keyCode === 229 ||
              view.composing ||
              !view.editable
            )
              return false;
            const { state } = view;
            const { selection } = state;
            if (isBoldShortcut(view, event)) {
              try {
                if (!getBoldState(editor).enabled) return true;
                return toggleBold(editor, { focus: false });
              } catch (error) {
                event.preventDefault();
                throw error;
              }
            }
            if (!(selection instanceof TextSelection)) return false;
            if (isHeadingNumberingShortcut(view, event) && selectedHeadingPosition(state) !== null) {
              toggleHeadingNumbering(editor);
              return true;
            }
            if (isHeadingNumberingShortcut(view, event)) {
              const rejoin = rejoinSequenceParagraphs(state, null);
              if (rejoin !== null) {
                if (rejoin) {
                  view.dispatch(rejoin);
                  if (!editor.isDestroyed && !view.state.doc.eq(state.doc))
                    view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
                }
                return true;
              }
            }
            const level = headingStyleShortcut(view, event);
            if (level !== null) {
              try {
                convertHeadingStyle(editor, level, { toggle: true, joinQuoteHistory: true });
              } catch (error) {
                // 命令失败时也阻止浏览器默认编辑，避免重复修改 DOM。
                event.preventDefault();
                throw error;
              }
              return true;
            }
            if (
              (event.key === "Backspace" || event.key === "Delete") &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              selectedWholeSupportedHeading(state)
            ) {
              // Tiptap otherwise treats a selected single heading as a whole
              // document deletion and appends a paragraph reset.
              const joinQuoteHistory = canJoinQuoteHeadingDeletion(state);
              const transaction = state.tr
                .deleteSelection()
                .setMeta("preventClearDocument", true)
                .setMeta(emptyHeadingHistoryKey, "delete");
              if (!joinQuoteHistory) closeHistory(transaction);
              if (!transaction.docChanged) return false;
              view.dispatch(transaction.scrollIntoView());
              // A host filter can reject the deletion; in that case a
              // separate closeHistory would still alter later undo grouping.
              if (!joinQuoteHistory && !view.isDestroyed && !view.state.doc.eq(state.doc))
                view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
              return true;
            }
            if (
              event.key !== "Backspace" ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              !selection.empty ||
              selection.$from.parent.type.name !== "heading" ||
              selection.$from.parentOffset !== 0
            )
              return false;
            if (headingNumberingStyle(selection.$from.parent.attrs.semloEditorHeadingNumbering)) {
              const heading = selection.$from.parent;
              const transaction = closeHistory(state.tr).setNodeMarkup(selection.$from.before(), undefined, {
                ...heading.attrs,
                semloEditorHeadingNumbering: null,
              });
              view.dispatch(transaction);
              if (!view.isDestroyed) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
              return true;
            }
            const paragraph = state.schema.nodes.paragraph;
            if (!paragraph) return false;
            // Retain paragraph-compatible block attributes and all text marks.
            const transaction = closeHistory(state.tr).setBlockType(
              selection.from,
              selection.to,
              paragraph,
              selection.$from.parent.attrs,
            );
            if (!transaction.docChanged) return false;
            view.dispatch(transaction);
            // Separate the conversion from both prior and subsequent typing.
            if (!view.isDestroyed) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
            return true;
          },
        },
      }),
    ];
  },
});
