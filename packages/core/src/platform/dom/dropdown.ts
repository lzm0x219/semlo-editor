import { linkPopup, popupEditorOwner } from "./popup-owner";

export interface MenuItem {
  label: string;
  value: string;
  shortcut?: string;
  selected?: boolean;
  className?: string;
}

interface DropdownOptions {
  label?: string;
  leadingSelection?: boolean;
  keyboardWithinMenu?: boolean;
}

// Menus live under body so they can escape the toolbar's overflow. Keep their
// fixed coordinates in sync with the visible viewport and the trigger.
export function trackPopupPosition(
  anchor: HTMLElement,
  popup: HTMLElement,
  onHidden: () => void,
  onPosition?: () => void,
) {
  const doc = anchor.ownerDocument;
  const view = doc.defaultView;
  if (!view) return { update: () => {}, stop: () => {} };

  const margin = 8;
  const gap = 4;
  const viewport = view.visualViewport;
  let stopped = false;

  const update = () => {
    if (stopped) return;
    if (!anchor.isConnected || !popup.isConnected) {
      onHidden();
      return;
    }

    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? view.innerWidth);
    const bottom = top + (viewport?.height ?? view.innerHeight);
    const bounds = anchor.getBoundingClientRect();
    if (bounds.right <= left || bounds.left >= right || bounds.bottom <= top || bounds.top >= bottom) {
      onHidden();
      return;
    }

    // Close an orphaned popup if horizontal toolbar scrolling fully hides its
    // trigger, rather than leaving a menu floating over unrelated controls.
    for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
      const style = view.getComputedStyle(parent);
      const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
      const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const clip = parent.getBoundingClientRect();
      if (
        (clipsX && (bounds.right <= clip.left || bounds.left >= clip.right)) ||
        (clipsY && (bounds.bottom <= clip.top || bounds.top >= clip.bottom))
      ) {
        onHidden();
        return;
      }
    }

    // Respect the existing CSS dimensions, but constrain oversized menus on
    // small viewports. Reset the constraints before measuring on each update.
    popup.style.maxWidth = "";
    popup.style.maxHeight = "";
    popup.style.minWidth = "";
    popup.style.overflowX = "";
    popup.style.overflowY = "";
    const style = view.getComputedStyle(popup);
    const horizontalExtras =
      style.boxSizing === "border-box"
        ? 0
        : parseFloat(style.paddingLeft) +
          parseFloat(style.paddingRight) +
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.borderRightWidth);
    const verticalExtras =
      style.boxSizing === "border-box"
        ? 0
        : parseFloat(style.paddingTop) +
          parseFloat(style.paddingBottom) +
          parseFloat(style.borderTopWidth) +
          parseFloat(style.borderBottomWidth);
    const width = Math.max(0, right - left - margin * 2);
    let popupBounds = popup.getBoundingClientRect();
    if (popupBounds.width > width) {
      popup.style.minWidth = "0";
      popup.style.maxWidth = `${Math.max(0, width - horizontalExtras)}px`;
      popup.style.overflowX = "auto";
      popupBounds = popup.getBoundingClientRect();
    }

    const below = Math.max(0, bottom - margin - bounds.bottom - gap);
    const above = Math.max(0, bounds.top - gap - top - margin);
    const useAbove = popupBounds.height > below && above > below;
    const availableHeight = useAbove ? above : below;
    if (popupBounds.height > availableHeight) {
      popup.style.maxHeight = `${Math.max(0, availableHeight - verticalExtras)}px`;
      popup.style.overflowY = "auto";
      popupBounds = popup.getBoundingClientRect();
    }

    const x = Math.max(left + margin, Math.min(bounds.left, right - margin - popupBounds.width));
    const y = useAbove ? bounds.top - gap - popupBounds.height : bounds.bottom + gap;
    popup.style.left = `${x}px`;
    popup.style.top = `${Math.max(top + margin, Math.min(y, bottom - margin - popupBounds.height))}px`;
    onPosition?.();
  };

  const onScroll = (event: Event) => {
    if (!popup.contains(event.target as Node)) update();
  };
  doc.addEventListener("scroll", onScroll, true);
  view.addEventListener("resize", update);
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  const observer = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(update) : undefined;
  observer?.observe(anchor);

  return {
    update,
    stop: () => {
      if (stopped) return;
      stopped = true;
      doc.removeEventListener("scroll", onScroll, true);
      view.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      observer?.disconnect();
    },
  };
}

export function openDropdown(
  anchor: HTMLElement,
  items: MenuItem[],
  onChoose: (value: string) => void,
  options: DropdownOptions = {},
): () => void {
  const doc = anchor.ownerDocument;
  const openingFocus = doc.activeElement;
  const owner = popupEditorOwner(anchor) ?? openingFocus?.closest(".semlo-editor");
  const popup = doc.createElement("div");
  popup.className = "semlo-editor-dropdown";
  popup.setAttribute("role", "menu");
  if (options.label) popup.setAttribute("aria-label", options.label);
  for (const item of items) {
    const row = doc.createElement("button");
    row.type = "button";
    row.className = `semlo-editor-dropdown-item ${item.className ?? ""}`;
    row.setAttribute("role", options.leadingSelection ? "menuitemradio" : "menuitem");
    row.dataset.value = item.value;
    if (options.leadingSelection) {
      row.setAttribute("aria-label", item.label);
      row.setAttribute("aria-checked", String(Boolean(item.selected)));
      if (item.shortcut) row.setAttribute("aria-description", `快捷键 ${item.shortcut}`);
      const check = doc.createElement("span");
      check.className = "semlo-editor-dropdown-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = item.selected ? "✓" : "";
      row.append(check);
    }
    const label = doc.createElement("span");
    label.textContent = item.label;
    row.append(label);
    const trailing = doc.createElement("span");
    trailing.className = "semlo-editor-dropdown-shortcut";
    trailing.textContent = options.leadingSelection
      ? (item.shortcut ?? "")
      : item.selected
        ? "✓"
        : (item.shortcut ?? "");
    if (options.leadingSelection) trailing.setAttribute("aria-hidden", "true");
    row.append(trailing);
    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("click", () => {
      close();
      onChoose(item.value);
    });
    popup.append(row);
  }
  doc.body.append(popup);
  const unlinkPopup = linkPopup(anchor, popup);
  anchor.setAttribute("aria-expanded", "true");
  let closed = false;
  let stopPosition = () => {};
  const outside = (event: Event) => {
    if (!popup.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    const active = doc.activeElement;
    const inMenu = active === anchor || popup.contains(active);
    const inOwner = inMenu || active === openingFocus || Boolean(active && owner?.contains(active));
    if (!inOwner) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      anchor.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (options.keyboardWithinMenu && !inMenu) return;
    event.preventDefault();
    const rows = [...popup.querySelectorAll<HTMLButtonElement>("button")].filter((row) => !row.disabled);
    if (!rows.length) return;
    const current = rows.indexOf(doc.activeElement as HTMLButtonElement);
    const next =
      current < 0
        ? event.key === "ArrowDown"
          ? 0
          : rows.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    stopPosition();
    unlinkPopup();
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
  return close;
}
