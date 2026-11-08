import type { Editor } from "@tiptap/core";
import { undo, redo } from "@tiptap/pm/history";
import type { EditorView } from "@tiptap/pm/view";

import { edgeGeometry, shapeContains, strokeTouched, updateLaneMembership } from "./geometry";
import { pruneGroups, type CanvasData, type CanvasPoint } from "./model";
import { shapeGraphic } from "./shape-library";
import { createSmartTemplate, isSmartTemplate } from "./smart-templates";
import type { CanvasTool } from "./state";

interface CanvasInteractionState {
  tool: CanvasTool;
  readonly active: boolean;
  panX: number;
  panY: number;
  lastCanvasPoint: CanvasPoint;
  selected: string | null;
  selectedEdge: string | null;
  readonly penColor: string;
  readonly penWidth: number;
}

interface CanvasInteractionContext {
  doc: Document;
  stage: HTMLElement;
  background: HTMLElement;
  viewport: HTMLElement;
  editor: Editor;
  view: EditorView;
  selectedIds: Set<string>;
  selectedEdgeIds: Set<string>;
  selectedStrokeIds: Set<string>;
  state: CanvasInteractionState;
  getData(): CanvasData;
  coordinates(event: Pick<MouseEvent, "clientX" | "clientY">): CanvasPoint;
  selectOnly(id: string | null): void;
  nudgeSelection(data: CanvasData, dx: number, dy: number): void;
  deleteSelection(data: CanvasData, fallbackShape?: string, fallbackEdge?: string, fallbackStroke?: string): void;
  commit(data: CanvasData): boolean;
  commitViewport(): void;
  paint(): void;
  newId(): string;
}

export function createCanvasInteraction({
  doc,
  stage,
  background,
  viewport,
  editor,
  view,
  selectedIds,
  selectedEdgeIds,
  selectedStrokeIds,
  state,
  getData,
  coordinates,
  selectOnly,
  nudgeSelection,
  deleteSelection,
  commit,
  commitViewport,
  paint,
  newId,
}: CanvasInteractionContext) {
  const mountViewport = () => {
    viewport.addEventListener(
      "pointerdown",
      (event) => {
        if (state.tool !== "pan" || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const box = stage.getBoundingClientRect();
        const startX = event.clientX,
          startY = event.clientY;
        const originalX = state.panX,
          originalY = state.panY;
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add("is-pan-dragging");
        const move = (e: PointerEvent) => {
          state.panX = originalX + ((e.clientX - startX) * 800) / box.width;
          state.panY = originalY + ((e.clientY - startY) * 440) / box.height;
          stage.style.transform = `translate(${state.panX / 8}%, ${state.panY / 4.4}%)`;
        };
        const cleanup = () => {
          viewport.classList.remove("is-pan-dragging");
          viewport.removeEventListener("pointermove", move);
          viewport.removeEventListener("pointerup", end);
          viewport.removeEventListener("pointercancel", cancel);
          viewport.removeEventListener("lostpointercapture", cancel);
        };
        const end = (e: PointerEvent) => {
          move(e);
          cleanup();
          if (state.panX !== originalX || state.panY !== originalY) commitViewport();
        };
        const cancel = () => {
          state.panX = originalX;
          state.panY = originalY;
          stage.style.transform = `translate(${state.panX / 8}%, ${state.panY / 4.4}%)`;
          cleanup();
        };
        viewport.addEventListener("pointermove", move);
        viewport.addEventListener("pointerup", end);
        viewport.addEventListener("pointercancel", cancel);
        viewport.addEventListener("lostpointercapture", cancel);
      },
      true,
    );
    viewport.addEventListener(
      "wheel",
      (event) => {
        if (
          !state.active ||
          event.ctrlKey ||
          event.metaKey ||
          event.target instanceof doc.defaultView!.HTMLTextAreaElement
        )
          return;
        const box = stage.getBoundingClientRect();
        const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
        if (!box.width || !box.height || (!event.deltaX && !event.deltaY)) return;
        event.preventDefault();
        event.stopPropagation();
        state.panX -= (event.deltaX * factor * 800) / box.width;
        state.panY -= (event.deltaY * factor * 440) / box.height;
        stage.style.transform = `translate(${state.panX / 8}%, ${state.panY / 4.4}%)`;
        commitViewport();
      },
      { passive: false },
    );
  };
  const mountStage = () => {
    stage.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && isSmartTemplate(state.tool)) {
        event.preventDefault();
        event.stopPropagation();
        state.tool = "select";
        paint();
        stage.focus();
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        (!editor.isEditable ||
          state.tool !== "select" ||
          selectedIds.size + selectedStrokeIds.size + selectedEdgeIds.size === 0)
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && state.tool === "select") {
        event.preventDefault();
        event.stopPropagation();
        const data = getData();
        selectedIds.clear();
        selectedEdgeIds.clear();
        selectedStrokeIds.clear();
        for (const shape of data.shapes) selectedIds.add(shape.id);
        for (const edge of data.edges) selectedEdgeIds.add(edge.id);
        for (const stroke of data.strokes ?? []) selectedStrokeIds.add(stroke.id);
        state.selected = data.shapes.at(-1)?.id ?? null;
        state.selectedEdge = data.edges.at(-1)?.id ?? null;
        paint();
        stage.focus();
        return;
      }
      if (
        editor.isEditable &&
        state.tool === "select" &&
        selectedIds.size + selectedStrokeIds.size + selectedEdgeIds.size > 0
      ) {
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          deleteSelection(getData());
          stage.focus();
          return;
        }
        if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          event.preventDefault();
          const amount = event.shiftKey ? 10 : 1;
          const data = getData();
          nudgeSelection(
            data,
            event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0,
            event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0,
          );
          if (commit(data)) stage.focus();
          return;
        }
      }
      if (!editor.isEditable || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      (event.shiftKey ? redo : undo)(view.state, view.dispatch);
      stage.focus();
    });
    stage.addEventListener("pointerdown", (event) => {
      if (
        !editor.isEditable ||
        state.tool === "pan" ||
        (event.target !== stage && event.target !== background) ||
        event.button !== 0
      )
        return;
      state.lastCanvasPoint = coordinates(event);
      if (state.tool === "connect") {
        event.preventDefault();
        const start = coordinates(event);
        const svg = stage.querySelector("svg")!;
        const preview = doc.createElementNS(svg.namespaceURI, "path");
        preview.setAttribute("fill", "none");
        preview.setAttribute("stroke", "#555");
        preview.setAttribute("stroke-width", "2");
        preview.setAttribute("pointer-events", "none");
        const previewArrow = doc.createElementNS(svg.namespaceURI, "path");
        previewArrow.setAttribute("fill", "#555");
        previewArrow.setAttribute("pointer-events", "none");
        svg.append(preview, previewArrow);
        stage.setPointerCapture(event.pointerId);
        let moved = false;
        const move = (e: PointerEvent) => {
          const point = coordinates(e);
          moved ||= Math.hypot(point.x - start.x, point.y - start.y) > 3;
          const from = { ...start, width: 0, height: 0 },
            to = { ...point, width: 0, height: 0 };
          const geometry = edgeGeometry(from, to);
          preview.setAttribute("d", geometry?.path ?? "");
          previewArrow.setAttribute("d", geometry?.arrow ?? "");
        };
        const cleanup = () => {
          stage.removeEventListener("pointermove", move);
          stage.removeEventListener("pointerup", end);
          stage.removeEventListener("pointercancel", cancel);
          stage.removeEventListener("lostpointercapture", cancel);
          preview.remove();
          previewArrow.remove();
        };
        const end = (e: PointerEvent) => {
          move(e);
          cleanup();
          if (!moved) return;
          const point = coordinates(e);
          const target = doc.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".semlo-editor-canvas-shape");
          const data = getData();
          const targetId = target && stage.contains(target) ? target.dataset.shapeId : undefined;
          const id = newId();
          data.edges.push({
            id,
            from: "",
            to: targetId ?? "",
            fromPoint: start,
            ...(!targetId ? { toPoint: point } : {}),
            text: "",
            dashed: false,
            arrow: true,
          });
          updateLaneMembership(data, new Set(), new Set(), new Set([id]));
          selectOnly(null);
          selectedEdgeIds.clear();
          selectedStrokeIds.clear();
          selectedEdgeIds.add(id);
          state.selectedEdge = id;
          state.tool = "select";
          if (commit(data))
            stage.querySelector<SVGElement>('.semlo-editor-canvas-edge-hit[aria-pressed="true"]')?.focus();
          else paint();
        };
        const cancel = () => cleanup();
        stage.addEventListener("pointermove", move);
        stage.addEventListener("pointerup", end);
        stage.addEventListener("pointercancel", cancel);
        stage.addEventListener("lostpointercapture", cancel);
        return;
      }
      if (state.tool === "select") {
        event.preventDefault();
        const start = coordinates(event);
        const marquee = doc.createElement("div");
        marquee.className = "semlo-editor-canvas-marquee";
        stage.append(marquee);
        stage.setPointerCapture(event.pointerId);
        let last = start;
        let moved = false;
        const move = (e: PointerEvent) => {
          last = coordinates(e);
          moved ||= Math.hypot(last.x - start.x, last.y - start.y) > 3;
          const x = Math.min(start.x, last.x),
            y = Math.min(start.y, last.y);
          marquee.style.left = `${x / 8}%`;
          marquee.style.top = `${y / 4.4}%`;
          marquee.style.width = `${Math.abs(last.x - start.x) / 8}%`;
          marquee.style.height = `${Math.abs(last.y - start.y) / 4.4}%`;
        };
        const cleanup = () => {
          stage.removeEventListener("pointermove", move);
          stage.removeEventListener("pointerup", end);
          stage.removeEventListener("pointercancel", cancel);
          stage.removeEventListener("lostpointercapture", cancel);
          marquee.remove();
        };
        const end = (e: PointerEvent) => {
          move(e);
          cleanup();
          selectedIds.clear();
          selectedEdgeIds.clear();
          selectedStrokeIds.clear();
          state.selectedEdge = null;
          if (moved) {
            const stageBox = stage.getBoundingClientRect();
            const left = Math.min(start.x, last.x),
              right = Math.max(start.x, last.x);
            const top = Math.min(start.y, last.y),
              bottom = Math.max(start.y, last.y);
            for (const shape of stage.querySelectorAll<HTMLButtonElement>(".semlo-editor-canvas-shape")) {
              const box = shape.getBoundingClientRect();
              const x1 = ((box.left - stageBox.left) * 800) / stageBox.width,
                x2 = ((box.right - stageBox.left) * 800) / stageBox.width;
              const y1 = ((box.top - stageBox.top) * 440) / stageBox.height,
                y2 = ((box.bottom - stageBox.top) * 440) / stageBox.height;
              if (shape.dataset.shapeId && x1 <= right && x2 >= left && y1 <= bottom && y2 >= top)
                selectedIds.add(shape.dataset.shapeId);
            }
            for (const hit of stage.querySelectorAll<SVGGraphicsElement>(".semlo-editor-canvas-stroke-hit")) {
              const box = hit.getBBox();
              const id = hit.getAttribute("data-stroke-id");
              if (id && box.x >= left && box.x + box.width <= right && box.y >= top && box.y + box.height <= bottom)
                selectedStrokeIds.add(id);
            }
            for (const hit of stage.querySelectorAll<SVGGraphicsElement>(".semlo-editor-canvas-edge-hit")) {
              const box = hit.getBBox();
              const id = hit.getAttribute("data-edge-id");
              if (id && box.x >= left && box.x + box.width <= right && box.y >= top && box.y + box.height <= bottom)
                selectedEdgeIds.add(id);
            }
          }
          const selectionData = getData();
          for (const group of selectionData.groups ?? []) {
            if (
              !group.members.some((id) => selectedIds.has(id)) &&
              !(group.strokes ?? []).some((id) => selectedStrokeIds.has(id)) &&
              !(group.edges ?? []).some((id) => selectedEdgeIds.has(id))
            )
              continue;
            for (const id of group.members) selectedIds.add(id);
            for (const id of group.strokes ?? []) selectedStrokeIds.add(id);
            for (const id of group.edges ?? []) selectedEdgeIds.add(id);
          }
          state.selected = Array.from(selectedIds).at(-1) ?? null;
          state.selectedEdge = Array.from(selectedEdgeIds).at(-1) ?? null;
          paint();
          if (state.selected)
            stage.querySelector<HTMLButtonElement>('.semlo-editor-canvas-shape[aria-pressed="true"]')?.focus();
          else if (state.selectedEdge)
            stage.querySelector<SVGElement>('.semlo-editor-canvas-edge-hit[aria-pressed="true"]')?.focus();
          else if (selectedStrokeIds.size)
            stage.querySelector<SVGElement>('.semlo-editor-canvas-stroke-hit[aria-pressed="true"]')?.focus();
          else stage.focus();
        };
        const cancel = () => {
          cleanup();
        };
        stage.addEventListener("pointermove", move);
        stage.addEventListener("pointerup", end);
        stage.addEventListener("pointercancel", cancel);
        stage.addEventListener("lostpointercapture", cancel);
        return;
      }
      if (state.tool === "eraser") {
        event.preventDefault();
        stage.focus();
        const data = getData();
        const removed = new Set<string>();
        let previous = coordinates(event);
        const sweep = (next: CanvasPoint) => {
          const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
          const steps = Math.max(1, Math.ceil(distance / 5));
          for (let i = 0; i <= steps; i++) {
            const point = {
              x: previous.x + ((next.x - previous.x) * i) / steps,
              y: previous.y + ((next.y - previous.y) * i) / steps,
            };
            for (const stroke of data.strokes ?? [])
              if (!removed.has(stroke.id) && strokeTouched(stroke, point)) removed.add(stroke.id);
          }
          previous = next;
          stage.querySelectorAll<SVGPathElement>(".semlo-editor-canvas-stroke").forEach((path) => {
            if (path.dataset.strokeId && removed.has(path.dataset.strokeId)) path.style.opacity = "0.2";
          });
        };
        sweep(previous);
        stage.setPointerCapture(event.pointerId);
        const move = (e: PointerEvent) => sweep(coordinates(e));
        const cleanup = () => {
          stage.removeEventListener("pointermove", move);
          stage.removeEventListener("pointerup", end);
          stage.removeEventListener("pointercancel", cancel);
          stage.removeEventListener("lostpointercapture", cancel);
        };
        const end = (e: PointerEvent) => {
          sweep(coordinates(e));
          cleanup();
          if (removed.size) {
            data.strokes = (data.strokes ?? []).filter((stroke) => !removed.has(stroke.id));
            if (data.groups) data.groups = pruneGroups(data.groups, new Set(), removed, new Set());
            if (commit(data)) return;
          }
          paint();
        };
        const cancel = () => {
          cleanup();
          paint();
        };
        stage.addEventListener("pointermove", move);
        stage.addEventListener("pointerup", end);
        stage.addEventListener("pointercancel", cancel);
        stage.addEventListener("lostpointercapture", cancel);
        return;
      }
      if (state.tool === "pen") {
        event.preventDefault();
        stage.focus();
        const data = getData();
        const points = [coordinates(event)];
        const svg = stage.querySelector("svg")!;
        const preview = doc.createElementNS(svg.namespaceURI, "path");
        preview.setAttribute("fill", "none");
        preview.setAttribute("stroke", state.penColor);
        preview.setAttribute("stroke-width", String(state.penWidth));
        preview.setAttribute("stroke-linecap", "round");
        preview.setAttribute("stroke-linejoin", "round");
        svg.append(preview);
        stage.setPointerCapture(event.pointerId);
        const move = (e: PointerEvent) => {
          if (points.length >= 20000) return;
          points.push(coordinates(e));
          preview.setAttribute("d", points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" "));
        };
        const cleanup = () => {
          stage.removeEventListener("pointermove", move);
          stage.removeEventListener("pointerup", end);
          stage.removeEventListener("pointercancel", cancel);
          stage.removeEventListener("lostpointercapture", cancel);
        };
        const end = (e: PointerEvent) => {
          cleanup();
          if (points.length < 2) points.push(coordinates(e));
          const id = newId();
          data.strokes = [...(data.strokes ?? []), { id, points, color: state.penColor, width: state.penWidth }];
          updateLaneMembership(data, new Set(), new Set([id]));
          if (!commit(data)) preview.remove();
        };
        const cancel = () => {
          cleanup();
          preview.remove();
        };
        stage.addEventListener("pointermove", move);
        stage.addEventListener("pointerup", end);
        stage.addEventListener("pointercancel", cancel);
        stage.addEventListener("lostpointercapture", cancel);
        return;
      }
      const point = coordinates(event);
      const data = getData();
      if (isSmartTemplate(state.tool)) {
        const template = createSmartTemplate(state.tool, point, newId);
        data.shapes.push(...template.shapes);
        data.groups = [...(data.groups ?? []), template.group];
        selectOnly(null);
        for (const shape of template.shapes) selectedIds.add(shape.id);
        selectedEdgeIds.clear();
        selectedStrokeIds.clear();
        state.selected = template.shapes[0].id;
        state.selectedEdge = null;
        state.tool = "select";
        updateLaneMembership(data, selectedIds);
        if (commit(data)) stage.focus();
        else paint();
        return;
      }
      const id = newId();
      const textTool = state.tool === "text";
      const laneTool = state.tool === "swimlaneVertical" || state.tool === "swimlaneHorizontal";
      const parentLane = laneTool
        ? undefined
        : [...data.shapes].reverse().find((candidate) => candidate.lanes && shapeContains(candidate, point, 0))?.id;
      const size = shapeGraphic(state.tool)?.size;
      const width = laneTool ? (state.tool === "swimlaneVertical" ? 450 : 600) : textTool ? 80 : (size?.[0] ?? 120),
        height = laneTool ? 400 : textTool ? 36 : state.tool === "cloud" ? 80 : (size?.[1] ?? 60);
      data.shapes.push({
        id,
        shape: state.tool,
        x: laneTool ? point.x : point.x - width / 2,
        y: laneTool ? point.y : point.y - height / 2,
        width,
        height,
        text: textTool ? "文本" : "",
        ...(laneTool ? { lanes: ["Lane 1", "Lane 2", "Lane 3"] } : {}),
        ...(parentLane ? { parentLane } : {}),
      });
      selectOnly(id);
      selectedEdgeIds.clear();
      selectedStrokeIds.clear();
      state.selectedEdge = null;
      state.tool = "select";
      commit(data);
    });
  };
  return { mountViewport, mountStage };
}
