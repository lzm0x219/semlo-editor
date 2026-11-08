import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import type { CanvasPoint, Shape } from "./model";
import type { SmartTemplate } from "./smart-templates";

export type CanvasTool = "select" | Shape | SmartTemplate | "connect" | "pen" | "eraser" | "pan";

export interface CanvasViewState {
  zoom: number;
  panX: number;
  panY: number;
  penColor: string;
  penWidth: number;
  current: ProseMirrorNode;
  documentEpoch: number;
  selected: string | null;
  selectedEdge: string | null;
  tool: CanvasTool;
  connecting: string | null;
  destroyed: boolean;
  active: boolean;
  lastCanvasPoint: CanvasPoint;
}

export function createCanvasViewState(
  initial: ProseMirrorNode,
  viewport: { zoom: number; x: number; y: number },
): CanvasViewState {
  return {
    zoom: viewport.zoom,
    panX: viewport.x,
    panY: viewport.y,
    penColor: "#555555",
    penWidth: 2,
    current: initial,
    documentEpoch: 0,
    selected: null,
    selectedEdge: null,
    tool: "select",
    connecting: null,
    destroyed: false,
    active: false,
    lastCanvasPoint: { x: 400, y: 220 },
  };
}
