/** Controls a toolbar whose trailing items move into a small overflow panel. */
export interface ToolbarOverflowController {
  /** Remeasure after changing a toolbar control's size. */
  refresh: () => void;
  /** Restore the original order and release observers and listeners. */
  destroy: () => void;
}

let nextPanelId = 0;

/**
 * The caller owns `moreButton` and should add all other controls first. Actual
 * controls are moved, rather than duplicated, so their state and handlers stay
 * intact and editor selections survive a mouse interaction with the panel.
 */
export function mountToolbarOverflow(
  toolbar: HTMLElement,
  shell: HTMLElement,
  moreButton: HTMLButtonElement,
): ToolbarOverflowController {
  const doc = toolbar.ownerDocument;
  const win = doc.defaultView;
  const items = [...toolbar.children].filter((item): item is HTMLElement => item.nodeType === 1 && item !== moreButton);
  const panel = doc.createElement("div");
  panel.className = "semlo-editor-toolbar-overflow-panel";
  // Separate copies of this module can be loaded into the same document.
  // Check the document instead of assuming a module-local counter is unique.
  do {
    panel.id = `semlo-editor-toolbar-overflow-${++nextPanelId}`;
  } while (doc.getElementById(panel.id));
  panel.hidden = true;
  panel.setAttribute("role", "toolbar");
  panel.setAttribute("aria-label", "更多工具");
  doc.body.append(panel);

  toolbar.classList.add("semlo-editor-toolbar-overflow-managed");
  moreButton.classList.add("semlo-editor-toolbar-overflow-more");
  moreButton.type = "button";
  moreButton.setAttribute("aria-label", "更多");
  moreButton.removeAttribute("aria-haspopup");
  moreButton.setAttribute("aria-expanded", "false");
  moreButton.setAttribute("aria-controls", panel.id);
  moreButton.hidden = true;
  toolbar.append(moreButton);

  let destroyed = false;
  let scheduled: number | undefined;
  let cut = items.length;
  let lastWidth = -1;
  let lastContent = "";

  const number = (value: string) => Number.parseFloat(value) || 0;
  const isSeparator = (element: HTMLElement) => element.classList.contains("semlo-editor-separator");

  const close = (restoreFocus = false) => {
    if (panel.hidden) return;
    panel.hidden = true;
    moreButton.setAttribute("aria-expanded", "false");
    if (restoreFocus && !moreButton.hidden) moreButton.focus({ preventScroll: true });
  };

  const position = () => {
    if (!win || panel.hidden) return;
    const anchor = moreButton.getBoundingClientRect();
    const viewport = win.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? win.innerWidth);
    const bottom = top + (viewport?.height ?? win.innerHeight);
    if (
      !moreButton.isConnected ||
      anchor.right <= left ||
      anchor.left >= right ||
      anchor.bottom <= top ||
      anchor.top >= bottom
    ) {
      close();
      return;
    }
    const maxWidth = `${Math.max(0, right - left - 16)}px`;
    const previousWidth = panel.style.maxWidth;
    const previousLeft = panel.style.left;
    const previousTop = panel.style.top;
    panel.style.maxWidth = maxWidth;
    const bounds = panel.getBoundingClientRect();
    const x = Math.max(left + 8, Math.min(anchor.right - bounds.width, right - bounds.width - 8));
    const below = anchor.bottom + 4;
    const above = anchor.top - bounds.height - 4;
    const y = below + bounds.height <= bottom - 8 || above < top + 8 ? below : above;
    panel.style.left = `${x}px`;
    panel.style.top = `${Math.max(top + 8, Math.min(y, bottom - bounds.height - 8))}px`;
    // Child dropdowns are mounted under body and track ancestor scroll. When
    // this fixed panel moves after a viewport change, notify those listeners
    // so their anchors are measured again after the move.
    if (
      panel.querySelector('[aria-expanded="true"]') &&
      (panel.style.left !== previousLeft || panel.style.top !== previousTop || maxWidth !== previousWidth)
    )
      panel.dispatchEvent(new win.Event("scroll"));
  };

  const moveItems = (visible: number) => {
    const focused = doc.activeElement?.nodeType === 1 ? (doc.activeElement as HTMLElement) : null;
    const focusWasItem = focused !== null && items.some((item) => item.contains(focused));
    let before: ChildNode = moreButton;
    for (let index = visible - 1; index >= 0; index--) {
      const item = items[index];
      if (item.parentNode !== toolbar || item.nextSibling !== before) toolbar.insertBefore(item, before);
      before = item;
    }
    let next: ChildNode | null = null;
    for (let index = items.length - 1; index >= visible; index--) {
      const item = items[index];
      if (item.parentNode !== panel || item.nextSibling !== next) panel.insertBefore(item, next);
      next = item;
    }
    if (focusWasItem && focused && doc.activeElement !== focused) {
      if (panel.contains(focused) && panel.hidden) moreButton.focus({ preventScroll: true });
      else focused.focus({ preventScroll: true });
    }
  };

  const update = (force = false) => {
    if (destroyed || !win) return;
    if (
      !toolbar.isConnected ||
      !shell.isConnected ||
      shell.classList.contains("semlo-editor-readonly") ||
      !toolbar.clientWidth
    ) {
      close();
      return;
    }

    const signature = items.map((item) => item.textContent).join("\u0000");
    if (!force && toolbar.clientWidth === lastWidth && signature === lastContent) {
      position();
      return;
    }
    lastWidth = toolbar.clientWidth;
    lastContent = signature;

    // Measure in an invisible, short-lived toolbar with the same inherited
    // styles. Controls currently hidden in the panel still get accurate widths.
    const measure = toolbar.cloneNode(false) as HTMLElement;
    measure.removeAttribute("id");
    measure.setAttribute("aria-hidden", "true");
    measure.inert = true;
    measure.style.cssText =
      "position:fixed;left:-100000px;top:0;width:max-content;max-width:none;min-width:0;overflow:visible;visibility:hidden;pointer-events:none;display:flex;flex-wrap:nowrap;";
    const copies = items.map((item) => item.cloneNode(true) as HTMLElement);
    const moreCopy = moreButton.cloneNode(true) as HTMLButtonElement;
    moreCopy.hidden = false;
    measure.append(...copies, moreCopy);
    shell.append(measure);
    const style = win.getComputedStyle(toolbar);
    const gap = number(style.columnGap || style.gap);
    const available = Math.max(0, toolbar.clientWidth - number(style.paddingLeft) - number(style.paddingRight));
    const widthOf = (element: HTMLElement) => {
      const computed = win.getComputedStyle(element);
      return element.getBoundingClientRect().width + number(computed.marginLeft) + number(computed.marginRight);
    };
    const widths = copies.map(widthOf);
    const moreWidth = widthOf(moreCopy);
    measure.remove();

    const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, items.length - 1) * gap;
    let visible = items.length;
    if (total > available + 0.5) {
      let used = 0;
      visible = 0;
      for (const width of widths) {
        const candidate = used + (visible ? gap : 0) + width;
        if (candidate + gap + moreWidth > available + 0.5) break;
        used = candidate;
        visible++;
      }
      while (visible > 0 && isSeparator(items[visible - 1])) visible--;
    }

    const hadFocus = doc.activeElement === moreButton;
    moreButton.hidden = visible === items.length;
    let movedExpandedControl = false;
    if (visible !== cut) {
      movedExpandedControl = items.some(
        (item) => item.getAttribute("aria-expanded") === "true" || item.querySelector('[aria-expanded="true"]'),
      );
      moveItems(visible);
      cut = visible;
    }
    if (moreButton.hidden) {
      close();
      if (hadFocus)
        [...items]
          .reverse()
          .find((item) => !isSeparator(item) && item.tabIndex >= 0)
          ?.focus({ preventScroll: true });
    } else {
      toolbar.scrollLeft = 0;
      position();
    }
    // A control can move between the toolbar and the panel without changing
    // size, so ResizeObserver alone cannot reposition its open dropdown.
    if (movedExpandedControl) toolbar.dispatchEvent(new win.Event("scroll"));
  };

  const refresh = () => update(true);

  const schedule = () => {
    if (!win || destroyed || scheduled !== undefined) return;
    scheduled = win.requestAnimationFrame(() => {
      scheduled = undefined;
      update();
    });
  };
  const invalidate = () => {
    lastWidth = -1;
    // Viewport changes move the toolbar before the next animation frame.
    // Move the open overflow synchronously so child popups never measure an
    // obsolete anchor that has already fallen outside the new viewport.
    position();
    schedule();
  };
  const onMore = (event: MouseEvent) => {
    if (moreButton.hidden || shell.classList.contains("semlo-editor-readonly")) return;
    if (!panel.hidden) {
      close();
      return;
    }
    panel.hidden = false;
    moreButton.setAttribute("aria-expanded", "true");
    position();
    // Keyboard activation should enter the panel immediately. Pointer
    // activation keeps the editor selection, as with the other toolbar tools.
    if (event.detail === 0 && !panel.hidden)
      panel.querySelector<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])')?.focus();
  };
  const preserveSelection = (event: MouseEvent) => event.preventDefault();
  const isOwnedPopup = (target: globalThis.Node) => {
    const pending: Element[] = [panel];
    const seen = new Set<Element>(pending);
    while (pending.length) {
      const container = pending.pop()!;
      for (const anchor of container.querySelectorAll('[aria-expanded="true"][aria-controls]')) {
        for (const id of (anchor.getAttribute("aria-controls") ?? "").split(/\s+/)) {
          const popup = id && doc.getElementById(id);
          if (!popup || seen.has(popup)) continue;
          if (popup.contains(target)) return true;
          seen.add(popup);
          pending.push(popup);
        }
      }
    }
    return false;
  };
  const outside = (event: Event) => {
    const target = event.target as globalThis.Node | null;
    if (!target || panel.contains(target) || moreButton.contains(target)) return;
    // Popups are mounted under body. Follow the actual control relationships,
    // including nested dialogs, instead of accepting any popup in the page.
    if (isOwnedPopup(target)) return;
    close();
  };
  let ownedEscape: KeyboardEvent | undefined;
  const captureKeyboard = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || event.key !== "Escape" || panel.hidden) return;
    const target = event.target as globalThis.Node | null;
    if (target && (shell.contains(target) || panel.contains(target) || isOwnedPopup(target))) ownedEscape = event;
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented && !panel.hidden) {
      if (ownedEscape !== event) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };
  const onScroll = (event: Event) => {
    if (!panel.contains(event.target as globalThis.Node)) position();
  };
  const onShell = () => {
    if (shell.classList.contains("semlo-editor-readonly")) close();
    schedule();
  };

  moreButton.addEventListener("mousedown", preserveSelection);
  moreButton.addEventListener("click", onMore);
  doc.addEventListener("keydown", captureKeyboard, true);
  doc.addEventListener("keydown", keyboard);
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("scroll", onScroll, true);
  win?.addEventListener("resize", invalidate);
  win?.visualViewport?.addEventListener("resize", invalidate);
  win?.visualViewport?.addEventListener("scroll", position);
  doc.fonts?.addEventListener("loadingdone", invalidate);
  const resize = win && typeof win.ResizeObserver === "function" ? new win.ResizeObserver(schedule) : undefined;
  resize?.observe(toolbar);
  const mutations = win && typeof win.MutationObserver === "function" ? new win.MutationObserver(schedule) : undefined;
  for (const item of items) mutations?.observe(item, { childList: true, characterData: true, subtree: true });
  const shellObserver =
    win && typeof win.MutationObserver === "function" ? new win.MutationObserver(onShell) : undefined;
  shellObserver?.observe(shell, { attributes: true, attributeFilter: ["class"] });
  refresh();

  return {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (scheduled !== undefined) win?.cancelAnimationFrame(scheduled);
      resize?.disconnect();
      mutations?.disconnect();
      shellObserver?.disconnect();
      doc.fonts?.removeEventListener("loadingdone", invalidate);
      win?.removeEventListener("resize", invalidate);
      win?.visualViewport?.removeEventListener("resize", invalidate);
      win?.visualViewport?.removeEventListener("scroll", position);
      doc.removeEventListener("pointerdown", outside, true);
      doc.removeEventListener("scroll", onScroll, true);
      moreButton.removeEventListener("mousedown", preserveSelection);
      moreButton.removeEventListener("click", onMore);
      doc.removeEventListener("keydown", captureKeyboard, true);
      doc.removeEventListener("keydown", keyboard);
      moveItems(items.length);
      panel.remove();
      toolbar.classList.remove("semlo-editor-toolbar-overflow-managed");
      moreButton.classList.remove("semlo-editor-toolbar-overflow-more");
      moreButton.hidden = true;
      moreButton.setAttribute("aria-expanded", "false");
      moreButton.removeAttribute("aria-controls");
      moreButton.remove();
    },
  };
}
