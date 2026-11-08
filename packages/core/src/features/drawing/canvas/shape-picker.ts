import { DOMSerializer } from "@tiptap/pm/model";

import { exportCanvas } from "./export";
import type { CanvasData } from "./model";
import { shapeCatalog, type ShapeCatalogEntry } from "./shape-catalog";
import { shapeGraphic } from "./shape-library";
import { createSmartTemplate, isSmartTemplate } from "./smart-templates";

function icon(doc: Document, entry: ShapeCatalogEntry) {
  let data: CanvasData;
  if (isSmartTemplate(entry.tool)) {
    let id = 0;
    data = {
      shapes: createSmartTemplate(entry.tool, { x: 0, y: 0 }, () => `icon-${id++}`).shapes.map((shape) => ({
        ...shape,
        text: "",
      })),
      edges: [],
    };
  } else {
    const lane = entry.tool === "swimlaneVertical" || entry.tool === "swimlaneHorizontal";
    const size = shapeGraphic(entry.tool)?.size ?? [100, 70];
    data = {
      shapes: [
        {
          id: "icon",
          shape: entry.tool,
          x: 0,
          y: 0,
          width: size[0],
          height: size[1],
          text: "",
          ...(lane ? { lanes: ["", "", ""] } : {}),
        },
      ],
      edges: [],
    };
  }
  const svg = DOMSerializer.renderSpec(doc, exportCanvas(data)).dom;
  svg.setAttribute("aria-hidden", "true");
  svg.removeAttribute("role");
  svg.removeAttribute("aria-label");
  for (const part of svg.querySelectorAll("path,rect,ellipse,circle,polygon")) {
    part.setAttribute("vector-effect", "non-scaling-stroke");
    part.setAttribute("stroke-width", "1");
  }
  return svg;
}

/** 挂载后量取实际轮廓，只收紧菜单副本，不改变正式画布的导出范围。 */
function fitThumbnails(panel: HTMLElement) {
  const thumbnails = Array.from(panel.querySelectorAll<SVGSVGElement>(".semlo-editor-canvas-shape-grid svg"));
  // 先读取再写入，避免逐个改 viewBox 时反复触发布局。
  const boxes = thumbnails.map((svg) => svg.getBBox());
  thumbnails.forEach((svg, index) => {
    const box = boxes[index];
    const size = Math.max(box.width, box.height);
    if (!size) return;
    const padding = size / 16;
    svg.setAttribute(
      "viewBox",
      `${box.x - padding} ${box.y - padding} ${box.width + padding * 2} ${box.height + padding * 2}`,
    );
  });
}

/** 分类是连续内容的滚动导航，关闭后不留下文档级监听或浮层节点。 */
export function createShapePicker({
  doc,
  toolbar,
  parent,
  enabled,
  choose,
  filter,
  constrainTo,
}: {
  doc: Document;
  toolbar: HTMLElement;
  parent: HTMLElement;
  enabled(): boolean;
  choose(entry: ShapeCatalogEntry): void;
  filter?(entry: ShapeCatalogEntry): boolean;
  constrainTo?: HTMLElement;
}) {
  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.className = "semlo-editor-canvas-more-shapes";
  trigger.setAttribute("aria-label", "更多形状");
  trigger.title = "更多形状";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.textContent = "◇+";
  trigger.disabled = !enabled();
  parent.append(trigger);
  let panel: HTMLDivElement | null = null;
  let disposed = false;
  const position = () => {
    if (!panel || !trigger.isConnected) return;
    const bounds = toolbar.getBoundingClientRect();
    const anchor = trigger.getBoundingClientRect();
    const width = doc.documentElement.clientWidth;
    const height = doc.documentElement.clientHeight;
    const limit = constrainTo?.getBoundingClientRect();
    const left = Math.max(8, (limit?.left ?? 0) + 8);
    const top = Math.max(8, (limit?.top ?? 0) + 8);
    const right = Math.min(width - 8, (limit?.right ?? width) - 8);
    const bottom = Math.min(height - 8, (limit?.bottom ?? height) - 8);
    panel.style.maxWidth = `${Math.max(0, right - left)}px`;
    panel.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    const rect = panel.getBoundingClientRect();
    const x = Math.max(left, Math.min(right - rect.width, anchor.right + 10));
    const y = Math.max(top, Math.min(bottom - rect.height, anchor.top));
    panel.style.left = `${x - bounds.left}px`;
    panel.style.top = `${y - bounds.top}px`;
  };
  const outside = (event: PointerEvent) => {
    if (
      event.target instanceof doc.defaultView!.Node &&
      !panel?.contains(event.target) &&
      !trigger.contains(event.target)
    )
      close();
  };
  const close = (restoreFocus = false) => {
    panel?.remove();
    panel = null;
    trigger.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("scroll", position, true);
    doc.defaultView?.removeEventListener("resize", position);
    if (restoreFocus && !disposed && trigger.isConnected && !trigger.disabled) trigger.focus();
  };
  const open = () => {
    if (disposed || !trigger.isConnected || !enabled()) return;
    if (panel) {
      close();
      return;
    }
    panel = doc.createElement("div");
    panel.className = "semlo-editor-canvas-shape-picker";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "图形库");
    const nav = doc.createElement("nav");
    nav.className = "semlo-editor-canvas-shape-categories";
    nav.setAttribute("aria-label", "图形分类");
    const list = doc.createElement("div");
    list.className = "semlo-editor-canvas-shape-list";
    const caption = doc.createElement("div");
    caption.className = "semlo-editor-canvas-shape-caption";
    caption.textContent = "选择图形后，在画布中点击放置";
    const tabs: HTMLButtonElement[] = [];
    const sections: HTMLElement[] = [];
    const items: HTMLButtonElement[] = [];
    const activate = (index: number) =>
      tabs.forEach((tab, current) => {
        if (current === index) tab.setAttribute("aria-current", "location");
        else tab.removeAttribute("aria-current");
      });
    const categories = shapeCatalog
      .map((category) => ({
        ...category,
        entries: filter ? category.entries.filter(filter) : category.entries,
      }))
      .filter((category) => category.entries.length);
    for (const [index, category] of categories.entries()) {
      const tab = doc.createElement("button");
      tab.type = "button";
      tab.textContent = category.label;
      tab.addEventListener("click", () => {
        list.scrollTop = sections[index].offsetTop - 5;
        activate(index);
      });
      tab.addEventListener("keydown", (event) => {
        const target =
          event.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : event.key === "ArrowLeft"
              ? (index + tabs.length - 1) % tabs.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : -1;
        if (target < 0) return;
        event.preventDefault();
        tabs[target].focus();
        tabs[target].click();
        tabs[target].scrollIntoView({ block: "nearest", inline: "nearest" });
      });
      tabs.push(tab);
      nav.append(tab);
      const section = doc.createElement("section");
      section.dataset.shapeCategory = category.id;
      section.setAttribute("aria-label", category.label);
      const heading = doc.createElement("h3");
      heading.textContent = category.label;
      const grid = doc.createElement("div");
      grid.className = "semlo-editor-canvas-shape-grid";
      for (const entry of category.entries) {
        const button = doc.createElement("button");
        button.type = "button";
        button.title = entry.label;
        button.setAttribute("aria-label", entry.label);
        button.dataset.shapeCatalogItem = entry.id;
        button.dataset.shapeTool = entry.tool;
        button.append(icon(doc, entry));
        const describe = () => {
          caption.textContent = entry.label;
        };
        button.addEventListener("focus", describe);
        button.addEventListener("mouseenter", describe);
        button.addEventListener("click", () => {
          if (disposed || !enabled() || !trigger.isConnected) return;
          close();
          choose(entry);
        });
        items.push(button);
        grid.append(button);
      }
      section.append(heading, grid);
      sections.push(section);
      list.append(section);
    }
    list.addEventListener("scroll", () => {
      let current = 0;
      for (const [index, section] of sections.entries()) if (section.offsetTop <= list.scrollTop + 8) current = index;
      activate(current);
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      const current = items.indexOf(event.target as HTMLButtonElement);
      if (current < 0) return;
      const next =
        event.key === "ArrowRight"
          ? current + 1
          : event.key === "ArrowLeft"
            ? current - 1
            : event.key === "ArrowDown"
              ? current + 6
              : event.key === "ArrowUp"
                ? current - 6
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : -1;
      if (next < 0 || !items[next]) return;
      event.preventDefault();
      event.stopPropagation();
      items[next].focus();
      items[next].scrollIntoView({ block: "nearest" });
    });
    panel.append(nav, list, caption);
    toolbar.append(panel);
    fitThumbnails(panel);
    activate(0);
    trigger.setAttribute("aria-expanded", "true");
    position();
    tabs[0].focus();
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("scroll", position, true);
    doc.defaultView?.addEventListener("resize", position);
  };
  trigger.addEventListener("click", open);
  return () => {
    disposed = true;
    close();
    trigger.removeEventListener("click", open);
  };
}
