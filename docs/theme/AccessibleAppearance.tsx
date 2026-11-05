import { useEffect } from "react";

/** Add keyboard and screen-reader support to Rspress's appearance controls. */
export function AccessibleAppearance() {
  useEffect(() => {
    const roots = [document.querySelector(".rp-nav"), document.getElementById("__rspress_modal_container")].filter(
      (root): root is Element => root !== null,
    );
    const attributes = ["role", "tabindex", "aria-label", "aria-pressed"] as const;
    const enhanced = new Map<HTMLElement, (string | null)[]>();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      (event.currentTarget as HTMLElement).click();
    }

    function update() {
      enhanced.forEach((_, element) => {
        if (!element.isConnected) {
          element.removeEventListener("keydown", onKeyDown);
          enhanced.delete(element);
        }
      });
      roots.forEach((root) => {
        root.querySelectorAll<HTMLElement>(".rp-switch-appearance").forEach((element) => {
          if (element.tagName === "BUTTON") return;
          if (!enhanced.has(element)) {
            enhanced.set(
              element,
              attributes.map((attribute) => element.getAttribute(attribute)),
            );
            element.setAttribute("role", "button");
            element.setAttribute("tabindex", "0");
            element.setAttribute("aria-label", "深色模式");
            element.addEventListener("keydown", onKeyDown);
          }
          element.setAttribute("aria-pressed", String(document.documentElement.classList.contains("dark")));
        });
      });
    }

    update();
    const observer = new MutationObserver(update);
    roots.forEach((root) => observer.observe(root, { childList: true, subtree: true }));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      enhanced.forEach((original, element) => {
        element.removeEventListener("keydown", onKeyDown);
        attributes.forEach((attribute, index) => {
          if (original[index] === null) element.removeAttribute(attribute);
          else element.setAttribute(attribute, original[index] as string);
        });
      });
    };
  }, []);
  return null;
}
