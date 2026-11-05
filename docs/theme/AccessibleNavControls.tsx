import { useEffect } from "react";

/** Add keyboard and screen-reader support around Rspress's search UI. */
export function AccessibleNavControls() {
  useEffect(() => {
    const mobileSearch = document.querySelector<HTMLElement>(".rp-nav .rp-search-button--mobile");
    const modalRoot = document.getElementById("__rspress_modal_container");
    const appRoot = document.getElementById("__rspress_root");
    if (!mobileSearch || !modalRoot) return;

    const mobileAttributes = ["role", "tabindex", "aria-label"] as const;
    const mobileOriginal = mobileAttributes.map((attribute) => mobileSearch.getAttribute(attribute));
    let panel: HTMLElement | null = null;
    let input: HTMLInputElement | null = null;
    let clear: SVGElement | null = null;
    let cancel: HTMLElement | null = null;
    let appWasInert = false;
    let opener: HTMLElement | null = null;
    let restoreFocus = false;

    function onMobileSearchKey(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      mobileSearch?.click();
    }
    function updateClearLabel() {
      clear?.setAttribute("aria-label", input?.value ? "清空搜索" : "关闭搜索");
    }
    function onControlKey(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as Element).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    function onPanelKey(event: KeyboardEvent) {
      if (
        (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") &&
        event.target instanceof Element &&
        event.target.closest("a[href], .semlo-editor-search__footer button, .semlo-editor-search__actions-menu button")
      ) {
        // Focused links and action buttons handle their own keys instead of opening the selected result.
        event.stopPropagation();
      }
    }
    function clearInput() {
      if (!input) return;
      // Bypass React's value tracker so its input handler cancels a pending search.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
    function onClearClick(event: MouseEvent) {
      if (!input?.value) return;
      event.stopImmediatePropagation();
      clearInput();
    }
    function restoreBackground() {
      if (appRoot) appRoot.inert = appWasInert;
      input?.removeEventListener("input", updateClearLabel);
      panel?.removeEventListener("keydown", onPanelKey);
      clear?.removeEventListener("keydown", onControlKey);
      clear?.removeEventListener("click", onClearClick, true);
      cancel?.removeEventListener("keydown", onControlKey);
      panel = null;
      input = null;
      clear = null;
      cancel = null;
    }
    function updatePanel() {
      const nextPanel = modalRoot?.querySelector<HTMLElement>(".rp-search-panel__modal") ?? null;
      if (nextPanel === panel) return;
      if (panel) {
        restoreBackground();
        if (restoreFocus) {
          const target = opener;
          requestAnimationFrame(() => {
            if (modalRoot?.querySelector(".rp-search-panel__modal")) return;
            if (target?.isConnected && target.getClientRects().length) {
              target.focus();
              if (document.activeElement === target) return;
            }
            const visibleSearch = Array.from(
              document.querySelectorAll<HTMLElement>(".rp-nav .rp-search-button, .rp-nav .rp-search-button--mobile"),
            ).find((element) => element.getClientRects().length > 0);
            visibleSearch?.focus();
          });
        }
        restoreFocus = false;
        opener = null;
      }
      if (!nextPanel) return;

      panel = nextPanel;
      input = panel.querySelector<HTMLInputElement>(".rp-search-panel__input");
      clear = panel.querySelector<SVGElement>(".rp-search-panel__close");
      cancel = panel.querySelector<HTMLElement>(".rp-search-panel__cancel");
      appWasInert = appRoot?.inert ?? false;
      if (appRoot) appRoot.inert = true;
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "搜索文档");
      panel.addEventListener("keydown", onPanelKey);
      input?.setAttribute("aria-label", "搜索文档");
      input?.addEventListener("input", updateClearLabel);
      if (clear) {
        clear.setAttribute("role", "button");
        clear.setAttribute("tabindex", "0");
        updateClearLabel();
        clear.addEventListener("keydown", onControlKey);
        clear.addEventListener("click", onClearClick, true);
      }
      if (cancel) {
        cancel.setAttribute("role", "button");
        cancel.setAttribute("tabindex", "0");
        cancel.setAttribute("aria-label", "关闭搜索");
        cancel.addEventListener("keydown", onControlKey);
      }
    }
    function onDocumentClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      const trigger = event.target.closest<HTMLElement>(".rp-nav .rp-search-button, .rp-nav .rp-search-button--mobile");
      if (trigger && !panel) opener = trigger;
      if (!panel) return;
      if (
        event.target.classList.contains("rp-search-panel__mask") ||
        event.target.closest(".rp-search-panel__cancel") ||
        (event.target.closest(".rp-search-panel__close") && !input?.value)
      )
        restoreFocus = true;
    }
    function onDocumentKeyDown(event: KeyboardEvent) {
      const shortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (shortcut && !panel && document.activeElement instanceof HTMLElement) opener = document.activeElement;
      if (!panel) return;
      if (event.key === "Escape" && panel.querySelector(".semlo-editor-search__actions-menu")) return;
      if ((event.isComposing || event.keyCode === 229) && event.key === "Escape") {
        event.stopImmediatePropagation();
        return;
      }
      if (event.key === "Escape" && input?.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearInput();
        return;
      }
      if (event.key === "Escape") restoreFocus = true;
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement | SVGElement>(
          'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    mobileSearch.setAttribute("role", "button");
    mobileSearch.setAttribute("tabindex", "0");
    mobileSearch.setAttribute("aria-label", "搜索文档");
    mobileSearch.addEventListener("keydown", onMobileSearchKey);
    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("keydown", onDocumentKeyDown, true);
    updatePanel();
    const observer = new MutationObserver(updatePanel);
    observer.observe(modalRoot, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (panel) restoreBackground();
      document.removeEventListener("click", onDocumentClick, true);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      mobileSearch.removeEventListener("keydown", onMobileSearchKey);
      mobileAttributes.forEach((attribute, index) => {
        if (mobileOriginal[index] === null) mobileSearch.removeAttribute(attribute);
        else mobileSearch.setAttribute(attribute, mobileOriginal[index] as string);
      });
    };
  }, []);
  return null;
}
