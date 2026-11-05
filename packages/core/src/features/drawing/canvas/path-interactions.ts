import type { Editor } from "@tiptap/core";
import { undo, redo } from "@tiptap/pm/history";
import type { EditorView } from "@tiptap/pm/view";

import { updateLaneMembership, withLaneMembers } from "./geometry";
import type { CanvasData, CanvasEdge, CanvasPoint, CanvasStroke } from "./model";
import type { CanvasSelection } from "./selection";
import type { CanvasViewState } from "./state";

interface CanvasPathInteractionOptions {
  editor: Editor;
  view: EditorView;
  stage: HTMLElement;
  state: Pick<CanvasViewState, "tool" | "selectedEdge">;
  selection: Pick<
    CanvasSelection,
    | "selectedIds"
    | "selectedEdgeIds"
    | "selectedStrokeIds"
    | "selectEdgeGroup"
    | "selectStrokeGroup"
    | "toggleEdgeGroup"
    | "toggleStrokeGroup"
  >;
  coordinates(event: Pick<MouseEvent, "clientX" | "clientY">): CanvasPoint;
  updateGroupShapes(data: CanvasData): void;
  previewEdges(data: CanvasData): void;
  previewStrokes(data: CanvasData): void;
  nudgeSelection(data: CanvasData, dx: number, dy: number): void;
  deleteSelection(data: CanvasData, fallbackShape?: string, fallbackEdge?: string, fallbackStroke?: string): void;
  commit(data: CanvasData): boolean;
  paint(): void;
}

export function createCanvasPathInteractions({
  editor,
  view,
  stage,
  state,
  selection,
  coordinates,
  updateGroupShapes,
  previewEdges,
  previewStrokes,
  nudgeSelection,
  deleteSelection,
  commit,
  paint,
}: CanvasPathInteractionOptions) {
  const { selectedIds, selectedEdgeIds, selectedStrokeIds } = selection;

  const bindEdge = (hit: SVGPathElement, data: CanvasData, link: CanvasEdge) => {
    hit.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.tool !== "select") return;
      selection.toggleEdgeGroup(data, link.id, event.shiftKey);
      paint();
      stage.querySelector<SVGElement>('.semlo-editor-canvas-edge-hit[aria-pressed="true"]')?.focus();
    });
    hit.addEventListener("pointerdown", (event) => {
      if (!editor.isEditable || state.tool !== "select" || event.button !== 0) return;
      const group = data.groups?.find((entry) => entry.edges?.includes(link.id));
      if (!group) return;
      event.preventDefault();
      event.stopPropagation();
      const wasSelected = selectedEdgeIds.has(link.id);
      const shapeRoots = wasSelected ? new Set(selectedIds) : new Set(group.members);
      const shapeIds = withLaneMembers(data, shapeRoots);
      const strokeIds = wasSelected ? selectedStrokeIds : new Set(group.strokes ?? []);
      const edgeIds = wasSelected ? selectedEdgeIds : new Set(group.edges ?? []);
      const originals = data.shapes
        .filter((shape) => shapeIds.has(shape.id))
        .map((shape) => ({ shape, x: shape.x, y: shape.y }));
      const strokes = (data.strokes ?? [])
        .filter((stroke) => strokeIds.has(stroke.id) || (!!stroke.parentLane && shapeRoots.has(stroke.parentLane)))
        .map((stroke) => ({ stroke, points: stroke.points.map((point) => ({ ...point })) }));
      const edges = data.edges
        .filter((edge) => edgeIds.has(edge.id) || (!!edge.parentLane && shapeRoots.has(edge.parentLane)))
        .map((edge) => ({
          edge,
          fromPoint: edge.fromPoint ? { ...edge.fromPoint } : undefined,
          toPoint: edge.toPoint ? { ...edge.toPoint } : undefined,
        }));
      const start = coordinates(event);
      let moved = false;
      hit.setPointerCapture(event.pointerId);
      const move = (e: PointerEvent) => {
        const point = coordinates(e),
          dx = point.x - start.x,
          dy = point.y - start.y;
        moved ||= Math.hypot(dx, dy) > 3;
        if (!moved) return;
        if (!wasSelected) selection.selectEdgeGroup(data, link.id);
        for (const original of originals) {
          original.shape.x = original.x + dx;
          original.shape.y = original.y + dy;
        }
        for (const original of strokes)
          original.stroke.points = original.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        for (const original of edges) {
          if (!original.edge.from && original.fromPoint)
            original.edge.fromPoint = { x: original.fromPoint.x + dx, y: original.fromPoint.y + dy };
          if (!original.edge.to && original.toPoint)
            original.edge.toPoint = { x: original.toPoint.x + dx, y: original.toPoint.y + dy };
        }
        updateGroupShapes(data);
      };
      const cleanup = () => {
        hit.removeEventListener("pointermove", move);
        hit.removeEventListener("pointerup", end);
        hit.removeEventListener("pointercancel", cancel);
        hit.removeEventListener("lostpointercapture", cancel);
      };
      const end = (e: PointerEvent) => {
        move(e);
        cleanup();
        if (moved) {
          updateLaneMembership(
            data,
            shapeRoots,
            new Set(strokes.map(({ stroke }) => stroke.id)),
            new Set(edges.map(({ edge }) => edge.id)),
          );
          if (!commit(data)) paint();
        }
      };
      const cancel = () => {
        cleanup();
        paint();
      };
      hit.addEventListener("pointermove", move);
      hit.addEventListener("pointerup", end);
      hit.addEventListener("pointercancel", cancel);
      hit.addEventListener("lostpointercapture", cancel);
    });
    hit.addEventListener("keydown", (event) => {
      if (!editor.isEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.stopPropagation();
        (event.shiftKey ? redo : undo)(view.state, view.dispatch);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        deleteSelection(data, undefined, link.id);
      }
    });
  };

  const bindStroke = (hit: SVGPathElement, data: CanvasData, stroke: CanvasStroke) => {
    hit.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.tool !== "select") return;
      selection.toggleStrokeGroup(data, stroke.id, event.shiftKey);
      paint();
      stage.querySelector<SVGElement>('.semlo-editor-canvas-stroke-hit[aria-pressed="true"]')?.focus();
    });
    hit.addEventListener("pointerdown", (event) => {
      if (!editor.isEditable || state.tool !== "select" || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const wasSelected = selectedStrokeIds.has(stroke.id);
      const group = data.groups?.find((entry) => entry.strokes?.includes(stroke.id));
      const shapeRoots = wasSelected ? new Set(selectedIds) : new Set(group?.members ?? []);
      const movingShapes = withLaneMembers(data, shapeRoots);
      const shapeOrigins = data.shapes
        .filter((shape) => movingShapes.has(shape.id))
        .map((shape) => ({ shape, x: shape.x, y: shape.y }));
      const strokeOrigins = (data.strokes ?? [])
        .filter(
          (item) =>
            (wasSelected ? selectedStrokeIds.has(item.id) : (group?.strokes ?? [stroke.id]).includes(item.id)) ||
            (!!item.parentLane && shapeRoots.has(item.parentLane)),
        )
        .map((item) => ({ stroke: item, points: item.points.map((point) => ({ ...point })) }));
      const edgeOrigins = data.edges
        .filter(
          (edge) =>
            (wasSelected ? selectedEdgeIds.has(edge.id) : (group?.edges ?? []).includes(edge.id)) ||
            (!!edge.parentLane && shapeRoots.has(edge.parentLane)),
        )
        .map((edge) => ({
          edge,
          fromPoint: edge.fromPoint ? { ...edge.fromPoint } : undefined,
          toPoint: edge.toPoint ? { ...edge.toPoint } : undefined,
        }));
      const start = coordinates(event);
      let moved = false;
      hit.setPointerCapture(event.pointerId);
      const move = (e: PointerEvent) => {
        const point = coordinates(e),
          dx = point.x - start.x,
          dy = point.y - start.y;
        moved ||= Math.abs(dx) + Math.abs(dy) > 3;
        if (!moved) return;
        for (const original of shapeOrigins) {
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
        for (const original of strokeOrigins)
          original.stroke.points = original.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        for (const original of edgeOrigins) {
          if (!original.edge.from && original.fromPoint)
            original.edge.fromPoint = { x: original.fromPoint.x + dx, y: original.fromPoint.y + dy };
          if (!original.edge.to && original.toPoint)
            original.edge.toPoint = { x: original.toPoint.x + dx, y: original.toPoint.y + dy };
        }
        previewEdges(data);
        previewStrokes(data);
      };
      const cleanup = () => {
        hit.removeEventListener("pointermove", move);
        hit.removeEventListener("pointerup", end);
        hit.removeEventListener("pointercancel", cancel);
        hit.removeEventListener("lostpointercapture", cancel);
      };
      const end = (e: PointerEvent) => {
        move(e);
        cleanup();
        if (!moved) return;
        if (!wasSelected) {
          selectedEdgeIds.clear();
          state.selectedEdge = null;
          selection.selectStrokeGroup(data, stroke.id);
        }
        updateLaneMembership(
          data,
          shapeRoots,
          new Set(strokeOrigins.map(({ stroke }) => stroke.id)),
          new Set(edgeOrigins.map(({ edge }) => edge.id)),
        );
        if (!commit(data)) paint();
      };
      const cancel = () => {
        cleanup();
        paint();
      };
      hit.addEventListener("pointermove", move);
      hit.addEventListener("pointerup", end);
      hit.addEventListener("pointercancel", cancel);
      hit.addEventListener("lostpointercapture", cancel);
    });
    hit.addEventListener("keydown", (event) => {
      if (!editor.isEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.stopPropagation();
        (event.shiftKey ? redo : undo)(view.state, view.dispatch);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        deleteSelection(data, undefined, undefined, stroke.id);
      } else if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!selectedStrokeIds.has(stroke.id)) {
          selectedEdgeIds.clear();
          state.selectedEdge = null;
          selection.selectStrokeGroup(data, stroke.id);
        }
        const amount = event.shiftKey ? 10 : 1;
        nudgeSelection(
          data,
          event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0,
          event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0,
        );
        if (commit(data))
          stage.querySelector<SVGElement>('.semlo-editor-canvas-stroke-hit[aria-pressed="true"]')?.focus();
      }
    });
  };

  return { bindEdge, bindStroke };
}

export type CanvasPathInteractions = ReturnType<typeof createCanvasPathInteractions>;
