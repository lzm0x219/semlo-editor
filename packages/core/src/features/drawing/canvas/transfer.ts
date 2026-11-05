import type { Editor } from "@tiptap/core";

import { edgeGeometry, endpointBox, withLaneMembers } from "./geometry";
import { dataFrom, parseJSON, type CanvasData, type CanvasEdge, type CanvasGroup, type CanvasPoint } from "./model";
import type { CanvasTool } from "./state";

interface TransferContext {
  doc: Document;
  stage: HTMLElement;
  editor: Editor;
  selectedIds: Set<string>;
  selectedStrokeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  getTool(): CanvasTool;
  getEpoch(): number;
  getLastCanvasPoint(): CanvasPoint;
  getData(): CanvasData;
  setSelected(value: string | null): void;
  setSelectedEdge(value: string | null): void;
  selectOnly(id: string | null): void;
  coordinates(event: Pick<MouseEvent, "clientX" | "clientY">): CanvasPoint;
  insertImageFile(file: File, epoch: number, point?: CanvasPoint): void;
  setImageStatus(message: string): void;
  commit(data: CanvasData): boolean;
  paint(): void;
  newId(): string;
}

export function mountCanvasTransfer({
  doc,
  stage,
  editor,
  selectedIds,
  selectedStrokeIds,
  selectedEdgeIds,
  getTool,
  getEpoch,
  getLastCanvasPoint,
  getData,
  setSelected,
  setSelectedEdge,
  selectOnly,
  coordinates,
  insertImageFile,
  setImageStatus,
  commit,
  paint,
  newId,
}: TransferContext) {
  const clipboardType = "application/x-semlo-canvas+json";
  let clipboardScope = newId();
  const isTextEntry = (target: EventTarget | null) =>
    target instanceof doc.defaultView!.HTMLTextAreaElement ||
    target instanceof doc.defaultView!.HTMLInputElement ||
    (target instanceof doc.defaultView!.HTMLElement && target.isContentEditable);
  stage.addEventListener("dragover", (event) => {
    if (!editor.isEditable || isTextEntry(event.target)) return;
    if (
      Array.from(event.dataTransfer?.items ?? []).some(
        (item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")),
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  stage.addEventListener("drop", (event) => {
    if (!editor.isEditable || isTextEntry(event.target)) return;
    const images = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    event.preventDefault();
    event.stopPropagation();
    if (images.length > 1) setImageStatus("请一次放入一张图片。");
    else insertImageFile(images[0], getEpoch(), coordinates(event));
  });
  stage.addEventListener("copy", (event) => {
    if (!event.clipboardData || getTool() !== "select" || isTextEntry(event.target)) return;
    const data = getData();
    const copyShapeIds = withLaneMembers(data, selectedIds);
    const shapes = data.shapes
      .filter((shape) => copyShapeIds.has(shape.id))
      .map((shape) => {
        const copy = { ...shape };
        if (copy.parentLane && !copyShapeIds.has(copy.parentLane)) delete copy.parentLane;
        return copy;
      });
    const strokes = (data.strokes ?? [])
      .filter(
        (stroke) => selectedStrokeIds.has(stroke.id) || (!!stroke.parentLane && copyShapeIds.has(stroke.parentLane)),
      )
      .map((stroke) => {
        const copy = { ...stroke };
        if (copy.parentLane && !copyShapeIds.has(copy.parentLane)) delete copy.parentLane;
        return copy;
      });
    const edges = data.edges
      .filter((edge) => selectedEdgeIds.has(edge.id) || (!!edge.parentLane && copyShapeIds.has(edge.parentLane)))
      .map((edge) => {
        const copy = { ...edge };
        if (copy.parentLane && !copyShapeIds.has(copy.parentLane)) delete copy.parentLane;
        const from = endpointBox(data, edge.from, edge.fromPoint),
          to = endpointBox(data, edge.to, edge.toPoint);
        const geometry =
          from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
        if (copy.from && !copyShapeIds.has(copy.from) && geometry) {
          copy.from = "";
          copy.fromPoint = { x: geometry.x1, y: geometry.y1 };
        }
        if (copy.to && !copyShapeIds.has(copy.to) && geometry) {
          copy.to = "";
          copy.toPoint = { x: geometry.x2, y: geometry.y2 };
        }
        return copy;
      });
    if (!shapes.length && !edges.length && !strokes.length) return;
    const groups = (data.groups ?? []).filter(
      (group) =>
        group.members.every((id) => copyShapeIds.has(id)) &&
        (group.strokes ?? []).every((id) => strokes.some((stroke) => stroke.id === id)) &&
        (group.edges ?? []).every((id) => edges.some((edge) => edge.id === id)),
    );
    const external = data.edges
      .filter((edge) => selectedEdgeIds.has(edge.id))
      .map((edge) => ({
        id: edge.id,
        from: edge.from && !copyShapeIds.has(edge.from) ? edge.from : "",
        to: edge.to && !copyShapeIds.has(edge.to) ? edge.to : "",
      }));
    event.clipboardData.setData(
      clipboardType,
      JSON.stringify({ data: { shapes, edges, strokes, groups }, scope: clipboardScope, external }),
    );
    event.clipboardData.setData(
      "text/plain",
      [...shapes.map((shape) => shape.text), ...edges.map((edge) => edge.text)].filter(Boolean).join("\n"),
    );
    event.preventDefault();
    event.stopPropagation();
  });
  stage.addEventListener("paste", (event) => {
    if (!editor.isEditable || !event.clipboardData || isTextEntry(event.target)) return;
    const raw = event.clipboardData.getData(clipboardType);
    if (!raw) {
      const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
      if (images.length) {
        event.preventDefault();
        event.stopPropagation();
        if (images.length > 1) setImageStatus("请一次粘贴一张图片。");
        else insertImageFile(images[0], getEpoch());
        return;
      }
      if (getTool() !== "select") return;
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      const data = getData();
      const id = newId();
      const lines = text.split("\n");
      const width = Math.max(
        80,
        Math.min(
          600,
          lines.reduce((max, line) => Math.max(max, Array.from(line).length * 14 + 16), 0),
        ),
      );
      const height = Math.max(36, lines.length * 17 + 12);
      data.shapes.push({
        id,
        shape: "text",
        x: getLastCanvasPoint().x,
        y: getLastCanvasPoint().y,
        width,
        height,
        text,
      });
      selectOnly(id);
      selectedEdgeIds.clear();
      selectedStrokeIds.clear();
      setSelectedEdge(null);
      event.preventDefault();
      event.stopPropagation();
      if (commit(data))
        stage.querySelector<HTMLButtonElement>('.semlo-editor-canvas-shape[aria-pressed="true"]')?.focus();
      else paint();
      return;
    }
    if (getTool() !== "select") return;
    let supported = true;
    const parsed = parseJSON(raw);
    const envelope = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const source = dataFrom(envelope && "data" in envelope ? envelope.data : parsed, "board", () => {
      supported = false;
    });
    if (!supported || (!source.shapes.length && !source.edges.length && !source.strokes?.length)) return;
    const data = getData();
    const ids = new Map<string, string>();
    selectOnly(null);
    selectedEdgeIds.clear();
    selectedStrokeIds.clear();
    setSelectedEdge(null);
    for (const shape of source.shapes) ids.set(shape.id, newId());
    for (const shape of source.shapes) {
      const id = ids.get(shape.id)!;
      data.shapes.push({
        ...shape,
        id,
        x: shape.x + 40,
        y: shape.y + 40,
        ...(shape.parentLane ? { parentLane: ids.get(shape.parentLane)! } : {}),
      });
      selectedIds.add(id);
      setSelected(id);
    }
    const edgeIdMap = new Map<string, string>();
    for (const edge of source.edges) {
      const id = newId();
      edgeIdMap.set(edge.id, id);
      const external =
        envelope?.scope === clipboardScope && Array.isArray(envelope.external)
          ? (envelope.external.find(
              (entry: unknown) =>
                entry && typeof entry === "object" && (entry as Record<string, unknown>).id === edge.id,
            ) as Record<string, unknown> | undefined)
          : undefined;
      const keepFrom =
        typeof external?.from === "string" && data.shapes.some((shape) => shape.id === external.from)
          ? external.from
          : "";
      const keepTo =
        typeof external?.to === "string" && data.shapes.some((shape) => shape.id === external.to) ? external.to : "";
      const pasted: CanvasEdge = {
        ...edge,
        id,
        from: ids.get(edge.from) ?? keepFrom,
        to: ids.get(edge.to) ?? keepTo,
        ...(edge.fromPoint ? { fromPoint: { x: edge.fromPoint.x + 40, y: edge.fromPoint.y + 40 } } : {}),
        ...(edge.toPoint ? { toPoint: { x: edge.toPoint.x + 40, y: edge.toPoint.y + 40 } } : {}),
        ...(edge.parentLane ? { parentLane: ids.get(edge.parentLane)! } : {}),
      };
      if (keepFrom) delete pasted.fromPoint;
      if (keepTo) delete pasted.toPoint;
      data.edges.push(pasted);
      selectedEdgeIds.add(id);
      setSelectedEdge(id);
    }
    const strokeIdMap = new Map<string, string>();
    for (const stroke of source.strokes ?? []) {
      const id = newId();
      strokeIdMap.set(stroke.id, id);
      data.strokes ??= [];
      data.strokes.push({
        ...stroke,
        id,
        points: stroke.points.map((point) => ({ x: point.x + 40, y: point.y + 40 })),
        ...(stroke.parentLane ? { parentLane: ids.get(stroke.parentLane)! } : {}),
      });
      selectedStrokeIds.add(id);
    }
    const cloneGroup = (group: CanvasGroup): CanvasGroup => ({
      id: newId(),
      members: group.members.map((id) => ids.get(id)!),
      ...(group.strokes === undefined ? {} : { strokes: group.strokes.map((id) => strokeIdMap.get(id)!) }),
      ...(group.edges === undefined ? {} : { edges: group.edges.map((id) => edgeIdMap.get(id)!) }),
      ...(group.children === undefined ? {} : { children: group.children.map(cloneGroup) }),
    });
    for (const group of source.groups ?? []) {
      data.groups ??= [];
      data.groups.push(cloneGroup(group));
    }
    event.preventDefault();
    event.stopPropagation();
    if (commit(data)) {
      const target = stage.querySelector<HTMLElement | SVGElement>(
        '.semlo-editor-canvas-shape[aria-pressed="true"], .semlo-editor-canvas-edge-hit[aria-pressed="true"], .semlo-editor-canvas-stroke-hit[aria-pressed="true"]',
      );
      target?.focus();
    } else paint();
  });
  return {
    reset: () => {
      clipboardScope = newId();
    },
  };
}
