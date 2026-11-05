import type { Editor } from "@tiptap/core";

import { edgeGeometry, updateLaneMembership, withLaneMembers } from "./geometry";
import type { CanvasData, CanvasPoint, CanvasShape } from "./model";
import type { CanvasSelection } from "./selection";
import type { CanvasViewState } from "./state";

interface CanvasShapeDragOptions {
  doc: Document;
  stage: HTMLElement;
  editor: Editor;
  state: Pick<CanvasViewState, "tool" | "connecting" | "selected" | "selectedEdge">;
  selection: Pick<
    CanvasSelection,
    "selectedIds" | "selectedEdgeIds" | "selectedStrokeIds" | "selectOnly" | "selectShapeGroup" | "shapeGroup"
  >;
  coordinates(event: Pick<MouseEvent, "clientX" | "clientY">): CanvasPoint;
  previewEdges(data: CanvasData): void;
  previewStrokes(data: CanvasData): void;
  commit(data: CanvasData): boolean;
  paint(): void;
  newId(): string;
}

export function createCanvasShapeDrag({
  doc,
  stage,
  editor,
  state,
  selection,
  coordinates,
  previewEdges,
  previewStrokes,
  commit,
  paint,
  newId,
}: CanvasShapeDragOptions) {
  const { selectedIds, selectedEdgeIds, selectedStrokeIds, selectOnly, selectShapeGroup, shapeGroup } = selection;
  const bind = (button: HTMLButtonElement, data: CanvasData, item: CanvasShape, svg: SVGSVGElement) => {
    button.addEventListener("pointerdown", (event) => {
      if (editor.isEditable && state.tool === "connect" && event.button === 0) {
        event.preventDefault();
        const start = coordinates(event);
        const preview = doc.createElementNS(svg.namespaceURI, "path");
        const arrow = doc.createElementNS(svg.namespaceURI, "path");
        preview.setAttribute("fill", "none");
        preview.setAttribute("stroke", "#555");
        preview.setAttribute("stroke-width", "2");
        preview.setAttribute("pointer-events", "none");
        arrow.setAttribute("fill", "#555");
        arrow.setAttribute("pointer-events", "none");
        svg.append(preview, arrow);
        button.setPointerCapture(event.pointerId);
        let moved = false;
        const move = (e: PointerEvent) => {
          const point = coordinates(e);
          moved ||= Math.hypot(point.x - start.x, point.y - start.y) > 3;
          if (!moved) return;
          const geometry = edgeGeometry(item, { ...point, width: 0, height: 0 });
          preview.setAttribute("d", geometry?.path ?? "");
          arrow.setAttribute("d", geometry?.arrow ?? "");
        };
        const cleanup = () => {
          button.removeEventListener("pointermove", move);
          button.removeEventListener("pointerup", end);
          button.removeEventListener("pointercancel", cancel);
          button.removeEventListener("lostpointercapture", cancel);
          preview.remove();
          arrow.remove();
        };
        const end = (e: PointerEvent) => {
          move(e);
          cleanup();
          if (!moved) return;
          const point = coordinates(e);
          const target = doc.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".semlo-editor-canvas-shape");
          const targetId =
            target && stage.contains(target) && target.dataset.shapeId !== item.id ? target.dataset.shapeId : undefined;
          const id = newId();
          data.edges.push({
            id,
            from: item.id,
            to: targetId ?? "",
            ...(!targetId ? { toPoint: point } : {}),
            text: "",
            dashed: false,
            arrow: true,
          });
          selectOnly(null);
          selectedEdgeIds.clear();
          selectedStrokeIds.clear();
          selectedEdgeIds.add(id);
          state.selectedEdge = id;
          state.connecting = null;
          state.tool = "select";
          if (commit(data))
            stage.querySelector<SVGElement>('.semlo-editor-canvas-edge-hit[aria-pressed="true"]')?.focus();
          else paint();
        };
        const cancel = () => cleanup();
        button.addEventListener("pointermove", move);
        button.addEventListener("pointerup", end);
        button.addEventListener("pointercancel", cancel);
        button.addEventListener("lostpointercapture", cancel);
        return;
      }
      if (!editor.isEditable || state.tool !== "select" || event.button !== 0) return;
      event.preventDefault();
      const start = coordinates(event);
      const roots = selectedIds.has(item.id) ? new Set(selectedIds) : new Set(shapeGroup(data, item.id));
      const ids = withLaneMembers(data, roots);
      const originals = data.shapes
        .filter((shape) => ids.has(shape.id))
        .map((shape) => ({ shape, x: shape.x, y: shape.y }));
      const isGroup = selectedIds.has(item.id);
      const groupStrokes = data.groups?.find((group) => group.members.includes(item.id))?.strokes ?? [];
      const strokeOrigins = (data.strokes ?? [])
        .filter(
          (stroke) =>
            (isGroup ? selectedStrokeIds.has(stroke.id) : groupStrokes.includes(stroke.id)) ||
            (!!stroke.parentLane && roots.has(stroke.parentLane)),
        )
        .map((stroke) => ({ stroke, points: stroke.points.map((point) => ({ ...point })) }));
      const edgeOrigins = data.edges
        .filter(
          (edge) =>
            (isGroup
              ? selectedEdgeIds.has(edge.id)
              : (data.groups?.find((group) => group.members.includes(item.id))?.edges ?? []).includes(edge.id)) ||
            (!!edge.parentLane && roots.has(edge.parentLane)),
        )
        .map((edge) => ({
          edge,
          fromPoint: edge.fromPoint ? { ...edge.fromPoint } : undefined,
          toPoint: edge.toPoint ? { ...edge.toPoint } : undefined,
        }));
      const translateOthers = (dx: number, dy: number) => {
        for (const original of strokeOrigins)
          original.stroke.points = original.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
        for (const original of edgeOrigins) {
          if (!original.edge.from && original.fromPoint)
            original.edge.fromPoint = { x: original.fromPoint.x + dx, y: original.fromPoint.y + dy };
          if (!original.edge.to && original.toPoint)
            original.edge.toPoint = { x: original.toPoint.x + dx, y: original.toPoint.y + dy };
        }
      };
      let moved = false;
      button.setPointerCapture(event.pointerId);
      button.addEventListener("pointermove", move);
      button.addEventListener("pointerup", end, { once: true });
      button.addEventListener("pointercancel", cancel, { once: true });
      button.addEventListener("lostpointercapture", cancel, { once: true });
      function move(e: PointerEvent) {
        const p = coordinates(e);
        const dx = p.x - start.x,
          dy = p.y - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          moved = true;
          for (const original of originals) {
            original.shape.x = original.x + dx;
            original.shape.y = original.y + dy;
            const element = Array.from(stage.querySelectorAll<HTMLButtonElement>(".semlo-editor-canvas-shape")).find(
              (shape) => shape.dataset.shapeId === original.shape.id,
            );
            if (element) {
              element.style.left = `${original.shape.x / 8}%`;
              element.style.top = `${original.shape.y / 4.4}%`;
            }
          }
          translateOthers(dx, dy);
          previewEdges(data);
          previewStrokes(data);
        }
      }
      function end(e: PointerEvent) {
        button.removeEventListener("pointermove", move);
        button.removeEventListener("pointercancel", cancel);
        button.removeEventListener("lostpointercapture", cancel);
        if (!moved) return;
        const p = coordinates(e);
        for (const original of originals) {
          original.shape.x = original.x + p.x - start.x;
          original.shape.y = original.y + p.y - start.y;
        }
        translateOthers(p.x - start.x, p.y - start.y);
        updateLaneMembership(
          data,
          roots,
          new Set(strokeOrigins.map(({ stroke }) => stroke.id)),
          new Set(edgeOrigins.map(({ edge }) => edge.id)),
        );
        if (!selectedIds.has(item.id)) {
          selectShapeGroup(data, item.id);
        } else state.selected = item.id;
        if (!commit(data)) paint();
      }
      function cancel() {
        button.removeEventListener("pointermove", move);
        button.removeEventListener("pointerup", end);
        button.removeEventListener("pointercancel", cancel);
        button.removeEventListener("lostpointercapture", cancel);
        paint();
      }
    });
  };
  return { bind };
}
export type CanvasShapeDrag = ReturnType<typeof createCanvasShapeDrag>;
