import type { Editor } from "@tiptap/core";
import { undo, redo } from "@tiptap/pm/history";
import type { EditorView } from "@tiptap/pm/view";

import { edge, type CanvasData, type CanvasShape } from "./model";
import type { CanvasSelection } from "./selection";
import type { CanvasShapeDrag } from "./shape-drag";
import type { CanvasViewState } from "./state";

interface CanvasShapeInteractionOptions {
  dom: HTMLElement;
  stage: HTMLElement;
  editor: Editor;
  view: EditorView;
  state: Pick<CanvasViewState, "tool" | "connecting" | "selected">;
  selection: Pick<
    CanvasSelection,
    "selectedIds" | "selectedEdgeIds" | "selectedStrokeIds" | "selectOnly" | "selectShapeGroup" | "toggleShapeGroup"
  >;
  drag: CanvasShapeDrag;
  nudgeSelection(data: CanvasData, dx: number, dy: number): void;
  deleteSelection(data: CanvasData, fallbackShape?: string, fallbackEdge?: string, fallbackStroke?: string): void;
  commit(data: CanvasData): boolean;
  paint(): void;
  refreshControls(): void;
  newId(): string;
}

export function createCanvasShapeInteractions({
  dom,
  stage,
  editor,
  view,
  state,
  selection,
  drag,
  nudgeSelection,
  deleteSelection,
  commit,
  paint,
  refreshControls,
  newId,
}: CanvasShapeInteractionOptions) {
  const { selectedIds, selectedEdgeIds, selectedStrokeIds, selectOnly, selectShapeGroup } = selection;
  const bind = (button: HTMLButtonElement, data: CanvasData, item: CanvasShape, svg: SVGSVGElement) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.tool === "connect" && editor.isEditable) {
        if (state.connecting && state.connecting !== item.id) {
          data.edges.push(edge(newId(), state.connecting, item.id));
          state.connecting = null;
          state.tool = "select";
          selectOnly(item.id);
          commit(data);
        } else {
          state.connecting = item.id;
          selectOnly(item.id);
          paint();
        }
      } else {
        selection.toggleShapeGroup(data, item.id, event.shiftKey);
        button.focus();
        dom.classList.toggle("is-multi-selected", selectedIds.size + selectedEdgeIds.size + selectedStrokeIds.size > 1);
        svg
          .querySelectorAll(".semlo-editor-canvas-stroke-hit")
          .forEach((stroke) =>
            stroke.setAttribute(
              "aria-pressed",
              String(selectedStrokeIds.has(stroke.getAttribute("data-stroke-id") ?? "")),
            ),
          );
        svg
          .querySelectorAll(".semlo-editor-canvas-edge-hit")
          .forEach((edge) =>
            edge.setAttribute("aria-pressed", String(selectedEdgeIds.has(edge.getAttribute("data-edge-id") ?? ""))),
          );
        svg.querySelectorAll(".semlo-editor-canvas-edge").forEach((line) => {
          const id = line.getAttribute("data-edge-id") ?? "";
          const edge = data.edges.find((entry) => entry.id === id);
          line.setAttribute("stroke", selectedEdgeIds.has(id) ? "#7799d0" : (edge?.color ?? "#555"));
        });
        svg.querySelectorAll(".semlo-editor-canvas-stroke-selection").forEach((box) => {
          if (!selectedStrokeIds.has(box.getAttribute("data-stroke-id") ?? "")) box.remove();
        });
        stage
          .querySelectorAll<HTMLButtonElement>(".semlo-editor-canvas-shape")
          .forEach((shape) =>
            shape.setAttribute(
              "aria-pressed",
              String(!!shape.dataset.shapeId && selectedIds.has(shape.dataset.shapeId)),
            ),
          );
        refreshControls();
      }
    });
    button.addEventListener("keydown", (event) => {
      if (!editor.isEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        (event.shiftKey ? redo : undo)(view.state, view.dispatch);
      } else if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        if (!selectedIds.has(item.id)) {
          selectShapeGroup(data, item.id);
        }
        const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
        const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
        nudgeSelection(data, dx, dy);
        state.selected = item.id;
        if (commit(data))
          stage.querySelector<HTMLButtonElement>('.semlo-editor-canvas-shape[aria-pressed="true"]')?.focus();
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelection(data, item.id);
      }
    });
    drag.bind(button, data, item, svg);
  };
  return { bind };
}

export type CanvasShapeInteractions = ReturnType<typeof createCanvasShapeInteractions>;
