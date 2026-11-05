// The counter lives on the document so separately bundled copies cannot
// assign the same ID, even while a newly linked popup is still detached.
const popupCounter = Symbol.for("@semlo-editor/core/popup-owner/counter");

/** Associate a body-mounted popup with its trigger until the popup closes. */
export function linkPopup(anchor: HTMLElement, popup: HTMLElement): () => void {
  const doc = anchor.ownerDocument as Document & { [popupCounter]?: number };
  const previousControls = anchor.getAttribute("aria-controls");
  const previousIds = new Set(previousControls?.split(/\s+/) ?? []);
  let counter = doc[popupCounter] ?? 0;
  let id: string;
  do {
    id = `semlo-editor-popup-${++counter}`;
  } while (doc.getElementById(id) || previousIds.has(id));
  doc[popupCounter] = counter;

  const previousId = popup.getAttribute("id");
  const linkedControls = previousControls?.trim() ? `${previousControls} ${id}` : id;
  popup.id = id;
  anchor.setAttribute("aria-controls", linkedControls);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = anchor.getAttribute("aria-controls");
    if (current === linkedControls) {
      if (previousControls === null) anchor.removeAttribute("aria-controls");
      else anchor.setAttribute("aria-controls", previousControls);
    } else if (current !== null) {
      const remaining = current.split(/\s+/).filter((value) => value && value !== id);
      if (remaining.length) anchor.setAttribute("aria-controls", remaining.join(" "));
      else anchor.removeAttribute("aria-controls");
    }
    if (popup.id === id) {
      if (previousId === null) popup.removeAttribute("id");
      else popup.id = previousId;
    }
  };
}

/** Locate an editor shell even when a toolbar control has moved into overflow. */
export function popupEditorOwner(anchor: HTMLElement): Element | null {
  const shell = anchor.closest(".semlo-editor");
  if (shell) return shell;
  const overflow = anchor.closest(".semlo-editor-toolbar-overflow-panel");
  if (!overflow?.id) return null;
  for (const trigger of anchor.ownerDocument.querySelectorAll<HTMLElement>(
    ".semlo-editor-toolbar-overflow-more[aria-controls]",
  )) {
    if (trigger.getAttribute("aria-controls")?.split(/\s+/).includes(overflow.id))
      return trigger.closest(".semlo-editor");
  }
  return null;
}
