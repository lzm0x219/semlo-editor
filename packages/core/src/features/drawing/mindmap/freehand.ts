import type { DOMOutputSpec } from "@tiptap/pm/model";

export interface MindmapPoint {
  x: number;
  y: number;
}
export interface MindmapStroke {
  points: MindmapPoint[];
  color: string;
  width: number;
  kind?: "marker";
}
export const maxMindmapStrokePoints = 4096;
export function readMindmapStrokes(value: unknown, invalid: () => void = () => {}): MindmapStroke[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 5000) {
    invalid();
    return [];
  }
  let total = 0;
  const strokes: MindmapStroke[] = [];
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !["points", "color", "width", "kind"].includes(key)) ||
      (entry.kind !== undefined && entry.kind !== "marker") ||
      !Array.isArray(entry.points) ||
      !entry.points.length ||
      entry.points.length > maxMindmapStrokePoints ||
      typeof entry.color !== "string" ||
      !/^#[\da-f]{6}$/i.test(entry.color) ||
      typeof entry.width !== "number" ||
      !Number.isFinite(entry.width) ||
      entry.width < 1 ||
      entry.width > 20
    ) {
      invalid();
      return [];
    }
    total += entry.points.length;
    if (
      total > 100000 ||
      entry.points.some((point: unknown) => {
        if (!point || typeof point !== "object" || Array.isArray(point)) return true;
        const p = point as Record<string, unknown>;
        return (
          Object.keys(p).some((key) => !["x", "y"].includes(key)) ||
          typeof p.x !== "number" ||
          !Number.isFinite(p.x) ||
          Math.abs(p.x) > 100000 ||
          typeof p.y !== "number" ||
          !Number.isFinite(p.y) ||
          Math.abs(p.y) > 100000
        );
      })
    ) {
      invalid();
      return [];
    }
    strokes.push({
      color: entry.color,
      width: entry.width,
      ...(entry.kind === "marker" ? { kind: "marker" as const } : {}),
      points: entry.points.map((point: MindmapPoint) => ({ x: point.x, y: point.y })),
    });
  }
  return strokes;
}
export function strokePath(stroke: MindmapStroke, offset = 0) {
  const points = stroke.points;
  const first = points[0];
  return `M ${first.x + offset} ${first.y + offset} ${
    points.length === 1
      ? `L ${first.x + offset} ${first.y + offset}`
      : points
          .slice(1)
          .map((point) => `L ${point.x + offset} ${point.y + offset}`)
          .join(" ")
  }`;
}
function distance(point: MindmapPoint, a: MindmapPoint, b: MindmapPoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
function intersects(a: MindmapPoint, b: MindmapPoint, c: MindmapPoint, d: MindmapPoint) {
  const cross = (p: MindmapPoint, q: MindmapPoint, r: MindmapPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  if (abC === 0 && abD === 0 && cdA === 0 && cdB === 0)
    return (
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
    );
  return abC * abD <= 0 && cdA * cdB <= 0;
}
export function strokeHit(stroke: MindmapStroke, from: MindmapPoint, to: MindmapPoint, radius = 8) {
  const points = stroke.points;
  for (let index = 0; index < points.length; index++) {
    const a = points[index],
      b = points[Math.min(index + 1, points.length - 1)];
    if (
      intersects(from, to, a, b) ||
      Math.min(distance(from, a, b), distance(to, a, b), distance(a, from, to), distance(b, from, to)) <=
        radius + stroke.width / 2
    )
      return true;
  }
  return false;
}
export function exportMindmapStrokes(svg: DOMOutputSpec, strokes: MindmapStroke[]): DOMOutputSpec {
  if (!strokes.length || !Array.isArray(svg) || typeof svg[1] !== "object" || !svg[1] || Array.isArray(svg[1]))
    return svg;
  const attrs = svg[1] as Record<string, string | number>;
  const viewBox = String(attrs.viewBox ?? "0 0 0 0")
    .split(/\s+/)
    .map(Number);
  let [minX, minY, width, height] = viewBox;
  let maxX = minX + width,
    maxY = minY + height;
  const paths: DOMOutputSpec[] = [];
  for (const stroke of strokes) {
    const margin = stroke.width / 2 + 4;
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x + 16 - margin);
      minY = Math.min(minY, point.y + 16 - margin);
      maxX = Math.max(maxX, point.x + 16 + margin);
      maxY = Math.max(maxY, point.y + 16 + margin);
    }
    paths.push([
      "path",
      {
        d: strokePath(stroke, 16),
        fill: "none",
        stroke: stroke.color,
        "stroke-width": stroke.width,
        "stroke-linecap": stroke.kind === "marker" ? "square" : "round",
        "stroke-linejoin": "round",
        ...(stroke.kind === "marker" ? { "stroke-opacity": 0.5 } : {}),
      },
    ]);
  }
  width = maxX - minX;
  height = maxY - minY;
  return [
    svg[0],
    { ...attrs, viewBox: `${minX} ${minY} ${width} ${height}` },
    ...paths,
    ...svg.slice(2),
  ] as DOMOutputSpec;
}
