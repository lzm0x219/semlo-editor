import { trackPopupPosition } from "../../platform/dom/dropdown";
import { linkPopup, popupEditorOwner } from "../../platform/dom/popup-owner";
import { toolbarAlignmentIcon } from "./icons";

export type ToolbarAlignment = "left" | "center" | "right" | "justify";

/** Open the inline alignment choices without consuming the editor selection. */
export function openToolbarAlignmentMenu(
  anchor: HTMLElement,
  current: string,
  onChoose: (value: ToolbarAlignment) => void,
  focusMenu = false,
): () => void {
  const doc = anchor.ownerDocument;
  const openingFocus = doc.activeElement;
  const owner = popupEditorOwner(anchor) ?? openingFocus?.closest(".semlo-editor");
  const popup = doc.createElement("div");
  popup.className = "semlo-editor-toolbar-alignment-menu";
  popup.setAttribute("role", "menu");
  popup.setAttribute("aria-label", "对齐方式");
  const options: [ToolbarAlignment, string][] = [
    ["left", "左对齐"],
    ["center", "居中"],
    ["right", "右对齐"],
    ["justify", "两端对齐"],
  ];
  const buttons = options.map(([value, label]) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "semlo-editor-toolbar-alignment-choice";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-checked", String(value === current));
    button.title = label;
    button.innerHTML = toolbarAlignmentIcon(value);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      close();
      onChoose(value);
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
    const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : index < 0
            ? 0
            : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
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
    (buttons.find((button) => button.getAttribute("aria-checked") === "true") ?? buttons[0]).focus();
  return close;
}
