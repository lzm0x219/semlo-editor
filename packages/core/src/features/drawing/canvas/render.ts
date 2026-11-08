import type { CanvasEdgeHandles } from "./edge-handles";
import { edgeGeometry, endpointBox, shapeTransform } from "./geometry";
import type { CanvasData } from "./model";
import { polygonPoints, specialShapePath } from "./model";
import type { CanvasPathInteractions } from "./path-interactions";
import type { CanvasShapeInteractions } from "./shape-interactions";
import { graphicPaths, shapeGraphic } from "./shape-library";
import type { CanvasShapeTextEditing } from "./shape-text-editing";
import type { CanvasShapeTransforms } from "./shape-transforms";

interface CanvasRenderContext {
  doc: Document;
  stage: HTMLElement;
  svg: SVGSVGElement;
  data: CanvasData;
  selectedIds: ReadonlySet<string>;
  selectedEdgeIds: ReadonlySet<string>;
  selectedStrokeIds: ReadonlySet<string>;
  paths: CanvasPathInteractions;
  shapes: CanvasShapeInteractions;
  textEditing: CanvasShapeTextEditing;
  transforms: CanvasShapeTransforms;
  edgeHandles: CanvasEdgeHandles;
}

export function renderCanvasObjects({
  doc,
  stage,
  svg,
  data,
  selectedIds,
  selectedEdgeIds,
  selectedStrokeIds,
  paths,
  shapes,
  textEditing,
  transforms,
  edgeHandles,
}: CanvasRenderContext) {
  for (const link of data.edges) {
    const a = endpointBox(data, link.from, link.fromPoint);
    const b = endpointBox(data, link.to, link.toPoint);
    const geometry = a && b ? edgeGeometry(a, b, link.route, link.startMarker, link.endMarker, link.bendOffset) : null;
    if (!geometry) continue;
    const line = doc.createElementNS(svg.namespaceURI, "path");
    line.classList.add("semlo-editor-canvas-edge");
    line.setAttribute("data-edge-id", link.id);
    line.setAttribute("d", geometry.path);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", selectedEdgeIds.has(link.id) ? "#7799d0" : (link.color ?? "#555"));
    line.setAttribute("stroke-width", String(link.width ?? 2));
    if (link.dashed) line.setAttribute("stroke-dasharray", "5 4");
    svg.append(line);
    const hit = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", line.getAttribute("d")!);
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "18");
    hit.classList.add("semlo-editor-canvas-edge-hit");
    hit.setAttribute("data-edge-id", link.id);
    hit.setAttribute("role", "button");
    hit.setAttribute("tabindex", "0");
    hit.setAttribute("aria-label", `连接线${link.text ? `：${link.text}` : ""}`);
    hit.setAttribute("aria-pressed", String(selectedEdgeIds.has(link.id)));
    paths.bindEdge(hit, data, link);
    svg.append(hit);
    if (link.arrow) {
      const arrow = doc.createElementNS(svg.namespaceURI, "path");
      arrow.setAttribute("d", geometry.arrow);
      arrow.setAttribute("data-edge-arrow-id", link.id);
      arrow.setAttribute("fill", geometry.endFill === "currentColor" ? (link.color ?? "#555") : geometry.endFill);
      arrow.setAttribute("stroke", link.color ?? "#555");
      svg.append(arrow);
    }
    if (link.startArrow) {
      const arrow = doc.createElementNS(svg.namespaceURI, "path");
      arrow.setAttribute("d", geometry.startArrow);
      arrow.setAttribute("data-edge-start-arrow-id", link.id);
      arrow.setAttribute("fill", geometry.startFill === "currentColor" ? (link.color ?? "#555") : geometry.startFill);
      arrow.setAttribute("stroke", link.color ?? "#555");
      svg.append(arrow);
    }
    if (link.text) {
      const text = doc.createElementNS(svg.namespaceURI, "text");
      text.setAttribute("data-edge-text-id", link.id);
      text.setAttribute("x", String(geometry.midX));
      text.setAttribute("y", String(geometry.midY - 5));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "14");
      text.textContent = link.text;
      svg.append(text);
    }
  }
  for (const stroke of data.strokes ?? []) {
    const path = doc.createElementNS(svg.namespaceURI, "path");
    path.classList.add("semlo-editor-canvas-stroke");
    path.setAttribute("data-stroke-id", stroke.id);
    path.setAttribute("d", stroke.points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" "));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke.color ?? "#555555");
    path.setAttribute("stroke-width", String(stroke.width ?? 3));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    const hit = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.classList.add("semlo-editor-canvas-stroke-hit");
    hit.setAttribute("data-stroke-id", stroke.id);
    hit.setAttribute("d", path.getAttribute("d")!);
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", String(Math.max(16, (stroke.width ?? 3) + 12)));
    hit.setAttribute("stroke-linecap", "round");
    hit.setAttribute("role", "button");
    hit.setAttribute("tabindex", "0");
    hit.setAttribute("aria-label", "笔迹");
    hit.setAttribute("aria-pressed", String(selectedStrokeIds.has(stroke.id)));
    paths.bindStroke(hit, data, stroke);
    if (selectedStrokeIds.has(stroke.id)) {
      const xs = stroke.points.map((point) => point.x),
        ys = stroke.points.map((point) => point.y);
      const box = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
      box.setAttribute("x", String(Math.min(...xs) - 4));
      box.setAttribute("y", String(Math.min(...ys) - 4));
      box.setAttribute("width", String(Math.max(...xs) - Math.min(...xs) + 8));
      box.setAttribute("height", String(Math.max(...ys) - Math.min(...ys) + 8));
      box.setAttribute("fill", "none");
      box.setAttribute("stroke", "#7799d0");
      box.setAttribute("stroke-width", "1");
      box.setAttribute("pointer-events", "none");
      box.classList.add("semlo-editor-canvas-stroke-selection");
      box.setAttribute("data-stroke-id", stroke.id);
      svg.append(box);
    }
    svg.append(hit);
  }
  stage.append(svg);
  for (const item of data.shapes) {
    const graphic = shapeGraphic(item.shape);
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `semlo-editor-canvas-shape semlo-editor-canvas-shape-${item.shape}`;
    button.dataset.shapeId = item.id;
    button.style.left = `${item.x / 8}%`;
    button.style.top = `${item.y / 4.4}%`;
    button.style.width = `${item.width / 8}%`;
    button.style.height = `${item.height / 4.4}%`;
    button.style.transform = shapeTransform(item);
    if (
      !graphic &&
      item.shape !== "text" &&
      item.shape !== "actor" &&
      item.shape !== "image" &&
      !polygonPoints(item.shape)
    ) {
      button.style.borderWidth = `${(item.strokeWidth ?? 2) / 8}cqw`;
      button.style.borderStyle = item.strokeDashed ? "dashed" : "solid";
    }
    if (
      item.fill !== undefined &&
      !graphic &&
      item.shape !== "text" &&
      item.shape !== "actor" &&
      item.shape !== "image" &&
      !polygonPoints(item.shape)
    )
      button.style.backgroundColor = item.fill;
    if (item.stroke !== undefined) {
      button.style.borderColor = item.stroke;
      if (item.shape === "text" || item.shape === "actor") button.style.color = item.stroke;
    }
    const points = polygonPoints(item.shape);
    if (graphic) {
      button.classList.add("semlo-editor-canvas-shape-polygon");
      const graphicSvg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      graphicSvg.classList.add("semlo-editor-canvas-polygon");
      graphicSvg.setAttribute("viewBox", "0 0 100 100");
      graphicSvg.setAttribute("preserveAspectRatio", "none");
      graphicSvg.setAttribute("aria-hidden", "true");
      for (const attrs of graphicPaths(item.shape, {
        fill: item.fill === "transparent" ? "none" : (item.fill ?? graphic.defaultFill ?? "#ffffff"),
        stroke: item.stroke ?? "#555555",
        width: item.strokeWidth ?? 2,
        dashed: item.strokeDashed,
      })) {
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        for (const [name, value] of Object.entries(attrs)) path.setAttribute(name, String(value));
        path.style.strokeWidth = `${(item.strokeWidth ?? 2) / 8}cqw`;
        graphicSvg.append(path);
      }
      button.append(graphicSvg);
    } else if (points) {
      button.classList.add("semlo-editor-canvas-shape-polygon");
      const polygonSvg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      polygonSvg.classList.add("semlo-editor-canvas-polygon");
      polygonSvg.setAttribute("viewBox", "0 0 100 100");
      polygonSvg.setAttribute("preserveAspectRatio", "none");
      polygonSvg.setAttribute("aria-hidden", "true");
      const path = specialShapePath(item.shape);
      const polygon = doc.createElementNS("http://www.w3.org/2000/svg", path ? "path" : "polygon");
      if (path) polygon.setAttribute("d", path);
      else polygon.setAttribute("points", points);
      polygon.setAttribute(
        "fill",
        item.shape === "leftBracket" || item.shape === "rightBracket" || item.fill === "transparent"
          ? "none"
          : (item.fill ?? "#ffffff"),
      );
      polygon.setAttribute("stroke", item.stroke ?? "#555555");
      polygon.style.strokeWidth = `${(item.strokeWidth ?? 2) / 8}cqw`;
      if (item.strokeDashed) polygon.style.strokeDasharray = "5 4";
      polygon.setAttribute("vector-effect", "non-scaling-stroke");
      polygon.setAttribute("stroke-linejoin", "round");
      polygonSvg.append(polygon);
      button.append(polygonSvg);
    }
    button.setAttribute(
      "aria-label",
      item.lanes
        ? `泳道：${item.lanes.join("、")}`
        : item.shape === "image"
          ? `图片：${item.text || "图片"}`
          : `图形：${item.text || "空白"}`,
    );
    button.setAttribute("aria-pressed", String(selectedIds.has(item.id)));
    if (item.shape === "image") {
      const image = doc.createElement("img");
      image.src = item.imageSrc!;
      image.alt = "";
      image.draggable = false;
      image.className = "semlo-editor-canvas-image";
      button.append(image);
    }
    if (item.shape === "actor") {
      const actor = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      actor.setAttribute("viewBox", "0 0 50 72");
      actor.classList.add("semlo-editor-canvas-actor-icon");
      actor.setAttribute("aria-hidden", "true");
      const head = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
      head.setAttribute("cx", "25");
      head.setAttribute("cy", "10");
      head.setAttribute("r", "8");
      head.setAttribute("fill", "none");
      head.setAttribute("stroke", "currentColor");
      head.style.strokeWidth = `${(item.strokeWidth ?? 2) / 8}cqw`;
      head.setAttribute("vector-effect", "non-scaling-stroke");
      if (item.strokeDashed) head.style.strokeDasharray = "5 4";
      const body = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      body.setAttribute("d", "M25 18 L25 44 M6 30 L44 30 M25 44 L7 68 M25 44 L43 68");
      body.setAttribute("fill", "none");
      body.setAttribute("stroke", "currentColor");
      body.style.strokeWidth = `${(item.strokeWidth ?? 2) / 8}cqw`;
      body.setAttribute("vector-effect", "non-scaling-stroke");
      if (item.strokeDashed) body.style.strokeDasharray = "5 4";
      actor.append(head, body);
      button.append(actor);
    }
    const content = doc.createElement("span");
    content.textContent = item.shape === "image" ? "" : item.text;
    content.style.fontSize = `${(item.fontSize ?? 14) / 8}cqw`;
    content.style.fontWeight = item.bold ? "bold" : "normal";
    content.style.fontStyle = item.italic ? "italic" : "normal";
    content.style.textDecoration =
      [item.underline && "underline", item.strike && "line-through"].filter(Boolean).join(" ") || "none";
    content.style.color = item.textColor ?? (item.shape === "text" ? item.stroke : undefined) ?? "#222222";
    button.style.textAlign = item.textAlign ?? "center";
    if (item.shape !== "actor" && item.verticalAlign && item.verticalAlign !== "middle") {
      content.style.position = "absolute";
      content.style.left = "1cqw";
      content.style.width = "calc(100% - 2cqw)";
      content.style[item.verticalAlign] = "1cqw";
    }
    button.append(content);
    const laneTitleEditors: Array<() => void> = [];
    if (item.lanes) {
      for (const side of ["top", "right", "bottom", "left"]) {
        const hit = doc.createElement("div");
        hit.className = `semlo-editor-canvas-lane-border is-${side}`;
        hit.setAttribute("aria-hidden", "true");
        button.append(hit);
      }
      const lanes = doc.createElement("div");
      const vertical = item.shape === "swimlaneVertical";
      lanes.className = `semlo-editor-canvas-lanes ${vertical ? "is-vertical" : "is-horizontal"}`;
      lanes.style.color = item.stroke ?? "#555555";
      lanes.style.setProperty("--semlo-editor-lane-stroke", item.stroke ?? "#555555");
      lanes.style.setProperty("--semlo-editor-lane-width", `${(item.strokeWidth ?? 2) / 8}cqw`);
      lanes.style.setProperty("--semlo-editor-lane-line", item.strokeDashed ? "dashed" : "solid");
      lanes.style.gridTemplateColumns = vertical ? `repeat(${item.lanes.length}, 1fr)` : "1fr";
      lanes.style.gridTemplateRows = vertical ? "1fr" : `repeat(${item.lanes.length}, 1fr)`;
      item.lanes.forEach((label, index) => {
        const lane = doc.createElement("div");
        lane.className = "semlo-editor-canvas-lane";
        const title = doc.createElement("span");
        title.className = "semlo-editor-canvas-lane-title";
        title.textContent = label;
        title.style.color = item.textColor ?? "#222222";
        title.style.fontSize = `${(item.fontSize ?? 14) / 8}cqw`;
        title.style.fontWeight = item.bold === false ? "normal" : "bold";
        title.style.fontStyle = item.italic ? "italic" : "normal";
        title.style.textDecoration =
          [item.underline && "underline", item.strike && "line-through"].filter(Boolean).join(" ") || "none";
        const editTitle = textEditing.laneTitleEditor(button, item, title, label, index);
        laneTitleEditors.push(editTitle);
        title.addEventListener("dblclick", (event) => {
          event.preventDefault();
          event.stopPropagation();
          editTitle();
        });
        lane.append(title);
        lanes.append(lane);
      });
      button.append(lanes);
    }
    transforms.mount(button, data, item);
    textEditing.bindShape(button, data, item, laneTitleEditors);
    shapes.bind(button, data, item, svg);
    stage.append(button);
  }
  edgeHandles.mount(data, svg);
}
