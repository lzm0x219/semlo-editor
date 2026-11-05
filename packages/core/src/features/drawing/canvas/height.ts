/** Shared height control for the independent canvas cards. */
export const CANVAS_DEFAULT_HEIGHT = 460;
const minHeight = 80;
const maxHeight = 2000;
export function canvasHeight(value: unknown): number {
  if (value === null || value === undefined || value === "") return CANVAS_DEFAULT_HEIGHT;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(minHeight, Math.min(maxHeight, Math.round(n))) : CANVAS_DEFAULT_HEIGHT;
}
export function mountCanvasHeight(
  root: HTMLElement,
  height: number,
  editable: boolean,
  commit: (value: number) => void,
): void {
  height = canvasHeight(height);
  root.style.height = `${height}px`;
  const handle = root.ownerDocument.createElement("div");
  handle.className = "semlo-editor-canvas-height-handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-label", "调整画布高度");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-valuemin", String(minHeight));
  handle.setAttribute("aria-valuemax", String(maxHeight));
  handle.setAttribute("aria-valuenow", String(height));
  handle.tabIndex = editable ? 0 : -1;
  handle.setAttribute("aria-disabled", String(!editable));
  if (editable) {
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      commit(canvasHeight(height + (event.key === "ArrowUp" ? -10 : 10)));
    });
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const start = event.clientY;
      let next = height;
      handle.setPointerCapture(event.pointerId);
      const move = (e: PointerEvent) => {
        next = canvasHeight(height + e.clientY - start);
        root.style.height = `${next}px`;
        handle.setAttribute("aria-valuenow", String(next));
      };
      const cleanup = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", cancel);
        handle.removeEventListener("lostpointercapture", cancel);
      };
      const end = (e: PointerEvent) => {
        move(e);
        cleanup();
        if (next !== height) commit(next);
      };
      const cancel = () => {
        cleanup();
        root.style.height = `${height}px`;
        handle.setAttribute("aria-valuenow", String(height));
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", cancel);
      handle.addEventListener("lostpointercapture", cancel);
    });
  }
  root.append(handle);
}
