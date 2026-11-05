import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { edgeGeometry, endpointBox, updateLaneMembership } from "./geometry";
import { markerOptions, type CanvasData, type CanvasEdge, type CanvasShape, type Marker } from "./model";
import type { CanvasTool } from "./state";

interface ControlsContext {
  doc: Document;
  dom: HTMLElement;
  stage: HTMLElement;
  toolbar: HTMLElement;
  editor: Editor;
  selectedIds: Set<string>;
  selectedStrokeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  getSelection(): {
    tool: CanvasTool;
    selected: string | null;
    selectedEdge: string | null;
  };
  getCurrent(): ProseMirrorNode;
  getEpoch(): number;
  isDestroyed(): boolean;
  getData(): CanvasData;
  paintGroupOutline(data: CanvasData): void;
  commit(data: CanvasData): boolean;
  newId(): string;
}

export function createCanvasControls({
  doc,
  dom,
  stage,
  toolbar,
  editor,
  selectedIds,
  selectedStrokeIds,
  selectedEdgeIds,
  getSelection,
  getCurrent,
  getEpoch,
  isDestroyed,
  getData,
  paintGroupOutline,
  commit,
  newId,
}: ControlsContext) {
  let shapeStylePanel: "fill" | "stroke" | "text" | "lanes" | null = null;
  let shapeStyleTarget: string | null = null;
  let edgeStylePanel: "line" | "start" | "end" | "text" | null = null;
  let edgeStyleTarget: string | null = null;
  const positionControls = (controls: HTMLElement) => {
    const bounds = dom.getBoundingClientRect();
    const targets = stage.querySelectorAll<HTMLElement | SVGElement>(
      '.semlo-editor-canvas-shape[aria-pressed="true"], .semlo-editor-canvas-edge-hit[aria-pressed="true"], .semlo-editor-canvas-stroke-hit[aria-pressed="true"]',
    );
    if (!targets.length) return;
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (const target of targets) {
      const box = target.getBoundingClientRect();
      left = Math.min(left, box.left);
      right = Math.max(right, box.right);
      top = Math.min(top, box.top);
      bottom = Math.max(bottom, box.bottom);
    }
    const width = controls.offsetWidth,
      height = controls.offsetHeight;
    const x = Math.max(56, Math.min(bounds.width - width - 8, (left + right) / 2 - bounds.left - width / 2));
    let y = top - bounds.top - height - 8;
    if (y < 8 || (y < 48 && x + width > bounds.width - 150)) {
      const below = bottom - bounds.top + 8;
      y = below + height <= bounds.height - 8 ? below : Math.max(8, y);
    }
    controls.style.left = `${x}px`;
    controls.style.top = `${Math.max(8, Math.min(bounds.height - height - 8, y))}px`;
  };
  const placeStylePanel = (panel: HTMLElement) => {
    panel.style.top = "";
    panel.style.bottom = "";
    panel.style.transform = "";
    const bounds = dom.getBoundingClientRect();
    panel.style.maxWidth = `${Math.max(0, bounds.width - 16)}px`;
    panel.style.maxHeight = `${Math.max(0, bounds.height - 16)}px`;
    const rect = panel.getBoundingClientRect();
    const dx = Math.min(0, bounds.right - 8 - rect.right);
    if (rect.bottom > bounds.bottom - 8) {
      panel.style.top = "auto";
      panel.style.bottom = "calc(100% + 4px)";
    }
    const positioned = panel.getBoundingClientRect();
    const dy = Math.max(0, bounds.top + 8 - positioned.top);
    if (dx || dy) panel.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const styleGroup = <K extends string>(
    controls: HTMLElement,
    key: K,
    label: string,
    icon: string,
    getOpen: () => K | null,
    setOpen: (value: K | null) => void,
  ) => {
    const wrapper = doc.createElement("div");
    wrapper.className = "semlo-editor-canvas-style-group";
    const trigger = doc.createElement("button");
    trigger.type = "button";
    trigger.textContent = icon;
    trigger.setAttribute("aria-label", label);
    trigger.title = label;
    trigger.setAttribute("aria-expanded", String(getOpen() === key));
    const panel = doc.createElement("div");
    panel.className = "semlo-editor-canvas-style-panel";
    panel.hidden = getOpen() !== key;
    trigger.addEventListener("click", () => {
      setOpen(getOpen() === key ? null : key);
      for (const sibling of controls.querySelectorAll<HTMLElement>(".semlo-editor-canvas-style-group")) {
        const active = sibling === wrapper && getOpen() === key;
        sibling.querySelector("button")?.setAttribute("aria-expanded", String(active));
        const siblingPanel = sibling.querySelector<HTMLElement>(".semlo-editor-canvas-style-panel");
        if (siblingPanel) siblingPanel.hidden = !active;
      }
      if (!panel.hidden) placeStylePanel(panel);
    });
    wrapper.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || panel.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(null);
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus();
    });
    wrapper.append(trigger, panel);
    controls.append(wrapper);
    return panel;
  };
  const paintShapeControls = () => {
    const { tool, selected } = getSelection();
    paintGroupOutline(getData());
    toolbar.querySelector(".semlo-editor-canvas-shape-controls")?.remove();
    if (tool !== "select" || selectedIds.size !== 1 || selectedEdgeIds.size || selectedStrokeIds.size) {
      shapeStyleTarget = null;
      shapeStylePanel = null;
    }
    const selectionData = getData();
    const movableEdges = selectionData.edges.filter((edge) => selectedEdgeIds.has(edge.id));
    const edgesCanAlign = movableEdges.every((edge) => !edge.from && !edge.to && edge.fromPoint && edge.toPoint);
    if (
      editor.isEditable &&
      tool === "select" &&
      selectedIds.size + selectedStrokeIds.size + selectedEdgeIds.size > 1
    ) {
      const controls = doc.createElement("div");
      controls.className = "semlo-editor-canvas-shape-controls";
      const data = getData();
      const selectedGroup = data.groups?.find(
        (group) =>
          group.members.length === selectedIds.size &&
          group.members.every((id) => selectedIds.has(id)) &&
          (group.strokes?.length ?? 0) === selectedStrokeIds.size &&
          (group.strokes ?? []).every((id) => selectedStrokeIds.has(id)) &&
          (group.edges?.length ?? 0) === selectedEdgeIds.size &&
          (group.edges ?? []).every((id) => selectedEdgeIds.has(id)),
      );
      if (selectedGroup) {
        const ungroup = doc.createElement("button");
        ungroup.type = "button";
        ungroup.textContent = "取消编组";
        ungroup.addEventListener("click", () => {
          const next = getData();
          next.groups = [
            ...(next.groups ?? []).filter((group) => group.id !== selectedGroup.id),
            ...(selectedGroup.children ?? []),
          ];
          commit(next);
        });
        controls.append(ungroup);
        toolbar.append(controls);
        positionControls(controls);
        return;
      }
      if (edgesCanAlign)
        for (const [mode, name] of [
          ["left", "左对齐"],
          ["center", "水平居中"],
          ["right", "右对齐"],
          ["top", "顶端对齐"],
          ["middle", "垂直居中"],
          ["bottom", "底端对齐"],
        ] as const) {
          const button = doc.createElement("button");
          button.type = "button";
          button.textContent = name;
          button.addEventListener("click", () => {
            const data = getData();
            const parts = data.shapes
              .filter((shape) => selectedIds.has(shape.id))
              .map((shape) => {
                const angle = ((shape.rotation ?? 0) * Math.PI) / 180;
                const width = Math.abs(Math.cos(angle)) * shape.width + Math.abs(Math.sin(angle)) * shape.height;
                const height = Math.abs(Math.sin(angle)) * shape.width + Math.abs(Math.cos(angle)) * shape.height;
                return {
                  key: `shape:${shape.id}`,
                  left: shape.x + (shape.width - width) / 2,
                  top: shape.y + (shape.height - height) / 2,
                  width,
                  height,
                  move: (dx: number, dy: number) => {
                    shape.x += dx;
                    shape.y += dy;
                    if (shape.lanes) {
                      for (const member of data.shapes)
                        if (member.parentLane === shape.id && !selectedIds.has(member.id)) {
                          member.x += dx;
                          member.y += dy;
                        }
                      for (const stroke of data.strokes ?? [])
                        if (stroke.parentLane === shape.id && !selectedStrokeIds.has(stroke.id))
                          stroke.points = stroke.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
                      for (const edge of data.edges)
                        if (edge.parentLane === shape.id && !selectedEdgeIds.has(edge.id)) {
                          if (edge.fromPoint) edge.fromPoint = { x: edge.fromPoint.x + dx, y: edge.fromPoint.y + dy };
                          if (edge.toPoint) edge.toPoint = { x: edge.toPoint.x + dx, y: edge.toPoint.y + dy };
                        }
                    }
                  },
                };
              });
            for (const stroke of data.strokes ?? []) {
              if (!selectedStrokeIds.has(stroke.id)) continue;
              const xs = stroke.points.map((point) => point.x),
                ys = stroke.points.map((point) => point.y);
              const padding = (stroke.width ?? 3) / 2;
              const left = Math.min(...xs) - padding,
                right = Math.max(...xs) + padding;
              const top = Math.min(...ys) - padding,
                bottom = Math.max(...ys) + padding;
              parts.push({
                key: `stroke:${stroke.id}`,
                left,
                top,
                width: right - left,
                height: bottom - top,
                move: (dx, dy) => {
                  stroke.points = stroke.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
                },
              });
            }
            for (const edge of data.edges) {
              if (!selectedEdgeIds.has(edge.id) || !edge.fromPoint || !edge.toPoint) continue;
              const from = endpointBox(data, edge.from, edge.fromPoint),
                to = endpointBox(data, edge.to, edge.toPoint);
              const geometry =
                from && to
                  ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset)
                  : null;
              if (!geometry) continue;
              const padding = Math.max((edge.width ?? 2) / 2, edge.arrow || edge.startArrow ? 10 : 1);
              const left = Math.min(geometry.x1, geometry.x2, geometry.midX) - padding;
              const right = Math.max(geometry.x1, geometry.x2, geometry.midX) + padding;
              const top = Math.min(geometry.y1, geometry.y2, geometry.midY) - padding;
              const bottom = Math.max(geometry.y1, geometry.y2, geometry.midY) + padding;
              parts.push({
                key: `edge:${edge.id}`,
                left,
                top,
                width: right - left,
                height: bottom - top,
                move: (dx, dy) => {
                  edge.fromPoint = { x: edge.fromPoint!.x + dx, y: edge.fromPoint!.y + dy };
                  edge.toPoint = { x: edge.toPoint!.x + dx, y: edge.toPoint!.y + dy };
                },
              });
            }
            const grouped = new Set<string>();
            const items: typeof parts = [];
            for (const group of data.groups ?? []) {
              const keys = [
                ...group.members.map((id) => `shape:${id}`),
                ...(group.strokes ?? []).map((id) => `stroke:${id}`),
                ...(group.edges ?? []).map((id) => `edge:${id}`),
              ];
              const members = parts.filter((part) => keys.includes(part.key));
              if (members.length !== keys.length) continue;
              for (const key of keys) grouped.add(key);
              const left = Math.min(...members.map((part) => part.left)),
                top = Math.min(...members.map((part) => part.top));
              const right = Math.max(...members.map((part) => part.left + part.width)),
                bottom = Math.max(...members.map((part) => part.top + part.height));
              items.push({
                key: `group:${group.id}`,
                left,
                top,
                width: right - left,
                height: bottom - top,
                move: (dx, dy) => members.forEach((part) => part.move(dx, dy)),
              });
            }
            items.push(...parts.filter((part) => !grouped.has(part.key)));
            if (items.length < 2) return;
            const left = Math.min(...items.map((item) => item.left)),
              right = Math.max(...items.map((item) => item.left + item.width));
            const top = Math.min(...items.map((item) => item.top)),
              bottom = Math.max(...items.map((item) => item.top + item.height));
            let changed = false;
            for (const item of items) {
              let dx = 0,
                dy = 0;
              if (mode === "left") dx = left - item.left;
              if (mode === "center") dx = (left + right - item.width) / 2 - item.left;
              if (mode === "right") dx = right - item.left - item.width;
              if (mode === "top") dy = top - item.top;
              if (mode === "middle") dy = (top + bottom - item.height) / 2 - item.top;
              if (mode === "bottom") dy = bottom - item.top - item.height;
              if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
                item.move(dx, dy);
                changed = true;
              }
            }
            if (changed) {
              updateLaneMembership(data, selectedIds, selectedStrokeIds, selectedEdgeIds);
              commit(data);
            }
          });
          controls.append(button);
        }
      {
        const group = doc.createElement("button");
        group.type = "button";
        group.textContent = "编组";
        group.addEventListener("click", () => {
          const next = getData();
          const children = (next.groups ?? []).filter(
            (entry) =>
              entry.members.some((id) => selectedIds.has(id)) ||
              (entry.strokes ?? []).some((id) => selectedStrokeIds.has(id)) ||
              (entry.edges ?? []).some((id) => selectedEdgeIds.has(id)),
          );
          next.groups = (next.groups ?? []).filter((entry) => !children.includes(entry));
          next.groups.push({
            id: newId(),
            members: Array.from(selectedIds),
            ...(selectedStrokeIds.size ? { strokes: Array.from(selectedStrokeIds) } : {}),
            ...(selectedEdgeIds.size ? { edges: Array.from(selectedEdgeIds) } : {}),
            ...(children.length ? { children } : {}),
          });
          commit(next);
        });
        controls.append(group);
      }
      toolbar.append(controls);
      positionControls(controls);
      return;
    }
    if (
      !editor.isEditable ||
      tool !== "select" ||
      !selected ||
      selectedIds.size !== 1 ||
      selectedEdgeIds.size ||
      selectedStrokeIds.size
    )
      return;
    const item = getData().shapes.find((shape) => shape.id === selected);
    if (!item || item.shape === "image") return;
    const controlNode = getCurrent();
    const controlEpoch = getEpoch();
    const controls = doc.createElement("div");
    controls.className = "semlo-editor-canvas-shape-controls";
    if (shapeStyleTarget !== selected) {
      shapeStyleTarget = selected;
      shapeStylePanel = null;
    }
    const shapeGroup = (key: "fill" | "stroke" | "text" | "lanes", label: string, icon: string) =>
      styleGroup(
        controls,
        key,
        label,
        icon,
        () => shapeStylePanel,
        (value) => {
          shapeStylePanel = value;
        },
      );
    const fillPanel = item.shape !== "text" && item.shape !== "actor" ? shapeGroup("fill", "填充", "◯") : null;
    const strokePanel = item.shape !== "text" ? shapeGroup("stroke", "描边", "◎") : null;
    const textPanel = shapeGroup("text", "文字样式", "T");
    textPanel.classList.add("semlo-editor-canvas-text-style-panel");
    const setStyle = (patch: Partial<CanvasShape>) => {
      if (isDestroyed() || getEpoch() !== controlEpoch || !getCurrent().eq(controlNode)) return;
      const data = getData();
      const shape = data.shapes.find((entry) => entry.id === item.id);
      if (!shape) return;
      Object.assign(shape, patch);
      commit(data);
    };
    if (item.lanes) {
      const count = doc.createElement("input");
      count.type = "number";
      count.min = "1";
      count.max = "50";
      count.value = String(item.lanes.length);
      count.setAttribute("aria-label", "泳道数量");
      count.addEventListener("change", () => {
        const length = Math.max(1, Math.min(50, Math.round(Number(count.value))));
        if (!Number.isFinite(length)) return;
        const lanes = item.lanes!.slice(0, length);
        while (lanes.length < length) lanes.push(`Lane ${lanes.length + 1}`);
        const scale = length / item.lanes!.length;
        setStyle({
          lanes,
          ...(item.shape === "swimlaneVertical" ? { width: item.width * scale } : { height: item.height * scale }),
        });
      });
      controls.prepend(count);
      const laneTitles = shapeGroup("lanes", "泳道标题", "≡");
      laneTitles.classList.add("semlo-editor-canvas-lane-title-panel");
      item.lanes.forEach((label, index) => {
        const field = doc.createElement("input");
        field.type = "text";
        field.value = label;
        field.setAttribute("aria-label", `泳道 ${index + 1} 名称`);
        field.addEventListener("change", () => {
          const next = item.lanes!.slice();
          next[index] = field.value;
          setStyle({ lanes: next });
        });
        field.addEventListener("keydown", (event) => {
          if (event.isComposing) {
            event.stopPropagation();
            return;
          }
          if (event.key === "Escape") {
            field.value = label;
            return;
          }
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            field.blur();
          }
        });
        laneTitles.append(field);
      });
    }
    if (item.shape !== "text" && item.shape !== "actor") {
      const swatches = doc.createElement("div");
      swatches.className = "semlo-editor-canvas-color-swatches";
      for (const color of [
        "#262626",
        "#ffffff",
        "#a287e1",
        "#6f81db",
        "#6ec4c4",
        "#dfb85d",
        "#77c386",
        "#e48484",
        "#e482d4",
        "#69b1e4",
      ]) {
        const swatch = doc.createElement("button");
        swatch.type = "button";
        swatch.className = "semlo-editor-canvas-color-swatch";
        swatch.style.backgroundColor = color;
        swatch.setAttribute("aria-label", `填充颜色 ${color}`);
        swatch.setAttribute(
          "aria-pressed",
          String((item.fill ?? (item.lanes ? "transparent" : "#ffffff")).toLowerCase() === color),
        );
        swatch.addEventListener("click", () => setStyle({ fill: color }));
        swatches.append(swatch);
      }
      const fill = doc.createElement("input");
      fill.type = "color";
      fill.value = item.fill && item.fill !== "transparent" ? item.fill : "#ffffff";
      fill.setAttribute("aria-label", "图形填充颜色");
      fill.addEventListener("change", () => setStyle({ fill: fill.value }));
      const clear = doc.createElement("button");
      clear.type = "button";
      clear.textContent = "∅";
      clear.setAttribute("aria-label", "无填充");
      clear.title = "无填充";
      clear.addEventListener("click", () => setStyle({ fill: "transparent" }));
      fillPanel?.append(swatches, fill, clear);
    }
    if (item.shape !== "text") {
      const stroke = doc.createElement("input");
      stroke.type = "color";
      stroke.value = item.stroke ?? "#555555";
      stroke.setAttribute("aria-label", "图形边框颜色");
      stroke.addEventListener("change", () => setStyle({ stroke: stroke.value }));
      const strokeWidth = doc.createElement("input");
      strokeWidth.type = "number";
      strokeWidth.min = "1";
      strokeWidth.max = "10";
      strokeWidth.step = "1";
      strokeWidth.value = String(item.strokeWidth ?? 2);
      strokeWidth.setAttribute("aria-label", "图形描边粗细");
      strokeWidth.addEventListener("change", () => {
        const value = Number(strokeWidth.value);
        if (Number.isFinite(value)) setStyle({ strokeWidth: Math.max(1, Math.min(10, Math.round(value))) });
      });
      const dashed = doc.createElement("button");
      dashed.type = "button";
      dashed.textContent = "┄";
      dashed.setAttribute("aria-label", "虚线描边");
      dashed.title = "虚线描边";
      dashed.setAttribute("aria-pressed", String(item.strokeDashed === true));
      dashed.addEventListener("click", () => setStyle({ strokeDashed: !item.strokeDashed }));
      strokePanel?.append(stroke, strokeWidth, dashed);
    }
    const textColor = doc.createElement("input");
    textColor.type = "color";
    textColor.value = item.textColor ?? (item.shape === "text" ? item.stroke : undefined) ?? "#222222";
    textColor.setAttribute("aria-label", "文字颜色");
    textColor.addEventListener("change", () => setStyle({ textColor: textColor.value }));
    const size = doc.createElement("select");
    size.setAttribute("aria-label", "文字字号");
    for (const value of [12, 14, 15, 16, 18, 22, 24, 32, 36, 48, 64, 92]) {
      const option = doc.createElement("option");
      option.value = String(value);
      option.textContent = `${value}px`;
      option.selected = value === (item.fontSize ?? 14);
      size.append(option);
    }
    size.addEventListener("change", () => setStyle({ fontSize: Number(size.value) }));
    const bold = doc.createElement("button");
    bold.type = "button";
    bold.textContent = "B";
    bold.setAttribute("aria-label", "加粗");
    bold.title = "加粗";
    const isBold = item.lanes ? item.bold !== false : item.bold === true;
    bold.setAttribute("aria-pressed", String(isBold));
    bold.addEventListener("click", () => setStyle({ bold: !isBold }));
    const textToggle = (key: "italic" | "underline" | "strike", label: string, glyph: string) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = glyph;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.setAttribute("aria-pressed", String(item[key] === true));
      button.addEventListener("click", () => setStyle({ [key]: !item[key] }));
      return button;
    };
    const align = doc.createElement("select");
    align.setAttribute("aria-label", "文字对齐");
    for (const [value, label] of [
      ["left", "左对齐"],
      ["center", "居中对齐"],
      ["right", "右对齐"],
      ["justify", "两端对齐"],
    ] as const) {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === (item.textAlign ?? "center");
      align.append(option);
    }
    align.addEventListener("change", () => setStyle({ textAlign: align.value as CanvasShape["textAlign"] }));
    const verticalAlign = doc.createElement("select");
    verticalAlign.setAttribute("aria-label", "文字竖直对齐");
    for (const [value, label] of [
      ["top", "顶部对齐"],
      ["middle", "垂直居中"],
      ["bottom", "底部对齐"],
    ] as const) {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === (item.verticalAlign ?? "middle");
      verticalAlign.append(option);
    }
    verticalAlign.addEventListener("change", () =>
      setStyle({ verticalAlign: verticalAlign.value as CanvasShape["verticalAlign"] }),
    );
    textPanel.append(
      bold,
      textToggle("italic", "斜体", "I"),
      textToggle("strike", "删除线", "S"),
      textToggle("underline", "下划线", "U"),
      size,
      textColor,
      ...(!item.lanes ? [align] : []),
    );
    if (item.shape !== "actor" && !item.lanes) textPanel.append(verticalAlign);
    toolbar.append(controls);
    positionControls(controls);
    const openPanel = controls.querySelector<HTMLElement>(".semlo-editor-canvas-style-panel:not([hidden])");
    if (openPanel) placeStylePanel(openPanel);
  };
  const paintEdgeControls = () => {
    const { tool, selectedEdge } = getSelection();
    toolbar.querySelector(".semlo-editor-canvas-edge-controls")?.remove();
    if (tool !== "select" || selectedEdgeIds.size !== 1 || selectedIds.size || selectedStrokeIds.size) {
      edgeStyleTarget = null;
      edgeStylePanel = null;
    }
    if (
      !editor.isEditable ||
      tool !== "select" ||
      !selectedEdge ||
      selectedEdgeIds.size !== 1 ||
      selectedIds.size ||
      selectedStrokeIds.size
    )
      return;
    const edge = getData().edges.find((entry) => entry.id === selectedEdge);
    if (!edge) return;
    const controlNode = getCurrent();
    const controlEpoch = getEpoch();
    const controls = doc.createElement("div");
    controls.className = "semlo-editor-canvas-edge-controls";
    if (edgeStyleTarget !== selectedEdge) {
      edgeStyleTarget = selectedEdge;
      edgeStylePanel = null;
    }
    const edgeGroup = (key: "line" | "start" | "end" | "text", label: string, icon: string) =>
      styleGroup(
        controls,
        key,
        label,
        icon,
        () => edgeStylePanel,
        (value) => {
          edgeStylePanel = value;
        },
      );
    const linePanel = edgeGroup("line", "线条样式", "⌁");
    const startPanel = edgeGroup("start", "起点", "←");
    const endPanel = edgeGroup("end", "终点", "→");
    const textPanel = edgeGroup("text", "连线标签", "T");
    const setEdgeStyle = (patch: Partial<CanvasEdge>) => {
      if (isDestroyed() || getEpoch() !== controlEpoch || !getCurrent().eq(controlNode)) return;
      const data = getData();
      const target = data.edges.find((entry) => entry.id === edge.id);
      if (!target) return;
      Object.assign(target, patch);
      commit(data);
    };
    const route = doc.createElement("select");
    route.setAttribute("aria-label", "连线路径");
    for (const [value, text] of [
      ["straight", "直线"],
      ["curved", "曲线"],
      ["orthogonal", "折线"],
    ] as const) {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = text;
      option.selected = value === (edge.route ?? "orthogonal");
      route.append(option);
    }
    route.addEventListener("change", () => setEdgeStyle({ route: route.value as CanvasEdge["route"] }));
    const color = doc.createElement("input");
    color.type = "color";
    color.value = edge.color ?? "#555555";
    color.setAttribute("aria-label", "连线颜色");
    color.addEventListener("change", () => setEdgeStyle({ color: color.value }));
    const width = doc.createElement("input");
    width.type = "number";
    width.min = "1";
    width.max = "10";
    width.step = "1";
    width.value = String(edge.width ?? 2);
    width.setAttribute("aria-label", "连线粗细");
    width.addEventListener("change", () => {
      const value = Number(width.value);
      if (Number.isFinite(value)) setEdgeStyle({ width: Math.max(1, Math.min(10, Math.round(value))) });
    });
    const markerSelect = (side: "start" | "end") => {
      const select = doc.createElement("select");
      select.setAttribute("aria-label", side === "start" ? "起点样式" : "终点样式");
      for (const [value, name] of markerOptions) {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = name;
        option.selected = value === ((side === "start" ? edge.startMarker : edge.endMarker) ?? "triangle");
        select.append(option);
      }
      select.addEventListener("change", () =>
        setEdgeStyle(
          side === "start"
            ? { startArrow: true, startMarker: select.value as Marker }
            : { arrow: true, endMarker: select.value as Marker },
        ),
      );
      return select;
    };
    const toggle = (name: string, key: "dashed" | "arrow" | "startArrow") => {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.setAttribute("aria-pressed", String(edge[key] === true));
      button.addEventListener("click", () => {
        if (isDestroyed() || getEpoch() !== controlEpoch || !getCurrent().eq(controlNode)) return;
        const data = getData();
        const target = data.edges.find((entry) => entry.id === edge.id);
        if (!target) return;
        target[key] = !target[key];
        commit(data);
      });
      return button;
    };
    const label = doc.createElement("input");
    label.type = "text";
    label.value = edge.text;
    label.setAttribute("aria-label", "连线文字");
    label.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        label.blur();
      }
    });
    label.addEventListener("change", () => {
      if (isDestroyed() || getEpoch() !== controlEpoch || !getCurrent().eq(controlNode)) return;
      const data = getData();
      const target = data.edges.find((entry) => entry.id === edge.id);
      if (!target || target.text === label.value) return;
      target.text = label.value;
      commit(data);
    });
    linePanel.append(route, color, width, toggle("虚线", "dashed"));
    startPanel.append(toggle("起点箭头", "startArrow"), markerSelect("start"));
    endPanel.append(toggle("箭头", "arrow"), markerSelect("end"));
    textPanel.append(label);
    toolbar.append(controls);
    positionControls(controls);
    const openPanel = controls.querySelector<HTMLElement>(".semlo-editor-canvas-style-panel:not([hidden])");
    if (openPanel) placeStylePanel(openPanel);
  };
  return {
    paintShapeControls,
    paintEdgeControls,
    reset() {
      shapeStylePanel = null;
      shapeStyleTarget = null;
      edgeStylePanel = null;
      edgeStyleTarget = null;
    },
  };
}
