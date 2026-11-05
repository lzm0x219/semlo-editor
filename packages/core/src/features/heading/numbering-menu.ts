import { trackPopupPosition } from "../../platform/dom/dropdown";
import { linkPopup } from "../../platform/dom/popup-owner";

export type HeadingNumberingStyle = "mixed" | "chinese" | "decimal";

export interface HeadingNumberingMenuOptions {
  anchor: HTMLElement;
  value?: HeadingNumberingStyle | null;
  onSelect: (value: HeadingNumberingStyle) => void;
  onClose?: () => void;
  /** Move focus to the current option when opened from the keyboard. */
  focusOnOpen?: boolean;
}

export interface HeadingNumberingMenuClose {
  (): void;
  reanchor: (anchor: HTMLElement) => boolean;
}

const previews: Array<{ value: HeadingNumberingStyle; label: string; numbers: [string, string, string] }> = [
  { value: "decimal", label: "数字层级：1.、1.1.、1.1.1.", numbers: ["1.", "1.1.", "1.1.1."] },
  { value: "chinese", label: "中文层级：一、（一）、1.", numbers: ["一、", "(一)", "1."] },
  { value: "mixed", label: "混合层级：1.、a.、ⅰ.", numbers: ["1.", "a.", "ⅰ."] },
];

/** Open the numbering-style previews. Calling the returned function disposes the popup. */
export function openHeadingNumberingMenu({
  anchor: initialAnchor,
  value,
  onSelect,
  onClose,
  focusOnOpen = false,
}: HeadingNumberingMenuOptions): HeadingNumberingMenuClose {
  let anchor = initialAnchor;
  const doc = anchor.ownerDocument;
  const popup = doc.createElement("div");
  popup.className = "semlo-editor-heading-numbering-menu";
  popup.setAttribute("role", "menu");
  popup.setAttribute("aria-label", "设置编号");
  const group = doc.createElement("div");
  group.className = "semlo-editor-heading-numbering-options";
  group.setAttribute("role", "none");
  popup.append(group);

  const selected = previews.some((preview) => preview.value === value) ? value : "mixed";
  const cards: HTMLButtonElement[] = [];
  let closed = false;
  let stopPosition = () => {};
  let disconnectObserver = () => {};
  let unlinkPopup = () => {};

  const close = () => {
    if (closed) return;
    closed = true;
    stopPosition();
    disconnectObserver();
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", keyboard, true);
    unlinkPopup();
    popup.remove();
    anchor.setAttribute("aria-expanded", "false");
    onClose?.();
  };
  const reanchor = (next: HTMLElement): boolean => {
    if (closed || !next.isConnected || next.ownerDocument !== doc) return false;
    if (next === anchor) return true;
    stopPosition();
    unlinkPopup();
    anchor.setAttribute("aria-expanded", "false");
    anchor = next;
    unlinkPopup = linkPopup(anchor, popup);
    anchor.setAttribute("aria-haspopup", "menu");
    anchor.setAttribute("aria-expanded", "true");
    const position = trackPopupPosition(anchor, popup, close);
    stopPosition = position.stop;
    position.update();
    return !closed;
  };
  const outside = (event: Event) => {
    const target = event.target as Node;
    if (!popup.contains(target) && !anchor.contains(target)) close();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (doc.activeElement !== anchor && !popup.contains(doc.activeElement)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      if (anchor.isConnected) anchor.focus();
      return;
    }
    const current = cards.indexOf(doc.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1 + cards.length) % cards.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = current < 0 ? cards.length - 1 : (current - 1 + cards.length) % cards.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = cards.length - 1;
    else return;
    event.preventDefault();
    for (const [index, card] of cards.entries()) card.tabIndex = index === next ? 0 : -1;
    cards[next]?.focus();
  };

  for (const preview of previews) {
    const card = doc.createElement("button");
    card.type = "button";
    card.className = "semlo-editor-heading-numbering-choice";
    card.dataset.value = preview.value;
    card.setAttribute("role", "menuitemradio");
    card.setAttribute("aria-label", preview.label);
    card.setAttribute("aria-checked", String(preview.value === selected));
    card.tabIndex = preview.value === selected ? 0 : -1;
    const illustration = doc.createElement("span");
    illustration.className = "semlo-editor-heading-numbering-preview";
    illustration.setAttribute("aria-hidden", "true");
    for (const [index, number] of preview.numbers.entries()) {
      const row = doc.createElement("span");
      row.className = "semlo-editor-heading-numbering-preview-row";
      const numeral = doc.createElement("span");
      numeral.className = "semlo-editor-heading-numbering-preview-number";
      numeral.textContent = number;
      const bar = doc.createElement("span");
      bar.className = "semlo-editor-heading-numbering-preview-bar";
      row.append(numeral, bar);
      illustration.append(row);
      if (index < 2) {
        const rule = doc.createElement("span");
        rule.className = "semlo-editor-heading-numbering-preview-rule";
        illustration.append(rule);
      }
      if (index === 0) {
        const rule = doc.createElement("span");
        rule.className = "semlo-editor-heading-numbering-preview-rule";
        illustration.append(rule);
      }
    }
    card.append(illustration);
    // Keep an editor selection in place when a style is picked by pointer.
    card.addEventListener("mousedown", (event) => event.preventDefault());
    card.addEventListener("click", () => {
      const restoreFocus = popup.contains(doc.activeElement);
      close();
      if (restoreFocus && anchor.isConnected) anchor.focus();
      onSelect(preview.value);
    });
    group.append(card);
    cards.push(card);
  }

  doc.body.append(popup);
  unlinkPopup = linkPopup(anchor, popup);
  anchor.setAttribute("aria-haspopup", "menu");
  anchor.setAttribute("aria-expanded", "true");
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("keydown", keyboard, true);
  const observer = doc.defaultView?.MutationObserver
    ? new doc.defaultView.MutationObserver(() => {
        if (!anchor.isConnected) close();
      })
    : undefined;
  observer?.observe(doc.documentElement, { childList: true, subtree: true });
  disconnectObserver = () => observer?.disconnect();
  const position = trackPopupPosition(anchor, popup, close);
  stopPosition = position.stop;
  position.update();
  if (!closed && focusOnOpen) cards.find((card) => card.dataset.value === selected)?.focus();
  return Object.assign(close, { reanchor });
}
