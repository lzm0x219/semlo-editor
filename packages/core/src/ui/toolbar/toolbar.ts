import type { Editor } from "@tiptap/core";

const icons: Record<string, string> = {
  bold: '<path d="M6 4h6a3.5 3.5 0 0 1 0 7H6zM6 11h7a4 4 0 0 1 0 8H6z"/>',
  italic: '<path d="M10 4h8M6 20h8M14 4 10 20"/>',
  underline: '<path d="M6 4v7a6 6 0 0 0 12 0V4M4 20h16"/>',
  strike:
    '<path d="M4 12h16M16.5 7.5C16 5.5 14.5 4 12 4c-2.6 0-4 1.3-4 3.2 0 1.5 1.2 2.4 3.1 3M7.5 16.5c.5 2.2 2 3.5 4.5 3.5 2.7 0 4.4-1.3 4.4-3.3 0-1.4-.9-2.4-2.7-3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/>',
  bullet:
    '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
  ordered: '<path d="M9 6h11M9 12h11M9 18h11M3 4h1v4M3 13c0-1.7 3-1.7 3 0 0 1-3 2-3 3h3M3 19h3"/>',
  task: '<rect x="3" y="4" width="5" height="5" rx="1"/><path d="m4 6 1 1 2-2M11 6h9M3 15l2 2 3-3M11 17h9"/>',
  quote: '<path d="M10 5H5v7h5v4l-3 3M19 5h-5v7h5v4l-3 3"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  superscript: '<path d="m3 8 8 10M11 8 3 18M15 6a2 2 0 0 1 4 0c0 1.5-3 2.6-4 4h4"/>',
  subscript: '<path d="m3 6 8 10M11 6 3 16M15 14a2 2 0 0 1 4 0c0 1.5-3 2.6-4 4h4"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 2-2 6 6"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
  undo: '<path d="M9 7 4 12l5 5M4 12h10a5 5 0 0 1 5 5"/>',
  redo: '<path d="m15 7 5 5-5 5M20 12H10a5 5 0 0 0-5 5"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  clear: '<path d="m4 15 7-9a2 2 0 0 1 3-.2l6 5.5a2 2 0 0 1 .2 2.8L16 19H8zM8 11l7 6M14 20h7"/>',
  divider: '<path d="M4 12h16"/>',
};
export const icon = (name: string) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name] ?? ""}</svg>`;

export type ToolbarButton = {
  element: HTMLButtonElement;
  active?: () => boolean;
  enabled?: () => boolean;
  state?: () => { active: boolean; enabled: boolean };
};

/** 更新一组工具按钮；浮动工具栏可独立于默认主工具栏使用。 */
export function refreshToolbarButtons(editor: Editor, buttons: ToolbarButton[], detailsRestricted = false) {
  for (const b of buttons) {
    const state = b.state?.();
    if (state) b.element.setAttribute("aria-pressed", String(state.active));
    else if (b.active) b.element.setAttribute("aria-pressed", String(b.active()));
    const restricted = ["插入内容", "无序列表", "有序列表"].includes(b.element.getAttribute("aria-label") ?? "");
    b.element.disabled =
      !editor.isEditable ||
      (detailsRestricted && restricted) ||
      (state ? !state.enabled : b.enabled ? !b.enabled() : false);
  }
}

export function createToolbarRoot(doc: Document) {
  const toolbar = doc.createElement("div");
  toolbar.className = "semlo-editor-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "文本格式");
  return toolbar;
}

export function createToolbarBindings({
  doc,
  toolbar,
  syncTextSelection,
}: {
  doc: Document;
  toolbar: HTMLElement;
  syncTextSelection: () => void;
}) {
  const buttons: ToolbarButton[] = [];
  const menuButton = (label: string, className: string) => {
    const el = doc.createElement("button");
    el.type = "button";
    el.className = `semlo-editor-dropdown-trigger ${className}`;
    el.setAttribute("aria-label", label);
    el.setAttribute("aria-haspopup", "menu");
    el.setAttribute("aria-expanded", "false");
    el.title = label;
    el.addEventListener("mousedown", (event) => event.preventDefault());
    return el;
  };
  const button = (
    parent: HTMLElement,
    label: string,
    iconName: string,
    action: (event: MouseEvent) => void,
    active?: () => boolean,
    enabled?: () => boolean,
    state?: () => { active: boolean; enabled: boolean },
  ) => {
    const el = doc.createElement("button");
    el.type = "button";
    el.className = "semlo-editor-button";
    el.title = label;
    el.setAttribute("aria-label", label);
    if (active || state) el.setAttribute("aria-pressed", "false");
    el.innerHTML = icon(iconName);
    el.addEventListener("mousedown", (event) => event.preventDefault());
    el.addEventListener("click", (event) => {
      syncTextSelection();
      action(event);
    });
    parent.append(el);
    buttons.push({ element: el, active, enabled, state });
    return el;
  };
  const separator = () => {
    const el = doc.createElement("span");
    el.className = "semlo-editor-separator";
    el.setAttribute("aria-hidden", "true");
    toolbar.append(el);
  };
  return { buttons, menuButton, button, separator };
}

export type ToolbarButtonFactory = ReturnType<typeof createToolbarBindings>["button"];
