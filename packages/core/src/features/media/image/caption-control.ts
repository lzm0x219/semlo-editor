export interface ImageCaptionState {
  text: string;
  visible: boolean;
}

export type ImageCaptionCommitKind = "toggle" | "input" | "finish";

export interface ImageCaptionControlOptions {
  doc: Document;
  canEdit: () => boolean;
  getState: () => ImageCaptionState;
  commit: (text: string, visible: boolean, kind: ImageCaptionCommitKind) => void;
  /** Begin and finish delimit one editing session in the host's undo history. */
  beginEdit?: () => void;
  enterAfter: () => void;
  undo?: () => void;
  redo?: () => void;
}

/** The description is separate from the image's alt text and the document body. */
export function createImageCaptionControl({
  doc,
  canEdit,
  getState,
  commit,
  beginEdit,
  enterAfter,
  undo,
  redo,
}: ImageCaptionControlOptions) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "semlo-editor-image-caption-toggle";
  button.setAttribute("aria-label", "图片描述");
  button.setAttribute("aria-pressed", "false");
  button.title = "图片描述";
  button.innerHTML =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14v8H3zM5 15h10M7 8h6"/></svg><span>描述</span>';

  const caption = doc.createElement("div");
  caption.className = "semlo-editor-image-caption";
  caption.contentEditable = "false";
  const input = doc.createElement("textarea");
  // 描述宽度由图片决定，避免 textarea 的默认列宽反过来撑大图片容器。
  input.cols = 1;
  input.rows = 1;
  input.className = "semlo-editor-image-caption-input";
  input.setAttribute("aria-label", "图片描述内容");
  input.placeholder = "添加图片描述";
  const readonly = doc.createElement("span");
  readonly.className = "semlo-editor-image-caption-readonly";
  caption.append(input, readonly);

  let editing = false;
  let composing = false;
  let destroyed = false;
  let closing = false;

  const resizeInput = () => {
    if (input.hidden || caption.hidden) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  };
  let observedWidth = -1;
  const observer = doc.defaultView?.ResizeObserver
    ? new doc.defaultView.ResizeObserver(([entry]) => {
        if (!entry || entry.contentRect.width === observedWidth) return;
        observedWidth = entry.contentRect.width;
        resizeInput();
      })
    : undefined;
  observer?.observe(caption);

  const refresh = () => {
    if (destroyed) return;
    const state = getState();
    const editable = canEdit();
    const active = editable && editing && doc.activeElement === input;
    if (!active) input.value = state.text;
    readonly.textContent = state.text;
    input.hidden = !editable;
    input.disabled = !editable;
    readonly.hidden = editable;
    const visible = state.visible && (state.text.length > 0 || (editable && editing));
    caption.hidden = !visible;
    resizeInput();
    button.setAttribute("aria-pressed", String(state.visible && (state.text.length > 0 || editing)));
    button.disabled = !editable;
  };

  const publishInput = () => {
    if (destroyed || !canEdit() || !editing) return;
    resizeInput();
    if (composing) return;
    const state = getState();
    if (input.value !== state.text || !state.visible) commit(input.value, true, "input");
  };

  const finish = () => {
    if (!editing) return;
    if (!destroyed && canEdit() && !closing) {
      // Do not write a partially composed IME string if editing is interrupted.
      if (!composing) publishInput();
      editing = false;
      const state = getState();
      commit(state.text, state.visible && state.text.trim().length > 0, "finish");
    } else editing = false;
    composing = false;
    refresh();
  };

  button.addEventListener("pointerdown", (event) => {
    // Keep an open description focused until the toggle handles the click.
    if (canEdit()) event.preventDefault();
  });
  button.addEventListener("click", (event) => {
    if (destroyed || !canEdit()) return;
    const state = getState();
    const active = state.visible && (state.text.length > 0 || editing);
    if (active) {
      finish();
      const latest = getState();
      if (latest.visible) commit(latest.text, false, "toggle");
      input.blur();
      refresh();
      return;
    }
    editing = true;
    if (!state.visible) commit(state.text, true, "toggle");
    refresh();
    input.classList.toggle("is-pointer-focus", event.detail > 0);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  input.addEventListener("focus", () => {
    if (destroyed || !canEdit()) return;
    editing = true;
    beginEdit?.();
    refresh();
  });
  input.addEventListener("pointerdown", () => input.classList.add("is-pointer-focus"));
  input.addEventListener("input", publishInput);
  input.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain");
    if (text === undefined || !/[\r\n]/.test(text)) return;
    event.preventDefault();
    input.setRangeText(text.replace(/\r\n?|\n/g, " "), input.selectionStart, input.selectionEnd, "end");
    publishInput();
  });
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    publishInput();
  });
  input.addEventListener("blur", () => {
    input.classList.remove("is-pointer-focus");
    finish();
  });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229 || composing) return;
    const key = event.key.toLowerCase();
    const history = (event.metaKey || event.ctrlKey) && (key === "z" || key === "y");
    if (history) {
      const action = key === "y" || event.shiftKey ? redo : undo;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
      // Undo may update the node while the input retains focus.
      input.value = getState().text;
      input.setSelectionRange(input.value.length, input.value.length);
      refresh();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    finish();
    enterAfter();
  });

  const close = () => {
    if (destroyed) return;
    closing = true;
    input.blur();
    editing = false;
    composing = false;
    closing = false;
    refresh();
  };
  refresh();
  return {
    button,
    caption,
    refresh,
    close,
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      observer?.disconnect();
      button.remove();
      caption.remove();
    },
  };
}
