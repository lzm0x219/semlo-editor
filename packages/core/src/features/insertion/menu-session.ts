import type { Editor, Range } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import type { EditorOptions } from "../../types";
import type { BlockInsertTarget } from "../blocks/actions/target";
import { openEncryptedInsertion } from "../cards/encrypted-text";
import type { InteractiveInsertTarget } from "../interactive/interactive-card-insert";
import { prepareBlockInsertion } from "./block-insert";
import type { InteractiveKind } from "./commands";
import { openCardMenu } from "./menu";

export function createCardMenuSession({
  getEditor,
  syncTextSelection,
  closeOther,
  getCloseCardMenu,
  setCloseCardMenu,
  isDestroyed,
  documentWasReplaced,
  report,
  openURL,
  openAttachment,
  showEmoji,
  openMedia,
  openYuqueContent,
  insertInteractive,
  interactiveAvailable,
  getEncryptedTextProvider,
}: {
  getEditor: () => Editor | undefined;
  syncTextSelection: () => void;
  closeOther: () => void;
  getCloseCardMenu: () => (() => void) | undefined;
  setCloseCardMenu: (close: () => void) => void;
  isDestroyed: () => boolean;
  documentWasReplaced: (transaction: Transaction, appended: Transaction[]) => boolean;
  report: (error: unknown) => void;
  openURL: (
    kind: "link" | "image",
    focusText?: boolean,
    sync?: boolean,
    prepare?: () => boolean,
    slashRange?: Range,
    anchor?: HTMLElement,
  ) => void;
  openAttachment: (prepare?: () => boolean) => void;
  showEmoji: (anchor?: HTMLElement) => void;
  openMedia: (kind: "video" | "audio", prepare?: () => boolean) => void;
  openYuqueContent: (range?: Range, target?: BlockInsertTarget, anchor?: HTMLElement) => void;
  insertInteractive: (kind: "vote" | "checkin", target?: InteractiveInsertTarget) => void;
  interactiveAvailable: (kind: InteractiveKind) => boolean;
  getEncryptedTextProvider: () => EditorOptions["encryptedTextProvider"];
}) {
  return function showCardMenu(anchor?: HTMLElement, target?: BlockInsertTarget, focusSearch = true) {
    const editor = getEditor();
    if (!editor?.isEditable) return;
    syncTextSelection();
    const wasOpen = anchor?.getAttribute("aria-expanded") === "true";
    closeOther();
    if (wasOpen) return;
    const prepare = target
      ? (id: string) => {
          if (prepareBlockInsertion(editor, target, id)) return true;
          report(new Error("目标块已变化，无法在下方插入"));
          return false;
        }
      : undefined;
    const deferred = new Set([
      "image",
      "attachment",
      "localFile",
      "video",
      "audio",
      "link",
      "vote",
      "checkin",
      "yuque",
      "encrypted",
    ]);
    const invalidate = ({
      transaction,
      appendedTransactions = [],
    }: {
      transaction: Transaction;
      appendedTransactions?: Transaction[];
    }) => {
      if (isDestroyed() || editor.isDestroyed) return;
      const parts = [transaction, ...appendedTransactions];
      if (target && parts.some((part) => part.docChanged)) return getCloseCardMenu()?.();
      if (documentWasReplaced(transaction, appendedTransactions)) getCloseCardMenu()?.();
    };
    const close = openCardMenu(
      editor,
      () =>
        openURL(
          "image",
          false,
          true,
          prepare ? () => prepare("image") : undefined,
          undefined,
          target?.trigger ?? anchor,
        ),
      () => openAttachment(prepare ? () => prepare("attachment") : undefined),
      () => showEmoji(target?.trigger ?? anchor),
      (kind) => openMedia(kind, prepare ? () => prepare(kind) : undefined),
      () =>
        openURL("link", true, false, prepare ? () => prepare("link") : undefined, undefined, target?.trigger ?? anchor),
      anchor,
      target
        ? {
            onInteractive: (kind) =>
              kind === "encrypted"
                ? openEncryptedInsertion(editor, () => getEncryptedTextProvider(), {
                    kind: "below",
                    position: target.after,
                  })
                : kind === "yuque"
                  ? openYuqueContent(undefined, target, target.trigger)
                  : insertInteractive(kind, { kind: "below", target }),
            interactiveAvailable,
            getInsertPosition: () => (editor.state.doc.nodeAt(target.pos) === target.node ? target.pos : null),
            blockBelow: true,
            trigger: target.trigger,
            focusPanel: target.focusPanel,
            onOpen: target.onOpen,
            onChoose: target.closeMenu,
            onEscape: () => target.trigger.focus({ preventScroll: true }),
            beforeChoose: (id) => deferred.has(id) || !!prepare?.(id),
            onClose: () => {
              editor.off("transaction", invalidate);
              target.onClose();
            },
          }
        : {
            onInteractive: (kind) =>
              kind === "encrypted"
                ? openEncryptedInsertion(editor, () => getEncryptedTextProvider(), { kind: "selection" })
                : kind === "yuque"
                  ? openYuqueContent(undefined, undefined, anchor)
                  : insertInteractive(kind),
            interactiveAvailable,
            focusSearch,
            onClose: () => {
              editor.off("transaction", invalidate);
            },
          },
    );
    setCloseCardMenu(close);
    editor.on("transaction", invalidate);
    return close;
  };
}
