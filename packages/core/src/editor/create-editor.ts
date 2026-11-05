import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import {
  invalidateEncryptedProvider,
  markEncryptedProviderChanged,
  openEncryptedInsertion,
} from "../features/cards/encrypted-text";
import { configureCodeRunner } from "../features/code-block/runner";
import { configureCodePreferences } from "../features/code-block/settings";
import { configureHeadingFoldPreferences, expandHeadingAncestors } from "../features/heading/fold";
import { headingStyleShortcut, isBoldShortcut } from "../features/heading/keyboard";
import { mountHeadingNumberingInteraction } from "../features/heading/numbering-interaction";
import { openEmojiPicker } from "../features/insertion/emoji";
import { slashSuggestionKey } from "../features/insertion/keys";
import { createCardMenuSession } from "../features/insertion/menu-session";
import { slashHistoryCandidate } from "../features/insertion/slash-history-candidate";
import {
  closeSlashSuggestion,
  invalidateSlashSuggestion,
  reconcileSlashInvalidation,
  slashSuggestionIsInvalidated,
} from "../features/insertion/suggestion";
import {
  InteractiveCardHostController,
  canCreateInteractiveActivity,
} from "../features/interactive/interactive-card-host";
import {
  insertInteractiveCard,
  defaultCheckinConfig,
  defaultVoteConfig,
  type InteractiveInsertTarget,
} from "../features/interactive/interactive-card-insert";
import { clearAttachments, uploadAttachments } from "../features/media/attachment/uploads";
import { clearGalleryUploads } from "../features/media/gallery/uploads";
import { clearUploads, uploadImages } from "../features/media/image/uploads";
import { setEmbedMetadataResolver } from "../features/references/embed-bookmark";
import { refreshMentionSuggestion } from "../features/references/mention";
import { createYuqueContentSession } from "../features/references/yuque-content-session";
import { cancelTableResize } from "../features/table/resize";
import { mountTableToolbar } from "../features/table/toolbar";
import { extractDocumentFontHTML, readDocumentFont } from "../features/text/document-font";
import { applyHighlightColor, DEFAULT_HIGHLIGHT_COLOR } from "../features/text/highlight";
import { createIntegrationBindings } from "../integrations/bindings";
import { createIntegrationUpdateCoordinator } from "../integrations/update-coordinator";
import { createSelectionSync } from "../runtime/selection-sync";
import type { EditorControllerWithResults, EditorOptions } from "../types";
import { mountFindReplace, type FindReplaceController } from "../ui/find/find-replace";
import { mountFormatPainter } from "../ui/format-painter/format-painter";
import { mountOutline } from "../ui/outline/outline";
import { createBubbleToolbar } from "../ui/toolbar/bubble";
import { mountToolbarColorShortcuts } from "../ui/toolbar/color-shortcuts";
import { createDefaultToolbar } from "../ui/toolbar/default-toolbar";
import { mountToolbarOverflow, type ToolbarOverflowController } from "../ui/toolbar/overflow";
import { createToolbarRoot } from "../ui/toolbar/toolbar";
import { mountTranslationPanel, type TranslationPanelController } from "../ui/toolbar/translation";
import { initializeEditorContent } from "./content/initialize";
import { createContentReplacement } from "./content/replace";
import { getEditorSnapshot } from "./content/snapshot";
import { createControllerEditorClass } from "./controlled-editor";
import { createEditorExtensions } from "./extensions";
import { createEditorLifecycle } from "./lifecycle";
import { createUrlSession } from "./url-session";

function lineHeightShortcut(view: EditorView, event: KeyboardEvent): boolean {
  const platform = view.dom.ownerDocument.defaultView?.navigator.platform ?? "";
  const mac = /Mac|iPhone|iPad|iPod/i.test(platform);
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod || !event.altKey) return false;
  // Match prosemirror-keymap's direct and modifier fallback paths. A shifted
  // event whose key is still a bracket also reaches its unshifted binding.
  let name = event.key;
  if (!name || name === "Unidentified") {
    if (event.keyCode === 219) name = event.shiftKey ? "{" : "[";
    else if (event.keyCode === 221) name = event.shiftKey ? "}" : "]";
  }
  if (name === "[" || name === "]") return true;
  return (
    !event.shiftKey &&
    name.length === 1 &&
    !(/Win/i.test(platform) && event.ctrlKey && event.altKey) &&
    (event.keyCode === 219 || event.keyCode === 221)
  );
}

/** Create a standalone editor. Only the supplied element is owned and cleared on destroy. */
export function createEditor(options: EditorOptions): EditorControllerWithResults {
  const doc = options.element.ownerDocument;
  const shell = doc.createElement("div");
  shell.className = "semlo-editor";
  const toolbarFactory = typeof options.toolbar === "function" ? options.toolbar : undefined;
  const floatingToolbarOption = options.floatingToolbar;
  const floatingToolbarFactory = typeof floatingToolbarOption === "function" ? floatingToolbarOption : undefined;
  const floatingToolbarEnabled =
    floatingToolbarOption === undefined ? options.toolbar !== false : floatingToolbarOption !== false;
  const toolbar = !toolbarFactory && options.toolbar !== false ? createToolbarRoot(doc) : undefined;
  const customToolbar = toolbarFactory ? doc.createElement("div") : undefined;
  if (customToolbar) {
    customToolbar.className = "semlo-editor-custom-toolbar";
    customToolbar.setAttribute("role", "toolbar");
    customToolbar.setAttribute("aria-label", "文本格式");
  }
  const bubbleToolbar = floatingToolbarEnabled ? createBubbleToolbar(doc, customToolbar ?? toolbar) : undefined;
  const contentArea = doc.createElement("div");
  contentArea.className = "semlo-editor-content";
  const editorBody = doc.createElement("div");
  editorBody.className = "semlo-editor-editor-body";
  const errorBox = doc.createElement("div");
  errorBox.className = "semlo-editor-error";
  errorBox.hidden = true;
  errorBox.setAttribute("role", "alert");
  const errorMessage = doc.createElement("span");
  const dismissError = doc.createElement("button");
  dismissError.type = "button";
  dismissError.className = "semlo-editor-error-dismiss";
  dismissError.setAttribute("aria-label", "关闭错误提示");
  dismissError.addEventListener("click", () => {
    errorBox.hidden = true;
    errorMessage.textContent = "";
    if (!lifecycle.destroyed && !editor.isDestroyed) editor.view.focus();
  });
  errorBox.append(errorMessage, dismissError);
  const mount = doc.createElement("div");
  contentArea.append(mount);
  editorBody.append(contentArea);
  if (customToolbar) shell.append(customToolbar);
  else if (options.toolbar !== false && toolbar) shell.append(toolbar);
  shell.append(errorBox, editorBody);
  if (bubbleToolbar) shell.append(bubbleToolbar.element);
  const lifecycle = createEditorLifecycle();
  let editor!: Editor;
  const unavailable = () => lifecycle.destroyed || lifecycle.editorDestroying || !editor;
  const viewUnavailable = () => unavailable() || editor.isDestroyed;
  const { registerViewDisposer, closeViewDisposers } = lifecycle;
  const integrations = createIntegrationBindings(options);
  const interactiveController = new InteractiveCardHostController(options.interactiveCardHost ?? null);
  let mentionRefreshQueued = false;
  const report = (error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    errorMessage.textContent = normalized.message;
    errorBox.hidden = false;
    options.onError?.(normalized);
  };
  const snapshot = () => getEditorSnapshot(editor, doc);
  const selectionSync = createSelectionSync({ getEditor: () => editor, registerViewDisposer });
  const { syncTextSelection } = selectionSync;
  let closeDropdown: (() => void) | undefined;
  let closeEmoji: (() => void) | undefined;
  let closeFonts: (() => void) | undefined;
  const defaultToolbar = toolbar
    ? createDefaultToolbar({
        doc,
        toolbar,
        shell,
        syncTextSelection,
        primaryContext: {
          get editor() {
            return editor;
          },
          get closeDropdown() {
            return closeDropdown;
          },
          set closeDropdown(value) {
            closeDropdown = value;
          },
          get closeFonts() {
            return closeFonts;
          },
          set closeFonts(value) {
            closeFonts = value;
          },
          closePopover: () => closePopover(),
          get closeCardMenu() {
            return closeCardMenu;
          },
          get closeEmoji() {
            return closeEmoji;
          },
          showCardMenu: (anchor, target, focusSearch) => showCardMenu(anchor, target, focusSearch),
        },
      })
    : undefined;
  const refresh = () => {
    if (viewUnavailable()) return;
    if (defaultToolbar) defaultToolbar.refresh(editor);
    if (viewUnavailable()) return;
    bubbleToolbar?.refresh(editor);
    if (!defaultToolbar) {
      shell.classList.toggle("semlo-editor-readonly", !editor.isEditable);
      editor.view.dom.setAttribute("aria-readonly", String(!editor.isEditable));
    }
  };

  let popover: HTMLElement | undefined;
  let removePopoverListeners: (() => void) | undefined;
  let refreshImageUploadAction: (() => void) | undefined;
  let pendingImageInsert: (() => boolean) | undefined;
  let pendingAttachmentInsert: (() => boolean) | undefined;
  const pendingMediaInsert: Partial<Record<"video" | "audio", () => boolean>> = {};
  const closePopover = () => {
    removePopoverListeners?.();
    removePopoverListeners = undefined;
    refreshImageUploadAction = undefined;
    popover?.remove();
    popover = undefined;
  };
  const openURL = createUrlSession({
    document: doc,
    shell,
    getEditor: () => editor,
    isDestroyed: () => lifecycle.destroyed,
    syncTextSelection,
    beforeOpen: () => {
      closeFonts?.();
      closePopover();
    },
    closePopover,
    imageUploadAvailable: () => Boolean(integrations.current.uploadImage),
    setRefreshImageUploadAction: (refresh) => {
      refreshImageUploadAction = refresh;
    },
    requestImageFile: (prepare) => {
      pendingImageInsert = prepare;
      closePopover();
      fileInput.click();
    },
    mountPopover: (element) => {
      popover = element;
      return (cleanup) => {
        removePopoverListeners = cleanup;
      };
    },
  });
  function insertInteractive(kind: "vote" | "checkin", target?: InteractiveInsertTarget) {
    const onAbandoned = integrations.current.onInteractiveCardAbandoned;
    if (!canCreateInteractiveActivity(interactiveController.getHost(), kind, onAbandoned) || !onAbandoned) {
      report(new Error("请先配置互动卡片服务和未插入活动回调"));
      return;
    }
    void insertInteractiveCard({
      editor,
      host: interactiveController,
      config: kind === "vote" ? defaultVoteConfig() : defaultCheckinConfig(),
      target,
      onAbandoned,
    }).then((result) => {
      if (result.status === "failed" && !lifecycle.destroyed) report(result.error);
    });
  }
  const interactiveAvailable = (kind: "vote" | "checkin" | "yuque" | "encrypted") =>
    kind === "encrypted"
      ? typeof integrations.current.encryptedTextProvider?.encrypt === "function" &&
        typeof integrations.current.encryptedTextProvider?.decrypt === "function"
      : kind === "yuque"
        ? typeof integrations.current.yuqueContentProvider?.search === "function" &&
          typeof integrations.current.yuqueContentProvider?.resolveLink === "function"
        : canCreateInteractiveActivity(
            interactiveController.getHost(),
            kind,
            integrations.current.onInteractiveCardAbandoned,
          );
  const { open: openYuqueContent, close: closeYuqueContent } = createYuqueContentSession({
    document: doc,
    shell,
    getEditor: () => editor,
    getProvider: () => integrations.current.yuqueContentProvider,
    closeOther: () => {
      closePopover();
      closeDropdown?.();
      closeEmoji?.();
      closeFonts?.();
      closeCardMenu?.();
    },
    closePopover,
    registerPopover: (element, close) => {
      popover = element;
      removePopoverListeners = close;
    },
    report,
  });
  let closeCardMenu: (() => void) | undefined;
  function documentWasReplaced(transaction: Transaction, appendedTransactions: Transaction[] = []) {
    const replaced = [transaction, ...appendedTransactions].some((part) =>
      part.mapping.maps.some((map, index) => {
        const prior = part.docs[index];
        let wholeDocument = false;
        map.forEach((start, end, newStart) => {
          if (prior && start === 0 && end === prior.content.size && newStart === 0) wholeDocument = true;
        });
        return wholeDocument;
      }),
    );
    if (!replaced) return false;
    const before = transaction.before;
    const after = editor.state.doc;
    if (
      before.eq(after) &&
      before.childCount === after.childCount &&
      Array.from({ length: before.childCount }, (_, index) => before.child(index) === after.child(index)).every(Boolean)
    )
      return false;
    return true;
  }
  const showCardMenu = createCardMenuSession({
    getEditor: () => editor,
    syncTextSelection,
    closeOther: () => {
      closePopover();
      closeDropdown?.();
      closeEmoji?.();
      closeFonts?.();
      closeCardMenu?.();
    },
    getCloseCardMenu: () => closeCardMenu,
    setCloseCardMenu: (close) => {
      closeCardMenu = close;
    },
    isDestroyed: () => lifecycle.destroyed,
    documentWasReplaced,
    report,
    openURL,
    openAttachment,
    showEmoji,
    openMedia,
    openYuqueContent,
    insertInteractive,
    interactiveAvailable,
    getEncryptedTextProvider: () => integrations.current.encryptedTextProvider,
  });
  function showEmoji(anchor?: HTMLElement) {
    if (!editor?.isEditable) return;
    closePopover();
    closeDropdown?.();
    closeCardMenu?.();
    closeFonts?.();
    closeEmoji?.();
    closeEmoji = openEmojiPicker(editor, anchor);
  }
  defaultToolbar?.mountFormatting({
    get editor() {
      return editor;
    },
    get closeDropdown() {
      return closeDropdown;
    },
    set closeDropdown(value) {
      closeDropdown = value;
    },
    closePopover: () => closePopover(),
    get closeCardMenu() {
      return closeCardMenu;
    },
    get closeEmoji() {
      return closeEmoji;
    },
    get closeFonts() {
      return closeFonts;
    },
    openLink: (anchor) => openURL("link", false, true, undefined, undefined, anchor),
  });
  const defaultActions = defaultToolbar?.mountActions({
    translationAvailable: Boolean(integrations.current.translate),
    openTranslation: (anchor) => translationPanel?.open(anchor),
  });
  if (bubbleToolbar && !floatingToolbarFactory)
    bubbleToolbar.mount({
      syncTextSelection,
      getEditor: () => editor,
      openLink: (anchor) => openURL("link", false, true, undefined, undefined, anchor),
    });
  const fileInput = doc.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  shell.append(fileInput);
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    const prepare = pendingImageInsert;
    pendingImageInsert = undefined;
    if (!file || lifecycle.destroyed || !editor.isEditable) return;
    if (!integrations.current.uploadImage) {
      report(new Error("请先配置图片上传"));
      return;
    }
    if (!prepare || prepare())
      uploadImages(editor, [file], editor.state.selection.from, integrations.current.uploadImage, report, true);
  });
  fileInput.addEventListener("cancel", () => {
    pendingImageInsert = undefined;
  });
  const attachmentInput = doc.createElement("input");
  attachmentInput.type = "file";
  attachmentInput.multiple = true;
  attachmentInput.hidden = true;
  shell.append(attachmentInput);
  attachmentInput.addEventListener("change", () => {
    const files = Array.from(attachmentInput.files ?? []);
    attachmentInput.value = "";
    const prepare = pendingAttachmentInsert;
    pendingAttachmentInsert = undefined;
    if (!files.length || lifecycle.destroyed || !editor.isEditable) return;
    if (!integrations.current.uploadAttachment) {
      report(new Error("请先配置附件上传"));
      return;
    }
    if (!prepare || prepare())
      uploadAttachments(editor, files, editor.state.selection.from, integrations.current.uploadAttachment, report);
  });
  attachmentInput.addEventListener("cancel", () => {
    pendingAttachmentInsert = undefined;
  });
  function openAttachment(prepare?: () => boolean) {
    if (!integrations.current.uploadAttachment) {
      report(new Error("请先配置附件上传"));
      return;
    }
    pendingAttachmentInsert = prepare;
    attachmentInput.click();
  }
  const mediaInputs = Object.fromEntries(
    (["video", "audio"] as const).map((kind) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.accept = `${kind}/*`;
      input.hidden = true;
      input.dataset.semloEditorMediaInput = kind;
      shell.append(input);
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        input.value = "";
        const prepare = pendingMediaInsert[kind];
        delete pendingMediaInsert[kind];
        if (!file || lifecycle.destroyed || !editor.isEditable) return;
        if (!integrations.current.uploadAttachment) {
          report(new Error("请先配置附件上传"));
          return;
        }
        const extension = kind === "video" ? /\.(mp4|webm|mov|m4v|ogv)$/i : /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i;
        if (!file.type.startsWith(`${kind}/`) && !extension.test(file.name)) {
          report(new Error(`请选择${kind === "video" ? "视频" : "音频"}文件`));
          return;
        }
        if (!prepare || prepare())
          uploadAttachments(
            editor,
            [file],
            editor.state.selection.from,
            integrations.current.uploadAttachment,
            report,
            kind,
          );
      });
      input.addEventListener("cancel", () => {
        delete pendingMediaInsert[kind];
      });
      return [kind, input];
    }),
  ) as Record<"video" | "audio", HTMLInputElement>;
  function openMedia(kind: "video" | "audio", prepare?: () => boolean) {
    if (!integrations.current.uploadAttachment) {
      report(new Error("请先配置附件上传"));
      return;
    }
    pendingMediaInsert[kind] = prepare;
    mediaInputs[kind].click();
  }
  const { createPointerExtension } = selectionSync;
  const ControllerEditor = createControllerEditorClass(lifecycle);
  options.element.append(shell);
  try {
    const initialFont = typeof options.content === "string" ? extractDocumentFontHTML(options.content, doc) : null;
    if (options.content && typeof options.content !== "string") readDocumentFont(options.content.attrs ?? {});
    editor = new ControllerEditor({
      element: mount,
      // Resolve old block-image snapshots after the actual extension schema is
      // available, including any textblocks supplied by the host application.
      content: { type: "doc", content: [{ type: "paragraph" }] },
      editable: options.editable !== false,
      extensions: createEditorExtensions({
        options,
        bubbleExtension: bubbleToolbar?.createExtension,
        getIntegrations: () => integrations.current,
        interactiveController,
        registerViewDisposer,
        pointerExtension: createPointerExtension,
        openInsertBelow: (_editor, target) => showCardMenu(target.anchor, target),
        openLink: () => openURL("link"),
        slashActions: [
          () => openURL("image"),
          openAttachment,
          showEmoji,
          openMedia,
          (range) => openURL("link", true, false, undefined, range),
          showCardMenu,
          (kind, range) =>
            kind === "encrypted"
              ? openEncryptedInsertion(editor, () => integrations.current.encryptedTextProvider, {
                  kind: "selection",
                  range,
                })
              : kind === "yuque"
                ? openYuqueContent(range)
                : insertInteractive(kind, range ? { kind: "slash", range } : undefined),
          interactiveAvailable,
        ],
        report,
      }),
      editorProps: {
        attributes: {
          class: "semlo-editor-prose",
          "aria-label": "文档内容",
          role: "textbox",
          "aria-multiline": "true",
        },
        handleDOMEvents: {
          // A click or arrow-key movement can update the browser selection
          // before ProseMirror's deferred selectionchange handler runs.
          // Capture it before operations that modify content; non-text
          // selections and IME composition are preserved.
          paste: () => {
            syncTextSelection();
            return false;
          },
          keydown: (view, event) => {
            if (view.editable && !event.defaultPrevented && lineHeightShortcut(view, event)) {
              const platform = view.dom.ownerDocument.defaultView?.navigator.platform ?? "";
              const altGraph = !/Mac|iPhone|iPad|iPod/i.test(platform) && event.getModifierState("AltGraph");
              if (event.isComposing || event.keyCode === 229 || view.composing || altGraph) return true;
              syncTextSelection();
              return false;
            }
            if (
              !event.isComposing &&
              event.keyCode !== 229 &&
              (event.key === "Backspace" ||
                event.key === "Delete" ||
                event.key === "Enter" ||
                (view.editable &&
                  !event.defaultPrevented &&
                  event.key === "Tab" &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey) ||
                (view.editable && !view.composing && !event.defaultPrevented && isBoldShortcut(view, event)) ||
                (view.editable && !event.defaultPrevented && headingStyleShortcut(view, event) !== null))
            )
              syncTextSelection();
            return false;
          },
        },
      },
      onUpdate: () => {
        if (!viewUnavailable()) options.onChange?.(snapshot());
      },
      onSelectionUpdate: refresh,
      onTransaction: refresh,
    });
    editor.registerPlugin(slashHistoryCandidate());
    configureCodePreferences(editor, options.codeBlockPreferences ?? null);
    configureCodeRunner(editor, options.runCode ?? null, report);
    initializeEditorContent(editor, options.content, initialFont);
    configureHeadingFoldPreferences(editor, options.headingFoldPreferences ?? null);
  } catch (error) {
    lifecycle.failInitialization(error, [
      () => closeViewDisposers(),
      () => bubbleToolbar?.dispose(),
      () => {
        if (editor) editor.destroy();
      },
      () => shell.remove(),
    ]);
  }
  let unmountOutline: (() => void) | undefined;
  let unmountPainter: (() => void) | undefined;
  let unmountTableToolbar: (() => void) | undefined;
  let unmountHeadingNumbering: (() => void) | undefined;
  let findReplace: FindReplaceController | undefined;
  let toolbarOverflow: ToolbarOverflowController | undefined;
  let translationPanel: TranslationPanelController | undefined;
  let unmountColorShortcuts: (() => void) | undefined;
  try {
    unmountColorShortcuts = mountToolbarColorShortcuts(editor, () => {
      if (defaultToolbar) {
        defaultToolbar.applyHighlightColor();
        return;
      }
      syncTextSelection();
      closeDropdown?.();
      closePopover();
      closeCardMenu?.();
      applyHighlightColor(editor, DEFAULT_HIGHLIGHT_COLOR, false, Symbol("color-apply"));
    });
    translationPanel = mountTranslationPanel(editor, editorBody, () => integrations.current.translate, report);
    unmountHeadingNumbering = mountHeadingNumberingInteraction(editor);
    findReplace = mountFindReplace(editor, defaultActions?.findButton, shell);
    if (options.toolbar !== false && toolbar && defaultActions)
      toolbarOverflow = mountToolbarOverflow(toolbar, shell, defaultActions.moreButton);
    if (options.toolbar !== false) unmountTableToolbar = mountTableToolbar(editor, shell);
    if (options.outline !== false)
      unmountOutline = mountOutline(editor, editorBody, (pos) => {
        expandHeadingAncestors(editor, pos);
      });
    unmountPainter = mountFormatPainter(editor, defaultToolbar?.painterButton, {
      syncSelection: syncTextSelection,
      beforeActivate: () => {
        closePopover();
        closeDropdown?.();
        closeEmoji?.();
        closeFonts?.();
        closeCardMenu?.();
      },
    });
  } catch (error) {
    lifecycle.failInitialization(error, [
      () => closeViewDisposers(),
      () => bubbleToolbar?.dispose(),
      () => unmountPainter?.(),
      () => unmountOutline?.(),
      () => unmountColorShortcuts?.(),
      () => translationPanel?.destroy(),
      () => unmountHeadingNumbering?.(),
      () => toolbarOverflow?.destroy(),
      () => findReplace?.destroy(false),
      () => unmountTableToolbar?.(),
      () => editor.destroy(),
      () => shell.remove(),
    ]);
  }
  const pointerTransaction = ({
    transaction,
    appendedTransactions = [],
  }: {
    transaction: Transaction;
    appendedTransactions?: Transaction[];
  }) => {
    if (viewUnavailable()) return;
    reconcileSlashInvalidation(editor, transaction);
    if (documentWasReplaced(transaction, appendedTransactions)) {
      closePopover();
      closeDropdown?.();
      closeEmoji?.();
      closeFonts?.();
      closeCardMenu?.();
      const suggestion = slashSuggestionKey.getState(editor.state);
      const range = suggestion?.range;
      if (
        suggestion?.active &&
        range &&
        range.to <= transaction.before.content.size &&
        transaction.before.textBetween(range.from, range.to) === suggestion.text
      ) {
        const document = editor.state.doc;
        if (invalidateSlashSuggestion(editor, document, range, suggestion.text)) {
          queueMicrotask(() => {
            if (
              !viewUnavailable() &&
              editor.state.doc === document &&
              slashSuggestionIsInvalidated(editor, document) &&
              slashSuggestionKey.getState(editor.state)?.active
            )
              closeSlashSuggestion(editor);
          });
        }
      }
    }
    selectionSync.onTransaction(transaction, appendedTransactions);
  };
  editor.on("transaction", pointerTransaction);

  // Tiptap emits destroy while the view and schema are still available, then
  // immediately tears them down. Dispose our UI even when a host destroys
  // the exposed editor directly.
  const dispose = (destroyEditor: boolean) => {
    lifecycle.dispose(() => [
      () => closeViewDisposers(),
      () => bubbleToolbar?.dispose(),
      () => clearGalleryUploads(editor),
      () => unmountTableToolbar?.(),
      () => unmountOutline?.(),
      () => unmountPainter?.(),
      () => unmountHeadingNumbering?.(),
      () => unmountColorShortcuts?.(),
      () => toolbarOverflow?.destroy(),
      () => translationPanel?.destroy(),
      // Tiptap will destroy all plugins; avoid reentrant reconfiguration.
      () => findReplace?.destroy(false),
      () => closePopover(),
      () => closeDropdown?.(),
      () => closeEmoji?.(),
      () => closeFonts?.(),
      () => closeCardMenu?.(),
      () => selectionSync.reset(),
      () => editor.off("transaction", pointerTransaction),
      () => editor.off("unmount", onEditorUnmount),
      () => {
        if (destroyEditor && !lifecycle.editorDestroying) editor.destroy();
      },
      () => interactiveController.setHost(null),
      () => shell.remove(),
    ]);
  };
  const onEditorUnmount = () => {
    closeDropdown?.();
    closeEmoji?.();
    closeFonts?.();
  };
  editor.on("unmount", onEditorUnmount);
  const onEditorDestroy = () => dispose(false);
  lifecycle.setRecoveryAction(onEditorDestroy);
  editor.on("destroy", onEditorDestroy);
  try {
    refresh();
  } catch (error) {
    lifecycle.failInitialization(error, [() => dispose(true)]);
  }
  const { setContent, trySetContent } = createContentReplacement({
    editor,
    doc,
    unavailable,
    closePopovers: () => {
      closePopover();
      closeDropdown?.();
      closeEmoji?.();
      closeFonts?.();
      closeCardMenu?.();
    },
    report,
  });
  const updateIntegrations = createIntegrationUpdateCoordinator({
    unavailable,
    markEncryptedChanged: () => markEncryptedProviderChanged(editor),
    interactive: () => interactiveController.setHost(integrations.current.interactiveCardHost ?? null),
    runner: () => configureCodeRunner(editor, integrations.current.runCode ?? null, report),
    translation: () => {
      translationPanel?.close();
      if (unavailable()) return;
      defaultToolbar?.setTranslationAvailable(Boolean(integrations.current.translate));
    },
    embed: () => setEmbedMetadataResolver(editor, integrations.current.resolveEmbedMetadata),
    yuque: () => closeYuqueContent(),
    cardMenu: () => closeCardMenu?.(),
    slash: () => closeSlashSuggestion(editor),
    imageUpload: () => refreshImageUploadAction?.(),
    search: () => {
      if (mentionRefreshQueued) return;
      mentionRefreshQueued = true;
      queueMicrotask(() => {
        mentionRefreshQueued = false;
        if (!unavailable()) refreshMentionSuggestion(editor);
      });
    },
    encrypted: () => invalidateEncryptedProvider(editor),
  });
  const toolbarEditableListeners = new Set<() => void>();
  const controller: EditorControllerWithResults = {
    editor,
    getSnapshot: snapshot,
    setContent,
    trySetContent,
    setEditable(editable: boolean) {
      if (unavailable() || editor.isEditable === editable) return;
      if (!editable) {
        translationPanel?.close();
        if (unavailable()) return;
        cancelTableResize(editor.view);
        if (unavailable()) return;
        clearUploads(editor, true);
        if (unavailable()) return;
        clearGalleryUploads(editor);
        if (unavailable()) return;
        clearAttachments(editor, true);
        if (unavailable()) return;
      }
      editor.setEditable(editable, false);
      if (unavailable()) return;
      if (!editor.isDestroyed)
        editor.view.dom.dispatchEvent(new (doc.defaultView?.Event ?? Event)("semlo-editor:editable"));
      if (unavailable()) return;
      closePopover();
      closeDropdown?.();
      closeEmoji?.();
      closeFonts?.();
      closeCardMenu?.();
      refresh();
      // 回调可以退订或增加订阅；本次通知只处理开始时已有的监听器。
      const listeners = Array.from(toolbarEditableListeners);
      for (const listener of listeners) {
        if (viewUnavailable()) break;
        listener();
      }
    },
    setIntegrations(next) {
      if (unavailable()) return;
      updateIntegrations(integrations.replace(next));
    },
    focus() {
      if (!viewUnavailable()) editor.commands.focus();
    },
    destroy() {
      dispose(true);
    },
  };
  const sharedToolbarContext = {
    controller,
    syncSelection() {
      if (!viewUnavailable()) syncTextSelection();
    },
    subscribe(listener: () => void) {
      if (viewUnavailable()) return () => {};
      let active = true;
      const notify = () => {
        if (active && !viewUnavailable()) listener();
      };
      const stop = () => {
        if (!active) return;
        active = false;
        editor.off("transaction", notify);
        toolbarEditableListeners.delete(notify);
      };
      editor.on("transaction", notify);
      toolbarEditableListeners.add(notify);
      const unregister = registerViewDisposer(stop);
      return () => {
        unregister();
        stop();
      };
    },
  };
  const mountCustomToolbar = (name: string, mount: () => void | (() => void)) => {
    try {
      const cleanup = mount();
      if (cleanup !== undefined && typeof cleanup !== "function")
        throw new TypeError(`自定义${name}必须返回清理函数或不返回值`);
      if (cleanup) registerViewDisposer(cleanup);
      if (viewUnavailable()) throw new Error(`自定义${name}装配期间编辑器已销毁或卸载`);
    } catch (error) {
      lifecycle.failInitialization(error, [() => dispose(true)]);
    }
  };
  if (toolbarFactory && customToolbar)
    mountCustomToolbar("工具栏", () => toolbarFactory({ ...sharedToolbarContext, element: customToolbar }));
  if (floatingToolbarFactory && bubbleToolbar) {
    mountCustomToolbar("浮动工具栏", () =>
      floatingToolbarFactory({
        ...sharedToolbarContext,
        element: bubbleToolbar.element,
        openLink(anchor) {
          if (!viewUnavailable()) openURL("link", false, true, undefined, undefined, anchor ?? bubbleToolbar.element);
        },
      }),
    );
  }
  return controller;
}
