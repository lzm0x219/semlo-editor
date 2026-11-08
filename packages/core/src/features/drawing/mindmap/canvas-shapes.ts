import type { DOMOutputSpec } from "@tiptap/pm/model";

import { exportCanvas } from "../canvas/export";
import { edgeGeometry, endpointBox } from "../canvas/geometry";
import { dataFrom, type CanvasData, type CanvasShape } from "../canvas/model";
import { mindmapNodePrefix, mindmapNodeReference } from "./node-reference";

function exportedNodeShapes(svg: DOMOutputSpec): CanvasShape[] {
  const shapes: CanvasShape[] = [];
  const visit = (value: DOMOutputSpec | string) => {
    if (!Array.isArray(value)) return;
    const attrs = value[1];
    if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
      const id = attrs["data-semlo-mindmap-node"];
      const x = Number(attrs["data-semlo-node-x"]);
      const y = Number(attrs["data-semlo-node-y"]);
      const width = Number(attrs["data-semlo-node-width"]);
      const height = Number(attrs["data-semlo-node-height"]);
      if (typeof id === "string" && [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0)
        shapes.push({
          id: mindmapNodeReference(id),
          shape: "rectangle",
          x: x - 16,
          y: y - 16,
          width,
          height,
          text: "",
        });
    }
    for (const child of value.slice(2)) visit(child as DOMOutputSpec | string);
  };
  visit(svg);
  return shapes;
}

export function readMindmapCanvasData(value: unknown, invalid: () => void = () => {}): CanvasData {
  if (value == null) return { shapes: [], edges: [] };
  let valid = true;
  const data = dataFrom(value, "board", () => (valid = false));
  if (
    !valid ||
    data.strokes?.length ||
    data.groups?.some((group) => group.children?.length || group.strokes?.length || group.edges?.length)
  ) {
    invalid();
    return { shapes: [], edges: [] };
  }
  return data;
}

export function readMindmapCanvasShapes(value: unknown, invalid: () => void = () => {}): CanvasShape[] {
  return readMindmapCanvasData(value, invalid).shapes;
}

export function exportMindmapCanvasShapes(svg: DOMOutputSpec, data: CanvasData): DOMOutputSpec {
  if (
    (!data.shapes.length && !data.edges.length) ||
    !Array.isArray(svg) ||
    typeof svg[1] !== "object" ||
    !svg[1] ||
    Array.isArray(svg[1])
  )
    return svg;
  const attrs = svg[1] as Record<string, string | number>;
  const shapeIds = new Set(data.shapes.map((shape) => shape.id));
  const nodeShapes = exportedNodeShapes(svg).filter((shape) => !shapeIds.has(shape.id));
  const geometryData = { ...data, shapes: [...data.shapes, ...nodeShapes] };
  let [minX, minY, width, height] = String(attrs.viewBox ?? "0 0 0 0")
    .split(/\s+/)
    .map(Number);
  let maxX = minX + width;
  let maxY = minY + height;
  for (const item of data.shapes) {
    const cx = item.x + item.width / 2 + 16;
    const cy = item.y + item.height / 2 + 16;
    const angle = ((item.rotation ?? 0) * Math.PI) / 180;
    const fontSize = item.fontSize ?? 14;
    const lines = item.text ? item.text.split("\n") : [];
    const textWidth = Math.max(0, ...lines.map((line) => Array.from(line).length * fontSize));
    const available = Math.max(1, item.width - 2 * (6 + (item.strokeWidth ?? 2)));
    const lineCount = lines.reduce(
      (sum, line) => sum + Math.max(1, Math.ceil((Array.from(line).length * fontSize) / available)),
      0,
    );
    const localHalfWidth = Math.max(item.width / 2, textWidth / 2 + (lines.length ? fontSize : 0));
    const localHalfHeight = Math.max(item.height / 2, lineCount * fontSize + (lines.length ? item.height / 2 : 0));
    const halfWidth = Math.abs(Math.cos(angle)) * localHalfWidth + Math.abs(Math.sin(angle)) * localHalfHeight;
    const halfHeight = Math.abs(Math.sin(angle)) * localHalfWidth + Math.abs(Math.cos(angle)) * localHalfHeight;
    const padding = (item.strokeWidth ?? 2) + 4;
    minX = Math.min(minX, cx - halfWidth - padding);
    minY = Math.min(minY, cy - halfHeight - padding);
    maxX = Math.max(maxX, cx + halfWidth + padding);
    maxY = Math.max(maxY, cy + halfHeight + padding);
  }
  for (const edge of data.edges) {
    const from = endpointBox(geometryData, edge.from, edge.fromPoint);
    const to = endpointBox(geometryData, edge.to, edge.toPoint);
    const geometry =
      from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
    if (!geometry) continue;
    const padding = Math.max(14, edge.text.length * 7);
    for (const point of [
      { x: geometry.x1, y: geometry.y1 },
      { x: geometry.x2, y: geometry.y2 },
      { x: geometry.midX, y: geometry.midY },
    ]) {
      minX = Math.min(minX, point.x + 16 - padding);
      minY = Math.min(minY, point.y + 16 - padding);
      maxX = Math.max(maxX, point.x + 16 + padding);
      maxY = Math.max(maxY, point.y + 16 + padding);
    }
  }
  width = maxX - minX;
  height = maxY - minY;
  const edges = data.edges.map((edge) => {
    if (!edge.from.startsWith(mindmapNodePrefix) && !edge.to.startsWith(mindmapNodePrefix)) return edge;
    const from = endpointBox(geometryData, edge.from, edge.fromPoint);
    const to = endpointBox(geometryData, edge.to, edge.toPoint);
    const geometry =
      from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
    return geometry
      ? {
          ...edge,
          from: "",
          to: "",
          fromPoint: { x: geometry.x1, y: geometry.y1 },
          toPoint: { x: geometry.x2, y: geometry.y2 },
        }
      : edge;
  });
  const canvas = exportCanvas({ ...data, edges });
  if (!Array.isArray(canvas)) return svg;
  return [
    svg[0],
    { ...attrs, viewBox: `${minX} ${minY} ${width} ${height}` },
    ...svg.slice(2),
    ["g", { transform: "translate(16 16)" }, ...canvas.slice(2)],
  ] as DOMOutputSpec;
}
