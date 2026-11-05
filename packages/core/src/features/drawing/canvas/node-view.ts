import type { NodeViewRenderer } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";

import { createCanvasControls } from "./controls";
import { createCanvasEdgeHandles } from "./edge-handles";
import { withLaneMembers, updateLaneMembership, endpointBox, shapeTransform, edgeGeometry } from "./geometry";
import { createGroupOutlineRenderer } from "./group-outline";
import { canvasHeight, mountCanvasHeight } from "./height";
import { createCanvasInteraction } from "./interaction";
import { kindFrom, maxCanvasImageBytes, validCanvasImage, dataFrom, pruneGroups, type CanvasData } from "./model";
import { createCanvasPathInteractions } from "./path-interactions";
import { supportedCanvasHeight, supportedCanvasKind, supportedCanvasViewport } from "./presentation";
import { renderCanvasObjects } from "./render";
import { createCanvasSelection } from "./selection";
import { createCanvasShapeDrag } from "./shape-drag";
import { createCanvasShapeInteractions } from "./shape-interactions";
import { createCanvasShapeTextEditing } from "./shape-text-editing";
import { createCanvasShapeTransforms } from "./shape-transforms";
import { createCanvasViewState } from "./state";
import { renderCanvasToolbar } from "./toolbar";
import { mountCanvasTransfer } from "./transfer";

let nextId = 0;
const newId = () => `n${Date.now().toString(36)}-${(nextId++).toString(36)}`;

export function createCanvasNodeView(): NodeViewRenderer {
  return ({ editor, view, node: initial, getPos }) => {
    const doc = view.dom.ownerDocument;
    const dom = doc.createElement("div");
    dom.className = "semlo-editor-canvas";
    dom.dataset.type = "semloEditorCanvas";
    dom.contentEditable = "false";
    const toolbar = doc.createElement("div");
    toolbar.className = "semlo-editor-canvas-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "画布工具");
    const stage = doc.createElement("div");
    stage.className = "semlo-editor-canvas-stage";
    stage.setAttribute("aria-label", "画布");
    stage.tabIndex = 0;
    const background = doc.createElement("div");
    background.className = "semlo-editor-canvas-background";
    const viewport = doc.createElement("div");
    viewport.className = "semlo-editor-canvas-viewport";
    viewport.append(stage);
    const imageStatus = doc.createElement("div");
    imageStatus.setAttribute("role", "status");
    imageStatus.className = "semlo-editor-canvas-image-status";
    imageStatus.hidden = true;
    const setImageStatus = (message: string) => {
      imageStatus.textContent = message;
      imageStatus.hidden = !message;
    };
    dom.append(toolbar, viewport, imageStatus);
    const readViewport = (value: unknown) => {
      if (!value || typeof value !== "object") return { zoom: 100, x: 0, y: 0 };
      const state = value as Record<string, unknown>;
      if (
        typeof state.zoom !== "number" ||
        !Number.isFinite(state.zoom) ||
        state.zoom < 10 ||
        state.zoom > 200 ||
        typeof state.x !== "number" ||
        !Number.isFinite(state.x) ||
        typeof state.y !== "number" ||
        !Number.isFinite(state.y)
      )
        return { zoom: 100, x: 0, y: 0 };
      return { zoom: state.zoom, x: state.x, y: state.y };
    };
    const initialViewport = readViewport(initial.attrs.viewport);
    const canvasState = createCanvasViewState(initial, initialViewport);

    let observedNode = initial;
    let observedPosition = getPos();
    let observedDocument = view.state.doc;

    const selection = createCanvasSelection(canvasState);
    const { selectedIds, selectedEdgeIds, selectedStrokeIds, selectOnly } = selection;

    const onDocumentPointerDown = (event: PointerEvent) => {
      canvasState.active = event.target instanceof doc.defaultView!.Node && dom.contains(event.target);
    };
    const onFocusIn = () => {
      canvasState.active = true;
    };
    doc.addEventListener("pointerdown", onDocumentPointerDown, true);
    dom.addEventListener("focusin", onFocusIn);

    const getData = () => dataFrom(canvasState.current.attrs.data, kindFrom(canvasState.current.attrs.kind));
    const dataSupported = () => {
      let supported =
        supportedCanvasHeight(canvasState.current.attrs.height) &&
        supportedCanvasKind(canvasState.current.attrs.kind) &&
        supportedCanvasViewport(canvasState.current.attrs.viewport);
      dataFrom(canvasState.current.attrs.data, kindFrom(canvasState.current.attrs.kind), () => {
        supported = false;
      });
      return supported;
    };
    const commit = (data: CanvasData) => {
      if (canvasState.destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return false;
      const pos = getPos();
      const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
      if (typeof pos !== "number" || !live || !live.eq(canvasState.current)) return false;
      view.dispatch(closeHistory(view.state.tr.setNodeAttribute(pos, "data", data)));
      view.dispatch(closeHistory(view.state.tr));
      return true;
    };
    const commitHeight = (value: number) => {
      if (canvasState.destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return;
      const pos = getPos();
      const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
      if (typeof pos !== "number" || !live || !live.eq(canvasState.current)) return;
      view.dispatch(closeHistory(view.state.tr.setNodeAttribute(pos, "height", canvasHeight(value))));
      view.dispatch(closeHistory(view.state.tr));
    };
    const commitViewport = () => {
      if (canvasState.destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return;
      const pos = getPos();
      const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
      if (typeof pos !== "number" || !live || !live.eq(canvasState.current)) return;
      view.dispatch(
        view.state.tr
          .setNodeAttribute(pos, "viewport", {
            ...live.attrs.viewport,
            zoom: canvasState.zoom,
            x: canvasState.panX,
            y: canvasState.panY,
          })
          .setMeta("addToHistory", false),
      );
    };
    const coordinates = (event: Pick<MouseEvent, "clientX" | "clientY">) => {
      const box = stage.getBoundingClientRect();
      return { x: ((event.clientX - box.left) * 800) / box.width, y: ((event.clientY - box.top) * 440) / box.height };
    };
    const applyStageWidth = () => {
      stage.style.width = `min(${canvasState.zoom}cqw, ${(canvasState.zoom * 800) / 440}cqh)`;
    };
    const setZoom = (value: number) => {
      const viewportBox = viewport.getBoundingClientRect();
      const oldBox = stage.getBoundingClientRect();
      const centerX = viewportBox.left + viewportBox.width / 2;
      const centerY = viewportBox.top + viewportBox.height / 2;
      const x = ((centerX - oldBox.left) * 800) / oldBox.width;
      const y = ((centerY - oldBox.top) * 440) / oldBox.height;
      canvasState.zoom = value;
      applyStageWidth();
      const newBox = stage.getBoundingClientRect();
      canvasState.panX += ((centerX - newBox.left) * 800) / newBox.width - x;
      canvasState.panY += ((centerY - newBox.top) * 440) / newBox.height - y;
      commitViewport();
      paint();
    };
    const paintGroupOutline = createGroupOutlineRenderer({
      doc,
      dom,
      stage,
      editor,
      selectedIds,
      selectedStrokeIds,
      selectedEdgeIds,
      getData,
      coordinates,
      updateGroupShapes: (data) => updateGroupShapes(data),
      commit,
      paint: () => paint(),
    });
    const updateGroupShapes = (data: CanvasData) => {
      const transforming = withLaneMembers(data, selectedIds);
      for (const shape of data.shapes) {
        if (!transforming.has(shape.id)) continue;
        const button = Array.from(stage.querySelectorAll<HTMLButtonElement>(".semlo-editor-canvas-shape")).find(
          (element) => element.dataset.shapeId === shape.id,
        );
        if (!button) continue;
        button.style.left = `${shape.x / 8}%`;
        button.style.top = `${shape.y / 4.4}%`;
        button.style.width = `${shape.width / 8}%`;
        button.style.height = `${shape.height / 4.4}%`;
        button.style.transform = shapeTransform(shape);
      }
      previewEdges(data);
      previewStrokes(data);
    };
    const previewEdges = (data: CanvasData) => {
      paintGroupOutline(data);
      const svg = stage.querySelector("svg");
      if (!svg) return;
      const byId = (selector: string, attribute: string, id: string) =>
        Array.from(svg.querySelectorAll(selector)).find((element) => element.getAttribute(attribute) === id);
      for (const edge of data.edges) {
        const from = endpointBox(data, edge.from, edge.fromPoint),
          to = endpointBox(data, edge.to, edge.toPoint);
        const geometry =
          from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
        if (!geometry) continue;
        byId(".semlo-editor-canvas-edge", "data-edge-id", edge.id)?.setAttribute("d", geometry.path);
        byId(".semlo-editor-canvas-edge-hit", "data-edge-id", edge.id)?.setAttribute("d", geometry.path);
        byId("[data-edge-arrow-id]", "data-edge-arrow-id", edge.id)?.setAttribute("d", geometry.arrow);
        byId("[data-edge-start-arrow-id]", "data-edge-start-arrow-id", edge.id)?.setAttribute("d", geometry.startArrow);
        const text = byId("[data-edge-text-id]", "data-edge-text-id", edge.id);
        text?.setAttribute("x", String(geometry.midX));
        text?.setAttribute("y", String(geometry.midY - 5));
      }
    };
    const previewStrokes = (data: CanvasData) => {
      for (const stroke of data.strokes ?? []) {
        const d = stroke.points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
        for (const path of stage.querySelectorAll<SVGElement>(
          ".semlo-editor-canvas-stroke, .semlo-editor-canvas-stroke-hit",
        ))
          if (path.getAttribute("data-stroke-id") === stroke.id) path.setAttribute("d", d);
        const box = Array.from(stage.querySelectorAll<SVGElement>(".semlo-editor-canvas-stroke-selection")).find(
          (element) => element.getAttribute("data-stroke-id") === stroke.id,
        );
        if (box) {
          const xs = stroke.points.map((point) => point.x),
            ys = stroke.points.map((point) => point.y);
          box.setAttribute("x", String(Math.min(...xs) - 4));
          box.setAttribute("y", String(Math.min(...ys) - 4));
        }
      }
    };
    const nudgeSelection = (data: CanvasData, dx: number, dy: number) => {
      const moving = withLaneMembers(data, selectedIds);
      for (const shape of data.shapes)
        if (moving.has(shape.id)) {
          shape.x += dx;
          shape.y += dy;
        }
      for (const stroke of data.strokes ?? [])
        if (selectedStrokeIds.has(stroke.id) || (stroke.parentLane && selectedIds.has(stroke.parentLane)))
          stroke.points = stroke.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      for (const edge of data.edges)
        if (selectedEdgeIds.has(edge.id) || (edge.parentLane && selectedIds.has(edge.parentLane))) {
          if (!edge.from && edge.fromPoint) edge.fromPoint = { x: edge.fromPoint.x + dx, y: edge.fromPoint.y + dy };
          if (!edge.to && edge.toPoint) edge.toPoint = { x: edge.toPoint.x + dx, y: edge.toPoint.y + dy };
        }
      updateLaneMembership(data, selectedIds, selectedStrokeIds, selectedEdgeIds);
    };
    const deleteSelection = (
      data: CanvasData,
      fallbackShape?: string,
      fallbackEdge?: string,
      fallbackStroke?: string,
    ) => {
      if (!editor.isEditable) return;
      const ids = new Set(selectedIds);
      const edgeIds = new Set(selectedEdgeIds);
      const strokeIds = new Set(selectedStrokeIds);
      if (!ids.size && !edgeIds.size && !strokeIds.size) {
        if (fallbackShape) ids.add(fallbackShape);
        if (fallbackEdge) edgeIds.add(fallbackEdge);
        if (fallbackStroke) strokeIds.add(fallbackStroke);
      }
      if (data.strokes) data.strokes = data.strokes.filter((stroke) => !strokeIds.has(stroke.id));
      data.edges = data.edges.filter((edge) => !edgeIds.has(edge.id));
      const detachedEdges = new Set<string>();
      for (const edge of data.edges) {
        const fromShape = data.shapes.find((shape) => shape.id === edge.from && ids.has(shape.id));
        const toShape = data.shapes.find((shape) => shape.id === edge.to && ids.has(shape.id));
        if (!fromShape && !toShape) continue;
        detachedEdges.add(edge.id);
        const from = endpointBox(data, edge.from, edge.fromPoint),
          to = endpointBox(data, edge.to, edge.toPoint);
        const geometry =
          from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
        if (fromShape) {
          edge.from = "";
          edge.fromPoint = geometry
            ? { x: geometry.x1, y: geometry.y1 }
            : { x: fromShape.x + fromShape.width / 2, y: fromShape.y + fromShape.height / 2 };
        }
        if (toShape) {
          edge.to = "";
          edge.toPoint = geometry
            ? { x: geometry.x2, y: geometry.y2 }
            : { x: toShape.x + toShape.width / 2, y: toShape.y + toShape.height / 2 };
        }
      }
      data.shapes = data.shapes.filter((shape) => !ids.has(shape.id));
      for (const shape of data.shapes) if (shape.parentLane && ids.has(shape.parentLane)) delete shape.parentLane;
      for (const stroke of data.strokes ?? [])
        if (stroke.parentLane && ids.has(stroke.parentLane)) delete stroke.parentLane;
      for (const edge of data.edges) if (edge.parentLane && ids.has(edge.parentLane)) delete edge.parentLane;
      updateLaneMembership(data, new Set(), new Set(), detachedEdges);
      if (data.groups) data.groups = pruneGroups(data.groups, ids, strokeIds, edgeIds);
      selectOnly(null);
      selectedEdgeIds.clear();
      selectedStrokeIds.clear();
      canvasState.selectedEdge = null;
      commit(data);
    };
    const paths = createCanvasPathInteractions({
      editor,
      view,
      stage,
      state: canvasState,
      selection,
      coordinates,
      updateGroupShapes,
      previewEdges,
      previewStrokes,
      nudgeSelection,
      deleteSelection,
      commit,
      paint: () => paint(),
    });
    const canvasControls = createCanvasControls({
      doc,
      dom,
      stage,
      toolbar,
      editor,
      selectedIds,
      selectedStrokeIds,
      selectedEdgeIds,
      getSelection: () => ({
        tool: canvasState.tool,
        selected: canvasState.selected,
        selectedEdge: canvasState.selectedEdge,
      }),
      getCurrent: () => canvasState.current,
      getEpoch: () => canvasState.documentEpoch,
      isDestroyed: () => canvasState.destroyed,
      getData,
      paintGroupOutline,
      commit,
      newId,
    });
    const { paintShapeControls, paintEdgeControls } = canvasControls;
    const shapeDrag = createCanvasShapeDrag({
      doc,
      stage,
      editor,
      state: canvasState,
      selection,
      coordinates,
      previewEdges,
      previewStrokes,
      commit,
      paint: () => paint(),
      newId,
    });
    const shapes = createCanvasShapeInteractions({
      dom,
      stage,
      editor,
      view,
      state: canvasState,
      selection,
      drag: shapeDrag,
      nudgeSelection,
      deleteSelection,
      commit,
      paint: () => paint(),
      refreshControls: () => {
        paintShapeControls();
        paintEdgeControls();
      },
      newId,
    });
    const textEditing = createCanvasShapeTextEditing({
      doc,
      stage,
      editor,
      state: canvasState,
      getData,
      commit,
      paint: () => paint(),
    });
    const transforms = createCanvasShapeTransforms({
      doc,
      editor,
      state: canvasState,
      coordinates,
      previewEdges,
      commit,
      paint: () => paint(),
    });
    const edgeHandles = createCanvasEdgeHandles({
      doc,
      stage,
      editor,
      state: canvasState,
      selection,
      coordinates,
      previewEdges,
      commit,
      paint: () => paint(),
    });
    const insertImageFile = (file: File, imageEpoch: number, point = { ...canvasState.lastCanvasPoint }) => {
      if (canvasState.destroyed || imageEpoch !== canvasState.documentEpoch || !editor.isEditable || !dataSupported())
        return;
      setImageStatus("");
      if (!/^(image\/png|image\/jpeg|image\/gif|image\/webp)$/.test(file.type) || file.size > maxCanvasImageBytes) {
        setImageStatus("请选择不超过 4 MB 的 PNG、JPEG、GIF 或 WebP 图片。");
        return;
      }
      const reader = new doc.defaultView!.FileReader();
      reader.onerror = () => {
        if (!canvasState.destroyed && imageEpoch === canvasState.documentEpoch) setImageStatus("图片读取失败。");
      };
      reader.onload = () => {
        if (canvasState.destroyed || imageEpoch !== canvasState.documentEpoch || !editor.isEditable) return;
        const source = reader.result;
        if (!validCanvasImage(source)) {
          setImageStatus("无法识别图片。");
          return;
        }
        const image = doc.createElement("img");
        image.onerror = () => {
          if (!canvasState.destroyed && imageEpoch === canvasState.documentEpoch) setImageStatus("无法识别图片。");
        };
        image.onload = () => {
          if (
            canvasState.destroyed ||
            imageEpoch !== canvasState.documentEpoch ||
            !editor.isEditable ||
            !dataSupported()
          )
            return;
          const scale = Math.min(
            300 / image.naturalWidth,
            200 / image.naturalHeight,
            Math.max(1, 80 / Math.max(image.naturalWidth, image.naturalHeight)),
          );
          const width = Math.max(1, image.naturalWidth * scale);
          const height = Math.max(1, image.naturalHeight * scale);
          const id = newId();
          const data = getData();
          data.shapes.push({
            id,
            shape: "image",
            x: point.x - width / 2,
            y: point.y - height / 2,
            width,
            height,
            text: file.name,
            imageSrc: source,
          });
          updateLaneMembership(data, new Set([id]));
          selectOnly(id);
          selectedEdgeIds.clear();
          selectedStrokeIds.clear();
          canvasState.selectedEdge = null;
          canvasState.tool = "select";
          if (commit(data))
            stage.querySelector<HTMLButtonElement>('.semlo-editor-canvas-shape[aria-pressed="true"]')?.focus();
        };
        image.src = source;
      };
      reader.readAsDataURL(file);
    };
    const paint = () => {
      const previousHeightHandle = dom.querySelector(".semlo-editor-canvas-height-handle");
      const restoreHeightFocus = previousHeightHandle !== null && previousHeightHandle === doc.activeElement;
      dom.querySelector(".semlo-editor-canvas-height-handle")?.remove();
      toolbar.replaceChildren();
      if (!dataSupported()) {
        stage.replaceChildren();
        const message = doc.createElement("p");
        message.textContent = "画布数据格式不受支持，暂无法编辑。";
        message.setAttribute("role", "status");
        stage.append(message);
        return;
      }
      renderCanvasToolbar({
        doc,
        toolbar,
        stage,
        viewport,
        editor,
        selectedEdgeIds,
        setImageStatus,
        insertImageFile,
        setZoom,
        applyStageWidth,
        commitViewport,
        paint,
        state: canvasState,
      });
      applyStageWidth();
      stage.style.transform = `translate(${canvasState.panX / 8}%, ${canvasState.panY / 4.4}%)`;
      viewport.classList.toggle("is-panning", canvasState.tool === "pan");
      stage.classList.toggle("is-drawing", canvasState.tool === "pen" || canvasState.tool === "eraser");
      stage.replaceChildren(background);
      const data = getData();
      selection.retain(data);
      dom.classList.toggle("is-multi-selected", selectedIds.size + selectedEdgeIds.size + selectedStrokeIds.size > 1);
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 800 440");
      svg.setAttribute("aria-label", "画布连接线");
      svg.classList.add("semlo-editor-canvas-edges");
      renderCanvasObjects({
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
      });
      paintShapeControls();
      paintEdgeControls();
      mountCanvasHeight(dom, canvasState.current.attrs.height, editor.isEditable, commitHeight);
      if (restoreHeightFocus && editor.isEditable)
        dom.querySelector<HTMLElement>(".semlo-editor-canvas-height-handle")?.focus({ preventScroll: true });
    };
    const canvasInteraction = createCanvasInteraction({
      doc,
      stage,
      background,
      viewport,
      editor,
      view,
      selectedIds,
      selectedEdgeIds,
      selectedStrokeIds,
      getData,
      coordinates,
      selectOnly,
      nudgeSelection,
      deleteSelection,
      commit,
      commitViewport,
      paint,
      newId,
      state: canvasState,
    });
    canvasInteraction.mountViewport();
    const canvasTransfer = mountCanvasTransfer({
      doc,
      stage,
      editor,
      selectedIds,
      selectedStrokeIds,
      selectedEdgeIds,
      getTool: () => canvasState.tool,
      getEpoch: () => canvasState.documentEpoch,
      getLastCanvasPoint: () => canvasState.lastCanvasPoint,
      getData,
      setSelected: (value) => {
        canvasState.selected = value;
      },
      setSelectedEdge: (value) => {
        canvasState.selectedEdge = value;
      },
      selectOnly,
      coordinates,
      insertImageFile,
      setImageStatus,
      commit,
      paint,
      newId,
    });
    canvasInteraction.mountStage();
    let editable = editor.isEditable;
    const refreshEditable = () => {
      if (editable === editor.isEditable || canvasState.destroyed) return;
      editable = editor.isEditable;
      paint();
    };
    const resetAfterDocumentReplacement = ({
      transaction,
      appendedTransactions,
    }: {
      transaction: Transaction;
      appendedTransactions: Transaction[];
    }) => {
      if (canvasState.destroyed) return;
      const transactions = [transaction, ...appendedTransactions];
      if (!transactions.some((entry) => entry.docChanged)) return;
      const outOfOrder = observedDocument !== transaction.before;
      observedDocument = view.state.doc;
      const previousNode = observedNode;
      let position = observedPosition;
      const finalPosition = getPos();
      const finalNode = typeof finalPosition === "number" ? view.state.doc.nodeAt(finalPosition) : null;
      observedNode = finalNode ?? canvasState.current;
      observedPosition = finalPosition;
      if (position === undefined) {
        transaction.before.descendants((node, offset) => {
          if (node === previousNode && position === undefined) position = offset;
        });
      }
      let replaced = false;
      let replacedNode = false;
      for (const entry of transactions)
        for (const [index, map] of entry.mapping.maps.entries()) {
          const before = entry.docs[index];
          const candidate = typeof position === "number" ? before.nodeAt(position) : null;
          map.forEach((oldStart, oldEnd, newStart) => {
            if (oldStart === 0 && oldEnd === before.content.size && newStart === 0) replaced = true;
            if (
              candidate &&
              typeof position === "number" &&
              oldStart <= position &&
              oldEnd >= position + candidate.nodeSize &&
              oldEnd > oldStart
            )
              replacedNode = true;
          });
          if (typeof position === "number") position = map.map(position, 1);
        }
      if (!outOfOrder && !replaced && !replacedNode) return;
      if (
        !outOfOrder &&
        previousNode === finalNode &&
        (!replaced || transaction.before.eq(transactions[transactions.length - 1].doc))
      )
        return;
      canvasState.documentEpoch++;
      setImageStatus("");
      selectOnly(null);
      selectedEdgeIds.clear();
      selectedStrokeIds.clear();
      canvasState.selectedEdge = null;
      canvasControls.reset();
      canvasState.connecting = null;
      canvasState.tool = "select";
      canvasState.active = false;
      canvasTransfer.reset();
      canvasState.lastCanvasPoint = { x: 400, y: 220 };
      paint();
    };
    editor.on("update", refreshEditable);
    editor.on("transaction", resetAfterDocumentReplacement);
    view.dom.addEventListener("semlo-editor:editable", refreshEditable);
    paint();
    return {
      dom,
      update(node) {
        if (node.type !== canvasState.current.type) return false;
        if (node.attrs.viewport !== canvasState.current.attrs.viewport) {
          const state = readViewport(node.attrs.viewport);
          canvasState.zoom = state.zoom;
          canvasState.panX = state.x;
          canvasState.panY = state.y;
        }
        canvasState.current = node;
        paint();
        return true;
      },
      stopEvent: () => true,
      ignoreMutation: () => true,
      destroy() {
        canvasState.destroyed = true;
        editor.off("update", refreshEditable);
        editor.off("transaction", resetAfterDocumentReplacement);
        view.dom.removeEventListener("semlo-editor:editable", refreshEditable);
        doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
        dom.removeEventListener("focusin", onFocusIn);
      },
    };
  };
}
