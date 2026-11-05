import { DEFAULT_HIGHLIGHT_COLOR } from "../../features/text/highlight";

export type ToolbarColorKind = "text" | "background";

export interface ToolbarColorControl {
  element: HTMLElement;
  arrow: HTMLButtonElement;
  applyCurrent(): void;
  setColor(value: string | null): void;
  setDisabled(disabled: boolean): void;
}

/** Create a split color control. The remembered color belongs to this control instance. */
export function createToolbarColorControl(
  doc: Document,
  kind: ToolbarColorKind,
  onApply: (value: string | null) => void,
  onOpen: (arrow: HTMLButtonElement) => void,
): ToolbarColorControl {
  const element = doc.createElement("span");
  element.className = "semlo-editor-toolbar-color-control";
  const apply = doc.createElement("button");
  apply.type = "button";
  apply.className = "semlo-editor-toolbar-color-apply";
  apply.setAttribute("aria-label", kind === "text" ? "应用文字颜色" : "应用高亮颜色");
  apply.title = kind === "text" ? "应用文字颜色" : "应用高亮颜色";
  const glyph = doc.createElement("span");
  glyph.className = "semlo-editor-toolbar-color-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.innerHTML =
    kind === "text"
      ? "A"
      : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="m3 9 5-5 4 4-5 5H4l-1-1zM7 3l2-1 4 4-1 2M3 13h10"/></svg>';
  const swatch = doc.createElement("span");
  swatch.className = "semlo-editor-toolbar-color-swatch";
  swatch.setAttribute("aria-hidden", "true");
  apply.append(glyph, swatch);
  const arrow = doc.createElement("button");
  arrow.type = "button";
  arrow.className = "semlo-editor-toolbar-color-arrow";
  arrow.setAttribute("aria-label", kind === "text" ? "文字颜色" : "高亮颜色");
  arrow.title = kind === "text" ? "文字颜色" : "高亮颜色";
  arrow.setAttribute("aria-haspopup", "dialog");
  arrow.setAttribute("aria-expanded", "false");
  let color: string | null = kind === "text" ? "#df2a3f" : DEFAULT_HIGHLIGHT_COLOR;
  const setColor = (value: string | null) => {
    color = value;
    swatch.style.background = value ?? (kind === "text" ? "#262626" : "transparent");
  };
  setColor(color);
  apply.addEventListener("mousedown", (event) => event.preventDefault());
  arrow.addEventListener("mousedown", (event) => event.preventDefault());
  const applyCurrent = () => {
    if (!apply.disabled) onApply(color);
  };
  apply.addEventListener("click", applyCurrent);
  arrow.addEventListener("click", () => onOpen(arrow));
  element.append(apply, arrow);
  return {
    element,
    arrow,
    applyCurrent,
    setColor,
    setDisabled(disabled) {
      apply.disabled = disabled;
      arrow.disabled = disabled;
    },
  };
}
