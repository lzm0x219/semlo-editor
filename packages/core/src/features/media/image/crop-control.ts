import {
  normalizeImageCropRect,
  updateImageCropRect,
  type ImageCropRect,
  type ImageCropHandle as Handle,
} from "../shared/crop";

export interface ImageCropControlOptions {
  doc: Document;
  /** A positioned element whose content box contains the entire visual image. */
  stage: HTMLElement;
  /** The host editor root whose keyboard events can finish this crop. */
  keyboardScope?: HTMLElement;
  initialRect?: unknown;
  /** Called once, on Enter or an explicit finish; never called on destroy. */
  onCommit: (rect: ImageCropRect) => void;
}

const handleLabels: Array<[Exclude<Handle, "move">, string]> = [
  ["nw", "左上"],
  ["n", "上"],
  ["ne", "右上"],
  ["e", "右"],
  ["se", "右下"],
  ["s", "下"],
  ["sw", "左下"],
  ["w", "左"],
];
const minimumCropSize = 28;

/**
 * Draws only the editable crop overlay; the host paints the complete visual image
 * beneath it. The host owns outside-click and toolbar-toggle confirmation.
 */
export function createImageCropControl({ doc, stage, keyboardScope, initialRect, onCommit }: ImageCropControlOptions) {
  const win = doc.defaultView;
  const element = doc.createElement("div");
  element.className = "semlo-editor-image-crop-control";
  element.contentEditable = "false";
  const selection = doc.createElement("div");
  selection.className = "semlo-editor-image-crop-selection";
  selection.tabIndex = 0;
  selection.setAttribute("role", "group");
  selection.setAttribute("aria-label", "图片裁剪区域");
  element.append(selection);
  for (const [handle, label] of handleLabels) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `semlo-editor-image-crop-handle semlo-editor-image-crop-handle--${handle}`;
    button.dataset.cropHandle = handle;
    button.setAttribute("aria-label", `调整裁剪${label}边界`);
    selection.append(button);
  }

  let draft = normalizeImageCropRect(initialRect);
  let destroyed = false;
  let drag:
    | { pointerId: number; handle: Handle; x: number; y: number; width: number; height: number; start: ImageCropRect }
    | undefined;

  const paint = () => {
    selection.style.left = `${draft.x * 100}%`;
    selection.style.top = `${draft.y * 100}%`;
    selection.style.width = `${draft.width * 100}%`;
    selection.style.height = `${draft.height * 100}%`;
  };
  const validStage = () => {
    const bounds = stage.getBoundingClientRect();
    return stage.isConnected && element.isConnected && bounds.width > 0 && bounds.height > 0 ? bounds : null;
  };
  const clearDrag = () => {
    drag = undefined;
    doc.removeEventListener("pointermove", onPointerMove, true);
    doc.removeEventListener("pointerup", onPointerUp, true);
    doc.removeEventListener("pointercancel", onPointerCancel, true);
    win?.removeEventListener("blur", onPointerCancel);
  };
  const unchangedStage = () => {
    const bounds = validStage();
    return (
      !!bounds && !!drag && Math.abs(bounds.width - drag.width) < 0.5 && Math.abs(bounds.height - drag.height) < 0.5
    );
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!unchangedStage()) {
      draft = drag.start;
      clearDrag();
      paint();
      return;
    }
    event.preventDefault();
    const minW = Math.min(drag.start.width, minimumCropSize / drag.width);
    const minH = Math.min(drag.start.height, minimumCropSize / drag.height);
    draft = updateImageCropRect(
      drag.start,
      drag.handle,
      (event.clientX - drag.x) / drag.width,
      (event.clientY - drag.y) / drag.height,
      minW,
      minH,
    );
    paint();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!unchangedStage()) {
      draft = drag.start;
      paint();
    }
    clearDrag();
  };
  const onPointerCancel = (event: Event) => {
    if (!drag || (event.type === "pointercancel" && (event as PointerEvent).pointerId !== drag.pointerId)) return;
    draft = drag.start;
    clearDrag();
    paint();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (destroyed || drag || event.button !== 0) return;
    const bounds = validStage();
    if (!bounds) return;
    const targetNode = event.target as Node | null;
    const target =
      targetNode?.nodeType === 1 ? (targetNode as Element).closest<HTMLElement>("[data-crop-handle]") : null;
    const handle = (target?.dataset.cropHandle ?? "move") as Handle;
    if (!target && !selection.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {
      pointerId: event.pointerId,
      handle,
      x: event.clientX,
      y: event.clientY,
      width: bounds.width,
      height: bounds.height,
      start: { ...draft },
    };
    doc.addEventListener("pointermove", onPointerMove, true);
    doc.addEventListener("pointerup", onPointerUp, true);
    doc.addEventListener("pointercancel", onPointerCancel, true);
    win?.addEventListener("blur", onPointerCancel);
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    clearDrag();
    doc.removeEventListener("keydown", onKeyDown, true);
    selection.removeEventListener("pointerdown", onPointerDown);
    element.remove();
  };
  const finish = () => {
    if (destroyed) return;
    const canCommit = !!validStage() && !drag;
    const result = { ...draft };
    destroy();
    if (canCommit) onCommit(result);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (destroyed || event.isComposing) return;
    if (!stage.isConnected || !element.isConnected) {
      destroy();
      return;
    }
    if (event.key === "Enter") {
      const path = event.composedPath();
      if (!path.includes(element) && !path.includes(keyboardScope ?? stage)) return;
      event.preventDefault();
      event.stopPropagation();
      finish();
      return;
    }
    if (!selection.contains(event.target as Node)) return;
    const bounds = validStage();
    if (!bounds) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const targetNode = event.target as Node | null;
    const target =
      targetNode?.nodeType === 1 ? (targetNode as Element).closest<HTMLElement>("[data-crop-handle]") : null;
    const handle = (target?.dataset.cropHandle ?? "move") as Handle;
    const step = event.shiftKey ? 10 : 1;
    draft = updateImageCropRect(
      draft,
      handle,
      (direction[0] * step) / bounds.width,
      (direction[1] * step) / bounds.height,
      Math.min(draft.width, minimumCropSize / bounds.width),
      Math.min(draft.height, minimumCropSize / bounds.height),
    );
    paint();
  };
  selection.addEventListener("pointerdown", onPointerDown);
  doc.addEventListener("keydown", onKeyDown, true);
  stage.append(element);
  paint();
  return { element, getRect: () => ({ ...draft }), finish, destroy };
}
