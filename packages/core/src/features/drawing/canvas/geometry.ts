import {
  polygonPoints,
  type CanvasData,
  type CanvasEdge,
  type CanvasPoint,
  type CanvasShape,
  type CanvasStroke,
  type Marker,
} from "./model";
import { shapeGraphic } from "./shape-library";

function distanceToSegment(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint): number {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}
export function withLaneMembers(data: CanvasData, ids: Set<string>): Set<string> {
  const result = new Set(ids);
  for (const item of data.shapes) if (item.parentLane && ids.has(item.parentLane)) result.add(item.id);
  return result;
}
export function shapeContains(shape: CanvasShape, point: CanvasPoint, padding = 8): boolean {
  const cx = shape.x + shape.width / 2,
    cy = shape.y + shape.height / 2;
  const angle = ((shape.rotation ?? 0) * Math.PI) / 180;
  const dx = point.x - cx,
    dy = point.y - cy;
  const local = {
    x: dx * Math.cos(angle) + dy * Math.sin(angle) + shape.width / 2,
    y: -dx * Math.sin(angle) + dy * Math.cos(angle) + shape.height / 2,
  };
  if (local.x < -padding || local.x > shape.width + padding || local.y < -padding || local.y > shape.height + padding)
    return false;
  if (shape.shape === "ellipse" || shapeGraphic(shape.shape)?.ellipse) {
    const x = (local.x - shape.width / 2) / (shape.width / 2 + padding);
    const y = (local.y - shape.height / 2) / (shape.height / 2 + padding);
    return x * x + y * y <= 1;
  }
  if (shape.shape === "rounded" || shape.shape === "roundedRect") {
    const halfWidth = shape.width / 2,
      halfHeight = shape.height / 2;
    const radius = Math.min(halfWidth, halfHeight, shape.shape === "rounded" ? Infinity : 8);
    const x = Math.max(Math.abs(local.x - halfWidth) - (halfWidth - radius), 0);
    const y = Math.max(Math.abs(local.y - halfHeight) - (halfHeight - radius), 0);
    return x * x + y * y <= (radius + padding) ** 2;
  }
  const points = polygonPoints(shape.shape);
  if (!points) return true;
  const vertices = points.split(" ").map((part) => {
    const [x, y] = part.split(",").map(Number);
    return { x: (x * shape.width) / 100, y: (y * shape.height) / 100 };
  });
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i],
      b = vertices[j];
    if (distanceToSegment(local, a, b) <= padding) return true;
    if (a.y > local.y !== b.y > local.y && local.x < ((b.x - a.x) * (local.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
export function updateLaneMembership(
  data: CanvasData,
  moved: Set<string>,
  movedStrokes = new Set<string>(),
  movedEdges = new Set<string>(),
): void {
  const lanes = data.shapes.filter((shape) => shape.lanes).reverse();
  const assign = (item: { parentLane?: string }, center: CanvasPoint) => {
    if (item.parentLane && moved.has(item.parentLane)) return;
    const lane = lanes.find((candidate) => shapeContains(candidate, center, 0));
    if (lane) item.parentLane = lane.id;
    else delete item.parentLane;
  };
  for (const shape of data.shapes) {
    if (!moved.has(shape.id) || shape.lanes || (shape.parentLane && moved.has(shape.parentLane))) continue;
    assign(shape, { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 });
  }
  for (const stroke of data.strokes ?? []) {
    if (!movedStrokes.has(stroke.id)) continue;
    const bounds = stroke.points.reduce(
      (box, point) => ({
        left: Math.min(box.left, point.x),
        top: Math.min(box.top, point.y),
        right: Math.max(box.right, point.x),
        bottom: Math.max(box.bottom, point.y),
      }),
      { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    assign(stroke, { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 });
  }
  for (const edge of data.edges) {
    if (!movedEdges.has(edge.id) || edge.from || edge.to || !edge.fromPoint || !edge.toPoint) continue;
    assign(edge, { x: (edge.fromPoint.x + edge.toPoint.x) / 2, y: (edge.fromPoint.y + edge.toPoint.y) / 2 });
  }
}
export function strokeTouched(stroke: CanvasStroke, point: CanvasPoint): boolean {
  const radius = 8 + (stroke.width ?? 3) / 2;
  return stroke.points.some(
    (end, index) => index > 0 && distanceToSegment(point, stroke.points[index - 1], end) <= radius,
  );
}
type GeometryBox = Pick<CanvasShape, "x" | "y" | "width" | "height"> & Partial<Pick<CanvasShape, "rotation" | "shape">>;
export function endpointBox(data: CanvasData, id: string, point?: CanvasPoint): GeometryBox | null {
  return (
    data.shapes.find((shape) => shape.id === id) ?? (point ? { x: point.x, y: point.y, width: 0, height: 0 } : null)
  );
}
function boundaryDistance(box: GeometryBox, directionX: number, directionY: number): number {
  if (!box.width || !box.height) return 0;
  const angle = ((box.rotation ?? 0) * Math.PI) / 180;
  const x = directionX * Math.cos(angle) + directionY * Math.sin(angle);
  const y = -directionX * Math.sin(angle) + directionY * Math.cos(angle);
  const halfWidth = box.width / 2,
    halfHeight = box.height / 2;
  if (box.shape === "ellipse" || (box.shape && shapeGraphic(box.shape)?.ellipse))
    return 1 / Math.hypot(x / halfWidth, y / halfHeight);
  if (box.shape === "rounded" || box.shape === "roundedRect") {
    const radius = Math.min(halfWidth, halfHeight, box.shape === "rounded" ? Infinity : 8);
    const t = Math.min(x ? halfWidth / Math.abs(x) : Infinity, y ? halfHeight / Math.abs(y) : Infinity);
    if (Math.abs(x * t) <= halfWidth - radius || Math.abs(y * t) <= halfHeight - radius) return t;
    const cx = Math.sign(x) * (halfWidth - radius),
      cy = Math.sign(y) * (halfHeight - radius);
    const dot = x * cx + y * cy;
    const discriminant = dot * dot - (cx * cx + cy * cy - radius * radius);
    if (discriminant >= 0) return dot + Math.sqrt(discriminant);
    return t;
  }
  if (box.shape === "diamond") return 1 / (Math.abs(x) / halfWidth + Math.abs(y) / halfHeight);
  const points = box.shape ? polygonPoints(box.shape) : null;
  if (points) {
    const vertices = points.split(" ").map((part) => {
      const [px, py] = part.split(",").map(Number);
      return { x: (px * box.width) / 100 - halfWidth, y: (py * box.height) / 100 - halfHeight };
    });
    let distance = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i],
        b = vertices[(i + 1) % vertices.length];
      const sx = b.x - a.x,
        sy = b.y - a.y,
        denominator = x * sy - y * sx;
      if (Math.abs(denominator) < 1e-9) continue;
      const t = (a.x * sy - a.y * sx) / denominator;
      const u = (a.x * y - a.y * x) / denominator;
      if (t >= 0 && u >= 0 && u <= 1) distance = Math.min(distance, t);
    }
    if (Number.isFinite(distance)) return distance;
  }
  return Math.min(x ? halfWidth / Math.abs(x) : Infinity, y ? halfHeight / Math.abs(y) : Infinity);
}
export function shapeTransform(item: CanvasShape): string {
  return `rotate(${item.rotation ?? 0}deg)`;
}
function markerGeometry(x: number, y: number, angle: number, marker: Marker) {
  const point = (back: number, side: number) => {
    const px = x - back * Math.cos(angle) - side * Math.sin(angle);
    const py = y - back * Math.sin(angle) + side * Math.cos(angle);
    return `${px} ${py}`;
  };
  const circle = (back: number, radius: number) => {
    const k = radius * 0.55228475;
    return `M ${point(back, -radius)} C ${point(back + k, -radius)} ${point(back + radius, -k)} ${point(back + radius, 0)} C ${point(back + radius, k)} ${point(back + k, radius)} ${point(back, radius)} C ${point(back - k, radius)} ${point(back - radius, k)} ${point(back - radius, 0)} C ${point(back - radius, -k)} ${point(back - k, -radius)} ${point(back, -radius)} Z`;
  };
  const line = (fromBack: number, fromSide: number, toBack: number, toSide: number) =>
    `M ${point(fromBack, fromSide)} L ${point(toBack, toSide)}`;
  const bar = (back: number) => line(back, -5, back, 5);
  const fork = `${line(9, 0, 0, -5)} ${line(9, 0, 0, 5)}`;
  const hollow = marker.startsWith("hollow") || ["crossCircle", "crowFootCircle", "circleBar"].includes(marker);
  let path: string;
  let fill = hollow ? "#fff" : "currentColor";
  if (marker === "circle" || marker === "hollowCircle") {
    const cx = x - 5 * Math.cos(angle),
      cy = y - 5 * Math.sin(angle);
    path = `M ${cx - 5} ${cy} a 5 5 0 1 0 10 0 a 5 5 0 1 0 -10 0 Z`;
  } else if (marker === "diamond" || marker === "hollowDiamond") {
    path = `M ${point(0, 0)} L ${point(6, -4)} L ${point(12, 0)} L ${point(6, 4)} Z`;
  } else if (marker === "square" || marker === "hollowSquare") {
    path = `M ${point(0, -4)} L ${point(8, -4)} L ${point(8, 4)} L ${point(0, 4)} Z`;
  } else if (marker === "crossCircle") {
    path = `${circle(5, 4)} ${line(5, -4, 5, 4)} ${line(1, 0, 9, 0)}`;
  } else if (marker === "crowFootCircle") {
    path = `${circle(14, 4)} ${fork}`;
  } else if (marker === "circleBar") {
    path = `${circle(10, 4)} ${bar(0)}`;
  } else if (marker === "halfCircle") {
    path = `M ${point(0, -5)} C ${point(7, -5)} ${point(7, 5)} ${point(0, 5)}`;
    fill = "none";
  } else if (marker === "endBar" || marker === "middleBar" || marker === "doubleBar") {
    path = marker === "endBar" ? bar(0) : marker === "middleBar" ? bar(5) : `${bar(2)} ${bar(8)}`;
    fill = "none";
  } else if (marker === "slash") {
    path = line(2, -5, 8, 5);
    fill = "none";
  } else if (marker === "crowFoot" || marker === "crowFootBar") {
    path = marker === "crowFoot" ? fork : `${fork} ${bar(0)}`;
    fill = "none";
  } else if (marker === "oneSideUp" || marker === "oneSideDown") {
    path = line(10, marker === "oneSideUp" ? -4.35 : 4.35, 0, 0);
    fill = "none";
  } else {
    path = `M ${point(10, -4.35)} L ${point(0, 0)} L ${point(10, 4.35)}${marker === "open" ? "" : " Z"}`;
    if (marker === "open") fill = "none";
  }
  return { path, fill };
}
export function edgeGeometry(
  a: GeometryBox,
  b: GeometryBox,
  route: CanvasEdge["route"] = "orthogonal",
  startMarker: Marker = "triangle",
  endMarker: Marker = "triangle",
  bendOffset = 0,
) {
  const ax = a.x + a.width / 2,
    ay = a.y + a.height / 2,
    bx = b.x + b.width / 2,
    by = b.y + b.height / 2;
  const dx = bx - ax,
    dy = by - ay;
  if (!dx && !dy) return null;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const direction = Math.sign(horizontal ? dx : dy);
  const length = Math.hypot(dx, dy);
  const ux = route === "straight" ? dx / length : horizontal ? direction : 0;
  const uy = route === "straight" ? dy / length : horizontal ? 0 : direction;
  const fromDistance = boundaryDistance(a, ux, uy),
    toDistance = boundaryDistance(b, ux, uy);
  const x1 = ax + ux * fromDistance;
  const y1 = ay + uy * fromDistance;
  const x2 = bx - ux * toDistance;
  const y2 = by - uy * toDistance;
  const midX = (x1 + x2) / 2 + (route === "orthogonal" && horizontal ? bendOffset : 0),
    midY = (y1 + y2) / 2 + (route === "orthogonal" && !horizontal ? bendOffset : 0);
  const path =
    route === "straight"
      ? `M ${x1} ${y1} L ${x2} ${y2}`
      : route === "curved"
        ? horizontal
          ? `M ${x1} ${y1} C ${midX} ${y1} ${midX} ${y2} ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`
        : horizontal
          ? `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
          : `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
  const angle =
    route === "straight"
      ? Math.atan2(y2 - y1, x2 - x1)
      : horizontal
        ? direction > 0
          ? 0
          : Math.PI
        : direction > 0
          ? Math.PI / 2
          : -Math.PI / 2;
  const end = markerGeometry(x2, y2, angle, endMarker);
  const start = markerGeometry(x1, y1, angle + Math.PI, startMarker);
  return {
    path,
    arrow: end.path,
    startArrow: start.path,
    endFill: end.fill,
    startFill: start.fill,
    midX,
    midY,
    x1,
    y1,
    x2,
    y2,
    horizontal,
  };
}
export function textBaseline(item: CanvasShape, lineCount: number): number {
  const size = item.fontSize ?? 14;
  const lineHeight = size * 1.2;
  if (item.shape === "actor") return item.y + item.height + size;
  if (item.verticalAlign === "top") return item.y + 8 + size * 0.8;
  if (item.verticalAlign === "bottom") return item.y + item.height - 8 - size * 0.2 - (lineCount - 1) * lineHeight;
  return item.y + item.height / 2 + size * 0.35 - ((lineCount - 1) * lineHeight) / 2;
}
