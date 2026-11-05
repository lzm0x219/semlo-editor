import type { Editor } from "@tiptap/core";

import { shapeTransform } from "./geometry";
import type { CanvasData, CanvasPoint, CanvasShape } from "./model";
import type { CanvasViewState } from "./state";

interface CanvasShapeTransformOptions {
  doc: Document;
  editor: Editor;
  state: Pick<CanvasViewState, "tool" | "selected">;
  coordinates(event: Pick<MouseEvent, "clientX" | "clientY">): CanvasPoint;
  previewEdges(data: CanvasData): void;
  commit(data: CanvasData): boolean;
  paint(): void;
}

export function createCanvasShapeTransforms({
  doc,
  editor,
  state,
  coordinates,
  previewEdges,
  commit,
  paint,
}: CanvasShapeTransformOptions) {
  const mount = (button: HTMLButtonElement, data: CanvasData, item: CanvasShape) => {
    if (editor.isEditable) {
      for (const corner of ["nw", "ne", "sw", "se"] as const) {
        const handle = doc.createElement("span");
        handle.className = "semlo-editor-canvas-resize";
        handle.dataset.corner = corner;
        handle.setAttribute("aria-label", "调整图形大小");
        handle.addEventListener("pointerdown", (event) => {
          if (!editor.isEditable || state.tool !== "select" || event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          const start = coordinates(event);
          const original = { x: item.x, y: item.y, width: item.width, height: item.height };
          let moved = false;
          handle.setPointerCapture(event.pointerId);
          const dimensions = (e: PointerEvent) => {
            const point = coordinates(e),
              dx = point.x - start.x,
              dy = point.y - start.y;
            const angle = ((item.rotation ?? 0) * Math.PI) / 180;
            const cosine = Math.cos(angle),
              sine = Math.sin(angle);
            const localX = dx * cosine + dy * sine,
              localY = -dx * sine + dy * cosine;
            const west = corner.includes("w"),
              north = corner.includes("n");
            const width = Math.max(24, original.width + (west ? -localX : localX));
            const height = Math.max(24, original.height + (north ? -localY : localY));
            const shiftX = (width - original.width) * (west ? -0.5 : 0.5);
            const shiftY = (height - original.height) * (north ? -0.5 : 0.5);
            const centerX = original.x + original.width / 2 + shiftX * cosine - shiftY * sine;
            const centerY = original.y + original.height / 2 + shiftX * sine + shiftY * cosine;
            return { x: centerX - width / 2, y: centerY - height / 2, width, height };
          };
          const move = (e: PointerEvent) => {
            const next = dimensions(e);
            moved ||= Math.abs(next.width - original.width) + Math.abs(next.height - original.height) > 2;
            if (!moved) return;
            Object.assign(item, next);
            previewEdges(data);
            button.style.left = `${next.x / 8}%`;
            button.style.top = `${next.y / 4.4}%`;
            button.style.width = `${next.width / 8}%`;
            button.style.height = `${next.height / 4.4}%`;
          };
          const cleanup = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", end);
            handle.removeEventListener("pointercancel", cancel);
            handle.removeEventListener("lostpointercapture", cancel);
          };
          const end = (e: PointerEvent) => {
            cleanup();
            if (!moved) return;
            Object.assign(item, dimensions(e));
            state.selected = item.id;
            if (!commit(data)) paint();
          };
          const cancel = () => {
            cleanup();
            paint();
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", end);
          handle.addEventListener("pointercancel", cancel);
          handle.addEventListener("lostpointercapture", cancel);
        });
        button.append(handle);
      }
      const rotate = doc.createElement("span");
      rotate.className = "semlo-editor-canvas-rotate";
      rotate.setAttribute("aria-label", "旋转图形");
      rotate.textContent = "↻";
      rotate.addEventListener("pointerdown", (event) => {
        if (!editor.isEditable || state.tool !== "select" || event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        const center = { x: item.x + item.width / 2, y: item.y + item.height / 2 };
        const start = coordinates(event);
        const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
        const original = item.rotation ?? 0;
        let moved = false;
        rotate.setPointerCapture(event.pointerId);
        const move = (e: PointerEvent) => {
          const point = coordinates(e);
          const angle = Math.atan2(point.y - center.y, point.x - center.x);
          const next = Math.round(
            ((((original + ((angle - startAngle) * 180) / Math.PI + 180) % 360) + 360) % 360) - 180,
          );
          moved ||= next !== original;
          if (!moved) return;
          item.rotation = next;
          button.style.transform = shapeTransform(item);
          previewEdges(data);
        };
        const cleanup = () => {
          rotate.removeEventListener("pointermove", move);
          rotate.removeEventListener("pointerup", end);
          rotate.removeEventListener("pointercancel", cancel);
          rotate.removeEventListener("lostpointercapture", cancel);
        };
        const end = (e: PointerEvent) => {
          move(e);
          cleanup();
          if (moved) {
            state.selected = item.id;
            if (!commit(data)) paint();
          }
        };
        const cancel = () => {
          cleanup();
          paint();
        };
        rotate.addEventListener("pointermove", move);
        rotate.addEventListener("pointerup", end);
        rotate.addEventListener("pointercancel", cancel);
        rotate.addEventListener("lostpointercapture", cancel);
      });
      button.append(rotate);
    }
  };
  return { mount };
}

export type CanvasShapeTransforms = ReturnType<typeof createCanvasShapeTransforms>;
