import type { Editor } from "@tiptap/core";

import { edgeGeometry, endpointBox, withLaneMembers } from "./geometry";
import type { CanvasData, CanvasPoint } from "./model";

interface GroupOutlineContext {
  doc: Document;
  dom: HTMLElement;
  stage: HTMLElement;
  editor: Editor;
  selectedIds: Set<string>;
  selectedStrokeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  getData(): CanvasData;
  coordinates(event: Pick<MouseEvent, "clientX" | "clientY">): CanvasPoint;
  updateGroupShapes(data: CanvasData): void;
  commit(data: CanvasData): boolean;
  paint(): void;
}

export function createGroupOutlineRenderer({
  doc,
  dom,
  stage,
  editor,
  selectedIds,
  selectedStrokeIds,
  selectedEdgeIds,
  getData,
  coordinates,
  updateGroupShapes,
  commit,
  paint,
}: GroupOutlineContext) {
  return (data: CanvasData) => {
    const group = data.groups?.find(
      (entry) =>
        entry.members.length === selectedIds.size &&
        entry.members.every((id) => selectedIds.has(id)) &&
        (entry.strokes?.length ?? 0) === selectedStrokeIds.size &&
        (entry.strokes ?? []).every((id) => selectedStrokeIds.has(id)) &&
        (entry.edges?.length ?? 0) === selectedEdgeIds.size &&
        (entry.edges ?? []).every((id) => selectedEdgeIds.has(id)),
    );
    dom.classList.toggle("is-group-selected", !!group);
    if (!group) {
      stage.querySelector(".semlo-editor-canvas-group-outline")?.remove();
      return;
    }
    const items = data.shapes
      .filter((shape) => selectedIds.has(shape.id))
      .map((shape) => {
        const angle = ((shape.rotation ?? 0) * Math.PI) / 180;
        const width = Math.abs(Math.cos(angle)) * shape.width + Math.abs(Math.sin(angle)) * shape.height;
        const height = Math.abs(Math.sin(angle)) * shape.width + Math.abs(Math.cos(angle)) * shape.height;
        return {
          left: shape.x + (shape.width - width) / 2,
          top: shape.y + (shape.height - height) / 2,
          width,
          height,
        };
      });
    for (const stroke of data.strokes ?? []) {
      if (!selectedStrokeIds.has(stroke.id)) continue;
      const xs = stroke.points.map((point) => point.x),
        ys = stroke.points.map((point) => point.y);
      const padding = (stroke.width ?? 3) / 2;
      const left = Math.min(...xs) - padding,
        top = Math.min(...ys) - padding;
      items.push({ left, top, width: Math.max(...xs) + padding - left, height: Math.max(...ys) + padding - top });
    }
    for (const edge of data.edges) {
      if (!selectedEdgeIds.has(edge.id)) continue;
      const from = endpointBox(data, edge.from, edge.fromPoint),
        to = endpointBox(data, edge.to, edge.toPoint);
      const geometry =
        from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
      if (!geometry) continue;
      const padding = Math.max((edge.width ?? 2) / 2, edge.arrow || edge.startArrow ? 10 : 1);
      const left = Math.min(geometry.x1, geometry.x2, geometry.midX) - padding;
      const top = Math.min(geometry.y1, geometry.y2, geometry.midY) - padding;
      items.push({
        left,
        top,
        width: Math.max(geometry.x1, geometry.x2, geometry.midX) + padding - left,
        height: Math.max(geometry.y1, geometry.y2, geometry.midY) + padding - top,
      });
    }
    if (!items.length) return;
    const left = Math.min(...items.map((item) => item.left)),
      top = Math.min(...items.map((item) => item.top));
    const right = Math.max(...items.map((item) => item.left + item.width)),
      bottom = Math.max(...items.map((item) => item.top + item.height));
    let outline = stage.querySelector<HTMLDivElement>(".semlo-editor-canvas-group-outline");
    if (!outline) {
      outline = doc.createElement("div");
      outline.className = "semlo-editor-canvas-group-outline";
      if (editor.isEditable) {
        for (const corner of ["nw", "ne", "sw", "se"] as const) {
          const handle = doc.createElement("button");
          handle.type = "button";
          handle.className = "semlo-editor-canvas-group-resize";
          handle.dataset.corner = corner;
          handle.setAttribute("aria-label", "调整编组大小");
          handle.addEventListener("pointerdown", (event) => {
            if (!editor.isEditable || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const data = getData();
            const transforming = withLaneMembers(data, selectedIds);
            const originals = data.shapes
              .filter((shape) => transforming.has(shape.id))
              .map((shape) => ({
                shape,
                x: shape.x,
                y: shape.y,
                width: shape.width,
                height: shape.height,
              }));
            const strokeOriginals = (data.strokes ?? [])
              .filter(
                (stroke) =>
                  selectedStrokeIds.has(stroke.id) || (!!stroke.parentLane && selectedIds.has(stroke.parentLane)),
              )
              .map((stroke) => ({ stroke, points: stroke.points.map((point) => ({ ...point })) }));
            const edgeOriginals = data.edges
              .filter((edge) => selectedEdgeIds.has(edge.id) || (!!edge.parentLane && selectedIds.has(edge.parentLane)))
              .map((edge) => ({
                edge,
                fromPoint: edge.fromPoint ? { ...edge.fromPoint } : undefined,
                toPoint: edge.toPoint ? { ...edge.toPoint } : undefined,
                bendOffset: edge.bendOffset,
              }));
            const groupBox = outline!.getBoundingClientRect(),
              stageBox = stage.getBoundingClientRect();
            const left = ((groupBox.left - stageBox.left) * 800) / stageBox.width;
            const top = ((groupBox.top - stageBox.top) * 440) / stageBox.height;
            const width = (groupBox.width * 800) / stageBox.width,
              height = (groupBox.height * 440) / stageBox.height;
            const anchorX = left + (corner.includes("w") ? width : 0),
              anchorY = top + (corner.includes("n") ? height : 0);
            const start = coordinates(event),
              vx = start.x - anchorX,
              vy = start.y - anchorY;
            let moved = false;
            handle.setPointerCapture(event.pointerId);
            const move = (e: PointerEvent) => {
              const point = coordinates(e);
              const scale = Math.max(
                0.1,
                ((point.x - anchorX) * vx + (point.y - anchorY) * vy) / Math.max(1, vx * vx + vy * vy),
              );
              moved ||= Math.abs(scale - 1) > 0.01;
              if (!moved) return;
              for (const original of originals) {
                const centerX = anchorX + (original.x + original.width / 2 - anchorX) * scale;
                const centerY = anchorY + (original.y + original.height / 2 - anchorY) * scale;
                original.shape.width = original.width * scale;
                original.shape.height = original.height * scale;
                original.shape.x = centerX - original.shape.width / 2;
                original.shape.y = centerY - original.shape.height / 2;
              }
              for (const original of strokeOriginals)
                original.stroke.points = original.points.map((point) => ({
                  x: anchorX + (point.x - anchorX) * scale,
                  y: anchorY + (point.y - anchorY) * scale,
                }));
              for (const original of edgeOriginals) {
                if (!original.edge.from && original.fromPoint)
                  original.edge.fromPoint = {
                    x: anchorX + (original.fromPoint.x - anchorX) * scale,
                    y: anchorY + (original.fromPoint.y - anchorY) * scale,
                  };
                if (!original.edge.to && original.toPoint)
                  original.edge.toPoint = {
                    x: anchorX + (original.toPoint.x - anchorX) * scale,
                    y: anchorY + (original.toPoint.y - anchorY) * scale,
                  };
                if (original.bendOffset !== undefined) original.edge.bendOffset = original.bendOffset * scale;
              }
              updateGroupShapes(data);
            };
            const cleanup = () => {
              handle.removeEventListener("pointermove", move);
              handle.removeEventListener("pointerup", end);
              handle.removeEventListener("pointercancel", cancel);
              handle.removeEventListener("lostpointercapture", cancel);
            };
            const end = (e: PointerEvent) => {
              move(e);
              cleanup();
              if (!moved || !commit(data)) paint();
            };
            const cancel = () => {
              cleanup();
              paint();
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", end);
            handle.addEventListener("pointercancel", cancel);
            handle.addEventListener("lostpointercapture", cancel);
          });
          outline.append(handle);
        }
        const rotate = doc.createElement("button");
        rotate.type = "button";
        rotate.className = "semlo-editor-canvas-group-rotate";
        rotate.setAttribute("aria-label", "旋转编组");
        rotate.textContent = "↻";
        rotate.addEventListener("pointerdown", (event) => {
          if (!editor.isEditable || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const data = getData();
          const transforming = withLaneMembers(data, selectedIds);
          const originals = data.shapes
            .filter((shape) => transforming.has(shape.id))
            .map((shape) => ({
              shape,
              x: shape.x,
              y: shape.y,
              width: shape.width,
              height: shape.height,
              rotation: shape.rotation ?? 0,
            }));
          const strokeOriginals = (data.strokes ?? [])
            .filter(
              (stroke) =>
                selectedStrokeIds.has(stroke.id) || (!!stroke.parentLane && selectedIds.has(stroke.parentLane)),
            )
            .map((stroke) => ({ stroke, points: stroke.points.map((point) => ({ ...point })) }));
          const edgeOriginals = data.edges
            .filter((edge) => selectedEdgeIds.has(edge.id) || (!!edge.parentLane && selectedIds.has(edge.parentLane)))
            .map((edge) => ({
              edge,
              fromPoint: edge.fromPoint ? { ...edge.fromPoint } : undefined,
              toPoint: edge.toPoint ? { ...edge.toPoint } : undefined,
            }));
          const groupBox = outline!.getBoundingClientRect(),
            stageBox = stage.getBoundingClientRect();
          const centerX = ((groupBox.left + groupBox.width / 2 - stageBox.left) * 800) / stageBox.width;
          const centerY = ((groupBox.top + groupBox.height / 2 - stageBox.top) * 440) / stageBox.height;
          const start = coordinates(event),
            startAngle = Math.atan2(start.y - centerY, start.x - centerX);
          let moved = false;
          rotate.setPointerCapture(event.pointerId);
          const move = (e: PointerEvent) => {
            const point = coordinates(e),
              angle = Math.atan2(point.y - centerY, point.x - centerX) - startAngle;
            moved ||= Math.abs(angle) > 0.02;
            if (!moved) return;
            for (const original of originals) {
              const dx = original.x + original.width / 2 - centerX,
                dy = original.y + original.height / 2 - centerY;
              original.shape.x = centerX + dx * Math.cos(angle) - dy * Math.sin(angle) - original.width / 2;
              original.shape.y = centerY + dx * Math.sin(angle) + dy * Math.cos(angle) - original.height / 2;
              original.shape.rotation = Math.round(
                ((((original.rotation + (angle * 180) / Math.PI + 180) % 360) + 360) % 360) - 180,
              );
            }
            for (const original of strokeOriginals)
              original.stroke.points = original.points.map((point) => ({
                x: centerX + (point.x - centerX) * Math.cos(angle) - (point.y - centerY) * Math.sin(angle),
                y: centerY + (point.x - centerX) * Math.sin(angle) + (point.y - centerY) * Math.cos(angle),
              }));
            const rotatePoint = (point: CanvasPoint) => ({
              x: centerX + (point.x - centerX) * Math.cos(angle) - (point.y - centerY) * Math.sin(angle),
              y: centerY + (point.x - centerX) * Math.sin(angle) + (point.y - centerY) * Math.cos(angle),
            });
            for (const original of edgeOriginals) {
              if (!original.edge.from && original.fromPoint) original.edge.fromPoint = rotatePoint(original.fromPoint);
              if (!original.edge.to && original.toPoint) original.edge.toPoint = rotatePoint(original.toPoint);
            }
            updateGroupShapes(data);
          };
          const cleanup = () => {
            rotate.removeEventListener("pointermove", move);
            rotate.removeEventListener("pointerup", end);
            rotate.removeEventListener("pointercancel", cancel);
            rotate.removeEventListener("lostpointercapture", cancel);
          };
          const end = (e: PointerEvent) => {
            move(e);
            cleanup();
            if (!moved || !commit(data)) paint();
          };
          const cancel = () => {
            cleanup();
            paint();
          };
          rotate.addEventListener("pointermove", move);
          rotate.addEventListener("pointerup", end);
          rotate.addEventListener("pointercancel", cancel);
          rotate.addEventListener("lostpointercapture", cancel);
        });
        outline.append(rotate);
      }
      stage.append(outline);
    }
    outline.style.left = `${left / 8}%`;
    outline.style.top = `${top / 4.4}%`;
    outline.style.width = `${(right - left) / 8}%`;
    outline.style.height = `${(bottom - top) / 4.4}%`;
  };
}
