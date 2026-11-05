import { imageLinkInput } from "../shared/image-link";

export interface ImageLinkState {
  /** Keep the user's spelling for the editor; resolve it only when following a link. */
  href: string;
  openInCurrent: boolean;
}

export type ImageLinkChange = "input" | "toggle" | "remove";

export interface ImageLinkControlOptions {
  doc: Document;
  canEdit: () => boolean;
  getState: () => ImageLinkState;
  commit: (state: ImageLinkState, kind: ImageLinkChange) => void;
}

/** A link button and panel that can be mounted in the image's format toolbar. */
export function createImageLinkControl({ doc, canEdit, getState, commit }: ImageLinkControlOptions) {
  const win = doc.defaultView;
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "semlo-editor-image-link-toggle";
  button.setAttribute("aria-label", "图片链接");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.title = "链接";
  button.innerHTML =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8.4 11.6 3.2-3.2m-4.5 6.1-1 1a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0m1.8-1.8 1-1a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0"/></svg>';

  const panel = doc.createElement("div");
  panel.className = "semlo-editor-image-link-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "图片链接");
  panel.contentEditable = "false";
  panel.hidden = true;
  const input = doc.createElement("input");
  input.type = "text";
  input.className = "semlo-editor-image-link-input";
  input.setAttribute("aria-label", "图片链接地址");
  input.placeholder = "请输入网址";
  input.autocomplete = "off";
  input.spellcheck = false;
  const footer = doc.createElement("div");
  footer.className = "semlo-editor-image-link-footer";
  const label = doc.createElement("label");
  label.className = "semlo-editor-image-link-current";
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  const text = doc.createElement("span");
  text.textContent = "在当前页面打开";
  label.append(checkbox, text);
  const remove = doc.createElement("button");
  remove.type = "button";
  remove.className = "semlo-editor-image-link-remove";
  remove.textContent = "取消链接";
  footer.append(label, remove);
  panel.append(input, footer);

  let opened = false;
  let destroyed = false;
  let composing = false;

  const syncRemove = () => {
    remove.hidden = !input.value.trim();
  };
  const refresh = () => {
    if (destroyed) return;
    if (!canEdit()) close();
    const state = getState();
    if (!opened || doc.activeElement !== input) input.value = state.href;
    checkbox.checked = state.openInCurrent;
    button.disabled = !canEdit();
    input.disabled = !canEdit();
    checkbox.disabled = !canEdit();
    remove.disabled = !canEdit();
    syncRemove();
  };
  const apply = () => {
    if (!opened || !canEdit() || composing) return false;
    const href = imageLinkInput(input.value);
    if (href === null) {
      input.setAttribute("aria-invalid", "true");
      return false;
    }
    input.removeAttribute("aria-invalid");
    const state = getState();
    if (href !== state.href) commit({ href, openInCurrent: state.openInCurrent }, "input");
    input.value = href;
    syncRemove();
    return true;
  };
  const outside = (event: PointerEvent) => {
    const target = event.target as globalThis.Node;
    if (button.contains(target) || panel.contains(target)) return;
    apply();
    close();
  };
  const key = (event: KeyboardEvent) => {
    if (!opened || event.isComposing || event.keyCode === 229 || composing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  function close() {
    if (!opened) return;
    opened = false;
    composing = false;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-invalid");
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", key, true);
    refresh();
  }
  const open = () => {
    if (destroyed || !canEdit()) return;
    opened = true;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const state = getState();
    input.value = state.href;
    checkbox.checked = state.openInCurrent;
    syncRemove();
    const parent = panel.offsetParent as HTMLElement | null;
    const parentLeft = parent?.getBoundingClientRect().left ?? 0;
    const buttonRect = button.getBoundingClientRect();
    const viewportWidth = win?.innerWidth ?? doc.documentElement.clientWidth;
    const desired = Math.max(8, Math.min(buttonRect.left, viewportWidth - panel.offsetWidth - 8));
    panel.style.left = `${desired - parentLeft}px`;
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("keydown", key, true);
    input.focus();
  };
  button.addEventListener("click", () => {
    if (opened) {
      apply();
      close();
    } else open();
  });
  input.addEventListener("input", () => {
    input.removeAttribute("aria-invalid");
    syncRemove();
  });
  input.addEventListener("compositionstart", () => (composing = true));
  input.addEventListener("compositionend", () => (composing = false));
  input.addEventListener("blur", () => {
    if (opened) apply();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 || composing) return;
    event.preventDefault();
    event.stopPropagation();
    apply();
  });
  checkbox.addEventListener("change", () => {
    if (!opened || !canEdit()) return;
    const state = getState();
    if (state.openInCurrent !== checkbox.checked) commit({ ...state, openInCurrent: checkbox.checked }, "toggle");
  });
  remove.addEventListener("click", () => {
    if (!opened || !canEdit()) return;
    input.value = "";
    input.removeAttribute("aria-invalid");
    const state = getState();
    if (state.href) commit({ ...state, href: "" }, "remove");
    syncRemove();
  });
  refresh();
  return {
    button,
    panel,
    refresh,
    close,
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
    },
  };
}
