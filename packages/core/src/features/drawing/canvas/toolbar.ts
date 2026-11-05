import type { Editor } from "@tiptap/core";

import { polygonShapes, type Shape } from "./model";
import type { CanvasTool } from "./state";

interface CanvasToolbarState {
  tool: CanvasTool;
  connecting: string | null;
  selectedEdge: string | null;
  readonly documentEpoch: number;
  penColor: string;
  penWidth: number;
  zoom: number;
  panX: number;
  panY: number;
}

interface CanvasToolbarContext {
  doc: Document;
  toolbar: HTMLElement;
  stage: HTMLElement;
  viewport: HTMLElement;
  editor: Editor;
  selectedEdgeIds: Set<string>;
  state: CanvasToolbarState;
  setImageStatus(message: string): void;
  insertImageFile(file: File, epoch: number): void;
  setZoom(value: number): void;
  applyStageWidth(): void;
  commitViewport(): void;
  paint(): void;
}

export function renderCanvasToolbar({
  doc,
  toolbar,
  stage,
  viewport,
  editor,
  selectedEdgeIds,
  state,
  setImageStatus,
  insertImageFile,
  setZoom,
  applyStageWidth,
  commitViewport,
  paint,
}: CanvasToolbarContext) {
  const tools: Array<[typeof state.tool, string]> = [
    ["select", "选择"],
    ["pan", "平移"],
    ["rectangle", "矩形"],
    ["roundedRect", "圆角矩形"],
    ["ellipse", "圆形"],
    ["diamond", "菱形"],
    ["text", "文本"],
    ["connect", "连线"],
    ["pen", "画笔"],
    ["eraser", "橡皮"],
  ];
  const toolRail = doc.createElement("div");
  toolRail.className = "semlo-editor-canvas-tool-rail";
  toolbar.append(toolRail);
  const icons: Record<string, string> = {
    select: "M5 3l13 9-6 1-3 6z",
    pan: "M7 11V6a2 2 0 0 1 4 0v4-6a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-5-2-7-5l-2-3a2 2 0 0 1 3-2l1 1",
    rectangle: "M4 5h16v14H4z",
    roundedRect: "M7 5h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z",
    ellipse: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
    diamond: "M12 3l9 9-9 9-9-9z",
    text: "M4 5h16M12 5v14M8 19h8",
    connect: "M4 19L19 4M13 4h6v6",
    pen: "M4 20l4-1 11-11-3-3L5 16zM14 7l3 3",
    eraser: "M4 15l9-9a2 2 0 0 1 3 0l4 4-9 9H7zM10 19h10",
  };
  for (const [value, label] of tools) {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", icons[value]);
    svg.append(path);
    button.append(svg);
    button.disabled = !editor.isEditable && value !== "pan";
    button.setAttribute("aria-pressed", String(state.tool === value));
    button.addEventListener("click", () => {
      state.tool = value;
      state.connecting = null;
      if (value !== "select") {
        state.selectedEdge = null;
        selectedEdgeIds.clear();
      }
      paint();
    });
    toolRail.append(button);
  }
  const imageInput = doc.createElement("input");
  imageInput.type = "file";
  imageInput.disabled = !editor.isEditable;
  imageInput.accept = "image/png,image/jpeg,image/gif,image/webp";
  imageInput.setAttribute("aria-label", "选择画布图片");
  imageInput.hidden = true;
  let imageEpoch = state.documentEpoch;
  const imageButton = doc.createElement("button");
  imageButton.type = "button";
  imageButton.textContent = "图片";
  imageButton.setAttribute("aria-label", "插入画布图片");
  imageButton.disabled = !editor.isEditable;
  imageButton.addEventListener("click", () => {
    imageEpoch = state.documentEpoch;
    setImageStatus("");
    imageInput.click();
  });
  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    imageInput.value = "";
    if (!file) return;
    insertImageFile(file, imageEpoch);
  });
  toolRail.append(imageButton, imageInput);
  const moreShapes = doc.createElement("select");
  moreShapes.setAttribute("aria-label", "更多形状");
  moreShapes.disabled = !editor.isEditable;
  const placeholder = doc.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "更多形状";
  moreShapes.append(placeholder);
  const moreShapeOptions: Array<[Shape, string]> = [
    ...polygonShapes.map(([value, label]) => [value, label] as [Shape, string]),
    ["swimlaneVertical", "泳道垂直"],
    ["swimlaneHorizontal", "泳道水平"],
  ];
  for (const [shape, label] of moreShapeOptions) {
    const option = doc.createElement("option");
    option.value = shape;
    option.textContent = label;
    option.selected = state.tool === shape;
    moreShapes.append(option);
  }
  moreShapes.addEventListener("change", () => {
    const shape = moreShapeOptions.find(([value]) => value === moreShapes.value)?.[0];
    if (shape) {
      state.tool = shape;
      state.connecting = null;
      state.selectedEdge = null;
      selectedEdgeIds.clear();
      paint();
    }
  });
  const moreWrap = doc.createElement("div");
  moreWrap.className = "semlo-editor-canvas-more-shapes";
  const moreIcon = doc.createElement("span");
  moreIcon.textContent = "◇+";
  moreIcon.setAttribute("aria-hidden", "true");
  moreWrap.append(moreIcon, moreShapes);
  toolRail.append(moreWrap);
  if (state.tool === "pen") {
    const color = doc.createElement("input");
    color.type = "color";
    color.value = state.penColor;
    color.setAttribute("aria-label", "画笔颜色");
    color.disabled = !editor.isEditable;
    color.addEventListener("input", () => {
      state.penColor = color.value;
    });
    const width = doc.createElement("input");
    width.type = "range";
    width.min = "1";
    width.max = "10";
    width.step = "1";
    width.value = String(state.penWidth);
    width.setAttribute("aria-label", "画笔粗细");
    width.disabled = !editor.isEditable;
    const value = doc.createElement("output");
    value.textContent = String(state.penWidth);
    width.addEventListener("input", () => {
      state.penWidth = Number(width.value);
      value.textContent = width.value;
    });
    const penControls = doc.createElement("div");
    penControls.className = "semlo-editor-canvas-pen-controls";
    penControls.append(color, width, value);
    toolbar.append(penControls);
  }
  const zoomOut = doc.createElement("button");
  zoomOut.type = "button";
  zoomOut.textContent = "−";
  zoomOut.setAttribute("aria-label", "缩小画布");
  zoomOut.disabled = state.zoom <= 10;
  zoomOut.addEventListener("click", () => {
    setZoom(Math.max(10, state.zoom - 10));
  });
  const zoomValue = doc.createElement("span");
  zoomValue.className = "semlo-editor-canvas-zoom";
  zoomValue.textContent = `${state.zoom}%`;
  const zoomIn = doc.createElement("button");
  zoomIn.type = "button";
  zoomIn.textContent = "+";
  zoomIn.setAttribute("aria-label", "放大画布");
  zoomIn.disabled = state.zoom >= 200;
  zoomIn.addEventListener("click", () => {
    setZoom(Math.min(200, state.zoom + 10));
  });
  const fit = doc.createElement("button");
  fit.type = "button";
  fit.textContent = "⛶";
  fit.setAttribute("aria-label", "适应画布");
  fit.title = "适应画布";
  fit.addEventListener("click", () => {
    const stageBox = stage.getBoundingClientRect();
    const viewportBox = viewport.getBoundingClientRect();
    const elements = stage.querySelectorAll<SVGElement | HTMLElement>(
      ".semlo-editor-canvas-shape, .semlo-editor-canvas-edge, .semlo-editor-canvas-stroke, [data-edge-text-id]",
    );
    if (!elements.length) {
      state.zoom = 100;
      state.panX = 0;
      state.panY = 0;
      commitViewport();
      paint();
      return;
    }
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const element of elements) {
      const box = element.getBoundingClientRect();
      left = Math.min(left, ((box.left - stageBox.left) * 800) / stageBox.width);
      right = Math.max(right, ((box.right - stageBox.left) * 800) / stageBox.width);
      top = Math.min(top, ((box.top - stageBox.top) * 440) / stageBox.height);
      bottom = Math.max(bottom, ((box.bottom - stageBox.top) * 440) / stageBox.height);
    }
    const baseWidth = (stageBox.width * 100) / state.zoom;
    const baseHeight = (stageBox.height * 100) / state.zoom;
    const scale = Math.min(
      1,
      (viewportBox.width - 40) / Math.max(1, ((right - left) * baseWidth) / 800),
      (viewportBox.height - 40) / Math.max(1, ((bottom - top) * baseHeight) / 440),
    );
    state.zoom = Math.max(10, Math.min(100, Math.floor(scale * 100)));
    applyStageWidth();
    const box = stage.getBoundingClientRect();
    state.panX += ((viewportBox.left + viewportBox.width / 2 - box.left) * 800) / box.width - (left + right) / 2;
    state.panY += ((viewportBox.top + viewportBox.height / 2 - box.top) * 440) / box.height - (top + bottom) / 2;
    commitViewport();
    paint();
  });
  const viewControls = doc.createElement("div");
  viewControls.className = "semlo-editor-canvas-view-controls";
  viewControls.append(fit, zoomOut, zoomValue, zoomIn);
  toolbar.append(viewControls);
}
