import { maximumAttachmentHeight, minimumAttachmentHeight } from "./presentation";

interface ResizeContext {
  doc: Document;
  live(): boolean;
  height(): number;
  document(): object;
  paint(height: number): void;
  commit(height: number, document: object): void;
}

export function createAttachmentResize(context: ResizeContext) {
  const { doc } = context;
  const element = doc.createElement("span");
  element.className = "semlo-editor-attachment-resize";
  element.setAttribute("role", "separator");
  element.setAttribute("aria-label", "调整附件预览高度");
  element.setAttribute("aria-orientation", "horizontal");
  element.setAttribute("aria-valuemin", String(minimumAttachmentHeight));
  element.setAttribute("aria-valuemax", String(maximumAttachmentHeight));
  element.tabIndex = 0;
  element.hidden = true;
  let cancel: (() => void) | undefined;
  let destroyed = false;
  const clamp = (height: number) =>
    Math.round(Math.min(maximumAttachmentHeight, Math.max(minimumAttachmentHeight, height)));
  const paint = (height: number) => {
    context.paint(height);
    element.setAttribute("aria-valuenow", String(height));
    element.setAttribute("aria-valuetext", `${height} 像素`);
  };
  const pointerDown = (event: PointerEvent) => {
    if (destroyed || !context.live() || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    cancel?.();
    element.focus({ preventScroll: true });
    if (!context.live()) return;
    const start = context.height();
    const document = context.document();
    const y = event.clientY;
    let next = start;
    let finished = false;
    const valid = () => !destroyed && context.live() && context.document() === document;
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      cancel = undefined;
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      doc.removeEventListener("pointercancel", cancelled);
      doc.removeEventListener("keydown", key, true);
      element.removeEventListener("lostpointercapture", lostCapture);
      try {
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      } catch {
        /* 视图被移除时浏览器可能已释放捕获。 */
      }
      paint(context.height());
      if (commit && valid() && next !== start) context.commit(next, document);
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      if (!valid()) return finish(false);
      moveEvent.preventDefault();
      next = clamp(start + moveEvent.clientY - y);
      paint(next);
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === event.pointerId) finish(true);
    };
    const cancelled = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === event.pointerId) finish(false);
    };
    const lostCapture = () => finish(false);
    const key = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(false);
    };
    cancel = () => finish(false);
    doc.addEventListener("pointermove", move, { passive: false });
    doc.addEventListener("pointerup", up);
    doc.addEventListener("pointercancel", cancelled);
    doc.addEventListener("keydown", key, true);
    element.addEventListener("lostpointercapture", lostCapture);
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      /* 没有捕获能力时仍由本次手势的 document 监听器结束。 */
    }
  };
  const keyDown = (event: KeyboardEvent) => {
    if (destroyed || !context.live() || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const delta = event.shiftKey ? 50 : 10;
    const current = context.height();
    const next =
      event.key === "ArrowUp"
        ? current - delta
        : event.key === "ArrowDown"
          ? current + delta
          : event.key === "Home"
            ? minimumAttachmentHeight
            : event.key === "End"
              ? maximumAttachmentHeight
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    cancel?.();
    context.commit(clamp(next), context.document());
  };
  element.addEventListener("pointerdown", pointerDown);
  element.addEventListener("keydown", keyDown);
  return {
    element,
    cancel() {
      cancel?.();
    },
    update(enabled: boolean) {
      if (!enabled) cancel?.();
      element.hidden = !enabled;
      element.tabIndex = enabled ? 0 : -1;
      if (enabled && !cancel) paint(context.height());
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancel?.();
      element.removeEventListener("pointerdown", pointerDown);
      element.removeEventListener("keydown", keyDown);
    },
  };
}
