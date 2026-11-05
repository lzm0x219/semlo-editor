import type { Editor } from "@tiptap/core";

import { edgeGeometry, endpointBox, shapeContains, updateLaneMembership } from "./geometry";
import type { CanvasData, CanvasPoint } from "./model";
import type { CanvasSelection } from "./selection";
import type { CanvasViewState } from "./state";

interface CanvasEdgeHandleOptions {
  doc: Document;
  stage: HTMLElement;
  editor: Editor;
  state: Pick<CanvasViewState, "tool" | "selectedEdge">;
  selection: Pick<CanvasSelection, "selectedIds" | "selectedEdgeIds" | "selectedStrokeIds">;
  coordinates(event: Pick<MouseEvent, "clientX" | "clientY">): CanvasPoint;
  previewEdges(data: CanvasData): void;
  commit(data: CanvasData): boolean;
  paint(): void;
}

export function createCanvasEdgeHandles({
  doc,
  stage,
  editor,
  state,
  selection,
  coordinates,
  previewEdges,
  commit,
  paint,
}: CanvasEdgeHandleOptions) {
  const { selectedIds, selectedEdgeIds, selectedStrokeIds } = selection;
  const mount = (data: CanvasData, svg: SVGSVGElement) => {
    const activeEdge = data.edges.find((edge) => edge.id === state.selectedEdge);
    if (
      activeEdge &&
      editor.isEditable &&
      state.tool === "select" &&
      selectedEdgeIds.size === 1 &&
      selectedIds.size === 0 &&
      selectedStrokeIds.size === 0
    ) {
      const from = endpointBox(data, activeEdge.from, activeEdge.fromPoint);
      const to = endpointBox(data, activeEdge.to, activeEdge.toPoint);
      const geometry =
        from && to
          ? edgeGeometry(
              from,
              to,
              activeEdge.route,
              activeEdge.startMarker,
              activeEdge.endMarker,
              activeEdge.bendOffset,
            )
          : null;
      if (geometry) {
        for (const side of ["from", "to"] as const) {
          const handle = doc.createElement("button");
          handle.type = "button";
          handle.className = "semlo-editor-canvas-endpoint";
          handle.dataset.side = side;
          handle.setAttribute("aria-label", side === "from" ? "连接线起点" : "连接线终点");
          const startX = side === "from" ? geometry.x1 : geometry.x2;
          const startY = side === "from" ? geometry.y1 : geometry.y2;
          handle.style.left = `${startX / 8}%`;
          handle.style.top = `${startY / 4.4}%`;
          handle.addEventListener("pointerdown", (event) => {
            if (!editor.isEditable || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            handle.setPointerCapture(event.pointerId);
            let last = coordinates(event);
            let moved = false;
            const move = (e: PointerEvent) => {
              last = coordinates(e);
              moved ||= Math.hypot(last.x - startX, last.y - startY) > 3;
              handle.style.left = `${last.x / 8}%`;
              handle.style.top = `${last.y / 4.4}%`;
              const freeBox = { x: last.x, y: last.y, width: 0, height: 0 };
              const otherBox =
                side === "from"
                  ? endpointBox(data, activeEdge.to, activeEdge.toPoint)
                  : endpointBox(data, activeEdge.from, activeEdge.fromPoint);
              const preview = otherBox
                ? side === "from"
                  ? edgeGeometry(
                      freeBox,
                      otherBox,
                      activeEdge.route,
                      activeEdge.startMarker,
                      activeEdge.endMarker,
                      activeEdge.bendOffset,
                    )
                  : edgeGeometry(
                      otherBox,
                      freeBox,
                      activeEdge.route,
                      activeEdge.startMarker,
                      activeEdge.endMarker,
                      activeEdge.bendOffset,
                    )
                : null;
              if (!preview) return;
              const byId = (selector: string, attribute: string) =>
                Array.from(svg.querySelectorAll(selector)).find(
                  (element) => element.getAttribute(attribute) === activeEdge.id,
                );
              byId(".semlo-editor-canvas-edge", "data-edge-id")?.setAttribute("d", preview.path);
              byId(".semlo-editor-canvas-edge-hit", "data-edge-id")?.setAttribute("d", preview.path);
              byId("[data-edge-arrow-id]", "data-edge-arrow-id")?.setAttribute("d", preview.arrow);
              byId("[data-edge-start-arrow-id]", "data-edge-start-arrow-id")?.setAttribute("d", preview.startArrow);
              const text = byId("[data-edge-text-id]", "data-edge-text-id");
              text?.setAttribute("x", String(preview.midX));
              text?.setAttribute("y", String(preview.midY - 5));
              const otherHandle = stage.querySelector<HTMLElement>(
                `.semlo-editor-canvas-endpoint[data-side="${side === "from" ? "to" : "from"}"]`,
              );
              if (otherHandle) {
                otherHandle.style.left = `${(side === "from" ? preview.x2 : preview.x1) / 8}%`;
                otherHandle.style.top = `${(side === "from" ? preview.y2 : preview.y1) / 4.4}%`;
              }
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
              if (!moved) {
                paint();
                return;
              }
              const target = [...data.shapes].reverse().find((shape) => shapeContains(shape, last));
              if (side === "from") {
                activeEdge.from = target?.id ?? "";
                if (target) delete activeEdge.fromPoint;
                else activeEdge.fromPoint = last;
              } else {
                activeEdge.to = target?.id ?? "";
                if (target) delete activeEdge.toPoint;
                else activeEdge.toPoint = last;
              }
              if (activeEdge.from || activeEdge.to) delete activeEdge.parentLane;
              else updateLaneMembership(data, new Set(), new Set(), new Set([activeEdge.id]));
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
          stage.append(handle);
        }
        if ((activeEdge.route ?? "orthogonal") === "orthogonal") {
          const handle = doc.createElement("button");
          handle.type = "button";
          handle.className = "semlo-editor-canvas-bend";
          handle.setAttribute("aria-label", "调整折线拐点");
          handle.style.left = `${geometry.midX / 8}%`;
          handle.style.top = `${geometry.midY / 4.4}%`;
          handle.addEventListener("pointerdown", (event) => {
            if (!editor.isEditable || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const start = coordinates(event);
            const original = activeEdge.bendOffset ?? 0;
            let moved = false;
            handle.setPointerCapture(event.pointerId);
            const move = (e: PointerEvent) => {
              const point = coordinates(e);
              const delta = geometry.horizontal ? point.x - start.x : point.y - start.y;
              moved ||= Math.abs(delta) > 3;
              if (!moved) return;
              activeEdge.bendOffset = original + delta;
              handle.style.left = `${(geometry.midX + (geometry.horizontal ? delta : 0)) / 8}%`;
              handle.style.top = `${(geometry.midY + (geometry.horizontal ? 0 : delta)) / 4.4}%`;
              previewEdges(data);
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
              if (!moved || !commit(data)) paint();
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
          stage.append(handle);
        }
      }
    }
  };
  return { mount };
}

export type CanvasEdgeHandles = ReturnType<typeof createCanvasEdgeHandles>;
