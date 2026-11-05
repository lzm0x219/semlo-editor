const blockMenuIcons: Record<string, string> = {
  转化为: '<path d="M4 6a5 5 0 0 1 8-2l1 1M13 2v3h-3M12 10a5 5 0 0 1-8 2l-1-1M3 14v-3h3"/>',
  删除: '<path d="M3 4h10M6 4V2h4v2M5 4l.5 9h5L11 4M7 7v4M9 7v4"/>',
  复制: '<rect x="5" y="4" width="8" height="9" rx="1"/><path d="M3 10V3a1 1 0 0 1 1-1h6"/>',
  剪切: '<circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><path d="m5.5 5.5 7 7M5.5 10.5l7-7"/>',
  缩进: '<path d="M6 3h7M6 7h7M6 11h7M2 5l2 2-2 2"/>',
  在下方添加: '<path d="M8 3v10M3 8h10"/>',
};

export function createBlockMenuHelpers(doc: Document, win: (Window & typeof globalThis) | null) {
  const positionMenu = (element: HTMLElement, anchor: DOMRect, sub = false) => {
    const width = element.offsetWidth,
      height = element.offsetHeight,
      vw = win?.innerWidth ?? 1000,
      vh = win?.innerHeight ?? 800;
    const left = sub ? (anchor.right + width + 5 > vw ? anchor.left - width - 5 : anchor.right + 5) : anchor.left;
    const below = anchor.bottom + 4,
      above = anchor.top - height - 4,
      top = sub ? anchor.top : below + height <= vh - 4 || above < 4 ? below : above;
    element.style.left = `${Math.max(4, Math.min(left, vw - width - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(top, vh - height - 4))}px`;
  };
  const menuItem = (parent: HTMLElement, label: string, action: () => void, disabled = false, hasChildren = false) => {
    const row = doc.createElement("button");
    row.type = "button";
    row.setAttribute("role", "menuitem");
    row.className = "semlo-editor-block-menu-item";
    row.disabled = disabled;
    const icon = parent.classList.contains("semlo-editor-block-menu") ? blockMenuIcons[label] : undefined;
    if (icon) {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.3");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      svg.innerHTML = icon;
      row.append(svg);
    }
    const text = doc.createElement("span");
    text.className = "semlo-editor-block-menu-label";
    text.textContent = label;
    row.append(text);
    if (disabled) row.title = "当前块暂不支持此操作";
    if (hasChildren) {
      row.setAttribute("aria-haspopup", "menu");
      row.setAttribute("aria-expanded", "false");
      const arrow = doc.createElement("span");
      arrow.className = "semlo-editor-block-menu-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "›";
      row.append(arrow);
    }
    row.addEventListener("click", action);
    parent.append(row);
    return row;
  };
  const moveMenuFocus = (event: KeyboardEvent, container: HTMLElement) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      container.querySelectorAll<HTMLButtonElement>(':scope > button[role="menuitem"]:not(:disabled)'),
    );
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    const index = items.indexOf(doc.activeElement as HTMLButtonElement),
      direction = event.key === "ArrowDown" ? 1 : -1;
    items[
      index < 0 ? (direction > 0 ? 0 : items.length - 1) : (index + direction + items.length) % items.length
    ].focus();
  };
  return { positionMenu, menuItem, moveMenuFocus };
}
