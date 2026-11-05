import type { Editor, Range } from "@tiptap/core";

import { beginLinkEdit } from "../features/references/link-command";
import { linkPopup } from "../platform/dom/popup-owner";

const safeImageURL = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "blob:") return trimmed;
  } catch {
    /* invalid URLs are rejected */
  }
  return null;
};

interface UrlSessionContext {
  document: Document;
  shell: HTMLElement;
  getEditor: () => Editor;
  isDestroyed: () => boolean;
  syncTextSelection: () => void;
  beforeOpen: () => void;
  closePopover: () => void;
  imageUploadAvailable: () => boolean;
  setRefreshImageUploadAction: (refresh: () => void) => void;
  requestImageFile: (prepare?: () => boolean) => void;
  mountPopover: (element: HTMLElement) => (cleanup: () => void) => void;
}

export function createUrlSession(context: UrlSessionContext) {
  const {
    document: doc,
    shell,
    getEditor,
    isDestroyed,
    syncTextSelection,
    beforeOpen,
    closePopover,
    imageUploadAvailable,
    setRefreshImageUploadAction,
    requestImageFile,
    mountPopover,
  } = context;
  const openURL = (
    kind: "link" | "image",
    focusText = false,
    sync = true,
    prepare?: () => boolean,
    slashRange?: Range,
    anchor?: HTMLElement,
  ) => {
    const editor = getEditor();
    if (isDestroyed() || !editor.isEditable) return;
    if (sync) syncTextSelection();
    beforeOpen();
    if (kind === "link" && prepare && !prepare()) return;
    const linkEdit =
      kind === "link"
        ? beginLinkEdit(editor, {
            range: slashRange,
            prepared: Boolean(prepare),
            unavailable: isDestroyed,
            onInvalidate: closePopover,
          })
        : null;
    if (kind === "link" && !linkEdit) return;
    const existingLink = linkEdit?.existing ?? false;
    const { from: initialFrom, to: initialTo } = linkEdit?.range ?? slashRange ?? editor.state.selection;
    const originalText = linkEdit?.text ?? editor.state.doc.textBetween(initialFrom, initialTo, " ");
    const form = doc.createElement("form");
    form.className = `semlo-editor-url-form${kind === "link" ? " semlo-editor-link-form" : ""}`;
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-label", kind === "link" ? "插入链接" : "插入图片");
    let textInput: HTMLInputElement | undefined;
    if (kind === "link") {
      const textLabel = doc.createElement("label");
      textLabel.textContent = "文本";
      textInput = doc.createElement("input");
      textInput.type = "text";
      textInput.value = originalText || "链接";
      textInput.autocomplete = "off";
      textLabel.append(textInput);
      form.append(textLabel);
    }
    const label = doc.createElement("label");
    label.textContent = kind === "link" ? "链接" : "图片地址";
    const input = doc.createElement("input");
    input.type = "text";
    input.placeholder = kind === "link" ? "链接地址" : "https://";
    input.autocomplete = "off";
    input.value = linkEdit?.href ?? "";
    label.append(input);
    form.append(label);
    const actions = doc.createElement("div");
    actions.className = "semlo-editor-url-actions";
    if (kind === "image") {
      const fileButton = doc.createElement("button");
      fileButton.type = "button";
      fileButton.textContent = "上传图片";
      fileButton.addEventListener("click", () => {
        requestImageFile(prepare);
      });
      const refreshImageUploadAction = () => {
        if (imageUploadAvailable()) actions.prepend(fileButton);
        else fileButton.remove();
      };
      setRefreshImageUploadAction(refreshImageUploadAction);
      refreshImageUploadAction();
    }
    if (existingLink) {
      const remove = doc.createElement("button");
      remove.type = "button";
      remove.textContent = "移除链接";
      remove.addEventListener("click", () => {
        linkEdit?.remove();
        closePopover();
      });
      actions.append(remove);
    }
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => {
      closePopover();
      editor.commands.focus();
    });
    const submit = doc.createElement("button");
    submit.type = "submit";
    submit.className = "semlo-editor-primary";
    submit.textContent = "确定";
    actions.append(cancel, submit);
    form.append(actions);
    const refreshSubmit = () => {
      submit.disabled = !input.value.trim() || (kind === "link" && !textInput?.value.trim());
    };
    refreshSubmit();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (kind === "link" && linkEdit) {
        const result = linkEdit.apply({ href: input.value, text: textInput?.value ?? "" });
        if (result === "invalid-url") {
          input.setCustomValidity("请输入有效的链接地址，如 https://、mailto: 或站内路径");
          input.reportValidity();
          return;
        }
        if (result === "invalid-text") {
          textInput?.setCustomValidity("请输入链接文本");
          textInput?.reportValidity();
          return;
        }
        closePopover();
        return;
      }
      const url = safeImageURL(input.value);
      if (!url) {
        input.setCustomValidity("请输入有效的图片地址，如 https:// 或站内路径");
        input.reportValidity();
        return;
      }
      if (kind === "image" && prepare && !prepare()) {
        closePopover();
        return;
      }
      const from = kind === "image" && prepare ? editor.state.selection.from : initialFrom;
      const resolved = editor.state.doc.resolve(from);
      let codeDepth = 0;
      for (let depth = resolved.depth; depth > 0; depth--) {
        if (resolved.node(depth).type.spec.code) {
          codeDepth = depth;
          break;
        }
      }
      if (codeDepth) {
        editor
          .chain()
          .focus()
          .insertContentAt(resolved.after(codeDepth), { type: "image", attrs: { src: url } })
          .run();
      } else editor.chain().focus().setImage({ src: url }).run();
      closePopover();
    });
    input.addEventListener("input", () => {
      input.setCustomValidity("");
      refreshSubmit();
    });
    textInput?.addEventListener("input", () => {
      textInput.setCustomValidity("");
      refreshSubmit();
    });
    form.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        closePopover();
        editor.commands.focus();
      }
    });
    shell.append(form);
    const registerCleanup = mountPopover(form);
    const unlinkPopup = anchor ? linkPopup(anchor, form) : undefined;
    anchor?.setAttribute("aria-expanded", "true");
    const repositionLink = () => {
      if (isDestroyed() || editor.isDestroyed || !form.isConnected) return;
      const rect = editor.view.coordsAtPos(initialFrom),
        viewport = doc.defaultView;
      form.style.left = `${Math.max(8, Math.min(rect.left, (viewport?.innerWidth ?? 1000) - form.offsetWidth - 8))}px`;
      form.style.top = `${Math.max(8, Math.min(rect.bottom + 10, (viewport?.innerHeight ?? 800) - form.offsetHeight - 8))}px`;
    };
    if (kind === "link") {
      repositionLink();
      doc.addEventListener("scroll", repositionLink, true);
      doc.defaultView?.addEventListener("resize", repositionLink);
    }
    const outside = (event: Event) => {
      if (!form.contains(event.target as globalThis.Node)) closePopover();
    };
    doc.addEventListener("pointerdown", outside, true);
    registerCleanup(() => {
      linkEdit?.close();
      doc.removeEventListener("pointerdown", outside, true);
      if (kind === "link") {
        doc.removeEventListener("scroll", repositionLink, true);
        doc.defaultView?.removeEventListener("resize", repositionLink);
      }
      unlinkPopup?.();
      anchor?.setAttribute("aria-expanded", "false");
    });
    if (focusText && textInput) {
      textInput.focus();
      textInput.select();
    } else input.focus();
  };
  return openURL;
}
