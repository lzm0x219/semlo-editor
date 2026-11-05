type Kind = "board" | "flowchart" | "uml";
type PolygonShape =
  | "triangle"
  | "parallelogram"
  | "trapezoid"
  | "pentagon"
  | "star"
  | "leftArrow"
  | "rightArrow"
  | "doubleArrow"
  | "cross"
  | "callout"
  | "callout2"
  | "fiveArrow"
  | "flowArrow"
  | "cloud"
  | "leftBracket"
  | "rightBracket";
export type Shape =
  | "rectangle"
  | "rounded"
  | "roundedRect"
  | "ellipse"
  | "diamond"
  | "actor"
  | "text"
  | "image"
  | "swimlaneVertical"
  | "swimlaneHorizontal"
  | PolygonShape;
export type Marker =
  | "triangle"
  | "open"
  | "hollowTriangle"
  | "diamond"
  | "hollowDiamond"
  | "circle"
  | "hollowCircle"
  | "square"
  | "hollowSquare";
export const markerOptions: Array<[Marker, string]> = [
  ["triangle", "实心箭头"],
  ["open", "线箭头"],
  ["hollowTriangle", "空心箭头"],
  ["diamond", "实心菱形"],
  ["hollowDiamond", "空心菱形"],
  ["circle", "实心圆"],
  ["hollowCircle", "空心圆"],
  ["square", "实心方块"],
  ["hollowSquare", "空心方块"],
];
export interface CanvasShape {
  id: string;
  shape: Shape;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDashed?: boolean;
  rotation?: number;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  textColor?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  verticalAlign?: "top" | "middle" | "bottom";
  lanes?: string[];
  parentLane?: string;
  imageSrc?: string;
}
export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  text: string;
  dashed: boolean;
  arrow: boolean;
  startArrow?: boolean;
  startMarker?: Marker;
  endMarker?: Marker;
  bendOffset?: number;
  route?: "straight" | "curved" | "orthogonal";
  color?: string;
  width?: number;
  fromPoint?: CanvasPoint;
  toPoint?: CanvasPoint;
  parentLane?: string;
}
export interface CanvasPoint {
  x: number;
  y: number;
}
export interface CanvasStroke {
  id: string;
  points: CanvasPoint[];
  color?: string;
  width?: number;
  parentLane?: string;
}
export interface CanvasGroup {
  id: string;
  members: string[];
  strokes?: string[];
  edges?: string[];
  children?: CanvasGroup[];
}
export interface CanvasData {
  shapes: CanvasShape[];
  edges: CanvasEdge[];
  strokes?: CanvasStroke[];
  groups?: CanvasGroup[];
}
export const polygonShapes: Array<[PolygonShape, string, string]> = [
  ["triangle", "三角形", "50,0 100,100 0,100"],
  ["parallelogram", "平行四边形", "20,0 100,0 80,100 0,100"],
  ["trapezoid", "梯形", "20,0 80,0 100,100 0,100"],
  ["pentagon", "五边形", "50,0 100,38 81,100 19,100 0,38"],
  ["star", "五角星", "50,0 61,35 98,35 68,57 79,95 50,72 21,95 32,57 2,35 39,35"],
  ["leftArrow", "左箭头", "0,50 38,0 38,25 100,25 100,75 38,75 38,100"],
  ["rightArrow", "右箭头", "100,50 62,0 62,25 0,25 0,75 62,75 62,100"],
  ["doubleArrow", "双向箭头", "0,50 28,0 28,25 72,25 72,0 100,50 72,100 72,75 28,75 28,100"],
  ["cross", "十字", "32,0 68,0 68,32 100,32 100,68 68,68 68,100 32,100 32,68 0,68 0,32 32,32"],
  ["callout", "标注", "0,0 100,0 100,75 60,75 50,100 42,75 0,75"],
  ["callout2", "标注 2", "5,0 95,0 100,8 100,70 95,78 60,78 50,100 42,78 5,78 0,70 0,8"],
  ["fiveArrow", "五边箭头", "0,0 70,0 100,50 70,100 0,100"],
  ["flowArrow", "流程箭头", "0,0 70,0 100,50 70,100 0,100 30,50"],
  [
    "cloud",
    "云",
    "17,34 12,24 18,14 30,14 38,20 44,8 58,3 72,5 82,14 84,25 94,23 99,32 92,45 99,54 98,67 89,75 79,73 73,89 60,96 46,92 39,83 26,88 15,83 12,73 17,68 5,64 2,53 6,42",
  ],
  ["leftBracket", "左括号", "0,0 100,0 100,100 0,100"],
  ["rightBracket", "右括号", "0,0 100,0 100,100 0,100"],
];
const cloudPath =
  "M 17 34 C 8 19 23 9 38 20 C 39 2 78 -3 84 25 C 97 17 105 33 92 45 C 108 54 97 82 79 73 C 74 98 48 102 39 83 C 23 95 6 82 17 68 C -2 67 -2 37 17 34 Z";
const bracketPaths = {
  leftBracket: "M 98 2 C 94 2 94 8 94 16 L 94 38 C 94 46 92 50 88 50 C 92 50 94 54 94 62 L 94 84 C 94 92 94 98 98 98",
  rightBracket: "M 2 2 C 6 2 6 8 6 16 L 6 38 C 6 46 8 50 12 50 C 8 50 6 54 6 62 L 6 84 C 6 92 6 98 2 98",
} as const;
export const specialShapePath = (value: Shape) =>
  value === "cloud" ? cloudPath : value === "leftBracket" || value === "rightBracket" ? bracketPaths[value] : null;
const shapeTypes: Shape[] = [
  "rectangle",
  "rounded",
  "roundedRect",
  "ellipse",
  "diamond",
  "actor",
  "text",
  "image",
  "swimlaneVertical",
  "swimlaneHorizontal",
  ...polygonShapes.map(([shape]) => shape),
];
export const polygonPoints = (shape: Shape) =>
  shape === "diamond" ? "50,0 100,50 50,100 0,50" : polygonShapes.find(([value]) => value === shape)?.[2];
export const kindFrom = (value: unknown): Kind => (value === "flowchart" || value === "uml" ? value : "board");
const shape = (id: string, type: Shape, x: number, y: number, text: string): CanvasShape => ({
  id,
  shape: type,
  x,
  y,
  width: 120,
  height: 60,
  text,
});
export const edge = (id: string, from: string, to: string, text = "", dashed = false, arrow = true): CanvasEdge => ({
  id,
  from,
  to,
  text,
  dashed,
  arrow,
});
function initialData(kind: Kind): CanvasData {
  if (kind === "flowchart")
    return {
      shapes: [
        shape("a", "rounded", 120, 40, "开始"),
        shape("b", "rectangle", 300, 40, "过程"),
        shape("c", "diamond", 280, 160, "过程"),
        shape("d", "rectangle", 520, 160, "过程"),
        shape("e", "rounded", 300, 320, "结束"),
      ],
      edges: [
        edge("ab", "a", "b"),
        edge("bc", "b", "c"),
        edge("cd", "c", "d", "否"),
        edge("ce", "c", "e", "是"),
        edge("de", "d", "e"),
      ],
    };
  if (kind === "uml")
    return {
      shapes: [
        shape("a", "actor", 80, 45, "参与者"),
        shape("b", "ellipse", 250, 45, "用例"),
        shape("c", "ellipse", 520, 45, "用例"),
        shape("d", "ellipse", 250, 170, "用例"),
        shape("e", "ellipse", 520, 170, "用例"),
        shape("f", "ellipse", 450, 310, "用例"),
        shape("g", "ellipse", 600, 310, "用例"),
      ],
      edges: [
        edge("ab", "a", "b", "", false, false),
        edge("bc", "b", "c", "<<Include>>", true),
        edge("de", "d", "e", "<<Extend>>", true),
        edge("fe", "f", "e"),
        edge("ge", "g", "e"),
      ],
    };
  return { shapes: [], edges: [] };
}
/** Freeze the current template at insertion so saved documents do not follow later defaults. */
export function createCanvasContent(kind: Kind) {
  const data = initialData(kind);
  if (kind === "uml") {
    // Yuque's relationship labels are independent text objects, not part of the line.
    const include = data.edges.find((entry) => entry.id === "bc")!;
    const extend = data.edges.find((entry) => entry.id === "de")!;
    include.text = "";
    extend.text = "";
    data.shapes.push(
      { id: "include-label", shape: "text", x: 380, y: 16, width: 120, height: 30, text: "<<Include>>" },
      { id: "extend-label", shape: "text", x: 380, y: 141, width: 120, height: 30, text: "<<Extend>>" },
    );
  }
  return { type: "semloEditorCanvas", attrs: { kind, data } };
}
function readPoint(value: unknown): CanvasPoint | null {
  if (!value || typeof value !== "object") return null;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
    ? { x: point.x, y: point.y }
    : null;
}
export const maxCanvasImageBytes = 4 * 1024 * 1024;
export const validCanvasImage = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > Math.ceil(maxCanvasImageBytes / 3) * 4 + 32) return false;
  const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  return !!match && match[1].length % 4 === 0;
};
export function dataFrom(value: unknown, kind: Kind, onInvalid: () => void = () => {}): CanvasData {
  const invalid = () => {
    onInvalid();
    return initialData(kind);
  };
  if (value == null) return initialData(kind);
  if (typeof value !== "object") return invalid();
  const data = value as Record<string, unknown>;
  const known = (object: Record<string, unknown>, keys: string[]) =>
    Object.keys(object).every((key) => keys.includes(key));
  if (!known(data, ["shapes", "edges", "strokes", "groups"])) return invalid();
  if (
    !Array.isArray(data.shapes) ||
    !Array.isArray(data.edges) ||
    data.shapes.length > 5000 ||
    data.edges.length > 10000
  )
    return invalid();
  const shapes: CanvasShape[] = [];
  const shapeIds = new Set<string>();
  for (const raw of data.shapes) {
    if (!raw || typeof raw !== "object") return invalid();
    const s = raw as Record<string, unknown>;
    if (
      !known(s, [
        "id",
        "shape",
        "x",
        "y",
        "width",
        "height",
        "text",
        "fill",
        "stroke",
        "strokeWidth",
        "strokeDashed",
        "rotation",
        "fontSize",
        "bold",
        "italic",
        "underline",
        "strike",
        "textColor",
        "textAlign",
        "verticalAlign",
        "lanes",
        "parentLane",
        "imageSrc",
      ])
    )
      return invalid();
    if (
      typeof s.id !== "string" ||
      !s.id ||
      typeof s.text !== "string" ||
      !shapeTypes.includes(s.shape as Shape) ||
      ![s.x, s.y, s.width, s.height].every((n) => typeof n === "number" && Number.isFinite(n)) ||
      (s.width as number) <= 0 ||
      (s.height as number) <= 0
    )
      return invalid();
    if (shapeIds.has(s.id)) return invalid();
    shapeIds.add(s.id);
    if (
      s.fill !== undefined &&
      (typeof s.fill !== "string" || (s.fill !== "transparent" && !/^#[0-9a-f]{6}$/i.test(s.fill)))
    )
      return invalid();
    if (s.stroke !== undefined && (typeof s.stroke !== "string" || !/^#[0-9a-f]{6}$/i.test(s.stroke))) return invalid();
    if (
      s.strokeWidth !== undefined &&
      (typeof s.strokeWidth !== "number" || !Number.isInteger(s.strokeWidth) || s.strokeWidth < 1 || s.strokeWidth > 10)
    )
      return invalid();
    if (s.strokeDashed !== undefined && typeof s.strokeDashed !== "boolean") return invalid();
    if (s.rotation !== undefined && (typeof s.rotation !== "number" || !Number.isFinite(s.rotation))) return invalid();
    if (
      s.fontSize !== undefined &&
      (typeof s.fontSize !== "number" || !Number.isFinite(s.fontSize) || s.fontSize < 1 || s.fontSize > 200)
    )
      return invalid();
    if (s.bold !== undefined && typeof s.bold !== "boolean") return invalid();
    if ([s.italic, s.underline, s.strike].some((value) => value !== undefined && typeof value !== "boolean"))
      return invalid();
    if (s.textColor !== undefined && (typeof s.textColor !== "string" || !/^#[0-9a-f]{6}$/i.test(s.textColor)))
      return invalid();
    if (
      s.textAlign !== undefined &&
      (typeof s.textAlign !== "string" || !["left", "center", "right", "justify"].includes(s.textAlign))
    )
      return invalid();
    if (
      s.verticalAlign !== undefined &&
      (typeof s.verticalAlign !== "string" || !["top", "middle", "bottom"].includes(s.verticalAlign))
    )
      return invalid();
    const isSwimlane = s.shape === "swimlaneVertical" || s.shape === "swimlaneHorizontal";
    if (
      isSwimlane &&
      (!Array.isArray(s.lanes) ||
        s.lanes.length < 1 ||
        s.lanes.length > 50 ||
        !s.lanes.every((lane) => typeof lane === "string"))
    )
      return invalid();
    if (!isSwimlane && s.lanes !== undefined) return invalid();
    if (s.parentLane !== undefined && (typeof s.parentLane !== "string" || !s.parentLane || isSwimlane))
      return invalid();
    if (s.shape === "image" ? !validCanvasImage(s.imageSrc) : s.imageSrc !== undefined) return invalid();
    shapes.push({
      id: s.id,
      shape: s.shape as Shape,
      x: s.x as number,
      y: s.y as number,
      width: s.width as number,
      height: s.height as number,
      text: s.text,
      ...(s.fill === undefined ? {} : { fill: s.fill as string }),
      ...(s.stroke === undefined ? {} : { stroke: s.stroke as string }),
      ...(s.strokeWidth === undefined ? {} : { strokeWidth: s.strokeWidth as number }),
      ...(s.strokeDashed === undefined ? {} : { strokeDashed: s.strokeDashed as boolean }),
      ...(s.rotation === undefined ? {} : { rotation: s.rotation as number }),
      ...(s.fontSize === undefined ? {} : { fontSize: s.fontSize as number }),
      ...(s.bold === undefined ? {} : { bold: s.bold as boolean }),
      ...(s.italic === undefined ? {} : { italic: s.italic as boolean }),
      ...(s.underline === undefined ? {} : { underline: s.underline as boolean }),
      ...(s.strike === undefined ? {} : { strike: s.strike as boolean }),
      ...(s.textColor === undefined ? {} : { textColor: s.textColor as string }),
      ...(s.textAlign === undefined ? {} : { textAlign: s.textAlign as CanvasShape["textAlign"] }),
      ...(s.verticalAlign === undefined ? {} : { verticalAlign: s.verticalAlign as CanvasShape["verticalAlign"] }),
      ...(s.lanes === undefined ? {} : { lanes: [...(s.lanes as string[])] }),
      ...(s.parentLane === undefined ? {} : { parentLane: s.parentLane as string }),
      ...(s.imageSrc === undefined ? {} : { imageSrc: s.imageSrc as string }),
    });
  }
  const laneIds = new Set(shapes.filter((shape) => shape.lanes).map((shape) => shape.id));
  if (shapes.some((shape) => shape.parentLane && !laneIds.has(shape.parentLane))) return invalid();
  const edges: CanvasEdge[] = [];
  const edgeIds = new Set<string>();
  for (const raw of data.edges) {
    if (!raw || typeof raw !== "object") return invalid();
    const e = raw as Record<string, unknown>;
    if (
      !known(e, [
        "id",
        "from",
        "to",
        "text",
        "dashed",
        "arrow",
        "startArrow",
        "startMarker",
        "endMarker",
        "bendOffset",
        "fromPoint",
        "toPoint",
        "route",
        "color",
        "width",
        "parentLane",
      ])
    )
      return invalid();
    if (e.startArrow !== undefined && typeof e.startArrow !== "boolean") return invalid();
    if (e.bendOffset !== undefined && (typeof e.bendOffset !== "number" || !Number.isFinite(e.bendOffset)))
      return invalid();
    for (const marker of [e.startMarker, e.endMarker])
      if (marker !== undefined && (typeof marker !== "string" || !markerOptions.some(([value]) => value === marker)))
        return invalid();
    if (
      e.route !== undefined &&
      (typeof e.route !== "string" || !["straight", "curved", "orthogonal"].includes(e.route))
    )
      return invalid();
    if (e.color !== undefined && (typeof e.color !== "string" || !/^#[0-9a-f]{6}$/i.test(e.color))) return invalid();
    if (
      e.width !== undefined &&
      (typeof e.width !== "number" || !Number.isInteger(e.width) || e.width < 1 || e.width > 10)
    )
      return invalid();
    for (const point of [e.fromPoint, e.toPoint])
      if (
        point !== undefined &&
        (!point || typeof point !== "object" || !known(point as Record<string, unknown>, ["x", "y"]))
      )
        return invalid();
    if (
      typeof e.id !== "string" ||
      !e.id ||
      typeof e.from !== "string" ||
      typeof e.to !== "string" ||
      typeof e.text !== "string" ||
      typeof e.dashed !== "boolean" ||
      typeof e.arrow !== "boolean"
    )
      return invalid();
    if (edgeIds.has(e.id)) return invalid();
    edgeIds.add(e.id);
    const fromPoint = readPoint(e.fromPoint),
      toPoint = readPoint(e.toPoint);
    if ((e.fromPoint !== undefined && !fromPoint) || (e.toPoint !== undefined && !toPoint)) return invalid();
    if ((!shapeIds.has(e.from) && !fromPoint) || (!shapeIds.has(e.to) && !toPoint)) return invalid();
    if (
      e.parentLane !== undefined &&
      (typeof e.parentLane !== "string" || !laneIds.has(e.parentLane) || e.from || e.to)
    )
      return invalid();
    edges.push({
      id: e.id,
      from: e.from,
      to: e.to,
      text: e.text,
      dashed: e.dashed,
      arrow: e.arrow,
      ...(e.parentLane === undefined ? {} : { parentLane: e.parentLane as string }),
      ...(e.startArrow === undefined ? {} : { startArrow: e.startArrow as boolean }),
      ...(e.startMarker === undefined ? {} : { startMarker: e.startMarker as Marker }),
      ...(e.endMarker === undefined ? {} : { endMarker: e.endMarker as Marker }),
      ...(e.bendOffset === undefined ? {} : { bendOffset: e.bendOffset as number }),
      ...(e.route === undefined ? {} : { route: e.route as CanvasEdge["route"] }),
      ...(e.color === undefined ? {} : { color: e.color as string }),
      ...(e.width === undefined ? {} : { width: e.width as number }),
      ...(fromPoint ? { fromPoint } : {}),
      ...(toPoint ? { toPoint } : {}),
    });
  }
  const strokes: CanvasStroke[] = [];
  const strokeIds = new Set<string>();
  if (data.strokes !== undefined) {
    if (!Array.isArray(data.strokes) || data.strokes.length > 5000) return invalid();
    for (const raw of data.strokes) {
      if (!raw || typeof raw !== "object") return invalid();
      const stroke = raw as Record<string, unknown>;
      if (!known(stroke, ["id", "points", "color", "width", "parentLane"])) return invalid();
      if (
        typeof stroke.id !== "string" ||
        !stroke.id ||
        !Array.isArray(stroke.points) ||
        stroke.points.length < 2 ||
        stroke.points.length > 20000
      )
        return invalid();
      if (strokeIds.has(stroke.id)) return invalid();
      if (stroke.parentLane !== undefined && (typeof stroke.parentLane !== "string" || !laneIds.has(stroke.parentLane)))
        return invalid();
      strokeIds.add(stroke.id);
      const points: CanvasPoint[] = [];
      for (const rawPoint of stroke.points) {
        if (!rawPoint || typeof rawPoint !== "object") return invalid();
        const point = rawPoint as Record<string, unknown>;
        if (!known(point, ["x", "y"])) return invalid();
        if (
          typeof point.x !== "number" ||
          !Number.isFinite(point.x) ||
          typeof point.y !== "number" ||
          !Number.isFinite(point.y)
        )
          return invalid();
        points.push({ x: point.x, y: point.y });
      }
      if (stroke.color !== undefined && (typeof stroke.color !== "string" || !/^#[0-9a-f]{6}$/i.test(stroke.color)))
        return invalid();
      if (
        stroke.width !== undefined &&
        (typeof stroke.width !== "number" || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 10)
      )
        return invalid();
      strokes.push({
        id: stroke.id,
        points,
        ...(stroke.parentLane === undefined ? {} : { parentLane: stroke.parentLane as string }),
        ...(stroke.color === undefined ? {} : { color: stroke.color as string }),
        ...(stroke.width === undefined ? {} : { width: stroke.width as number }),
      });
    }
  }
  const groups: NonNullable<CanvasData["groups"]> = [];
  if (data.groups !== undefined) {
    if (!Array.isArray(data.groups) || data.groups.length > 2500) return invalid();
    const groupIds = new Set<string>();
    let groupCount = 0;
    const readGroups = (values: unknown[], depth: number, parent?: CanvasGroup): CanvasGroup[] | null => {
      if (depth > 64) return null;
      const groupedShapes = new Set<string>(),
        groupedStrokes = new Set<string>(),
        groupedEdges = new Set<string>();
      const result: CanvasGroup[] = [];
      for (const raw of values) {
        if (!raw || typeof raw !== "object" || ++groupCount > 2500) return null;
        const group = raw as Record<string, unknown>;
        if (
          !known(group, ["id", "members", "strokes", "edges", "children"]) ||
          typeof group.id !== "string" ||
          !group.id ||
          groupIds.has(group.id) ||
          !Array.isArray(group.members) ||
          group.members.length > shapes.length ||
          (group.strokes !== undefined && !Array.isArray(group.strokes)) ||
          (group.edges !== undefined && !Array.isArray(group.edges)) ||
          (group.children !== undefined && !Array.isArray(group.children)) ||
          group.members.length +
            (Array.isArray(group.strokes) ? group.strokes.length : 0) +
            (Array.isArray(group.edges) ? group.edges.length : 0) <
            2
        )
          return null;
        groupIds.add(group.id);
        const members: string[] = [];
        for (const member of group.members) {
          if (
            typeof member !== "string" ||
            !shapeIds.has(member) ||
            groupedShapes.has(member) ||
            (parent && !parent.members.includes(member))
          )
            return null;
          groupedShapes.add(member);
          members.push(member);
        }
        const groupStrokes: string[] = [];
        if (Array.isArray(group.strokes))
          for (const id of group.strokes) {
            if (
              typeof id !== "string" ||
              !strokeIds.has(id) ||
              groupedStrokes.has(id) ||
              (parent && !parent.strokes?.includes(id))
            )
              return null;
            groupedStrokes.add(id);
            groupStrokes.push(id);
          }
        const groupEdges: string[] = [];
        if (Array.isArray(group.edges))
          for (const id of group.edges) {
            if (
              typeof id !== "string" ||
              !edgeIds.has(id) ||
              groupedEdges.has(id) ||
              (parent && !parent.edges?.includes(id))
            )
              return null;
            groupedEdges.add(id);
            groupEdges.push(id);
          }
        const item: CanvasGroup = {
          id: group.id,
          members,
          ...(group.strokes === undefined ? {} : { strokes: groupStrokes }),
          ...(group.edges === undefined ? {} : { edges: groupEdges }),
        };
        if (Array.isArray(group.children)) {
          const children = readGroups(group.children, depth + 1, item);
          if (!children) return null;
          item.children = children;
        }
        result.push(item);
      }
      return result;
    };
    const parsed = readGroups(data.groups, 0);
    if (!parsed) return invalid();
    groups.push(...parsed);
  }
  return {
    shapes,
    edges,
    ...(data.strokes === undefined ? {} : { strokes }),
    ...(data.groups === undefined ? {} : { groups }),
  };
}
export function parseJSON(value: string | null): unknown {
  try {
    return value === null ? null : JSON.parse(value);
  } catch {
    return value;
  }
}
export function pruneGroups(
  groups: CanvasGroup[],
  shapes: Set<string>,
  strokes: Set<string>,
  edges: Set<string>,
): CanvasGroup[] {
  return groups
    .map((group) => ({
      ...group,
      members: group.members.filter((id) => !shapes.has(id)),
      ...(group.strokes === undefined ? {} : { strokes: group.strokes.filter((id) => !strokes.has(id)) }),
      ...(group.edges === undefined ? {} : { edges: group.edges.filter((id) => !edges.has(id)) }),
      ...(group.children === undefined ? {} : { children: pruneGroups(group.children, shapes, strokes, edges) }),
    }))
    .filter((group) => group.members.length + (group.strokes?.length ?? 0) + (group.edges?.length ?? 0) > 1);
}
