import { edgeGeometry, endpointBox, shapeContains } from "../canvas/geometry";
import { markerOptions, type CanvasData, type CanvasEdge, type Marker } from "../canvas/model";
import { createMindmapColorControl } from "./color-picker";

const ns = "http://www.w3.org/2000/svg";

function markerPreview(doc: Document, marker: Marker | null, start: boolean): SVGSVGElement {
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 28 18");
  svg.setAttribute("aria-hidden", "true");
  const geometry = edgeGeometry(
    { x: 3, y: 9, width: 0, height: 0 },
    { x: 25, y: 9, width: 0, height: 0 },
    "straight",
    marker ?? "triangle",
    marker ?? "triangle",
  )!;
  const path = doc.createElementNS(ns, "path");
  path.setAttribute("d", geometry.path);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  svg.append(path);
  if (marker) {
    const symbol = doc.createElementNS(ns, "path");
    symbol.setAttribute("d", start ? geometry.startArrow : geometry.arrow);
    symbol.setAttribute("fill", start ? geometry.startFill : geometry.endFill);
    symbol.setAttribute("stroke", "currentColor");
    svg.append(symbol);
  }
  return svg;
}

type LineOptions = {
  doc: Document;
  root: HTMLElement;
  content: HTMLElement;
  data(): CanvasData;
  pending(): CanvasEdge | null;
  selected(): string | null;
  editable(): boolean;
  canSelect(): boolean;
  scale(): number;
  guard(): () => boolean;
  setCancel(cancel: (() => void) | null): void;
  select(id: string): void;
  clear(): void;
  commit(edges: CanvasEdge[]): boolean;
  history(redo: boolean): void;
  beginInput(finish: (save: boolean) => void): boolean;
  endInput(finish: (save: boolean) => void): void;
};

/** 连线浮层只持有当前视图和指针会话，重绘或销毁时由节点视图取消。 */
export function createMindmapLineLayer(options: LineOptions) {
  const { doc, root, content } = options;
  const svg = doc.createElementNS(ns, "svg");
  svg.classList.add("semlo-editor-mindmap-edges");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "画布连线");
  content.prepend(svg);
  let activeGesture: (() => void) | null = null;
  const focusLine = (id: string) => {
    const element = [...root.querySelectorAll<SVGElement>("[data-mindmap-line]")].find(
      (item) => item.dataset.mindmapLine === id,
    );
    element?.focus({ preventScroll: true });
  };
  const point = (event: Pick<PointerEvent, "clientX" | "clientY">) => {
    const origin = content.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - origin.left) / options.scale()) * 100) / 100,
      y: Math.round(((event.clientY - origin.top) / options.scale()) * 100) / 100,
    };
  };
  const change = (id: string, update: (edge: CanvasEdge) => void) => {
    const data = options.data();
    const edge = data.edges.find((item) => item.id === id);
    if (!edge || options.selected() !== id) return false;
    update(edge);
    if (!options.commit(data.edges)) return false;
    focusLine(id);
    return true;
  };
  const refresh = () => {
    svg.replaceChildren();
    content.querySelector(".semlo-editor-mindmap-line-toolbar")?.remove();
    const data = options.data();
    const pending = options.pending();
    const edges = pending ? [...data.edges, pending] : data.edges;
    svg.setAttribute("aria-hidden", String(edges.length === 0));
    for (const edge of edges) {
      const from = endpointBox(data, edge.from, edge.fromPoint);
      const to = endpointBox(data, edge.to, edge.toPoint);
      const geometry =
        from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
      if (!geometry) continue;
      const path = doc.createElementNS(ns, "path");
      path.classList.add("semlo-editor-mindmap-canvas-line");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", edge.color ?? "#555555");
      path.setAttribute("stroke-width", String(edge.width ?? 2));
      if (edge.dashed) path.setAttribute("stroke-dasharray", "5 4");
      const arrow = doc.createElementNS(ns, "path");
      arrow.setAttribute("stroke", edge.color ?? "#555555");
      const startArrow = doc.createElementNS(ns, "path");
      startArrow.setAttribute("stroke", edge.color ?? "#555555");
      const hit = doc.createElementNS(ns, "path");
      hit.classList.add("semlo-editor-mindmap-line-hit");
      hit.setAttribute("fill", "none");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", "16");
      hit.dataset.mindmapLine = edge.id;
      const editable = options.editable() && edge !== pending;
      if (editable) {
        hit.setAttribute("role", "button");
        hit.setAttribute("tabindex", "0");
        hit.setAttribute("aria-label", `连线${edge.text ? `：${edge.text}` : ""}`);
        hit.setAttribute("aria-pressed", String(options.selected() === edge.id));
      }
      const label = doc.createElementNS(ns, "text");
      label.classList.add("semlo-editor-mindmap-line-label");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "14");
      label.setAttribute("fill", edge.color ?? "#555555");
      label.textContent = edge.text;
      let toolbar: HTMLElement | null = null;
      let startHandle: SVGCircleElement | null = null;
      let endHandle: SVGCircleElement | null = null;
      const update = (value: CanvasEdge) => {
        const a = endpointBox(data, value.from, value.fromPoint);
        const b = endpointBox(data, value.to, value.toPoint);
        const g = a && b ? edgeGeometry(a, b, value.route, value.startMarker, value.endMarker, value.bendOffset) : null;
        if (!g) return;
        path.setAttribute("d", g.path);
        hit.setAttribute("d", g.path);
        arrow.setAttribute("d", g.arrow);
        arrow.setAttribute("fill", g.endFill === "currentColor" ? (value.color ?? "#555555") : g.endFill);
        arrow.style.display = value.arrow ? "" : "none";
        startArrow.setAttribute("d", g.startArrow);
        startArrow.setAttribute("fill", g.startFill === "currentColor" ? (value.color ?? "#555555") : g.startFill);
        startArrow.style.display = value.startArrow ? "" : "none";
        label.setAttribute("x", String(g.midX));
        label.setAttribute("y", String(g.midY - 7));
        if (startHandle) {
          startHandle.setAttribute("cx", String(g.x1));
          startHandle.setAttribute("cy", String(g.y1));
        }
        if (endHandle) {
          endHandle.setAttribute("cx", String(g.x2));
          endHandle.setAttribute("cy", String(g.y2));
        }
        if (toolbar) {
          toolbar.style.left = `${g.midX}px`;
          toolbar.style.top = `${g.midY}px`;
        }
      };
      svg.append(path, arrow, startArrow, hit, label);
      if (editable) {
        hit.addEventListener("focus", () => {
          if (options.canSelect() && options.selected() !== edge.id) {
            options.select(edge.id);
            focusLine(edge.id);
          }
        });
        hit.addEventListener("click", (event) => {
          if (!options.canSelect()) return;
          event.stopPropagation();
          options.select(edge.id);
          focusLine(edge.id);
        });
        hit.addEventListener("keydown", (event) => {
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            const next = options.data().edges.filter((item) => item.id !== edge.id);
            options.clear();
            if (options.commit(next))
              root.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
          } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            options.history(event.shiftKey);
            if (options.data().edges.some((item) => item.id === edge.id)) focusLine(edge.id);
            else root.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
          }
        });
      }
      if (editable && options.selected() === edge.id) {
        toolbar = doc.createElement("div");
        toolbar.className = "semlo-editor-mindmap-line-toolbar";
        toolbar.setAttribute("role", "toolbar");
        toolbar.setAttribute("aria-label", "连线样式");
        const positionPopup = (button: HTMLButtonElement, popup: HTMLElement) => {
          popup.style.transform = "";
          const bounds = root.getBoundingClientRect();
          const box = popup.getBoundingClientRect();
          const scale = (button.offsetWidth ? button.getBoundingClientRect().width / button.offsetWidth : 1) || 1;
          const dx =
            box.left < bounds.left ? bounds.left - box.left : box.right > bounds.right ? bounds.right - box.right : 0;
          const dy =
            box.bottom > bounds.bottom ? bounds.bottom - box.bottom : box.top < bounds.top ? bounds.top - box.top : 0;
          popup.style.transform = `translate(${dx / scale}px, ${dy / scale}px)`;
        };
        const routes = [
          ["straight", "直线", "／"],
          ["curved", "曲线", "⌒"],
          ["orthogonal", "折线", "⌁"],
        ] as const;
        const routeControl = doc.createElement("div");
        routeControl.className = "semlo-editor-mindmap-line-marker";
        const routeToggle = doc.createElement("button");
        routeToggle.type = "button";
        routeToggle.setAttribute("aria-label", "连线类型");
        routeToggle.setAttribute("aria-expanded", "false");
        routeToggle.setAttribute("aria-haspopup", "menu");
        routeToggle.title = "连线类型";
        routeToggle.textContent = routes.find(([route]) => route === (edge.route ?? "orthogonal"))?.[2] ?? "⌁";
        const routeMenu = doc.createElement("div");
        routeMenu.className = "semlo-editor-mindmap-line-marker-menu semlo-editor-mindmap-line-route-menu";
        routeMenu.setAttribute("role", "menu");
        routeMenu.setAttribute("aria-label", "选择连线类型");
        routeMenu.hidden = true;
        for (const [route, name, icon] of routes) {
          const button = doc.createElement("button");
          button.type = "button";
          button.setAttribute("role", "menuitemradio");
          button.setAttribute("aria-label", name);
          button.setAttribute("aria-checked", String((edge.route ?? "orthogonal") === route));
          button.title = name;
          button.textContent = icon;
          button.addEventListener("click", () => change(edge.id, (item) => (item.route = route)));
          routeMenu.append(button);
        }
        routeToggle.addEventListener("click", () => {
          routeMenu.hidden = !routeMenu.hidden;
          routeToggle.setAttribute("aria-expanded", String(!routeMenu.hidden));
          if (!routeMenu.hidden) positionPopup(routeToggle, routeMenu);
        });
        routeMenu.addEventListener("keydown", (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          routeMenu.hidden = true;
          routeToggle.setAttribute("aria-expanded", "false");
          routeToggle.focus();
        });
        routeControl.append(routeToggle, routeMenu);
        toolbar.append(routeControl);
        const markerControl = (start: boolean) => {
          const wrapper = doc.createElement("div");
          wrapper.className = "semlo-editor-mindmap-line-marker";
          const button = doc.createElement("button");
          button.type = "button";
          const side = start ? "起点" : "终点";
          button.setAttribute("aria-label", `${side}箭头样式`);
          button.setAttribute("aria-expanded", "false");
          button.setAttribute("aria-haspopup", "dialog");
          button.title = side;
          const active = start ? edge.startArrow : edge.arrow;
          const current = (start ? edge.startMarker : edge.endMarker) ?? "triangle";
          button.append(markerPreview(doc, active ? current : null, start));
          const popup = doc.createElement("div");
          popup.className = "semlo-editor-mindmap-line-marker-menu";
          popup.setAttribute("role", "dialog");
          popup.setAttribute("aria-label", `${side}箭头样式选择`);
          popup.hidden = true;
          const choices: Array<[Marker | null, string]> = [[null, "无箭头"], ...markerOptions];
          for (const [value, name] of choices) {
            const choice = doc.createElement("button");
            choice.type = "button";
            choice.setAttribute("aria-label", `${side}${name}`);
            choice.setAttribute("aria-pressed", String(value === null ? !active : !!active && current === value));
            choice.title = name;
            choice.append(markerPreview(doc, value, start));
            choice.addEventListener("click", () =>
              change(edge.id, (item) => {
                if (start) {
                  item.startArrow = value !== null;
                  if (value) item.startMarker = value;
                } else {
                  item.arrow = value !== null;
                  if (value) item.endMarker = value;
                }
              }),
            );
            popup.append(choice);
          }
          button.addEventListener("click", () => {
            popup.hidden = !popup.hidden;
            button.setAttribute("aria-expanded", String(!popup.hidden));
            if (popup.hidden) return;
            positionPopup(button, popup);
          });
          popup.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            popup.hidden = true;
            button.setAttribute("aria-expanded", "false");
            button.focus();
          });
          wrapper.append(button, popup);
          return wrapper;
        };
        const reverse = doc.createElement("button");
        reverse.type = "button";
        reverse.setAttribute("aria-label", "交换连线起点和终点");
        reverse.title = "转换";
        reverse.textContent = "⇄";
        reverse.addEventListener("click", () =>
          change(edge.id, (item) => {
            [item.from, item.to] = [item.to, item.from];
            [item.fromPoint, item.toPoint] = [item.toPoint, item.fromPoint];
            [item.startArrow, item.arrow] = [item.arrow, item.startArrow ?? false];
            [item.startMarker, item.endMarker] = [item.endMarker, item.startMarker];
          }),
        );
        const dashed = doc.createElement("button");
        dashed.type = "button";
        dashed.setAttribute("aria-label", "虚线");
        dashed.setAttribute("aria-pressed", String(edge.dashed));
        dashed.textContent = "┄";
        dashed.addEventListener("click", () => change(edge.id, (item) => (item.dashed = !item.dashed)));
        const width = doc.createElement("input");
        width.type = "number";
        width.min = "1";
        width.max = "10";
        width.value = String(edge.width ?? 2);
        width.setAttribute("aria-label", "连线粗细");
        width.addEventListener("change", () => {
          const value = Number(width.value);
          if (Number.isFinite(value))
            change(edge.id, (item) => (item.width = Math.max(1, Math.min(10, Math.round(value)))));
        });
        const validColor = options.guard();
        const color = createMindmapColorControl(doc, "连线颜色", edge.color ?? "#555555", (value) => {
          if (validColor()) change(edge.id, (item) => (item.color = value));
        });
        const editText = doc.createElement("button");
        editText.type = "button";
        editText.setAttribute("aria-label", "编辑连线文字");
        editText.title = "文字";
        editText.textContent = "T";
        editText.addEventListener("click", () => {
          if (!toolbar || toolbar.querySelector(".semlo-editor-mindmap-line-input")) return;
          const valid = options.guard();
          const field = doc.createElement("input");
          field.type = "text";
          field.className = "semlo-editor-mindmap-line-input";
          field.setAttribute("aria-label", "连线文字");
          field.value = edge.text;
          field.maxLength = 10000;
          let done = false;
          const finish = (save: boolean) => {
            if (done) return;
            done = true;
            options.endInput(finish);
            if (!valid()) return;
            if (save && field.value !== edge.text) {
              if (change(edge.id, (item) => (item.text = field.value))) return;
              done = false;
              if (!options.beginInput(finish)) return;
              field.setCustomValidity("无法保存文字，请重试。");
              field.reportValidity();
              field.focus({ preventScroll: true });
              return;
            }
            field.remove();
            focusLine(edge.id);
          };
          if (!options.beginInput(finish)) return;
          toolbar.append(field);
          field.addEventListener("input", () => field.setCustomValidity(""));
          field.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              finish(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              finish(false);
            }
          });
          field.addEventListener("blur", () => finish(true));
          field.focus();
          field.select();
        });
        toolbar.append(markerControl(true), reverse, markerControl(false), dashed, width, color.element, editText);
        content.append(toolbar);
        const makeHandle = (start: boolean) => {
          const handle = doc.createElementNS(ns, "circle");
          handle.classList.add("semlo-editor-mindmap-line-handle");
          handle.setAttribute("r", "5");
          handle.setAttribute("role", "button");
          handle.setAttribute("tabindex", "0");
          handle.setAttribute("aria-label", start ? "调整连线起点" : "调整连线终点");
          handle.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || activeGesture) return;
            event.preventDefault();
            event.stopPropagation();
            const valid = options.guard();
            const pointer = event.pointerId;
            const working: CanvasEdge = {
              ...edge,
              fromPoint: edge.fromPoint && { ...edge.fromPoint },
              toPoint: edge.toPoint && { ...edge.toPoint },
            };
            let active = true;
            let moved = false;
            const cleanup = () => {
              if (!active) return;
              active = false;
              handle.removeEventListener("pointermove", move);
              handle.removeEventListener("pointerup", finish);
              handle.removeEventListener("pointercancel", abort);
              handle.removeEventListener("lostpointercapture", abort);
              if (handle.hasPointerCapture?.(pointer)) handle.releasePointerCapture(pointer);
              activeGesture = null;
              options.setCancel(null);
            };
            const abort = () => {
              cleanup();
              update(edge);
            };
            const move = (next: PointerEvent) => {
              if (next.pointerId !== pointer) return;
              const position = point(next);
              if (start) {
                working.from = "";
                working.fromPoint = position;
              } else {
                working.to = "";
                working.toPoint = position;
              }
              moved = true;
              update(working);
            };
            const finish = (next: PointerEvent) => {
              if (next.pointerId !== pointer) return;
              if (moved) move(next);
              cleanup();
              if (!moved || !valid()) return;
              const position = start ? working.fromPoint! : working.toPoint!;
              const target = [...data.shapes].reverse().find((shape) => shapeContains(shape, position, 4));
              if (target && target.id !== (start ? working.to : working.from)) {
                if (start) working.from = target.id;
                else working.to = target.id;
              }
              const nextEdges = options.data().edges.map((item) => (item.id === edge.id ? working : item));
              if (options.commit(nextEdges)) focusLine(edge.id);
              else update(edge);
            };
            options.setCancel(abort);
            activeGesture = abort;
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", finish);
            handle.addEventListener("pointercancel", abort);
            handle.addEventListener("lostpointercapture", abort);
            try {
              handle.setPointerCapture(pointer);
            } catch {
              abort();
            }
          });
          handle.addEventListener("keydown", (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
              event.preventDefault();
              options.history(event.shiftKey);
              const next = root.querySelector<SVGElement>(`[aria-label="${start ? "调整连线起点" : "调整连线终点"}"]`);
              if (next) next.focus({ preventScroll: true });
              else root.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
              return;
            }
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const amount = event.shiftKey ? 10 : 1;
            const position = { x: start ? geometry.x1 : geometry.x2, y: start ? geometry.y1 : geometry.y2 };
            if (event.key === "ArrowLeft") position.x -= amount;
            else if (event.key === "ArrowRight") position.x += amount;
            else if (event.key === "ArrowUp") position.y -= amount;
            else position.y += amount;
            change(edge.id, (item) => {
              if (start) {
                item.from = "";
                item.fromPoint = position;
              } else {
                item.to = "";
                item.toPoint = position;
              }
            });
            root
              .querySelector<SVGElement>(`[aria-label="${start ? "调整连线起点" : "调整连线终点"}"]`)
              ?.focus({ preventScroll: true });
          });
          svg.append(handle);
          return handle;
        };
        startHandle = makeHandle(true);
        endHandle = makeHandle(false);
      }
      update(edge);
    }
  };
  return { svg, refresh, focusLine };
}
