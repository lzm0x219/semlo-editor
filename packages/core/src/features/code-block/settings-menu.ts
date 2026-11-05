import { trackPopupPosition } from "../../platform/dom/dropdown";
import { linkPopup } from "../../platform/dom/popup-owner";
import type { CodeBlockSettings, CodeFontSize, CodeIndentMode, CodeIndentWidth } from "./settings";

type Group = "font" | "mode" | "width";

interface SettingsMenuOptions {
  doc: Document;
  getSettings: () => CodeBlockSettings;
  getTheme: () => string;
  canRun: () => boolean;
  onOpen: () => void;
  onChange: (settings: Partial<CodeBlockSettings>) => void;
  onSync: (includeLanguage: boolean) => void;
  onAutoIndent: () => void;
  onRun: () => void;
  onHideHeaders: () => boolean;
}

const fontOptions: Array<[string, CodeFontSize]> = [
  ["跟随正文", null],
  ["12px", 12],
  ["13px", 13],
  ["14px", 14],
  ["15px", 15],
  ["16px", 16],
  ["19px", 19],
  ["22px", 22],
];
const modeOptions: Array<[string, CodeIndentMode]> = [
  ["Tab", "tab"],
  ["Space", "space"],
];
const widthOptions: Array<[string, CodeIndentWidth]> = [
  ["2", 2],
  ["4", 4],
  ["8", 8],
];

function revealMenuItem(menu: HTMLElement, item: HTMLElement | undefined) {
  if (!item) return;
  const bounds = menu.getBoundingClientRect();
  const itemBounds = item.getBoundingClientRect();
  const top = bounds.top + menu.clientTop;
  const bottom = top + menu.clientHeight;
  if (itemBounds.top < top) menu.scrollTop -= top - itemBounds.top;
  else if (itemBounds.bottom > bottom) menu.scrollTop += itemBounds.bottom - bottom;
}

function focusMenuItem(menu: HTMLElement, item: HTMLElement | undefined) {
  if (!item) return;
  item.focus({ preventScroll: true });
  revealMenuItem(menu, item);
}

export function createCodeSettingsMenu({
  doc,
  getSettings,
  getTheme,
  canRun,
  onOpen,
  onChange,
  onSync,
  onAutoIndent,
  onRun,
  onHideHeaders,
}: SettingsMenuOptions) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "semlo-editor-code-select semlo-editor-code-more";
  button.setAttribute("aria-label", "代码块更多设置");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.title = "更多设置";
  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  for (const x of [3, 8, 13]) {
    const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(x));
    circle.setAttribute("cy", "8");
    circle.setAttribute("r", "1.2");
    circle.setAttribute("fill", "currentColor");
    icon.append(circle);
  }
  button.append(icon);

  let closePopup: (() => void) | undefined;
  let refreshPopup: (() => void) | undefined;
  const open = (moveFocus: boolean) => {
    if (button.disabled) return;
    const popup = doc.createElement("div");
    popup.className = "semlo-editor-code-settings-menu";
    popup.dataset.codeTheme = getTheme();
    popup.setAttribute("role", "menu");
    popup.setAttribute("aria-label", "代码块设置");
    doc.body.append(popup);
    const unlink = linkPopup(button, popup);
    button.setAttribute("aria-expanded", "true");
    let closed = false;
    let stopPosition = () => {};
    let closeSubmenu: (() => void) | undefined;
    let subPopup: HTMLElement | undefined;
    let activeGroup: Group | undefined;
    let refreshSubmenu: (() => void) | undefined;

    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!popup.contains(target) && !subPopup?.contains(target) && !button.contains(target)) close();
    };
    const close = () => {
      if (closed) return;
      closed = true;
      closeSubmenu?.();
      stopPosition();
      doc.removeEventListener("pointerdown", outside, true);
      unlink();
      popup.remove();
      button.setAttribute("aria-expanded", "false");
      closePopup = undefined;
      refreshPopup = undefined;
    };
    const mainRows: HTMLButtonElement[] = [];
    const groupTriggers = new Map<Group, HTMLButtonElement>();
    const toggles = new Map<"wordWrap" | "showLineNumbers", HTMLButtonElement>();

    const refresh = () => {
      const settings = getSettings();
      popup.dataset.codeTheme = getTheme();
      if (subPopup) subPopup.dataset.codeTheme = getTheme();
      for (const [key, toggle] of toggles) toggle.setAttribute("aria-checked", String(settings[key]));
      refreshSubmenu?.();
    };
    const choose = (patch: Partial<CodeBlockSettings>) => {
      onChange(patch);
      refresh();
    };
    const openSubmenu = (group: Group, moveFocus: boolean) => {
      if (activeGroup === group && subPopup) {
        if (moveFocus)
          focusMenuItem(subPopup, subPopup.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? undefined);
        return;
      }
      closeSubmenu?.();
      const trigger = groupTriggers.get(group)!;
      const submenu = doc.createElement("div");
      submenu.className = "semlo-editor-code-settings-submenu";
      submenu.dataset.codeTheme = getTheme();
      submenu.setAttribute("role", "menu");
      submenu.setAttribute("aria-label", group === "font" ? "字号" : group === "mode" ? "缩进模式" : "缩进宽度");
      doc.body.append(submenu);
      subPopup = submenu;
      activeGroup = group;
      const unlinkSubmenu = linkPopup(trigger, submenu);
      trigger.setAttribute("aria-expanded", "true");
      const entries = group === "font" ? fontOptions : group === "mode" ? modeOptions : widthOptions;
      const rows: Array<{ element: HTMLButtonElement; value: CodeFontSize | CodeIndentMode | CodeIndentWidth }> = [];
      for (const [label, value] of entries) {
        const row = doc.createElement("button");
        row.type = "button";
        row.className = "semlo-editor-code-settings-option";
        row.setAttribute("role", "menuitemradio");
        row.setAttribute("aria-label", label);
        const check = doc.createElement("span");
        check.className = "semlo-editor-code-settings-check";
        check.setAttribute("aria-hidden", "true");
        const text = doc.createElement("span");
        text.textContent = label;
        row.append(check, text);
        row.addEventListener("click", () => {
          if (group === "font") choose({ codeFontSize: value as CodeFontSize });
          else if (group === "mode") choose({ indentMode: value as CodeIndentMode });
          else choose({ indentWidth: value as CodeIndentWidth });
        });
        submenu.append(row);
        rows.push({ element: row, value });
      }
      const refreshRows = () => {
        const settings = getSettings();
        const current =
          group === "font" ? settings.codeFontSize : group === "mode" ? settings.indentMode : settings.indentWidth;
        for (const row of rows) {
          const selected = row.value === current;
          row.element.setAttribute("aria-checked", String(selected));
          row.element.querySelector<HTMLElement>(".semlo-editor-code-settings-check")!.textContent = selected
            ? "✓"
            : "";
        }
      };
      refreshSubmenu = refreshRows;
      refreshRows();
      let stopSubPosition = () => {};
      const stop = () => {
        stopSubPosition();
        unlinkSubmenu();
        submenu.remove();
        trigger.setAttribute("aria-expanded", "false");
        closeSubmenu = undefined;
        refreshSubmenu = undefined;
        subPopup = undefined;
        activeGroup = undefined;
      };
      closeSubmenu = stop;
      submenu.addEventListener("keydown", (event) => {
        if (event.key === "Escape" || event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          stop();
          trigger.focus();
        } else if (event.key === "Tab") {
          close();
          button.focus();
        } else if (
          event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "Home" ||
          event.key === "End"
        ) {
          event.preventDefault();
          const index = rows.findIndex((row) => row.element === doc.activeElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? rows.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
          focusMenuItem(submenu, rows[next]?.element);
        }
      });
      const reposition = () => {
        const win = doc.defaultView;
        if (!win || !submenu.isConnected || !trigger.isConnected) return;
        const viewport = win.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        const right = left + (viewport?.width ?? win.innerWidth);
        const bottom = top + (viewport?.height ?? win.innerHeight);
        submenu.style.maxHeight = `${Math.max(0, bottom - top - 16)}px`;
        submenu.style.overflowY = "auto";
        const menuBounds = popup.getBoundingClientRect();
        const anchorBounds = trigger.getBoundingClientRect();
        const subBounds = submenu.getBoundingClientRect();
        const preferred = menuBounds.right + 4;
        const alternate = menuBounds.left - subBounds.width - 4;
        const x = preferred + subBounds.width <= right - 8 ? preferred : alternate;
        submenu.style.left = `${Math.max(left + 8, Math.min(x, right - subBounds.width - 8))}px`;
        submenu.style.top = `${Math.max(top + 8, Math.min(anchorBounds.top - 4, bottom - subBounds.height - 8))}px`;
      };
      const position = trackPopupPosition(trigger, submenu, stop, () => {
        reposition();
        const active = doc.activeElement;
        if (active && submenu.contains(active)) revealMenuItem(submenu, active as HTMLElement);
      });
      stopSubPosition = position.stop;
      position.update();
      if (moveFocus && submenu.isConnected)
        focusMenuItem(submenu, submenu.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? rows[0]?.element);
    };

    const makeRow = (label: string, role: "menuitem" | "menuitemcheckbox") => {
      const row = doc.createElement("button");
      row.type = "button";
      row.className = "semlo-editor-code-settings-row";
      row.setAttribute("role", role);
      const text = doc.createElement("span");
      text.textContent = label;
      row.append(text);
      popup.append(row);
      mainRows.push(row);
      return row;
    };
    if (canRun()) {
      const row = makeRow("运行代码", "menuitem");
      row.addEventListener("click", () => {
        close();
        onRun();
      });
      const rule = doc.createElement("div");
      rule.className = "semlo-editor-code-settings-separator";
      rule.setAttribute("role", "separator");
      popup.append(rule);
    }
    for (const [group, label] of [
      ["font", "字号"],
      ["mode", "缩进模式"],
      ["width", "缩进宽度"],
    ] as Array<[Group, string]>) {
      const row = makeRow(label, "menuitem");
      row.setAttribute("aria-label", label);
      row.setAttribute("aria-haspopup", "menu");
      row.setAttribute("aria-expanded", "false");
      const trailing = doc.createElement("span");
      trailing.className = "semlo-editor-code-settings-trailing";
      const arrow = doc.createElement("span");
      arrow.className = "semlo-editor-code-settings-arrow";
      arrow.setAttribute("aria-hidden", "true");
      trailing.append(arrow);
      row.append(trailing);
      groupTriggers.set(group, row);
      row.addEventListener("click", () => openSubmenu(group, true));
      row.addEventListener("mouseenter", () => openSubmenu(group, false));
    }
    const separator = () => {
      const rule = doc.createElement("div");
      rule.className = "semlo-editor-code-settings-separator";
      rule.setAttribute("role", "separator");
      popup.append(rule);
    };
    separator();
    for (const [key, label] of [
      ["wordWrap", "自动换行"],
      ["showLineNumbers", "行号"],
    ] as const) {
      const row = makeRow(label, "menuitemcheckbox");
      const indicator = doc.createElement("span");
      indicator.className = "semlo-editor-code-settings-toggle";
      indicator.setAttribute("aria-hidden", "true");
      row.append(indicator);
      toggles.set(key, row);
      row.addEventListener("click", () => choose({ [key]: !getSettings()[key] }));
      row.addEventListener("mouseenter", () => closeSubmenu?.());
    }
    const autoIndent = makeRow("自动缩进", "menuitem");
    autoIndent.setAttribute("aria-label", "自动缩进");
    const mac = /Mac|iPhone|iPad|iPod/i.test(doc.defaultView?.navigator.platform ?? "");
    autoIndent.setAttribute("aria-keyshortcuts", mac ? "Meta+Shift+F" : "Control+Shift+F");
    const shortcut = doc.createElement("span");
    shortcut.className = "semlo-editor-code-settings-trailing";
    shortcut.setAttribute("aria-hidden", "true");
    shortcut.textContent = mac ? "⇧⌘F" : "Ctrl+Shift+F";
    autoIndent.append(shortcut);
    autoIndent.addEventListener("click", () => {
      onAutoIndent();
      refresh();
    });
    autoIndent.addEventListener("mouseenter", () => closeSubmenu?.());
    separator();
    for (const [label, includeLanguage] of [
      ["同步样式到全文", false],
      ["同步样式与语言到全文", true],
    ] as const) {
      const row = makeRow(label, "menuitem");
      row.addEventListener("click", () => {
        onSync(includeLanguage);
        refresh();
      });
      row.addEventListener("mouseenter", () => closeSubmenu?.());
    }
    const hideHeaders = makeRow("隐藏全文代码块标题栏", "menuitem");
    hideHeaders.addEventListener("click", () => {
      // The anchor disappears when this expanded block's header is hidden.
      // Keep the menu in place until it is dismissed, as on the reference UI.
      if (onHideHeaders()) {
        stopPosition();
        stopPosition = () => {};
      }
      refresh();
    });
    hideHeaders.addEventListener("mouseenter", () => closeSubmenu?.());
    popup.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        button.focus();
      } else if (event.key === "Tab") {
        close();
        button.focus();
      } else if (event.key === "ArrowRight") {
        const group = [...groupTriggers].find(([, trigger]) => trigger === doc.activeElement)?.[0];
        if (group) {
          event.preventDefault();
          openSubmenu(group, true);
        }
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const index = mainRows.indexOf(doc.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? mainRows.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + mainRows.length) % mainRows.length;
        focusMenuItem(popup, mainRows[next]);
      }
    });
    doc.addEventListener("pointerdown", outside, true);
    closePopup = close;
    refreshPopup = refresh;
    refresh();
    const position = trackPopupPosition(button, popup, close, () => {
      const active = doc.activeElement;
      if (active && popup.contains(active)) revealMenuItem(popup, active as HTMLElement);
    });
    stopPosition = position.stop;
    position.update();
    if (!closed && moveFocus) focusMenuItem(popup, mainRows[0]);
  };

  button.addEventListener("click", (event) => {
    if (closePopup) closePopup();
    else if (!button.disabled) {
      onOpen();
      // A pointer-opened menu leaves the caret in the code, while keyboard
      // activation moves focus into the menu for arrow-key navigation.
      open(event.detail === 0);
    }
  });
  return {
    element: button,
    refresh() {
      refreshPopup?.();
    },
    close() {
      closePopup?.();
    },
    setDisabled(disabled: boolean) {
      button.disabled = disabled;
      if (disabled) closePopup?.();
    },
    destroy() {
      closePopup?.();
    },
  };
}
