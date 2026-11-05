import { trackPopupPosition } from "../../platform/dom/dropdown";
import { linkPopup, popupEditorOwner } from "../../platform/dom/popup-owner";

export type OrderedListStyleChoice = "mixed" | "chinese" | "decimal";

const choices: { value: OrderedListStyleChoice; label: string; lines: string[] }[] = [
  { value: "mixed", label: "数字、字母和罗马数字", lines: ["1.", "a.", "b.", "ⅰ.", "2."] },
  { value: "chinese", label: "中文数字", lines: ["一、", "（一）", "（二）", "1.", "二、"] },
  { value: "decimal", label: "多级数字", lines: ["1.", "1.1.", "1.2.", "1.2.1.", "2."] },
];

/** Opens the list-style chooser; the caller applies the selected list style. */
export function openOrderedListStyleMenu(
  anchor: HTMLElement,
  current: OrderedListStyleChoice | null,
  onChoose: (style: OrderedListStyleChoice) => void,
  focusMenu = false,
  allowedChoices?: readonly OrderedListStyleChoice[],
): () => void {
  const doc = anchor.ownerDocument;
  const openingFocus = doc.activeElement;
  const owner = popupEditorOwner(anchor) ?? openingFocus?.closest(".semlo-editor");
  const popup = doc.createElement("div");
  popup.className = "semlo-editor-ordered-style-menu";
  popup.setAttribute("role", "menu");
  popup.setAttribute("aria-label", "有序列表样式");
  const buttons = choices.map((choice) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.disabled = !!allowedChoices && !allowedChoices.includes(choice.value);
    if (button.disabled) button.title = "当前编号组暂不支持此样式";
    button.className = "semlo-editor-ordered-style-choice";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-label", choice.label);
    button.setAttribute("aria-checked", String(choice.value === current));
    button.dataset.value = choice.value;
    const preview = doc.createElement("span");
    preview.className = "semlo-editor-ordered-style-preview";
    preview.setAttribute("aria-hidden", "true");
    choice.lines.forEach((line, index) => {
      const row = doc.createElement("span");
      row.className = "semlo-editor-ordered-style-row";
      row.style.paddingLeft = `${[0, 8, 8, 16, 0][index]}px`;
      const marker = doc.createElement("span");
      marker.textContent = line;
      const rule = doc.createElement("span");
      rule.className = "semlo-editor-ordered-style-rule";
      row.append(marker, rule);
      preview.append(row);
    });
    button.append(preview);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      close();
      onChoose(choice.value);
    });
    popup.append(button);
    return button;
  });
  doc.body.append(popup);
  const unlink = linkPopup(anchor, popup);
  anchor.setAttribute("aria-expanded", "true");
  let closed = false;
  let stopPosition = () => {};
  const outside = (event: Event) => {
    if (!popup.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      const active = doc.activeElement;
      if (active !== anchor && active !== openingFocus && !popup.contains(active) && !owner?.contains(active)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      anchor.focus({ preventScroll: true });
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    if (doc.activeElement !== anchor && !popup.contains(doc.activeElement)) return;
    event.preventDefault();
    const enabled = buttons.filter((button) => !button.disabled);
    const index = enabled.indexOf(doc.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? enabled.length - 1
          : index < 0
            ? 0
            : (index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
    enabled[next]?.focus();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    stopPosition();
    unlink();
    popup.remove();
    anchor.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", keyboard, true);
  };
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("keydown", keyboard, true);
  const position = trackPopupPosition(anchor, popup, close);
  stopPosition = position.stop;
  position.update();
  if (focusMenu && !closed)
    (
      buttons.find((button) => !button.disabled && button.getAttribute("aria-checked") === "true") ??
      buttons.find((button) => !button.disabled)
    )?.focus();
  return close;
}
