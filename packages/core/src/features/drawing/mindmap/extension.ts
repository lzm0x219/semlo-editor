import { Node } from "@tiptap/core";
import { closeHistory, redo, undo } from "@tiptap/pm/history";
import { DOMSerializer, type DOMOutputSpec } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import { normalizeLinkURL } from "../../references/link-command";
import { exportCanvas } from "../canvas/export";
import { edgeGeometry, endpointBox, shapeContains } from "../canvas/geometry";
import { CANVAS_DEFAULT_HEIGHT, canvasHeight, mountCanvasHeight } from "../canvas/height";
import type { CanvasData, CanvasEdge, CanvasGroup, CanvasShape, Shape } from "../canvas/model";
import { presentationPayload, readPresentationHeight, supportedCanvasHeight } from "../canvas/presentation";
import { shapeCatalog } from "../canvas/shape-catalog";
import { shapeGraphic } from "../canvas/shape-library";
import { createShapePicker } from "../canvas/shape-picker";
import { createSmartTemplate, isSmartTemplate, type SmartTemplate } from "../canvas/smart-templates";
import { createMindmapLineLayer } from "./canvas-lines";
import { exportMindmapCanvasShapes, readMindmapCanvasData, readMindmapCanvasShapes } from "./canvas-shapes";
import { exportMindmapCanvasText, readMindmapCanvasText, type MindmapCanvasText } from "./canvas-text";
import { createMindmapColorControl } from "./color-picker";
import {
  exportMindmapStrokes,
  maxMindmapStrokePoints,
  readMindmapStrokes,
  strokeHit,
  strokePath,
  type MindmapPoint,
  type MindmapStroke,
} from "./freehand";
import {
  mindmapNodePrefix,
  mindmapNodeReference,
  mindmapPendingNodePrefix,
  mindmapPendingNodeReference,
} from "./node-reference";
import { changeItemText, itemLinks, replaceItemText, textBoundary, type MindmapLink } from "./text-links";

export interface MindmapItem {
  text: string;
  children: MindmapItem[];
  nodeId?: string;
  summary?: MindmapItem;
  summarySpan?: number;
  collapsed?: boolean;
  style?: MindmapTextStyle;
  branch?: MindmapBranchStyle;
  branchType?: MindmapBranchType;
  subtreeLayout?: MindmapSubtreeLayout;
  appearance?: MindmapAppearance;
  markers?: MindmapMarkers;
  href?: string;
  links?: MindmapLink[];
}
interface MindmapTextStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  size?: number;
  color?: string;
  align?: "left" | "center" | "right" | "justify";
}
interface MindmapBranchStyle {
  color?: string;
  width?: number;
}
type MindmapBranchType = "curve" | "elbow";
interface MindmapAppearance {
  shape?: "line" | "rectangle" | "round";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}
interface MindmapMarkers {
  priority?: number;
  progress?: number;
  flag?: number;
}
type MindmapMarkerKind = keyof MindmapMarkers;
const markerNames: Record<MindmapMarkerKind, string> = { priority: "优先级", progress: "进度", flag: "旗帜" };
const markerColors: Record<MindmapMarkerKind, string[]> = {
  priority: ["#dc6576", "#e89a5e", "#e6c04e", "#a5abaa", "#a5abaa", "#a5abaa", "#a5abaa"],
  progress: ["#a5abaa", "#65c990", "#65c990", "#65c990", "#65c990", "#65c990", "#65c990"],
  flag: ["#dc6576", "#e89a5e", "#e6c04e", "#65c990", "#6fa5e6", "#9b73db", "#a5abaa"],
};
function markerGlyph(kind: MindmapMarkerKind, value: number) {
  return kind === "priority"
    ? String(value + 1)
    : kind === "progress"
      ? value === 0
        ? "◷"
        : value === 6
          ? "✓"
          : ""
      : "⚑";
}
function markerBackground(kind: MindmapMarkerKind, value: number) {
  return kind === "progress" && value > 0 && value < 6
    ? `conic-gradient(#65c990 ${value * 60}deg, #d7f1e2 0)`
    : markerColors[kind][value];
}
function markerLabel(kind: MindmapMarkerKind, value: number) {
  return kind === "priority"
    ? `优先级 ${value + 1}`
    : kind === "progress"
      ? `进度 ${[0, 17, 33, 50, 67, 83, 100][value]}%`
      : `旗帜 ${value + 1}`;
}
function itemMarkers(item: MindmapItem): Array<{ kind: MindmapMarkerKind; value: number }> {
  return (["priority", "progress", "flag"] as const).flatMap((kind) =>
    item.markers?.[kind] === undefined ? [] : [{ kind, value: item.markers[kind]! }],
  );
}
const mindmapFontSizes = [12, 14, 15, 16, 18, 22, 24, 32, 36, 48, 64, 92] as const;
type TreeLayout = "tree-down-right" | "tree-down-left" | "tree-up-right" | "tree-up-left";
type TimelineLayout = "timeline-right" | "timeline-left";
type MindmapLayout = "right" | "left" | "balanced" | "up" | "down" | TreeLayout | TimelineLayout;
type MindmapSubtreeLayout = "branch" | "tree-down" | "tree-up" | "timeline";
type BranchSide = "right" | "left";

function supportedLayout(value: unknown): value is MindmapLayout | null {
  return (
    value == null ||
    [
      "right",
      "left",
      "balanced",
      "up",
      "down",
      "tree-down-right",
      "tree-down-left",
      "tree-up-right",
      "tree-up-left",
      "timeline-right",
      "timeline-left",
    ].includes(value as string)
  );
}
function isTreeLayout(value: MindmapLayout): value is TreeLayout {
  return value.startsWith("tree-");
}
function isTimelineLayout(value: MindmapLayout): value is TimelineLayout {
  return value.startsWith("timeline-");
}

function balancedSplit(children: MindmapItem[]): number {
  let split = Math.ceil(children.length / 2);
  for (let first = 0; first < children.length; first++) {
    const end = first + (children[first].summarySpan ?? 1);
    if (first < split && end > split) {
      // 增删节点后仍让一个共同概要覆盖的分支位于同侧。
      split = first === 0 ? end : end === children.length ? first : split - first < end - split ? first : end;
      break;
    }
  }
  return split;
}
function branchSide(layout: MindmapLayout, index: number, children: MindmapItem[], split?: number): BranchSide {
  return layout === "left" || (layout === "balanced" && index >= (split ?? balancedSplit(children))) ? "left" : "right";
}
function resolveSubtreeLayout(item: MindmapItem, inherited: MindmapLayout, side: BranchSide): MindmapLayout {
  switch (item.subtreeLayout) {
    case "branch":
      return side;
    case "tree-down":
      return side === "left" ? "tree-down-left" : "tree-down-right";
    case "tree-up":
      return side === "left" ? "tree-up-left" : "tree-up-right";
    case "timeline":
      return side === "left" ? "timeline-left" : "timeline-right";
    default:
      return inherited;
  }
}
export const defaultMindmapLabels = ["思维导图", "新建节点", "新建节点", "新建节点"] as const;
const defaultTree = (): MindmapItem => ({
  text: defaultMindmapLabels[0],
  children: defaultMindmapLabels.slice(1).map((text) => ({ text, children: [] })),
});
/** Freeze the initial tree at insertion to keep saved documents stable across versions. */
export function createMindmapContent() {
  return { type: "semloEditorMindmap", attrs: { tree: defaultTree() } };
}
function treeFrom(value: unknown, labels?: unknown, onInvalid: () => void = () => {}): MindmapItem {
  let count = 0;
  const nodeIds = new Set<string>();
  const visit = (item: unknown, depth: number): MindmapItem | null => {
    if (!item || typeof item !== "object" || depth > 64 || ++count > 5000) return null;
    const candidate = item as Record<string, unknown>;
    const style = candidate.style;
    if (
      Object.keys(candidate).some(
        (key) =>
          ![
            "text",
            "children",
            "nodeId",
            "summary",
            "summarySpan",
            "collapsed",
            "style",
            "branch",
            "branchType",
            "subtreeLayout",
            "appearance",
            "markers",
            "href",
            "links",
          ].includes(key),
      ) ||
      (candidate.collapsed !== undefined && typeof candidate.collapsed !== "boolean") ||
      (candidate.nodeId !== undefined &&
        (typeof candidate.nodeId !== "string" ||
          !/^[a-zA-Z0-9_-]{1,64}$/.test(candidate.nodeId) ||
          nodeIds.has(candidate.nodeId))) ||
      (candidate.branchType !== undefined &&
        (depth !== 0 || (candidate.branchType !== "curve" && candidate.branchType !== "elbow"))) ||
      (candidate.subtreeLayout !== undefined &&
        (depth === 0 || !["branch", "tree-down", "tree-up", "timeline"].includes(candidate.subtreeLayout as string))) ||
      (candidate.href !== undefined &&
        (typeof candidate.href !== "string" || normalizeLinkURL(candidate.href) !== candidate.href)) ||
      typeof candidate.text !== "string" ||
      !Array.isArray(candidate.children)
    )
      return null;
    if (typeof candidate.nodeId === "string") nodeIds.add(candidate.nodeId);
    if (candidate.branch !== undefined) {
      if (!candidate.branch || typeof candidate.branch !== "object" || Array.isArray(candidate.branch) || depth === 0)
        return null;
      const branch = candidate.branch as Record<string, unknown>;
      if (
        Object.keys(branch).some((key) => !["color", "width"].includes(key)) ||
        (branch.color !== undefined && (typeof branch.color !== "string" || !/^#[\da-f]{6}$/i.test(branch.color))) ||
        (branch.width !== undefined &&
          (!Number.isInteger(branch.width) || (branch.width as number) < 1 || (branch.width as number) > 5))
      )
        return null;
    }
    if (candidate.markers !== undefined) {
      if (!candidate.markers || typeof candidate.markers !== "object" || Array.isArray(candidate.markers)) return null;
      const markers = candidate.markers as Record<string, unknown>;
      if (
        Object.keys(markers).some((key) => !["priority", "progress", "flag"].includes(key)) ||
        Object.values(markers).some(
          (value) => !Number.isInteger(value) || (value as number) < 0 || (value as number) > 6,
        )
      )
        return null;
    }
    if (candidate.appearance !== undefined) {
      if (!candidate.appearance || typeof candidate.appearance !== "object" || Array.isArray(candidate.appearance))
        return null;
      const appearance = candidate.appearance as Record<string, unknown>;
      const validColor = (value: unknown) =>
        value === "transparent" || (typeof value === "string" && /^#[\da-f]{6}$/i.test(value));
      if (
        Object.keys(appearance).some((key) => !["shape", "fill", "stroke", "strokeWidth"].includes(key)) ||
        (appearance.shape !== undefined && !["line", "rectangle", "round"].includes(appearance.shape as string)) ||
        (appearance.fill !== undefined && !validColor(appearance.fill)) ||
        (appearance.stroke !== undefined && !validColor(appearance.stroke)) ||
        (appearance.strokeWidth !== undefined &&
          (!Number.isInteger(appearance.strokeWidth) ||
            (appearance.strokeWidth as number) < 1 ||
            (appearance.strokeWidth as number) > 5))
      )
        return null;
    }
    if (candidate.href !== undefined && candidate.text.length === 0) return null;
    if (candidate.links !== undefined) {
      if (candidate.href !== undefined || !Array.isArray(candidate.links) || candidate.links.length > 1024) return null;
      let previous = 0;
      for (const link of candidate.links) {
        if (
          !link ||
          typeof link !== "object" ||
          Array.isArray(link) ||
          Object.keys(link).some((key) => !["from", "to", "href"].includes(key))
        )
          return null;
        const entry = link as Record<string, unknown>;
        if (
          !Number.isSafeInteger(entry.from) ||
          !Number.isSafeInteger(entry.to) ||
          (entry.from as number) < previous ||
          (entry.to as number) <= (entry.from as number) ||
          (entry.to as number) > candidate.text.length ||
          !textBoundary(candidate.text, entry.from as number) ||
          !textBoundary(candidate.text, entry.to as number) ||
          typeof entry.href !== "string" ||
          normalizeLinkURL(entry.href) !== entry.href
        )
          return null;
        previous = entry.to as number;
      }
    }
    if (style !== undefined) {
      if (!style || typeof style !== "object" || Array.isArray(style)) return null;
      const options = style as Record<string, unknown>;
      if (
        Object.keys(options).some(
          (key) => !["bold", "italic", "strike", "underline", "size", "color", "align"].includes(key),
        ) ||
        ["bold", "italic", "strike", "underline"].some(
          (key) => options[key] !== undefined && typeof options[key] !== "boolean",
        ) ||
        (options.size !== undefined && !mindmapFontSizes.some((size) => size === options.size)) ||
        (options.color !== undefined && (typeof options.color !== "string" || !/^#[\da-f]{6}$/i.test(options.color))) ||
        (options.align !== undefined &&
          (typeof options.align !== "string" || !["left", "center", "right", "justify"].includes(options.align)))
      )
        return null;
    }
    if (
      candidate.summarySpan !== undefined &&
      (depth === 0 ||
        candidate.summary === undefined ||
        !Number.isSafeInteger(candidate.summarySpan) ||
        (candidate.summarySpan as number) < 2)
    )
      return null;
    const children = candidate.children.map((child) => visit(child, depth + 1));
    if (children.some((child) => child === null)) return null;
    let coveredUntil = -1;
    for (let index = 0; index < children.length; index++) {
      const span = children[index]?.summarySpan;
      if (span !== undefined) {
        if (index <= coveredUntil || index + span > children.length) return null;
        coveredUntil = index + span - 1;
      }
    }
    if (depth === 0 && candidate.summary !== undefined) return null;
    const summary = candidate.summary === undefined ? undefined : visit(candidate.summary, depth + 1);
    if (summary === null || summary?.summarySpan !== undefined) return null;
    return {
      text: candidate.text,
      children: children as MindmapItem[],
      ...(candidate.nodeId === undefined ? {} : { nodeId: candidate.nodeId as string }),
      ...(summary === undefined ? {} : { summary }),
      ...(candidate.summarySpan === undefined ? {} : { summarySpan: candidate.summarySpan as number }),
      ...(candidate.collapsed === true ? { collapsed: true } : {}),
      ...(style === undefined ? {} : { style: { ...(style as MindmapTextStyle) } }),
      ...(candidate.branch === undefined ? {} : { branch: { ...(candidate.branch as MindmapBranchStyle) } }),
      ...(candidate.branchType === undefined ? {} : { branchType: candidate.branchType as MindmapBranchType }),
      ...(candidate.subtreeLayout === undefined
        ? {}
        : { subtreeLayout: candidate.subtreeLayout as MindmapSubtreeLayout }),
      ...(candidate.appearance === undefined ? {} : { appearance: { ...(candidate.appearance as MindmapAppearance) } }),
      ...(candidate.markers === undefined ? {} : { markers: { ...(candidate.markers as MindmapMarkers) } }),
      ...(candidate.href === undefined ? {} : { href: candidate.href as string }),
      ...(candidate.links === undefined
        ? {}
        : { links: (candidate.links as MindmapLink[]).map((link) => ({ ...link })) }),
    };
  };
  if (value != null) {
    const tree = visit(value, 0);
    if (tree) return tree;
    onInvalid();
    return defaultTree();
  }
  if (labels != null) {
    if (Array.isArray(labels) && labels.length === 4 && labels.every((label) => typeof label === "string"))
      return { text: labels[0], children: labels.slice(1).map((text) => ({ text, children: [] })) };
    onInvalid();
  }
  return defaultTree();
}
function mindmapTextSize(item: MindmapItem) {
  return item.style?.size ?? 14;
}
function mindmapTextWidth(item: MindmapItem) {
  const size = mindmapTextSize(item);
  return Math.max(
    65,
    Math.min(
      2000,
      Array.from(item.text).reduce((sum, char) => sum + (char.codePointAt(0)! > 255 ? size : size * 0.57), 0) +
        20 +
        itemMarkers(item).length * 18,
    ),
  );
}
function mindmapTextHeight(item: MindmapItem) {
  return Math.max(32, mindmapTextSize(item) + 12);
}
function mindmapTextAttributes(item: MindmapItem, root: boolean) {
  const style = item.style;
  return {
    "font-size": mindmapTextSize(item),
    fill: style?.color ?? (item.href ? "#1677ff" : "#252525"),
    ...(style?.bold === undefined
      ? root
        ? { "font-weight": "600" }
        : {}
      : { "font-weight": style.bold ? "700" : "400" }),
    ...(style?.italic ? { "font-style": "italic" } : {}),
    ...(style?.strike || style?.underline
      ? {
          "text-decoration": [style.underline && "underline", style.strike && "line-through"].filter(Boolean).join(" "),
        }
      : {}),
  };
}
function mindmapTextPosition(item: MindmapItem, x: number, width: number) {
  const markerWidth = itemMarkers(item).length * 18;
  if (item.style?.align === "left" || item.style?.align === "justify")
    return { x: x + 8 + markerWidth, "text-anchor": "start" };
  if (item.style?.align === "right") return { x: x + width - 8, "text-anchor": "end" };
  return { x: x + (width + markerWidth) / 2, "text-anchor": "middle" };
}
function mindmapSVGMarkers(item: MindmapItem, x: number, y: number, height: number): DOMOutputSpec[] {
  return itemMarkers(item).map(({ kind, value }, index) => {
    const cx = x + 15 + index * 18,
      cy = y + height / 2;
    if (kind === "progress" && value > 0 && value < 6) {
      const angle = (value * Math.PI) / 3;
      const endX = cx + 7 * Math.sin(angle),
        endY = cy - 7 * Math.cos(angle);
      return [
        "g",
        { "aria-label": markerLabel(kind, value) },
        ["circle", { cx, cy, r: 7, fill: "#d7f1e2" }],
        ["path", { d: `M ${cx} ${cy} V ${cy - 7} A 7 7 0 ${value > 3 ? 1 : 0} 1 ${endX} ${endY} Z`, fill: "#65c990" }],
      ];
    }
    return [
      "g",
      { "aria-label": markerLabel(kind, value) },
      ["circle", { cx, cy, r: 7, fill: markerColors[kind][value] }],
      [
        "text",
        { x: cx, y: cy + 3.5, "font-size": 10, "font-weight": 700, fill: "white", "text-anchor": "middle" },
        markerGlyph(kind, value),
      ],
    ];
  });
}
function mindmapSVGText(item: MindmapItem, attrs: Record<string, string | number>): DOMOutputSpec {
  const children: Array<DOMOutputSpec | string> = [];
  let offset = 0;
  for (const link of item.links ?? []) {
    if (offset < link.from) children.push(item.text.slice(offset, link.from));
    children.push([
      "a",
      { href: link.href, target: "_blank", rel: "noopener noreferrer" },
      ["tspan", { fill: item.style?.color ?? "#1677ff" }, item.text.slice(link.from, link.to)],
    ]);
    offset = link.to;
  }
  if (offset < item.text.length) children.push(item.text.slice(offset));
  if (item.nodeId) {
    const width = mindmapTextWidth(item);
    const height = mindmapTextHeight(item);
    const markers = itemMarkers(item).length * 18;
    const anchor = attrs["text-anchor"];
    const x =
      Number(attrs.x) - (anchor === "start" ? 8 + markers : anchor === "end" ? width - 8 : (width + markers) / 2);
    const y = Number(attrs.y) - mindmapTextSize(item) * 0.35 - height / 2;
    attrs = {
      ...attrs,
      "data-semlo-mindmap-node": item.nodeId,
      "data-semlo-node-x": x,
      "data-semlo-node-y": y,
      "data-semlo-node-width": width,
      "data-semlo-node-height": height,
    };
  }
  const text: DOMOutputSpec = ["text", attrs, ...children];
  return item.href ? ["a", { href: item.href, target: "_blank", rel: "noopener noreferrer" }, text] : text;
}
function parseJSON(value: string | null): unknown {
  try {
    return value === null ? null : JSON.parse(value);
  } catch {
    return value;
  }
}
function itemAt(root: MindmapItem, path: number[]): MindmapItem | undefined {
  return path.reduce<MindmapItem | undefined>(
    (item, index) => (index === -1 ? item?.summary : item?.children[index]),
    root,
  );
}
function visibleChildren(item: MindmapItem): MindmapItem[] {
  if (item.collapsed) return item.summarySpan && item.summary ? [item.summary] : [];
  return item.summary ? [...item.children, item.summary] : item.children;
}
function descendantCount(item: MindmapItem): number {
  return (
    item.children.reduce((total, child) => total + 1 + descendantCount(child), 0) +
    (item.summary ? 1 + descendantCount(item.summary) : 0)
  );
}
function hiddenDescendantCount(item: MindmapItem): number {
  return descendantCount(item) - (item.summarySpan && item.summary ? 1 + descendantCount(item.summary) : 0);
}
function plainText(item: MindmapItem): string {
  return [item.text, ...item.children.map(plainText), ...(item.summary ? [plainText(item.summary)] : [])].join("\n");
}
function mindmapLine(x1: number, y1: number, x2: number, y2: number, vertical: boolean, type: MindmapBranchType) {
  const bend = vertical ? (y1 + y2) / 2 : (x1 + x2) / 2;
  if (type === "elbow")
    return vertical ? `M ${x1} ${y1} V ${bend} H ${x2} V ${y2}` : `M ${x1} ${y1} H ${bend} V ${y2} H ${x2}`;
  return vertical
    ? `M ${x1} ${y1} C ${x1} ${bend}, ${x2} ${bend}, ${x2} ${y2}`
    : `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`;
}
function mindmapTreeLine(x1: number, y1: number, x2: number, y2: number, type: MindmapBranchType) {
  if (type === "elbow") return `M ${x1} ${y1} V ${y2} H ${x2}`;
  const vertical = Math.sign(y2 - y1) || 1;
  const horizontal = Math.sign(x2 - x1) || 1;
  const radius = Math.min(16, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} V ${y2 - vertical * radius} Q ${x1} ${y2} ${x1 + horizontal * radius} ${y2} H ${x2}`;
}
function mindmapSummaryLine(x1: number, y: number, x2: number, endY: number) {
  const direction = Math.sign(x2 - x1) || 1;
  const start = x1 + direction * 5,
    stem = x1 + direction * 15,
    end = stem + direction * 5;
  return `M ${start} ${y - 14} Q ${stem} ${y - 14} ${stem} ${y - 5} Q ${stem} ${y} ${end} ${y} M ${start} ${y + 14} Q ${stem} ${y + 14} ${stem} ${y + 5} Q ${stem} ${y} ${end} ${y} L ${x2} ${endY}`;
}
function mindmapGroupSummaryLine(x1: number, top: number, bottom: number, x2: number, endY: number) {
  const direction = Math.sign(x2 - x1) || 1;
  const start = x1 + direction * 5;
  const stem = x1 + direction * 18;
  const middle = (top + bottom) / 2;
  const radius = Math.min(12, (bottom - top) / 4);
  return `M ${start} ${top} Q ${stem} ${top} ${stem} ${top + radius} V ${middle - radius} Q ${stem} ${middle} ${stem + direction * 5} ${middle} M ${start} ${bottom} Q ${stem} ${bottom} ${stem} ${bottom - radius} V ${middle + radius} Q ${stem} ${middle} ${stem + direction * 5} ${middle} L ${x2} ${endY}`;
}
function mindmapVerticalGroupSummaryLine(y1: number, left: number, right: number, x2: number, y2: number) {
  const direction = Math.sign(y2 - y1) || 1;
  const start = y1 + direction * 5;
  const stem = y1 + direction * 18;
  const middle = (left + right) / 2;
  const radius = Math.min(12, (right - left) / 4);
  return `M ${left} ${start} Q ${left} ${stem} ${left + radius} ${stem} H ${middle - radius} Q ${middle} ${stem} ${middle} ${stem + direction * 5} M ${right} ${start} Q ${right} ${stem} ${right - radius} ${stem} H ${middle + radius} Q ${middle} ${stem} ${middle} ${stem + direction * 5} L ${x2} ${y2}`;
}
function mindmapShape(item: MindmapItem, root: boolean) {
  return item.appearance?.shape ?? (root ? "rectangle" : "line");
}
function mindmapSVGShape(
  item: MindmapItem,
  root: boolean,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  vertical: boolean,
): DOMOutputSpec | null {
  const appearance = item.appearance;
  const shape = mindmapShape(item, root);
  if (shape === "line") {
    if (vertical && !root) return null;
    return [
      "path",
      {
        d: `M ${x} ${y + height} H ${x + width}`,
        fill: "none",
        stroke: appearance?.stroke ?? color,
        "stroke-width": appearance?.strokeWidth ?? item.branch?.width ?? 3,
      },
    ];
  }
  return [
    "rect",
    {
      x,
      y,
      width,
      height,
      rx: shape === "round" ? height / 2 : root && appearance?.shape === undefined ? 4 : 2,
      fill: appearance?.fill ?? (root ? "#f0f1f1" : "transparent"),
      stroke: appearance?.stroke ?? (root ? "transparent" : color),
      "stroke-width": appearance?.strokeWidth ?? 3,
    },
  ];
}
function exportTreeMindmap(root: MindmapItem, direction: TreeLayout): DOMOutputSpec {
  interface TreeBox {
    item: MindmapItem;
    color: string;
    depth: number;
    width: number;
    height: number;
    spanWidth: number;
    spanHeight: number;
    x: number;
    y: number;
    children: TreeBox[];
  }
  const left = direction.endsWith("left"),
    up = direction.includes("-up-");
  const colors = ["#a48ed5", "#7989d5", "#8cc5bd", "#d5ba74", "#db9292"];
  const measure = (item: MindmapItem, depth: number, inherited: string): TreeBox => {
    const color = item.branch?.color ?? inherited;
    const width = mindmapTextWidth(item),
      height = mindmapTextHeight(item);
    const children = visibleChildren(item).map((child, index) =>
      measure(child, depth + 1, depth === 0 ? colors[index % colors.length] : color),
    );
    const childWidth = Math.max(0, ...children.map((child) => child.spanWidth));
    return {
      item,
      depth,
      color,
      width,
      height,
      x: 0,
      y: 0,
      children,
      spanWidth: children.length ? Math.max(width, width / 2 + 16 + childWidth) : width,
      spanHeight:
        height +
        (children.length
          ? 24 + children.reduce((sum, child) => sum + child.spanHeight, 0) + (children.length - 1) * 10
          : 0),
    };
  };
  const tree = measure(root, 0, colors[0]);
  const place = (node: TreeBox, x: number, y: number) => {
    node.x = x + (left ? node.spanWidth - node.width : 0);
    node.y = y + (up ? node.spanHeight - node.height : 0);
    let cursor = up ? node.y - 24 : node.y + node.height + 24;
    for (const child of node.children) {
      const childX = node.x + node.width / 2 + (left ? -16 - child.spanWidth : 16);
      const childY = up ? cursor - child.spanHeight : cursor;
      place(child, childX, childY);
      cursor += (up ? -1 : 1) * (child.spanHeight + 10);
    }
  };
  place(tree, 16, 16);
  const parts: DOMOutputSpec[] = [];
  const draw = (node: TreeBox) => {
    for (const child of [...node.children].reverse()) {
      const x1 = node.x + node.width / 2,
        y1 = node.y + (up ? 0 : node.height);
      const x2 = child.x + (left ? child.width : 0);
      const y2 = child.y + (mindmapShape(child.item, false) === "line" ? child.height : child.height / 2);
      parts.push([
        "path",
        {
          d: mindmapTreeLine(x1, y1, x2, y2, root.branchType ?? "curve"),
          fill: "none",
          stroke: child.color,
          "stroke-width": child.item.branch?.width ?? 3,
        },
      ]);
      draw(child);
    }
    const box = mindmapSVGShape(node.item, !node.depth, node.x, node.y, node.width, node.height, node.color, false);
    if (box) parts.push(box);
    parts.push(...mindmapSVGMarkers(node.item, node.x, node.y, node.height));
    parts.push(
      mindmapSVGText(node.item, {
        ...mindmapTextPosition(node.item, node.x, node.width),
        y: node.y + node.height / 2 + mindmapTextSize(node.item) * 0.35,
        ...mindmapTextAttributes(node.item, !node.depth),
      }),
    );
    if (node.item.collapsed && node.item.children.length)
      parts.push([
        "text",
        {
          x: left ? node.x - 8 : node.x + node.width + 8,
          y: node.y + node.height - 7,
          "font-size": 11,
          fill: node.color,
          ...(left ? { "text-anchor": "end" } : {}),
        },
        String(hiddenDescendantCount(node.item)),
      ]);
  };
  draw(tree);
  return [
    "http://www.w3.org/2000/svg svg",
    {
      viewBox: `0 0 ${tree.spanWidth + 32} ${tree.spanHeight + 32}`,
      width: "100%",
      role: "img",
      "aria-label": "思维导图",
    },
    ...parts,
  ];
}
function exportTimelineMindmap(root: MindmapItem, direction: TimelineLayout): DOMOutputSpec {
  const left = direction === "timeline-left";
  const colors = ["#a48ed5", "#7989d5", "#8cc5bd", "#d5ba74", "#db9292"];
  const nodes: Array<{
    item: MindmapItem;
    color: string;
    depth: number;
    width: number;
    height: number;
    x: number;
    y: number;
  }> = [];
  const visit = (item: MindmapItem, depth: number, inherited: string) => {
    const color = item.branch?.color ?? inherited;
    nodes.push({ item, color, depth, width: mindmapTextWidth(item), height: mindmapTextHeight(item), x: 0, y: 0 });
    visibleChildren(item).forEach((child, index) =>
      visit(child, depth + 1, depth === 0 ? colors[index % colors.length] : color),
    );
  };
  visit(root, 0, colors[0]);
  const totalWidth = nodes.reduce((sum, node) => sum + node.width, 0) + Math.max(0, nodes.length - 1) * 20;
  const maxHeight = Math.max(...nodes.map((node) => node.height));
  const baseline = 16 + maxHeight;
  let cursor = left ? 16 + totalWidth : 16;
  for (const node of nodes) {
    node.x = left ? cursor - node.width : cursor;
    node.y = baseline - (mindmapShape(node.item, !node.depth) === "line" ? node.height : node.height / 2);
    cursor += (left ? -1 : 1) * (node.width + 20);
  }
  const parts: DOMOutputSpec[] = [];
  for (let index = 1; index < nodes.length; index++) {
    const previous = nodes[index - 1],
      node = nodes[index];
    parts.push([
      "path",
      {
        d: `M ${left ? previous.x : previous.x + previous.width} ${baseline} H ${left ? node.x + node.width : node.x}`,
        fill: "none",
        stroke: node.color,
        "stroke-width": node.item.branch?.width ?? 3,
      },
    ]);
  }
  for (const node of nodes) {
    const box = mindmapSVGShape(node.item, !node.depth, node.x, node.y, node.width, node.height, node.color, false);
    if (box) parts.push(box);
    parts.push(...mindmapSVGMarkers(node.item, node.x, node.y, node.height));
    parts.push(
      mindmapSVGText(node.item, {
        ...mindmapTextPosition(node.item, node.x, node.width),
        y: node.y + node.height / 2 + mindmapTextSize(node.item) * 0.35,
        ...mindmapTextAttributes(node.item, !node.depth),
      }),
    );
    if (node.item.collapsed && node.item.children.length)
      parts.push([
        "text",
        {
          x: left ? node.x - 5 : node.x + node.width + 5,
          y: baseline - 5,
          "font-size": 11,
          fill: node.color,
          ...(left ? { "text-anchor": "end" } : {}),
        },
        String(hiddenDescendantCount(node.item)),
      ]);
  }
  return [
    "http://www.w3.org/2000/svg svg",
    {
      viewBox: `0 0 ${totalWidth + 32} ${baseline + maxHeight / 2 + 16}`,
      width: "100%",
      role: "img",
      "aria-label": "思维导图",
    },
    ...parts,
  ];
}
function exportVerticalMindmap(root: MindmapItem, direction: "up" | "down"): DOMOutputSpec {
  interface Layout {
    item: MindmapItem;
    depth: number;
    color: string;
    width: number;
    height: number;
    span: number;
    children: Layout[];
    x: number;
    y: number;
  }
  const palette = ["#a48ed5", "#7989d5", "#8cc5bd", "#d5ba74", "#db9292"];
  let maxDepth = 0;
  const heights: number[] = [];
  const measure = (item: MindmapItem, depth: number, color: string): Layout => {
    color = item.branch?.color ?? color;
    maxDepth = Math.max(maxDepth, depth);
    const width = mindmapTextWidth(item),
      height = mindmapTextHeight(item);
    heights[depth] = Math.max(heights[depth] ?? 0, height);
    const children = visibleChildren(item).map((child, index) =>
      measure(child, depth + 1, depth === 0 ? palette[index % palette.length] : color),
    );
    const childSpan = children.reduce((sum, child) => sum + child.span, 0) + Math.max(0, children.length - 1) * 32;
    return { item, depth, color, width, height, span: Math.max(width, childSpan), children, x: 0, y: 0 };
  };
  const tree = measure(root, 0, palette[0]);
  const place = (node: Layout, left: number) => {
    node.x = left + (node.span - node.width) / 2;
    const before = direction === "down" ? heights.slice(0, node.depth) : heights.slice(node.depth + 1);
    node.y = 16 + before.reduce((sum, height) => sum + height + 48, 0) + (heights[node.depth] - node.height) / 2;
    const childSpan =
      node.children.reduce((sum, child) => sum + child.span, 0) + Math.max(0, node.children.length - 1) * 32;
    let next = left + (node.span - childSpan) / 2;
    for (const child of node.children) {
      place(child, next);
      next += child.span + 32;
    }
  };
  place(tree, 16);
  const parts: DOMOutputSpec[] = [];
  const draw = (node: Layout) => {
    for (const child of node.children) {
      const x1 = node.x + node.width / 2,
        x2 = child.x + child.width / 2;
      const y1 = node.y + (direction === "down" ? node.height : 0),
        y2 = child.y + (direction === "down" ? 0 : child.height);
      parts.push([
        "path",
        {
          d: mindmapLine(x1, y1, x2, y2, true, root.branchType ?? "curve"),
          fill: "none",
          stroke: child.color,
          "stroke-width": child.item.branch?.width ?? 3,
        },
      ]);
      draw(child);
    }
    const box = mindmapSVGShape(node.item, !node.depth, node.x, node.y, node.width, node.height, node.color, true);
    if (box) parts.push(box);
    parts.push(...mindmapSVGMarkers(node.item, node.x, node.y, node.height));
    parts.push(
      mindmapSVGText(node.item, {
        ...mindmapTextPosition(node.item, node.x, node.width),
        y: node.y + node.height / 2 + mindmapTextSize(node.item) * 0.35,
        ...mindmapTextAttributes(node.item, node.depth === 0),
      }),
    );
    if (node.item.collapsed && node.item.children.length)
      parts.push([
        "text",
        { x: node.x + node.width + 5, y: node.y + node.height - 7, "font-size": 11, fill: node.color },
        String(hiddenDescendantCount(node.item)),
      ]);
  };
  draw(tree);
  return [
    "http://www.w3.org/2000/svg svg",
    {
      viewBox: `0 0 ${tree.span + 32} ${heights.reduce((sum, height) => sum + height, 0) + maxDepth * 48 + 32}`,
      width: "100%",
      role: "img",
      "aria-label": "思维导图",
    },
    ...parts,
  ];
}
function hasSubtreeLayout(item: MindmapItem): boolean {
  return (
    !!item.subtreeLayout || item.children.some(hasSubtreeLayout) || !!(item.summary && hasSubtreeLayout(item.summary))
  );
}
function exportMixedMindmap(root: MindmapItem, direction: MindmapLayout): DOMOutputSpec {
  interface Box {
    item: MindmapItem;
    mode: MindmapLayout;
    side: BranchSide;
    depth: number;
    color: string;
    width: number;
    height: number;
    spanWidth: number;
    spanHeight: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    children: Box[];
  }
  const colors = ["#a48ed5", "#7989d5", "#8cc5bd", "#d5ba74", "#db9292"];
  const initialSide: BranchSide = direction === "left" || direction.endsWith("left") ? "left" : "right";
  const build = (
    item: MindmapItem,
    inherited: MindmapLayout,
    side: BranchSide,
    depth: number,
    inheritedColor: string,
  ): Box => {
    const mode = depth ? resolveSubtreeLayout(item, inherited, side) : direction;
    const color = item.branch?.color ?? inheritedColor;
    const width = mindmapTextWidth(item);
    const height = mindmapTextHeight(item);
    const split = mode === "balanced" ? balancedSplit(item.children) : undefined;
    const allChildren = visibleChildren(item).map((child, index) => {
      const childSide =
        mode === "balanced"
          ? branchSide(mode, index, item.children, split)
          : mode === "left" || mode.endsWith("left")
            ? "left"
            : mode === "right" || mode.endsWith("right")
              ? "right"
              : side;
      return build(
        child,
        mode === "balanced" ? childSide : mode,
        childSide,
        depth + 1,
        depth ? color : colors[index % colors.length],
      );
    });
    const children = item.summarySpan ? allChildren.filter((child) => child.item !== item.summary) : allChildren;
    const node: Box = {
      item,
      mode,
      side,
      depth,
      color,
      width,
      height,
      spanWidth: width,
      spanHeight: height,
      x: 0,
      y: 0,
      offsetX: 0,
      offsetY: 0,
      children: allChildren,
    };
    if (!children.length) return node;
    const stackHeight = (group: Box[], gap: number) =>
      group.reduce((sum, child) => sum + child.spanHeight, 0) + Math.max(0, group.length - 1) * gap;
    if (mode === "balanced") {
      const left = children.filter((child) => child.side === "left");
      const right = children.filter((child) => child.side === "right");
      const leftWidth = Math.max(0, ...left.map((child) => child.spanWidth));
      const rightWidth = Math.max(0, ...right.map((child) => child.spanWidth));
      const leftHeight = stackHeight(left, 20);
      const rightHeight = stackHeight(right, 20);
      node.x = left.length ? leftWidth + 48 : 0;
      node.spanWidth = node.x + width + (right.length ? rightWidth + 48 : 0);
      node.spanHeight = Math.max(height, leftHeight, rightHeight);
      node.y = (node.spanHeight - height) / 2;
      for (const [group, groupHeight, isLeft] of [
        [left, leftHeight, true],
        [right, rightHeight, false],
      ] as const) {
        let y = (node.spanHeight - groupHeight) / 2;
        for (const child of group) {
          child.offsetX = isLeft ? leftWidth - child.spanWidth : node.x + width + 48;
          child.offsetY = y;
          y += child.spanHeight + 20;
        }
      }
    } else if (isTreeLayout(mode)) {
      const left = mode.endsWith("left");
      const up = mode.includes("-up-");
      const childHeight = stackHeight(children, 10);
      const childWidth = Math.max(...children.map((child) => child.spanWidth));
      node.spanWidth = Math.max(width, width / 2 + 16 + childWidth);
      node.spanHeight = height + 24 + childHeight;
      node.x = left ? node.spanWidth - width : 0;
      node.y = up ? childHeight + 24 : 0;
      let cursor = up ? node.y - 24 : height + 24;
      for (const child of children) {
        child.offsetX = left ? node.x + width / 2 - 16 - child.spanWidth : node.x + width / 2 + 16;
        child.offsetY = up ? cursor - child.spanHeight : cursor;
        cursor += (up ? -1 : 1) * (child.spanHeight + 10);
      }
    } else if (mode === "up" || mode === "down") {
      const totalWidth = children.reduce((sum, child) => sum + child.spanWidth, 0) + (children.length - 1) * 32;
      const childHeight = Math.max(...children.map((child) => child.spanHeight));
      node.spanWidth = Math.max(width, totalWidth);
      node.spanHeight = height + 48 + childHeight;
      node.x = (node.spanWidth - width) / 2;
      node.y = mode === "up" ? childHeight + 48 : 0;
      let x = (node.spanWidth - totalWidth) / 2;
      for (const child of children) {
        child.offsetX = x;
        child.offsetY = mode === "up" ? childHeight - child.spanHeight : height + 48;
        x += child.spanWidth + 32;
      }
    } else if (isTimelineLayout(mode)) {
      const left = mode === "timeline-left";
      const totalWidth = children.reduce((sum, child) => sum + child.spanWidth, 0) + (children.length - 1) * 20;
      node.spanWidth = width + 20 + totalWidth;
      node.spanHeight = Math.max(height, ...children.map((child) => child.spanHeight));
      node.x = left ? node.spanWidth - width : 0;
      node.y = node.spanHeight - height;
      let cursor = left ? node.x - 20 : width + 20;
      for (const child of children) {
        child.offsetX = left ? cursor - child.spanWidth : cursor;
        child.offsetY = node.spanHeight - child.spanHeight;
        cursor += (left ? -1 : 1) * (child.spanWidth + 20);
      }
    } else {
      const left = mode === "left" || (mode !== "right" && side === "left");
      const childWidth = Math.max(...children.map((child) => child.spanWidth));
      const childHeight = stackHeight(children, 20);
      node.spanWidth = width + 48 + childWidth;
      node.spanHeight = Math.max(height, childHeight);
      node.x = left ? childWidth + 48 : 0;
      node.y = (node.spanHeight - height) / 2;
      let y = (node.spanHeight - childHeight) / 2;
      for (const child of children) {
        child.offsetX = left ? childWidth - child.spanWidth : width + 48;
        child.offsetY = y;
        y += child.spanHeight + 20;
      }
    }
    return node;
  };
  const layout = build(root, direction, initialSide, 0, colors[0]);
  type Positioned = { node: Box; x: number; y: number };
  type Timeline = { side: BranchSide; nodes: Positioned[] };
  const labels: Positioned[] = [];
  const edges: Array<{ parent: Positioned; child: Positioned; summary: boolean }> = [];
  const timelines: Timeline[] = [];
  const visit = (node: Box, ox: number, oy: number, parent?: Positioned, inheritedTimeline?: Timeline) => {
    const position = { node, x: ox + node.x, y: oy + node.y };
    labels.push(position);
    if (parent) {
      const summary = parent.node.item.summary === node.item;
      if (isTimelineLayout(parent.node.mode) && inheritedTimeline && !(summary && parent.node.item.summarySpan))
        inheritedTimeline.nodes.push(position);
      else edges.push({ parent, child: position, summary });
    }
    let timeline: Timeline | undefined;
    if (isTimelineLayout(node.mode)) {
      if (parent && isTimelineLayout(parent.node.mode) && parent.node.mode === node.mode && inheritedTimeline)
        timeline = inheritedTimeline;
      else {
        timeline = { side: node.mode === "timeline-left" ? "left" : "right", nodes: [position] };
        timelines.push(timeline);
      }
    }
    for (const child of node.children) visit(child, ox + child.offsetX, oy + child.offsetY, position, timeline);
  };
  visit(layout, 16, 16);
  const byNode = new Map(labels.map((position) => [position.node, position]));
  type GroupedLine =
    | { axis: "horizontal"; x: number; top: number; bottom: number }
    | { axis: "vertical"; y: number; left: number; right: number; down: boolean };
  const grouped = new Map<Positioned, GroupedLine>();
  const positionGroups = (parent: Box) => {
    for (let index = 0; index < parent.children.length; index++) {
      const anchor = parent.children[index];
      const span = anchor.item.summarySpan;
      const summary = anchor.children.find((child) => child.item === anchor.item.summary);
      if (
        !span ||
        !summary ||
        (!isTreeLayout(parent.mode) &&
          !isTimelineLayout(parent.mode) &&
          !["right", "left", "balanced", "up", "down"].includes(parent.mode))
      )
        continue;
      const members = parent.children.slice(index, index + span);
      if (members.length !== span || members.some((child) => child.side !== anchor.side)) continue;
      const visible: Positioned[] = [];
      const collect = (node: Box) => {
        if (node === summary) return;
        const position = byNode.get(node);
        if (position) visible.push(position);
        node.children.forEach(collect);
      };
      members.forEach(collect);
      const summaryPosition = byNode.get(summary);
      if (!summaryPosition || !visible.length) continue;
      const top = Math.min(...visible.map((position) => position.y));
      const bottom = Math.max(...visible.map((position) => position.y + position.node.height));
      const left = Math.min(...visible.map((position) => position.x));
      const right = Math.max(...visible.map((position) => position.x + position.node.width));
      const vertical = parent.mode === "up" || parent.mode === "down" || isTimelineLayout(parent.mode);
      const x = anchor.side === "right" ? right : left;
      const y = parent.mode === "down" ? bottom : top;
      const targetX = vertical
        ? (left + right - summary.width) / 2
        : anchor.side === "right"
          ? x + 40
          : x - 40 - summary.width;
      const targetY = vertical
        ? parent.mode === "down"
          ? y + 40
          : y - 40 - summary.height
        : (top + bottom - summary.height) / 2;
      const dx = targetX - summaryPosition.x;
      const dy = targetY - summaryPosition.y;
      const move = (node: Box) => {
        const position = byNode.get(node);
        if (position) {
          position.x += dx;
          position.y += dy;
        }
        node.children.forEach(move);
      };
      move(summary);
      grouped.set(
        summaryPosition,
        vertical
          ? { axis: "vertical", y, left, right, down: parent.mode === "down" }
          : { axis: "horizontal", x, top, bottom },
      );
    }
    parent.children.forEach(positionGroups);
  };
  positionGroups(layout);
  const parts: DOMOutputSpec[] = [];
  for (const { parent, child, summary } of edges) {
    const p = parent.node;
    const c = child.node;
    const vertical = p.mode === "up" || p.mode === "down";
    const tree = isTreeLayout(p.mode);
    const up = p.mode === "up" || (tree && p.mode.includes("-up-"));
    const x1 = vertical || tree ? parent.x + p.width / 2 : c.side === "left" ? parent.x : parent.x + p.width;
    const x2 = vertical ? child.x + c.width / 2 : c.side === "left" ? child.x + c.width : child.x;
    const y1 =
      vertical || tree
        ? up
          ? parent.y
          : parent.y + p.height
        : summary
          ? parent.y + p.height / 2
          : mindmapShape(p.item, !p.depth) === "line"
            ? parent.y + p.height
            : parent.y + p.height / 2;
    const y2 = vertical
      ? up
        ? child.y + c.height
        : child.y
      : summary
        ? child.y + c.height / 2
        : mindmapShape(c.item, false) === "line"
          ? child.y + c.height
          : child.y + c.height / 2;
    const group = grouped.get(child);
    parts.push([
      "path",
      {
        d:
          group?.axis === "vertical"
            ? mindmapVerticalGroupSummaryLine(
                group.y,
                group.left,
                group.right,
                child.x + c.width / 2,
                group.down ? child.y : child.y + c.height,
              )
            : group
              ? mindmapGroupSummaryLine(group.x, group.top, group.bottom, x2, y2)
              : summary && !tree && !vertical
                ? mindmapSummaryLine(x1, y1, x2, y2)
                : tree
                  ? mindmapTreeLine(x1, y1, x2, y2, root.branchType ?? "curve")
                  : mindmapLine(x1, y1, x2, y2, vertical, root.branchType ?? "curve"),
        fill: "none",
        stroke: summary ? "#b6b9b9" : c.color,
        "stroke-width": summary ? 2 : (c.item.branch?.width ?? 3),
      },
    ]);
  }
  for (const timeline of timelines) {
    for (let index = 1; index < timeline.nodes.length; index++) {
      const previous = timeline.nodes[index - 1];
      const next = timeline.nodes[index];
      const x1 = timeline.side === "right" ? previous.x + previous.node.width : previous.x;
      const x2 = timeline.side === "right" ? next.x : next.x + next.node.width;
      const y =
        next.y + (mindmapShape(next.node.item, !next.node.depth) === "line" ? next.node.height : next.node.height / 2);
      parts.push([
        "path",
        {
          d: `M ${x1} ${y} H ${x2}`,
          fill: "none",
          stroke: next.node.color,
          "stroke-width": next.node.item.branch?.width ?? 3,
        },
      ]);
    }
  }
  for (const { node, x, y } of labels) {
    const shape = mindmapSVGShape(
      node.item,
      !node.depth,
      x,
      y,
      node.width,
      node.height,
      node.color,
      node.mode === "up" || node.mode === "down",
    );
    if (shape) parts.push(shape);
    parts.push(...mindmapSVGMarkers(node.item, x, y, node.height));
    parts.push(
      mindmapSVGText(node.item, {
        ...mindmapTextPosition(node.item, x, node.width),
        y: y + node.height / 2 + mindmapTextSize(node.item) * 0.35,
        ...mindmapTextAttributes(node.item, !node.depth),
      }),
    );
    if (node.item.collapsed && node.item.children.length)
      parts.push([
        "text",
        {
          x: node.side === "left" ? x - 8 : x + node.width + 8,
          y: y + node.height - 7,
          "font-size": 11,
          fill: node.color,
          ...(node.side === "left" ? { "text-anchor": "end" } : {}),
        },
        String(hiddenDescendantCount(node.item)),
      ]);
  }
  const bounds = { left: 0, top: 0, right: layout.spanWidth + 32, bottom: layout.spanHeight + 32 };
  for (const { node, x, y } of labels) {
    bounds.left = Math.min(bounds.left, x - 16);
    bounds.top = Math.min(bounds.top, y - 16);
    bounds.right = Math.max(bounds.right, x + node.width + 16);
    bounds.bottom = Math.max(bounds.bottom, y + node.height + 16);
  }
  return [
    "http://www.w3.org/2000/svg svg",
    {
      viewBox: `${bounds.left} ${bounds.top} ${bounds.right - bounds.left} ${bounds.bottom - bounds.top}`,
      width: "100%",
      role: "img",
      "aria-label": "思维导图",
    },
    ...parts,
  ];
}
function exportMindmap(root: MindmapItem, direction: MindmapLayout): DOMOutputSpec {
  const hasGroupedSummary = (item: MindmapItem): boolean =>
    !!item.summarySpan || item.children.some(hasGroupedSummary) || !!(item.summary && hasGroupedSummary(item.summary));
  if (hasSubtreeLayout(root)) return exportMixedMindmap(root, direction);
  if (
    (direction === "up" || direction === "down" || isTreeLayout(direction) || isTimelineLayout(direction)) &&
    hasGroupedSummary(root)
  )
    return exportMixedMindmap(root, direction);
  if (isTreeLayout(direction)) return exportTreeMindmap(root, direction);
  if (isTimelineLayout(direction)) return exportTimelineMindmap(root, direction);
  if (direction === "up" || direction === "down") return exportVerticalMindmap(root, direction);
  interface Layout {
    item: MindmapItem;
    depth: number;
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
    side: BranchSide;
    children: Layout[];
  }
  const palette = ["#a48ed5", "#7989d5", "#8cc5bd", "#d5ba74", "#db9292"];
  const widths: number[] = [];
  const measure = (item: MindmapItem, depth: number) => {
    widths[depth] = Math.max(widths[depth] ?? 65, mindmapTextWidth(item));
    visibleChildren(item).forEach((child) => measure(child, depth + 1));
  };
  measure(root, 0);
  const split = direction === "balanced" ? balancedSplit(root.children) : undefined;
  const sides = root.collapsed
    ? []
    : root.children.map((_, index) => branchSide(direction, index, root.children, split));
  const sideWidth = widths.slice(1).reduce((sum, width) => sum + 48 + width, 0);
  const rootX = 16 + (sides.includes("left") ? sideWidth : 0);
  const positionX = (depth: number, side: BranchSide) => {
    const distance = widths.slice(1, depth + 1).reduce((sum, width) => sum + 48 + width, 0);
    return side === "left" ? rootX - distance : rootX + widths[0] + distance - widths[depth];
  };
  const cursors: Record<BranchSide, number> = { left: 16, right: 16 };
  const shift = (node: Layout, amount: number) => {
    node.y += amount;
    node.children.forEach((child) => shift(child, amount));
  };
  const place = (item: MindmapItem, depth: number, color: string, side: BranchSide): Layout => {
    color = item.branch?.color ?? color;
    const top = cursors[side];
    const height = mindmapTextHeight(item);
    const visible = visibleChildren(item);
    const flow = item.summarySpan ? visible.filter((child) => child !== item.summary) : visible;
    const children = flow.map((child) => place(child, depth + 1, color, side));
    if (item.summarySpan && item.summary && visible.includes(item.summary)) {
      const cursor = cursors[side];
      children.push(place(item.summary, depth + 1, color, side));
      cursors[side] = cursor;
    }
    if (!flow.length) cursors[side] += height + 22;
    else {
      const extra = Math.max(0, height + 22 - (cursors[side] - top));
      if (extra) {
        children.forEach((child) => shift(child, extra / 2));
        cursors[side] += extra;
      }
    }
    const y = (top + cursors[side] - 22) / 2;
    return { item, depth, color, side, x: positionX(depth, side), y, width: widths[depth], height, children };
  };
  const children = root.collapsed
    ? []
    : root.children.map((child, index) => place(child, 1, palette[index % palette.length], sides[index]));
  const rootHeight = mindmapTextHeight(root);
  const rootY = Math.max(16 + rootHeight / 2, (Math.max(cursors.left, cursors.right) - 6) / 2);
  for (const side of ["left", "right"] as const) {
    const group = children.filter((child) => child.side === side);
    if (!group.length) continue;
    const center = (16 + cursors[side] - 22) / 2;
    group.forEach((child) => shift(child, rootY - center));
  }
  const tree: Layout = {
    item: root,
    depth: 0,
    color: palette[0],
    side: "right",
    x: rootX,
    y: rootY,
    width: widths[0],
    height: rootHeight,
    children,
  };
  const grouped = new Map<Layout, { x: number; top: number; bottom: number }>();
  const move = (node: Layout, dx: number, dy: number) => {
    node.x += dx;
    node.y += dy;
    node.children.forEach((child) => move(child, dx, dy));
  };
  const positionGroups = (parent: Layout) => {
    for (let index = 0; index < parent.children.length; index++) {
      const anchor = parent.children[index];
      const span = anchor.item.summarySpan;
      const summary = anchor.children.find((child) => child.item === anchor.item.summary);
      if (!span || !summary) continue;
      const members = parent.children.slice(index, index + span);
      if (members.length !== span || members.some((child) => child.side !== anchor.side)) continue;
      const visible: Layout[] = [];
      const collect = (node: Layout) => {
        if (node === summary) return;
        visible.push(node);
        node.children.forEach(collect);
      };
      members.forEach(collect);
      const top = Math.min(...visible.map((child) => child.y - child.height / 2));
      const bottom = Math.max(...visible.map((child) => child.y + child.height / 2));
      const x =
        anchor.side === "right"
          ? Math.max(...visible.map((child) => child.x + child.width))
          : Math.min(...visible.map((child) => child.x));
      const targetX = anchor.side === "right" ? x + 40 : x - 40 - summary.width;
      move(summary, targetX - summary.x, (top + bottom) / 2 - summary.y);
      grouped.set(summary, { x, top, bottom });
    }
    parent.children.forEach(positionGroups);
  };
  positionGroups(tree);
  const parts: DOMOutputSpec[] = [];
  const draw = (node: Layout) => {
    for (const child of node.children) {
      const summary = node.item.summary === child.item;
      const group = grouped.get(child);
      const startX = child.side === "right" ? node.x + node.width : node.x,
        endX = child.side === "right" ? child.x : child.x + child.width;
      const startY = node.y + (mindmapShape(node.item, !node.depth) === "line" ? node.height / 2 : 0),
        endY = child.y + (mindmapShape(child.item, false) === "line" ? child.height / 2 : 0);
      parts.push([
        "path",
        {
          d: group
            ? mindmapGroupSummaryLine(group.x, group.top, group.bottom, endX, child.y)
            : summary
              ? mindmapSummaryLine(startX, node.y, endX, child.y)
              : mindmapLine(startX, startY, endX, endY, false, root.branchType ?? "curve"),
          fill: "none",
          stroke: summary ? "#b6b9b9" : child.color,
          "stroke-width": summary ? 2 : (child.item.branch?.width ?? 3),
        },
      ]);
      draw(child);
    }
    const box = mindmapSVGShape(
      node.item,
      !node.depth,
      node.x,
      node.y - node.height / 2,
      node.width,
      node.height,
      node.color,
      false,
    );
    if (box) parts.push(box);
    parts.push(...mindmapSVGMarkers(node.item, node.x, node.y - node.height / 2, node.height));
    parts.push(
      mindmapSVGText(node.item, {
        ...mindmapTextPosition(node.item, node.x, node.width),
        y: node.y + mindmapTextSize(node.item) * 0.35,
        ...mindmapTextAttributes(node.item, node.depth === 0),
      }),
    );
    if (node.item.collapsed && node.item.children.length)
      parts.push([
        "text",
        {
          x: node.side === "left" ? node.x - 10 : node.x + node.width + 10,
          y: node.y + node.height / 2 + 2,
          "font-size": 11,
          fill: node.color,
          ...(node.side === "left" ? { "text-anchor": "end" } : {}),
        },
        String(hiddenDescendantCount(node.item)),
      ]);
  };
  draw(tree);
  const width = rootX + widths[0] + (sides.includes("right") ? sideWidth : 0) + 16;
  const bounds = {
    left: 0,
    top: 0,
    right: width,
    bottom: Math.max(48, cursors.left, cursors.right, rootY + rootHeight / 2) + 16,
  };
  const include = (node: Layout) => {
    bounds.left = Math.min(bounds.left, node.x - 16);
    bounds.top = Math.min(bounds.top, node.y - node.height / 2 - 16);
    bounds.right = Math.max(bounds.right, node.x + node.width + 16);
    bounds.bottom = Math.max(bounds.bottom, node.y + node.height / 2 + 16);
    node.children.forEach(include);
  };
  include(tree);
  return [
    "http://www.w3.org/2000/svg svg",
    {
      viewBox: `${bounds.left} ${bounds.top} ${bounds.right - bounds.left} ${bounds.bottom - bounds.top}`,
      width: "100%",
      role: "img",
      "aria-label": "思维导图",
    },
    ...parts,
  ];
}

export const Mindmap = Node.create({
  name: "semloEditorMindmap",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      height: {
        default: CANVAS_DEFAULT_HEIGHT,
        rendered: false,
        parseHTML: readPresentationHeight,
      },
      tree: { default: null, rendered: false, parseHTML: (element) => parseJSON(element.getAttribute("data-tree")) },
      drawing: {
        default: null,
        rendered: false,
        parseHTML: (element) => parseJSON(element.getAttribute("data-drawing")),
      },
      annotations: {
        default: null,
        rendered: false,
        parseHTML: (element) => parseJSON(element.getAttribute("data-annotations")),
      },
      canvasShapes: {
        default: null,
        rendered: false,
        parseHTML: (element) => parseJSON(element.getAttribute("data-canvas-shapes")),
      },
      // Read documents created by the earlier four-label prototype.
      labels: {
        default: null,
        rendered: false,
        parseHTML: (element) => parseJSON(element.getAttribute("data-labels")),
      },
      layout: {
        default: null,
        rendered: false,
        parseHTML: (element) => parseJSON(element.getAttribute("data-layout")),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-semlo-editor-mindmap]",
        priority: 100,
        getAttrs: (element: HTMLElement) => (readPresentationHeight(element) === null ? { height: null } : {}),
      },
    ];
  },
  renderText({ node }) {
    let supported = supportedCanvasHeight(node.attrs.height) && supportedLayout(node.attrs.layout);
    const tree = treeFrom(node.attrs.tree, node.attrs.labels, () => {
      supported = false;
    });
    readMindmapStrokes(node.attrs.drawing, () => {
      supported = false;
    });
    const annotations = readMindmapCanvasText(node.attrs.annotations, () => {
      supported = false;
    });
    const canvas = readMindmapCanvasData(node.attrs.canvasShapes, () => {
      supported = false;
    });
    return supported
      ? [
          plainText(tree),
          ...annotations.map((item) => item.text),
          ...canvas.shapes.map((item) => item.text).filter(Boolean),
          ...canvas.edges.map((item) => item.text).filter(Boolean),
        ].join("\n")
      : "思维导图数据格式不受支持";
  },
  renderHTML({ node }) {
    const presentation = presentationPayload(node.attrs.height);
    let supported = supportedCanvasHeight(node.attrs.height) && supportedLayout(node.attrs.layout);
    const tree = treeFrom(node.attrs.tree, node.attrs.labels, () => {
      supported = false;
    });
    const drawing = readMindmapStrokes(node.attrs.drawing, () => {
      supported = false;
    });
    const annotations = readMindmapCanvasText(node.attrs.annotations, () => {
      supported = false;
    });
    const canvas = readMindmapCanvasData(node.attrs.canvasShapes, () => {
      supported = false;
    });
    return [
      "figure",
      {
        "data-semlo-editor-mindmap": "",
        "data-height": canvasHeight(node.attrs.height),
        ...(presentation === null ? {} : { "data-semlo-editor-presentation": presentation }),
        "data-tree": JSON.stringify(node.attrs.tree),
        "data-labels": JSON.stringify(node.attrs.labels),
        ...(node.attrs.drawing == null ? {} : { "data-drawing": JSON.stringify(node.attrs.drawing) }),
        ...(node.attrs.annotations == null ? {} : { "data-annotations": JSON.stringify(node.attrs.annotations) }),
        ...(node.attrs.canvasShapes == null ? {} : { "data-canvas-shapes": JSON.stringify(node.attrs.canvasShapes) }),
        ...(node.attrs.layout == null ? {} : { "data-layout": JSON.stringify(node.attrs.layout) }),
        class: "semlo-editor-mindmap-export",
      },
      supported
        ? exportMindmapCanvasShapes(
            exportMindmapCanvasText(
              exportMindmapStrokes(exportMindmap(tree, node.attrs.layout ?? "right"), drawing),
              annotations,
            ),
            canvas,
          )
        : ["p", "思维导图数据格式不受支持，暂无法显示。"],
    ];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("div");
      dom.className = "semlo-editor-mindmap";
      dom.dataset.type = "semloEditorMindmap";
      dom.contentEditable = "false";
      let current = initial;
      let documentEpoch = 0;
      let observedNode = initial;
      let observedPosition = getPos();
      let observedDocument = view.state.doc;
      let selected: number[] | null = null;
      let selectedRange: { parent: number[]; anchor: number; first: number; last: number } | null = null;
      let destroyed = false;
      let zoom = 100;
      let panX = 0;
      let panY = 0;
      let panEnabled = false;
      let maximized = false;
      let drawingTool: "select" | "pen" | "marker" | "eraser" | "text" | "shape" | "line" = "select";
      let selectedText: number | null = null;
      let annotationLinkOpen = false;
      let annotationLinkSelection: { index: number; from: number; to: number } | null = null;
      let cancelTextDrag: (() => void) | null = null;
      let selectedShape: string | null = null;
      let pendingShape: Shape | SmartTemplate | null = null;
      let cancelShapeDrag: (() => void) | null = null;
      let disposeShapePicker: (() => void) | null = null;
      let selectedLine: string | null = null;
      let pendingLine: CanvasEdge | null = null;
      let lineRoute: NonNullable<CanvasEdge["route"]> = "straight";
      let lineMenuOpen = false;
      let cancelLineGesture: (() => void) | null = null;
      let drawingMenuOpen = false;
      let inkColor = "#585a5a";
      let inkWidth = 3;
      let markerColor = "#d8b95b";
      let markerWidth = 16;
      let pendingStroke: MindmapStroke | null = null;
      let pendingErased: Set<number> | null = null;
      let cancelDrawing: (() => void) | null = null;
      let branchMenuOpen = false;
      let shapeMenuOpen = false;
      let markerMenuOpen = false;
      let markerCategory: MindmapMarkerKind | null = null;
      let styleMenuOpen = false;
      let linkMenuOpen = false;
      let linkSelection: { path: number[]; from: number; to: number } | null = null;
      let input: HTMLInputElement | null = null;
      let finishInput: ((save: boolean) => void) | null = null;
      let layoutObserver: ResizeObserver | null = null;
      let removeResizeFallback: (() => void) | null = null;
      const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i]);
      const isActive = (path: number[]) => selected !== null && samePath(path, selected);
      const isSelected = (path: number[]) =>
        isActive(path) ||
        (selected !== null &&
          selectedRange !== null &&
          path.length === selectedRange.parent.length + 1 &&
          samePath(path.slice(0, -1), selectedRange.parent) &&
          path[path.length - 1] >= selectedRange.first &&
          path[path.length - 1] <= selectedRange.last);
      const selectionItems = (tree: MindmapItem, path: number[]) => {
        if (selectedRange && isSelected(path)) {
          const parent = itemAt(tree, selectedRange.parent);
          if (!parent || selectedRange.first < 0 || selectedRange.last >= parent.children.length) return [];
          return parent.children.slice(selectedRange.first, selectedRange.last + 1);
        }
        const item = itemAt(tree, path);
        return item ? [item] : [];
      };
      const clearLineSelection = () => {
        selectedLine = null;
        dom
          .querySelectorAll(".semlo-editor-mindmap-line-toolbar, .semlo-editor-mindmap-line-handle")
          .forEach((element) => element.remove());
        dom.querySelectorAll("[data-mindmap-line]").forEach((element) => element.setAttribute("aria-pressed", "false"));
      };
      const dataSupported = () => {
        let supported = supportedCanvasHeight(current.attrs.height) && supportedLayout(current.attrs.layout);
        treeFrom(current.attrs.tree, current.attrs.labels, () => {
          supported = false;
        });
        readMindmapStrokes(current.attrs.drawing, () => {
          supported = false;
        });
        readMindmapCanvasText(current.attrs.annotations, () => {
          supported = false;
        });
        readMindmapCanvasShapes(current.attrs.canvasShapes, () => {
          supported = false;
        });
        return supported;
      };
      const currentNodeShapes = (): CanvasShape[] => {
        const origin = dom.querySelector<HTMLElement>(".semlo-editor-mindmap-content")?.getBoundingClientRect();
        if (!origin) return [];
        const scale = zoom / 100;
        return [...dom.querySelectorAll<HTMLElement>("[data-mindmap-node-id]")]
          .map((label) => {
            const bounds = label.getBoundingClientRect();
            return {
              id: mindmapNodeReference(label.dataset.mindmapNodeId!),
              shape: "rectangle" as const,
              x: (bounds.left - origin.left) / scale,
              y: (bounds.top - origin.top) / scale,
              width: bounds.width / scale,
              height: bounds.height / scale,
              text: "",
            };
          })
          .filter((shape) => shape.width > 0 && shape.height > 0);
      };
      const commit = (tree: MindmapItem) => {
        if (destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return false;
        const pos = getPos();
        const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (typeof pos !== "number" || !live || !live.eq(current)) return false;
        const collect = (item: MindmapItem, ids: Set<string>) => {
          if (item.nodeId) ids.add(mindmapNodeReference(item.nodeId));
          item.children.forEach((child) => collect(child, ids));
          if (item.summary) collect(item.summary, ids);
        };
        const remaining = new Set<string>();
        const previous = new Set<string>();
        const canvas = readMindmapCanvasData(current.attrs.canvasShapes);
        if (
          canvas.edges.some((edge) => edge.from.startsWith(mindmapNodePrefix) || edge.to.startsWith(mindmapNodePrefix))
        ) {
          collect(tree, remaining);
          collect(treeFrom(current.attrs.tree, current.attrs.labels), previous);
        }
        const shapeIds = new Set(canvas.shapes.map((shape) => shape.id));
        const missing = (id: string) => previous.has(id) && !remaining.has(id) && !shapeIds.has(id);
        let transaction = view.state.tr.setNodeAttribute(pos, "tree", tree).setNodeAttribute(pos, "labels", null);
        if (canvas.edges.some((edge) => missing(edge.from) || missing(edge.to))) {
          const geometryData = { ...canvas, shapes: [...canvas.shapes, ...currentNodeShapes()] };
          const edges = canvas.edges.map((edge) => {
            if (!missing(edge.from) && !missing(edge.to)) return edge;
            const from = endpointBox(geometryData, edge.from, edge.fromPoint);
            const to = endpointBox(geometryData, edge.to, edge.toPoint);
            const geometry =
              from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
            return {
              ...edge,
              ...(missing(edge.from)
                ? {
                    from: "",
                    fromPoint: { x: geometry?.x1 ?? edge.fromPoint!.x, y: geometry?.y1 ?? edge.fromPoint!.y },
                  }
                : {}),
              ...(missing(edge.to)
                ? { to: "", toPoint: { x: geometry?.x2 ?? edge.toPoint!.x, y: geometry?.y2 ?? edge.toPoint!.y } }
                : {}),
            };
          });
          transaction = transaction.setNodeAttribute(pos, "canvasShapes", { ...canvas, edges });
        }
        view.dispatch(closeHistory(transaction));
        view.dispatch(closeHistory(view.state.tr));
        return true;
      };
      const commitDrawing = (strokes: MindmapStroke[]) => {
        if (destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return false;
        let valid = true;
        readMindmapStrokes(strokes, () => {
          valid = false;
        });
        const pos = getPos();
        const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (!valid || typeof pos !== "number" || !live || !live.eq(current)) return false;
        view.dispatch(closeHistory(view.state.tr.setNodeAttribute(pos, "drawing", strokes.length ? strokes : null)));
        view.dispatch(closeHistory(view.state.tr));
        return true;
      };
      const commitAnnotations = (annotations: MindmapCanvasText[]) => {
        if (destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return false;
        let valid = true;
        readMindmapCanvasText(annotations, () => {
          valid = false;
        });
        const pos = getPos();
        const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (!valid || typeof pos !== "number" || !live || !live.eq(current)) return false;
        view.dispatch(
          closeHistory(view.state.tr.setNodeAttribute(pos, "annotations", annotations.length ? annotations : null)),
        );
        view.dispatch(closeHistory(view.state.tr));
        return true;
      };
      const commitCanvasData = (data: CanvasData, tree?: MindmapItem) => {
        if (destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return false;
        let valid = true;
        readMindmapCanvasData(data, () => {
          valid = false;
        });
        if (tree)
          treeFrom(tree, null, () => {
            valid = false;
          });
        const pos = getPos();
        const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (!valid || typeof pos !== "number" || !live || !live.eq(current)) return false;
        let transaction = view.state.tr.setNodeAttribute(
          pos,
          "canvasShapes",
          data.shapes.length || data.edges.length ? data : null,
        );
        if (tree) transaction = transaction.setNodeAttribute(pos, "tree", tree).setNodeAttribute(pos, "labels", null);
        view.dispatch(closeHistory(transaction));
        view.dispatch(closeHistory(view.state.tr));
        return true;
      };
      const commitShapes = (
        shapes: CanvasShape[],
        groups: CanvasGroup[] | undefined = readMindmapCanvasData(current.attrs.canvasShapes).groups,
      ) => {
        const previous = readMindmapCanvasData(current.attrs.canvasShapes);
        const kept = new Set(shapes.map((shape) => shape.id));
        const previousIds = new Set(previous.shapes.map((shape) => shape.id));
        const needsNodeGeometry =
          previous.shapes.some((shape) => !kept.has(shape.id)) &&
          previous.edges.some(
            (edge) => edge.from.startsWith(mindmapNodePrefix) || edge.to.startsWith(mindmapNodePrefix),
          );
        const geometryData = needsNodeGeometry
          ? { ...previous, shapes: [...previous.shapes, ...currentNodeShapes()] }
          : previous;
        const edges = previous.edges.map((edge) => {
          const removedFrom = previousIds.has(edge.from) && !kept.has(edge.from);
          const removedTo = previousIds.has(edge.to) && !kept.has(edge.to);
          if (!removedFrom && !removedTo) return edge;
          const from = endpointBox(geometryData, edge.from, edge.fromPoint);
          const to = endpointBox(geometryData, edge.to, edge.toPoint);
          const geometry =
            from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
          const next = { ...edge };
          if (removedFrom && from) {
            next.from = "";
            next.fromPoint = {
              x: geometry?.x1 ?? from.x + from.width / 2,
              y: geometry?.y1 ?? from.y + from.height / 2,
            };
          }
          if (removedTo && to) {
            next.to = "";
            next.toPoint = { x: geometry?.x2 ?? to.x + to.width / 2, y: geometry?.y2 ?? to.y + to.height / 2 };
          }
          return next;
        });
        return commitCanvasData({ shapes, edges, ...(groups === undefined ? {} : { groups }) });
      };
      const commitEdges = (edges: CanvasEdge[]) => {
        const data = readMindmapCanvasData(current.attrs.canvasShapes);
        if (
          !edges.some(
            (edge) => edge.from.startsWith(mindmapPendingNodePrefix) || edge.to.startsWith(mindmapPendingNodePrefix),
          )
        )
          return commitCanvasData({ ...data, edges });
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const shapeIds = new Set(data.shapes.map((shape) => shape.id));
        const used = new Set<string>(shapeIds);
        const collect = (item: MindmapItem) => {
          if (item.nodeId) used.add(mindmapNodeReference(item.nodeId));
          item.children.forEach(collect);
          if (item.summary) collect(item.summary);
        };
        collect(tree);
        for (const edge of data.edges) {
          if (edge.from.startsWith(mindmapNodePrefix)) used.add(edge.from);
          if (edge.to.startsWith(mindmapNodePrefix)) used.add(edge.to);
        }
        let changed = false;
        let number = 1;
        const resolve = (reference: string) => {
          if (shapeIds.has(reference)) return reference;
          if (!reference.startsWith(mindmapPendingNodePrefix)) return reference;
          let path: unknown;
          try {
            path = JSON.parse(reference.slice(mindmapPendingNodePrefix.length));
          } catch {
            return null;
          }
          if (!Array.isArray(path) || !path.every((value) => Number.isSafeInteger(value) && value >= -1)) return null;
          const item = itemAt(tree, path as number[]);
          if (!item) return null;
          if (!item.nodeId) {
            while (used.has(mindmapNodeReference(`n${number}`))) number++;
            item.nodeId = `n${number++}`;
            used.add(mindmapNodeReference(item.nodeId));
            changed = true;
          }
          const id = mindmapNodeReference(item.nodeId);
          return shapeIds.has(id) ? null : id;
        };
        const next: CanvasEdge[] = [];
        for (const edge of edges) {
          const from = resolve(edge.from);
          const to = resolve(edge.to);
          if (from === null || to === null) return false;
          next.push({ ...edge, from, to });
        }
        return commitCanvasData({ ...data, edges: next }, changed ? tree : undefined);
      };
      const commitHeight = (value: number) => {
        if (destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return;
        const pos = getPos();
        const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (typeof pos !== "number" || !live || !live.eq(current)) return;
        view.dispatch(closeHistory(view.state.tr.setNodeAttribute(pos, "height", canvasHeight(value))));
        view.dispatch(closeHistory(view.state.tr));
      };
      const setLayout = (layout: MindmapLayout) => {
        if (destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return;
        const pos = getPos();
        const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (typeof pos !== "number" || !live || !live.eq(current) || (current.attrs.layout ?? "right") === layout)
          return;
        view.dispatch(closeHistory(view.state.tr.setNodeAttribute(pos, "layout", layout)));
        view.dispatch(closeHistory(view.state.tr));
        focusSelected();
      };
      const subtreeLayoutAt = (path: number[]) => {
        let item = treeFrom(current.attrs.tree, current.attrs.labels);
        let layout = (current.attrs.layout ?? "right") as MindmapLayout;
        let side: BranchSide = layout === "left" || layout.endsWith("left") ? "left" : "right";
        for (let depth = 0; depth < path.length; depth++) {
          const index = path[depth];
          if (depth === 0 && layout === "balanced" && index >= 0) side = branchSide(layout, index, item.children);
          const child = index === -1 ? item.summary : item.children[index];
          if (!child) break;
          item = child;
          layout = resolveSubtreeLayout(item, layout === "balanced" ? side : layout, side);
          if (layout === "left" || layout.endsWith("left")) side = "left";
          else if (layout === "right" || layout.endsWith("right")) side = "right";
        }
        return layout;
      };
      const subtreeKind = (layout: MindmapLayout): MindmapSubtreeLayout | null =>
        isTimelineLayout(layout)
          ? "timeline"
          : isTreeLayout(layout)
            ? layout.includes("-up-")
              ? "tree-up"
              : "tree-down"
            : layout === "right" || layout === "left"
              ? "branch"
              : null;
      const rangeCanSummarize = (tree: MindmapItem) => {
        if (!selectedRange) return false;
        const { parent: parentPath, first, last } = selectedRange;
        const parent = itemAt(tree, parentPath);
        const layout = subtreeLayoutAt(parentPath);
        if (
          !parent ||
          first === last ||
          last >= parent.children.length ||
          (!isTreeLayout(layout) &&
            !isTimelineLayout(layout) &&
            !["right", "left", "balanced", "up", "down"].includes(layout)) ||
          (layout === "balanced" &&
            branchSide(layout, first, parent.children) !== branchSide(layout, last, parent.children))
        )
          return false;
        return parent.children.every((item, index) => {
          if (index >= first && index <= last && item.summary) return false;
          const end = index + (item.summarySpan ?? 1) - 1;
          return item.summarySpan === undefined || end < first || index > last;
        });
      };
      const focusSelected = () =>
        dom.querySelector<HTMLButtonElement>('.semlo-editor-mindmap-label[aria-pressed="true"]')?.focus();
      const applyTextStyle = (element: HTMLElement, item: MindmapItem, root: boolean) => {
        const style = item.style;
        element.style.fontWeight = style?.bold === undefined ? (root ? "600" : "") : style.bold ? "700" : "400";
        element.style.fontStyle = style?.italic ? "italic" : "";
        element.style.textDecoration = [style?.underline && "underline", style?.strike && "line-through"]
          .filter(Boolean)
          .join(" ");
        element.style.fontSize = style?.size ? `${style.size}px` : "";
        element.style.maxWidth = style?.size ? "none" : "";
        element.style.color = style?.color ?? (item.href ? "#1677ff" : "");
        element.style.textAlign = style?.align ?? "";
      };
      const applyAppearance = (
        element: HTMLElement,
        item: MindmapItem,
        root: boolean,
        color: string,
        vertical: boolean,
      ) => {
        const appearance = item.appearance;
        const shape = mindmapShape(item, root);
        if (shape === "line") {
          element.style.border = "1px solid transparent";
          element.style.borderBottom = `${appearance?.strokeWidth ?? item.branch?.width ?? 3}px solid ${vertical && !root ? "transparent" : (appearance?.stroke ?? color)}`;
          element.style.borderRadius = "0";
          element.style.background = appearance?.fill ?? "white";
        } else {
          const stroke = appearance?.stroke ?? (root ? "transparent" : color);
          element.style.border =
            root && !appearance?.stroke ? "0" : `${appearance?.strokeWidth ?? 3}px solid ${stroke}`;
          element.style.borderRadius = shape === "round" ? "999px" : "4px";
          element.style.background = appearance?.fill ?? (root ? "#f0f1f1" : "transparent");
        }
      };
      const updateTextStyle = (path: number[], patch: Partial<MindmapTextStyle>, focus: string) => {
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const items = selectionItems(tree, path);
        if (!items.length) return;
        items.forEach((item) => (item.style = { ...item.style, ...patch }));
        if (commit(tree)) dom.querySelector<HTMLElement>(`[data-mindmap-style-control="${focus}"]`)?.focus();
      };
      const updateBranch = (path: number[], patch: Partial<MindmapBranchStyle>, focus: string) => {
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const items = selectionItems(tree, path);
        if (!items.length || !path.length) return;
        items.forEach((item) => (item.branch = { ...item.branch, ...patch }));
        if (commit(tree)) dom.querySelector<HTMLElement>(`[data-mindmap-branch-control="${focus}"]`)?.focus();
      };
      const updateAppearance = (path: number[], patch: Partial<MindmapAppearance>, focus: string) => {
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const item = itemAt(tree, path);
        if (!item) return;
        item.appearance = { ...item.appearance, ...patch };
        if (commit(tree)) dom.querySelector<HTMLElement>(`[data-mindmap-shape-control="${focus}"]`)?.focus();
      };
      const updateMarker = (path: number[], kind: MindmapMarkerKind, value: number | null) => {
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const items = selectionItems(tree, path);
        if (!items.length) return;
        for (const item of items) {
          const markers = { ...item.markers };
          if (value === null) delete markers[kind];
          else markers[kind] = value;
          if (Object.keys(markers).length) item.markers = markers;
          else delete item.markers;
        }
        if (commit(tree))
          dom.querySelector<HTMLElement>(`[data-mindmap-marker-control="${kind}-${value ?? "clear"}"]`)?.focus();
      };
      const edit = (path: number[]) => {
        if (!editor.isEditable || destroyed || input) return;
        const editNode = current;
        const editEpoch = documentEpoch;
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const item = itemAt(tree, path);
        const button = dom.querySelector<HTMLButtonElement>('.semlo-editor-mindmap-label[aria-pressed="true"]');
        if (!item || !button) return;
        const originalItem = JSON.stringify(item);
        const field = doc.createElement("input");
        field.className = "semlo-editor-mindmap-input";
        field.setAttribute("aria-label", path.length ? "编辑节点" : "编辑中心节点");
        field.value = item.text;
        field.style.cssText = button.style.cssText;
        applyTextStyle(field, item, path.length === 0);
        input = field;
        button.replaceWith(field);
        let done = false;
        let composing = false;
        const updateDraft = () => {
          if (field.value !== item.text) changeItemText(item, field.value);
        };
        const finish = (save: boolean) => {
          if (done) return;
          done = true;
          input = null;
          finishInput = null;
          if (destroyed || documentEpoch !== editEpoch || !current.eq(editNode)) return;
          if (save) {
            updateDraft();
            if (JSON.stringify(item) !== originalItem && commit(tree)) {
              focusSelected();
              return;
            }
          }
          if (!destroyed) {
            paint();
            focusSelected();
          }
        };
        finishInput = finish;
        field.addEventListener("compositionstart", () => (composing = true));
        field.addEventListener("compositionend", () => {
          composing = false;
          updateDraft();
        });
        field.addEventListener("input", () => {
          if (!composing) updateDraft();
        });
        field.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        });
        field.addEventListener("blur", () => finish(true));
        field.focus();
        field.select();
      };
      const add = (path: number[], sibling: boolean) => {
        if (!editor.isEditable || destroyed) return;
        if (sibling && path[path.length - 1] === -1) return;
        selectedRange = null;
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const parentPath = sibling ? path.slice(0, -1) : path;
        const parent = itemAt(tree, parentPath);
        if (!parent || (sibling && !path.length)) return;
        const index = sibling ? path[path.length - 1] + 1 : parent.children.length;
        for (let i = 0; i < parent.children.length; i++) {
          const span = parent.children[i].summarySpan;
          if (span !== undefined && index > i && index < i + span) parent.children[i].summarySpan = span + 1;
        }
        parent.collapsed = false;
        parent.children.splice(index, 0, { text: "", children: [] });
        branchMenuOpen = false;
        shapeMenuOpen = false;
        markerMenuOpen = false;
        markerCategory = null;
        styleMenuOpen = false;
        linkMenuOpen = false;
        linkSelection = null;
        selected = [...parentPath, index];
        if (commit(tree)) edit(selected);
      };
      const addSummary = (path: number[]) => {
        if (!path.length || !editor.isEditable || destroyed) return;
        selectedRange = null;
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const item = itemAt(tree, path);
        if (!item) return;
        selected = [...path, -1];
        branchMenuOpen = shapeMenuOpen = markerMenuOpen = styleMenuOpen = linkMenuOpen = false;
        markerCategory = null;
        linkSelection = null;
        if (item.summary) {
          paint();
          focusSelected();
          return;
        }
        item.collapsed = false;
        item.summary = {
          text: "概要",
          children: [],
          appearance: { shape: "rectangle", fill: "transparent", stroke: "transparent" },
        };
        if (commit(tree)) focusSelected();
      };
      const addRangeSummary = () => {
        if (!selectedRange || !editor.isEditable || destroyed) return;
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        if (!rangeCanSummarize(tree)) return;
        const { parent: parentPath, first, last } = selectedRange;
        const item = itemAt(tree, parentPath)!.children[first];
        item.summary = {
          text: "概要",
          children: [],
          appearance: { shape: "rectangle", fill: "transparent", stroke: "transparent" },
        };
        item.summarySpan = last - first + 1;
        selected = [...parentPath, first, -1];
        selectedRange = null;
        branchMenuOpen = shapeMenuOpen = markerMenuOpen = styleMenuOpen = linkMenuOpen = false;
        markerCategory = null;
        linkSelection = null;
        if (commit(tree)) focusSelected();
      };
      const remove = (path: number[]) => {
        if (!path.length || !editor.isEditable) return;
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const parentPath = path.slice(0, -1);
        const parent = itemAt(tree, parentPath);
        const index = path[path.length - 1];
        if (!parent || (index === -1 ? !parent.summary : !parent.children[index])) return;
        if (index === -1) {
          delete parent.summary;
          delete parent.summarySpan;
        } else {
          for (let i = 0; i < parent.children.length; i++) {
            const item = parent.children[i];
            const span = item.summarySpan;
            if (span === undefined || index < i || index >= i + span) continue;
            if (index === i) {
              const successor = parent.children[i + 1];
              if (successor.summary) {
                const status = dom.querySelector<HTMLElement>(".semlo-editor-mindmap-drawing-status");
                if (status) {
                  status.textContent = "后续节点已有概要，请先处理概要再删除";
                  status.hidden = false;
                }
                return;
              }
              successor.summary = item.summary;
              if (span > 2) successor.summarySpan = span - 1;
            } else if (span > 2) item.summarySpan = span - 1;
            else delete item.summarySpan;
          }
          parent.children.splice(index, 1);
        }
        selectedRange = null;
        branchMenuOpen = false;
        shapeMenuOpen = false;
        markerMenuOpen = false;
        markerCategory = null;
        styleMenuOpen = false;
        linkMenuOpen = false;
        linkSelection = null;
        selected = parentPath;
        if (commit(tree)) focusSelected();
      };
      const toggleCollapsed = (path: number[]) => {
        if (!editor.isEditable || destroyed) return;
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const item = itemAt(tree, path);
        if (!item || (!item.children.length && (!item.summary || item.summarySpan))) return;
        item.collapsed = !item.collapsed;
        branchMenuOpen = false;
        shapeMenuOpen = false;
        markerMenuOpen = false;
        markerCategory = null;
        styleMenuOpen = false;
        linkMenuOpen = false;
        linkSelection = null;
        selected = path;
        if (commit(tree)) focusSelected();
      };
      const makePlus = (path: number[]) => {
        const plus = doc.createElement("button");
        plus.type = "button";
        plus.className = "semlo-editor-mindmap-add";
        plus.setAttribute("aria-label", "添加下级节点");
        plus.textContent = "+";
        plus.addEventListener("click", () => add(path, false));
        return plus;
      };
      const makeNodeToolbar = (path: number[], item: MindmapItem, branchColor: string) => {
        const toolbar = doc.createElement("div");
        toolbar.className = "semlo-editor-mindmap-structure";
        const rangeToolbar = selectedRange !== null && isSelected(path);
        const selectedItems = selectionItems(treeFrom(current.attrs.tree, current.attrs.labels), path);
        const toolbarNode = current;
        const toolbarEpoch = documentEpoch;
        const canApplyColor = () =>
          !destroyed &&
          editor.isEditable &&
          documentEpoch === toolbarEpoch &&
          current.eq(toolbarNode) &&
          isSelected(path);
        const toggle = doc.createElement("button");
        toggle.type = "button";
        toggle.className = "semlo-editor-mindmap-structure-toggle";
        toggle.setAttribute("aria-label", "结构");
        toggle.setAttribute("aria-expanded", "false");
        toggle.title = "结构";
        const icon = (layout: MindmapLayout) => {
          const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 24 24");
          svg.setAttribute("aria-hidden", "true");
          const path = doc.createElementNS(svg.namespaceURI, "path");
          const paths: Record<MindmapLayout, string> = {
            balanced: "M10 9h4v6h-4z M10 12H7C5 12 5 7 2 7 M7 12c-2 0-2 5-5 5 M14 12h3c2 0 2-5 5-5 M17 12c2 0 2 5 5 5",
            right: "M3 9h4v6H3z M7 12h5c3 0 3-5 8-5 M12 12c3 0 3 5 8 5",
            left: "M17 9h4v6h-4z M17 12h-5c-3 0-3-5-8-5 M12 12c-3 0-3 5-8 5",
            up: "M9 17h6v4H9z M12 17v-5c0-3-5-3-5-8 M12 12c0-3 5-3 5-8",
            down: "M9 3h6v4H9z M12 7v5c0 3-5 3-5 8 M12 12c0 3 5 3 5 8",
            "tree-down-right": "M5 3h5v4H5z M7.5 7v12 M7.5 12h10 M7.5 19h10",
            "tree-down-left": "M14 3h5v4h-5z M16.5 7v12 M16.5 12h-10 M16.5 19h-10",
            "tree-up-right": "M5 17h5v4H5z M7.5 17V5 M7.5 12h10 M7.5 5h10",
            "tree-up-left": "M14 17h5v4h-5z M16.5 17V5 M16.5 12h-10 M16.5 5h-10",
            "timeline-right": "M3 9h5v6H3z M8 12h13 M12 10v4 M17 10v4",
            "timeline-left": "M16 9h5v6h-5z M16 12H3 M12 10v4 M7 10v4",
          };
          path.setAttribute("d", paths[layout]);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", "currentColor");
          path.setAttribute("stroke-width", "1.4");
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          svg.append(path);
          return svg;
        };
        const activeLayout = path.length ? subtreeLayoutAt(path) : ((current.attrs.layout ?? "right") as MindmapLayout);
        toggle.append(icon(activeLayout));
        const menu = doc.createElement("div");
        menu.className = "semlo-editor-mindmap-structure-menu";
        menu.hidden = true;
        const rootChoices = [
          ["balanced", "双侧结构"],
          ["right", "向右结构"],
          ["left", "向左结构"],
          ["up", "向上结构"],
          ["down", "向下结构"],
          ["tree-down-right", "向右树形结构"],
          ["tree-down-left", "向左树形结构"],
          ["tree-up-right", "向上右树形结构"],
          ["tree-up-left", "向上左树形结构"],
          ["timeline-right", "向右时间轴结构"],
          ["timeline-left", "向左时间轴结构"],
        ] as const;
        const subtreeChoices = [
          ["branch", "right", "分支结构"],
          ["tree-down", "tree-down-right", "向下树形子树"],
          ["tree-up", "tree-up-right", "向上树形子树"],
          ["timeline", "timeline-right", "时间轴子树"],
        ] as const;
        const choices: Array<{ layout: MindmapLayout; name: string; subtree?: MindmapSubtreeLayout }> = path.length
          ? subtreeChoices.map(([subtree, layout, name]) => ({ subtree, layout, name }))
          : rootChoices.map(([layout, name]) => ({ layout, name }));
        for (const { layout, name, subtree } of choices) {
          const choice = doc.createElement("button");
          choice.type = "button";
          choice.setAttribute("aria-label", name);
          choice.title = name;
          const active =
            subtree && rangeToolbar && selectedRange
              ? selectedItems.every(
                  (_, index) =>
                    subtreeKind(subtreeLayoutAt([...selectedRange!.parent, selectedRange!.first + index])) === subtree,
                )
              : subtree
                ? subtreeKind(activeLayout) === subtree
                : activeLayout === layout;
          choice.setAttribute("aria-pressed", String(active));
          choice.append(icon(layout));
          choice.addEventListener("click", () => {
            if (active) {
              menu.hidden = true;
              toggle.setAttribute("aria-expanded", "false");
              toggle.focus();
              return;
            }
            if (subtree) {
              const tree = treeFrom(current.attrs.tree, current.attrs.labels);
              const items = selectionItems(tree, path);
              if (!items.length) return;
              items.forEach((selectedItem) => (selectedItem.subtreeLayout = subtree));
              if (commit(tree)) focusSelected();
            } else setLayout(layout);
          });
          menu.append(choice);
        }
        toggle.addEventListener("click", () => {
          menu.hidden = !menu.hidden;
          toggle.setAttribute("aria-expanded", String(!menu.hidden));
          if (!menu.hidden) {
            closeMarker();
            branchMenuOpen = false;
            branchMenu.hidden = true;
            branchToggle.setAttribute("aria-expanded", "false");
            shapeMenuOpen = false;
            shapeMenu.hidden = true;
            shapeToggle.setAttribute("aria-expanded", "false");
            styleMenuOpen = false;
            styleMenu.hidden = true;
            styleToggle.setAttribute("aria-expanded", "false");
            linkMenuOpen = false;
            linkMenu.hidden = true;
            linkToggle.setAttribute("aria-expanded", "false");
          }
        });
        const branchToggle = doc.createElement("button");
        branchToggle.type = "button";
        branchToggle.setAttribute("aria-label", "分支样式");
        branchToggle.title = "分支";
        branchToggle.setAttribute("aria-expanded", String(branchMenuOpen));
        branchToggle.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h5c4 0 4-6 10-6h3M8 12c4 0 4 6 10 6h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        const branchMenu = doc.createElement("div");
        branchMenu.className = "semlo-editor-mindmap-branch-menu";
        branchMenu.hidden = !branchMenuOpen;
        const branchOptions = doc.createElement("div");
        branchOptions.className = "semlo-editor-mindmap-branch-options";
        const branchType = treeFrom(current.attrs.tree, current.attrs.labels).branchType ?? "curve";
        for (const [type, name, line] of [
          ["curve", "曲线分支", "M3 12h5c4 0 4-6 10-6h3M8 12c4 0 4 6 10 6h3"],
          ["elbow", "直角分支", "M3 12h6V6h12M9 12v6h12"],
        ] as const) {
          const choice = doc.createElement("button");
          choice.type = "button";
          choice.setAttribute("aria-label", name);
          choice.title = name;
          choice.dataset.mindmapBranchControl = type;
          choice.setAttribute("aria-pressed", String(branchType === type));
          const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("viewBox", "0 0 24 24");
          icon.setAttribute("aria-hidden", "true");
          const shape = doc.createElementNS(icon.namespaceURI, "path");
          shape.setAttribute("d", line);
          shape.setAttribute("fill", "none");
          shape.setAttribute("stroke", "currentColor");
          shape.setAttribute("stroke-width", "1.5");
          icon.append(shape);
          choice.append(icon);
          choice.addEventListener("click", () => {
            if (branchType === type) return;
            const tree = treeFrom(current.attrs.tree, current.attrs.labels);
            tree.branchType = type;
            if (commit(tree)) dom.querySelector<HTMLElement>(`[data-mindmap-branch-control="${type}"]`)?.focus();
          });
          branchOptions.append(choice);
        }
        branchMenu.append(branchOptions);
        if (path.length) {
          const settings = doc.createElement("div");
          settings.className = "semlo-editor-mindmap-branch-settings";
          const width = doc.createElement("input");
          width.type = "number";
          width.min = "1";
          width.max = "5";
          width.step = "1";
          width.value = String(item.branch?.width ?? 3);
          width.setAttribute("aria-label", "分支粗细");
          width.dataset.mindmapBranchControl = "width";
          width.addEventListener("change", () => {
            const value = Number(width.value);
            updateBranch(
              path,
              { width: Number.isFinite(value) ? Math.max(1, Math.min(5, Math.round(value))) : 3 },
              "width",
            );
          });
          const color = createMindmapColorControl(doc, "分支颜色", branchColor, (value) => {
            if (canApplyColor()) updateBranch(path, { color: value }, "color");
          });
          color.trigger.dataset.mindmapBranchControl = "color";
          settings.append(width, color.element);
          branchMenu.append(settings);
        }
        branchToggle.addEventListener("click", () => {
          branchMenuOpen = !branchMenuOpen;
          branchMenu.hidden = !branchMenuOpen;
          branchToggle.setAttribute("aria-expanded", String(branchMenuOpen));
          if (branchMenuOpen) {
            closeMarker();
            menu.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
            shapeMenuOpen = false;
            shapeMenu.hidden = true;
            shapeToggle.setAttribute("aria-expanded", "false");
            styleMenuOpen = false;
            styleMenu.hidden = true;
            styleToggle.setAttribute("aria-expanded", "false");
            linkMenuOpen = false;
            linkMenu.hidden = true;
            linkToggle.setAttribute("aria-expanded", "false");
          }
        });
        const shapeToggle = doc.createElement("button");
        shapeToggle.type = "button";
        shapeToggle.setAttribute("aria-label", "节点形状");
        shapeToggle.title = "节点形状";
        shapeToggle.setAttribute("aria-expanded", String(shapeMenuOpen));
        shapeToggle.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
        const shapeMenu = doc.createElement("div");
        shapeMenu.className = "semlo-editor-mindmap-shape-menu";
        shapeMenu.hidden = !shapeMenuOpen;
        const shapeOptions = doc.createElement("div");
        shapeOptions.className = "semlo-editor-mindmap-branch-options";
        const currentShape = mindmapShape(item, !path.length);
        for (const [shape, name, drawing] of [
          ["line", "横线节点", '<path d="M4 12h16" fill="none" stroke="currentColor" stroke-width="1.5"/>'],
          [
            "rectangle",
            "矩形节点",
            '<rect x="4" y="7" width="16" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>',
          ],
          [
            "round",
            "圆角节点",
            '<rect x="4" y="7" width="16" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
          ],
        ] as const) {
          const choice = doc.createElement("button");
          choice.type = "button";
          choice.setAttribute("aria-label", name);
          choice.title = name;
          choice.dataset.mindmapShapeControl = shape;
          choice.setAttribute("aria-pressed", String(currentShape === shape));
          choice.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${drawing}</svg>`;
          choice.addEventListener("click", () => {
            if (currentShape !== shape) updateAppearance(path, { shape }, shape);
          });
          shapeOptions.append(choice);
        }
        shapeMenu.append(shapeOptions);
        if (currentShape !== "line") {
          const fillSettings = doc.createElement("div");
          fillSettings.className = "semlo-editor-mindmap-shape-settings";
          const strokeSettings = doc.createElement("div");
          strokeSettings.className = "semlo-editor-mindmap-shape-settings";
          const fillValue =
            item.appearance?.fill && item.appearance.fill !== "transparent"
              ? item.appearance.fill
              : path.length
                ? "#ffffff"
                : "#f0f1f1";
          const fill = createMindmapColorControl(doc, "节点填充颜色", fillValue, (value) => {
            if (canApplyColor()) updateAppearance(path, { fill: value }, "fill");
          });
          fill.trigger.dataset.mindmapShapeControl = "fill";
          const clearFill = doc.createElement("button");
          clearFill.type = "button";
          clearFill.textContent = "∅";
          clearFill.setAttribute("aria-label", "无填充");
          clearFill.title = "无填充";
          clearFill.dataset.mindmapShapeControl = "clearFill";
          clearFill.addEventListener("click", () => updateAppearance(path, { fill: "transparent" }, "clearFill"));
          const strokeValue =
            item.appearance?.stroke && item.appearance.stroke !== "transparent" ? item.appearance.stroke : branchColor;
          const stroke = createMindmapColorControl(doc, "节点描边颜色", strokeValue, (value) => {
            if (canApplyColor()) updateAppearance(path, { stroke: value }, "stroke");
          });
          stroke.trigger.dataset.mindmapShapeControl = "stroke";
          const width = doc.createElement("input");
          width.type = "number";
          width.min = "1";
          width.max = "5";
          width.step = "1";
          width.value = String(item.appearance?.strokeWidth ?? 3);
          width.setAttribute("aria-label", "节点描边粗细");
          width.dataset.mindmapShapeControl = "width";
          width.addEventListener("change", () => {
            const value = Number(width.value);
            updateAppearance(
              path,
              { strokeWidth: Number.isFinite(value) ? Math.max(1, Math.min(5, Math.round(value))) : 3 },
              "width",
            );
          });
          const clearStroke = doc.createElement("button");
          clearStroke.type = "button";
          clearStroke.textContent = "∅";
          clearStroke.setAttribute("aria-label", "无描边");
          clearStroke.title = "无描边";
          clearStroke.dataset.mindmapShapeControl = "clearStroke";
          clearStroke.addEventListener("click", () => updateAppearance(path, { stroke: "transparent" }, "clearStroke"));
          fillSettings.append(fill.element, clearFill);
          strokeSettings.append(stroke.element, width, clearStroke);
          shapeMenu.append(fillSettings, strokeSettings);
        }
        shapeToggle.addEventListener("click", () => {
          shapeMenuOpen = !shapeMenuOpen;
          shapeMenu.hidden = !shapeMenuOpen;
          shapeToggle.setAttribute("aria-expanded", String(shapeMenuOpen));
          if (shapeMenuOpen) {
            closeMarker();
            menu.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
            branchMenuOpen = false;
            branchMenu.hidden = true;
            branchToggle.setAttribute("aria-expanded", "false");
            styleMenuOpen = false;
            styleMenu.hidden = true;
            styleToggle.setAttribute("aria-expanded", "false");
            linkMenuOpen = false;
            linkMenu.hidden = true;
            linkToggle.setAttribute("aria-expanded", "false");
          }
        });
        const styleToggle = doc.createElement("button");
        styleToggle.type = "button";
        styleToggle.textContent = "T";
        styleToggle.setAttribute("aria-label", "文字样式");
        styleToggle.title = "文字样式";
        styleToggle.setAttribute("aria-expanded", String(styleMenuOpen));
        const styleMenu = doc.createElement("div");
        styleMenu.className = "semlo-editor-mindmap-text-menu";
        styleMenu.hidden = !styleMenuOpen;
        const row = doc.createElement("div");
        row.className = "semlo-editor-mindmap-text-buttons";
        const styles = [
          ["bold", "粗体", "B"],
          ["italic", "斜体", "I"],
          ["strike", "删除线", "S"],
          ["underline", "下划线", "U"],
        ] as const;
        for (const [key, name, symbol] of styles) {
          const button = doc.createElement("button");
          button.type = "button";
          button.textContent = symbol;
          button.dataset.mindmapStyleControl = key;
          button.setAttribute("aria-label", name);
          const enabled = selectedItems.every(
            (selectedItem) => selectedItem.style?.[key] ?? (key === "bold" && path.length === 0),
          );
          button.setAttribute("aria-pressed", String(enabled));
          if (key === "bold") button.style.fontWeight = "700";
          if (key === "italic") button.style.fontStyle = "italic";
          if (key === "strike") button.style.textDecoration = "line-through";
          if (key === "underline") button.style.textDecoration = "underline";
          button.addEventListener("click", () => updateTextStyle(path, { [key]: !enabled }, key));
          row.append(button);
        }
        const settings = doc.createElement("div");
        settings.className = "semlo-editor-mindmap-text-settings";
        const size = doc.createElement("select");
        size.setAttribute("aria-label", "节点字号");
        size.dataset.mindmapStyleControl = "size";
        for (const value of mindmapFontSizes) {
          const option = doc.createElement("option");
          option.value = String(value);
          option.textContent = `${value}px`;
          size.append(option);
        }
        size.value = String(item.style?.size ?? 14);
        size.addEventListener("change", () => updateTextStyle(path, { size: Number(size.value) }, "size"));
        const color = createMindmapColorControl(doc, "节点文字颜色", item.style?.color ?? "#252525", (value) => {
          if (canApplyColor()) updateTextStyle(path, { color: value }, "color");
        });
        color.trigger.dataset.mindmapStyleControl = "color";
        const align = doc.createElement("select");
        align.setAttribute("aria-label", "节点文字对齐");
        align.dataset.mindmapStyleControl = "align";
        for (const [value, name] of [
          ["left", "左对齐"],
          ["center", "居中对齐"],
          ["right", "右对齐"],
          ["justify", "两端对齐"],
        ] as const) {
          const option = doc.createElement("option");
          option.value = value;
          option.textContent = name;
          align.append(option);
        }
        align.value = item.style?.align ?? "center";
        align.addEventListener("change", () =>
          updateTextStyle(path, { align: align.value as MindmapTextStyle["align"] }, "align"),
        );
        settings.append(size, color.element, align);
        styleMenu.append(row, settings);
        styleToggle.addEventListener("click", () => {
          styleMenuOpen = !styleMenuOpen;
          styleMenu.hidden = !styleMenuOpen;
          styleToggle.setAttribute("aria-expanded", String(styleMenuOpen));
          if (styleMenuOpen) {
            closeMarker();
            branchMenuOpen = false;
            branchMenu.hidden = true;
            branchToggle.setAttribute("aria-expanded", "false");
            shapeMenuOpen = false;
            shapeMenu.hidden = true;
            shapeToggle.setAttribute("aria-expanded", "false");
            menu.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
            linkMenuOpen = false;
            linkMenu.hidden = true;
            linkToggle.setAttribute("aria-expanded", "false");
          }
        });
        const markerToggle = doc.createElement("button");
        markerToggle.type = "button";
        markerToggle.setAttribute("aria-label", "添加标记");
        markerToggle.title = "添加标记";
        markerToggle.setAttribute("aria-expanded", String(markerMenuOpen));
        markerToggle.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m7 11 2 2 4-4M17 16v6m-3-3h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        const markerMenu = doc.createElement("div");
        markerMenu.className = "semlo-editor-mindmap-marker-menu";
        markerMenu.hidden = !markerMenuOpen;
        const closeMarker = () => {
          markerMenuOpen = false;
          markerCategory = null;
          markerMenu.hidden = true;
          markerToggle.setAttribute("aria-expanded", "false");
        };
        for (const kind of ["priority", "progress", "flag"] as const) {
          if (markerCategory && markerCategory !== kind) continue;
          const group = doc.createElement("div");
          group.className = "semlo-editor-mindmap-marker-group";
          const title = doc.createElement("div");
          title.textContent = markerNames[kind];
          const choices = doc.createElement("div");
          choices.className = "semlo-editor-mindmap-marker-choices";
          for (let value = 0; value < 7; value++) {
            const choice = doc.createElement("button");
            choice.type = "button";
            choice.className = "semlo-editor-mindmap-marker-choice";
            choice.setAttribute("aria-label", markerLabel(kind, value));
            choice.title = markerLabel(kind, value);
            choice.dataset.mindmapMarkerControl = `${kind}-${value}`;
            const active = selectedItems.every((selectedItem) => selectedItem.markers?.[kind] === value);
            choice.setAttribute("aria-pressed", String(active));
            choice.style.background = markerBackground(kind, value);
            choice.textContent = markerGlyph(kind, value);
            choice.addEventListener("click", () => {
              if (!active) updateMarker(path, kind, value);
            });
            choices.append(choice);
          }
          const clear = doc.createElement("button");
          clear.type = "button";
          clear.className = "semlo-editor-mindmap-marker-clear";
          clear.setAttribute("aria-label", `清除${markerNames[kind]}`);
          clear.title = `清除${markerNames[kind]}`;
          clear.textContent = "×";
          clear.dataset.mindmapMarkerControl = `${kind}-clear`;
          clear.disabled = selectedItems.every((selectedItem) => selectedItem.markers?.[kind] === undefined);
          clear.addEventListener("click", () => updateMarker(path, kind, null));
          choices.append(clear);
          group.append(title, choices);
          markerMenu.append(group);
        }
        markerToggle.addEventListener("click", () => {
          if (markerMenuOpen && markerCategory) {
            markerCategory = null;
            paint();
            dom.querySelector<HTMLButtonElement>('[aria-label="添加标记"]')?.focus();
            return;
          }
          markerMenuOpen = !markerMenuOpen;
          markerMenu.hidden = !markerMenuOpen;
          markerToggle.setAttribute("aria-expanded", String(markerMenuOpen));
          if (markerMenuOpen) {
            menu.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
            branchMenuOpen = false;
            branchMenu.hidden = true;
            branchToggle.setAttribute("aria-expanded", "false");
            shapeMenuOpen = false;
            shapeMenu.hidden = true;
            shapeToggle.setAttribute("aria-expanded", "false");
            styleMenuOpen = false;
            styleMenu.hidden = true;
            styleToggle.setAttribute("aria-expanded", "false");
            linkMenuOpen = false;
            linkMenu.hidden = true;
            linkToggle.setAttribute("aria-expanded", "false");
          }
        });
        const linkToggle = doc.createElement("button");
        linkToggle.type = "button";
        linkToggle.setAttribute("aria-label", "插入节点链接");
        linkToggle.title = "插入链接";
        linkToggle.setAttribute("aria-expanded", String(linkMenuOpen));
        linkToggle.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 7l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        const linkMenu = doc.createElement("div");
        linkMenu.className = "semlo-editor-mindmap-link-menu";
        linkMenu.setAttribute("role", "dialog");
        linkMenu.setAttribute("aria-label", "节点链接");
        linkMenu.hidden = !linkMenuOpen;
        const textLabel = doc.createElement("label");
        textLabel.textContent = "文本";
        const initialRange =
          linkSelection &&
          linkSelection.path.length === path.length &&
          linkSelection.path.every((value, index) => value === path[index])
            ? linkSelection
            : { from: 0, to: item.text.length };
        const matchingLink = itemLinks(item).find((link) =>
          initialRange.from === initialRange.to
            ? initialRange.from > link.from && initialRange.from < link.to
            : link.from <= initialRange.from && link.to >= initialRange.to,
        );
        const linkText = doc.createElement("input");
        linkText.value = item.text.slice(initialRange.from, initialRange.to) || "链接";
        textLabel.append(linkText);
        const urlLabel = doc.createElement("label");
        urlLabel.textContent = "链接";
        const linkURL = doc.createElement("input");
        linkURL.value = matchingLink?.href ?? "";
        linkURL.dataset.mindmapLinkUrl = "";
        linkURL.placeholder = "链接地址";
        linkURL.autocomplete = "off";
        urlLabel.append(linkURL);
        const actions = doc.createElement("div");
        actions.className = "semlo-editor-mindmap-link-actions";
        const confirm = doc.createElement("button");
        confirm.type = "button";
        confirm.textContent = "确定";
        const linkNode = current,
          linkEpoch = documentEpoch;
        const closeLink = () => {
          linkMenuOpen = false;
          linkSelection = null;
          linkMenu.hidden = true;
          linkToggle.setAttribute("aria-expanded", "false");
        };
        const updateLink = (remove: boolean) => {
          if (destroyed || documentEpoch !== linkEpoch || !current.eq(linkNode)) return;
          const href = remove ? null : normalizeLinkURL(linkURL.value);
          if (!remove && (!href || !linkText.value.trim())) {
            const field = !href ? linkURL : linkText;
            field.setCustomValidity(!href ? "请输入有效的链接地址" : "请输入链接文本");
            field.reportValidity();
            return;
          }
          const tree = treeFrom(current.attrs.tree, current.attrs.labels);
          const target = itemAt(tree, path);
          if (!target) return;
          let { from, to } = linkSelection ?? { from: 0, to: target.text.length };
          if (remove && from === to) {
            const existing = itemLinks(target).find((link) => from > link.from && from < link.to);
            if (!existing) return;
            from = existing.from;
            to = existing.to;
          }
          if (
            from < 0 ||
            to < from ||
            to > target.text.length ||
            !textBoundary(target.text, from) ||
            !textBoundary(target.text, to)
          )
            return;
          replaceItemText(target, from, to, remove ? target.text.slice(from, to) : linkText.value, href);
          linkMenuOpen = false;
          linkSelection = null;
          if (commit(tree)) focusSelected();
        };
        linkText.addEventListener("input", () => linkText.setCustomValidity(""));
        linkURL.addEventListener("input", () => linkURL.setCustomValidity(""));
        confirm.addEventListener("click", () => updateLink(false));
        actions.append(confirm);
        if (
          itemLinks(item).some((link) =>
            initialRange.from === initialRange.to
              ? initialRange.from > link.from && initialRange.from < link.to
              : link.from < initialRange.to && link.to > initialRange.from,
          )
        ) {
          const remove = doc.createElement("button");
          remove.type = "button";
          remove.textContent = "移除链接";
          remove.addEventListener("click", () => updateLink(true));
          actions.append(remove);
        }
        linkMenu.append(textLabel, urlLabel, actions);
        linkToggle.addEventListener("mousedown", (event) => event.preventDefault());
        linkToggle.addEventListener("click", () => {
          if (input && finishInput) {
            const draft = input.value;
            const from = input.selectionStart ?? 0,
              to = input.selectionEnd ?? from;
            finishInput(true);
            const live = itemAt(treeFrom(current.attrs.tree, current.attrs.labels), path);
            if (destroyed || !editor.isEditable || !isSelected(path) || live?.text !== draft) return;
            linkSelection = { path: [...path], from, to };
            branchMenuOpen = false;
            shapeMenuOpen = false;
            markerMenuOpen = false;
            markerCategory = null;
            styleMenuOpen = false;
            linkMenuOpen = true;
            paint();
            dom.querySelector<HTMLInputElement>("[data-mindmap-link-url]")?.focus();
            return;
          }
          if (linkMenuOpen) return closeLink();
          linkSelection = { path: [...path], from: 0, to: item.text.length };
          linkMenuOpen = true;
          linkMenu.hidden = false;
          linkToggle.setAttribute("aria-expanded", "true");
          closeMarker();
          branchMenuOpen = false;
          branchMenu.hidden = true;
          branchToggle.setAttribute("aria-expanded", "false");
          shapeMenuOpen = false;
          shapeMenu.hidden = true;
          shapeToggle.setAttribute("aria-expanded", "false");
          styleMenuOpen = false;
          styleMenu.hidden = true;
          styleToggle.setAttribute("aria-expanded", "false");
          menu.hidden = true;
          toggle.setAttribute("aria-expanded", "false");
          linkURL.focus();
        });
        linkMenu.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            updateLink(false);
          }
        });
        toolbar.addEventListener("keydown", (event) => {
          if (
            event.key === "Escape" &&
            (!menu.hidden ||
              !branchMenu.hidden ||
              !shapeMenu.hidden ||
              !markerMenu.hidden ||
              !styleMenu.hidden ||
              !linkMenu.hidden)
          ) {
            event.preventDefault();
            const restoreFocus = !linkMenu.hidden
              ? linkToggle
              : !styleMenu.hidden
                ? styleToggle
                : !markerMenu.hidden
                  ? markerToggle
                  : !shapeMenu.hidden
                    ? shapeToggle
                    : !branchMenu.hidden
                      ? branchToggle
                      : toggle;
            menu.hidden = true;
            branchMenu.hidden = true;
            branchMenuOpen = false;
            shapeMenu.hidden = true;
            shapeMenuOpen = false;
            closeMarker();
            styleMenu.hidden = true;
            styleMenuOpen = false;
            closeLink();
            toggle.setAttribute("aria-expanded", "false");
            branchToggle.setAttribute("aria-expanded", "false");
            shapeToggle.setAttribute("aria-expanded", "false");
            styleToggle.setAttribute("aria-expanded", "false");
            restoreFocus.focus();
          }
        });
        toolbar.append(toggle, menu, branchToggle, branchMenu);
        if (!rangeToolbar) toolbar.append(shapeToggle, shapeMenu);
        toolbar.append(styleToggle, styleMenu, markerToggle, markerMenu);
        if (!rangeToolbar) toolbar.append(linkToggle, linkMenu);
        if (path.length) {
          const summary = doc.createElement("button");
          summary.type = "button";
          summary.setAttribute(
            "aria-label",
            rangeToolbar ? "为选中节点添加概要" : item.summary ? "选择概要" : "添加概要",
          );
          summary.title = item.summary ? "选择概要" : "添加概要";
          if (rangeToolbar) summary.disabled = !rangeCanSummarize(treeFrom(current.attrs.tree, current.attrs.labels));
          summary.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3c6 0 2 7 6 9-4 2 0 9-6 9M10 12h5m0-3h6v6h-6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
          summary.addEventListener("click", () => (rangeToolbar ? addRangeSummary() : addSummary(path)));
          toolbar.append(summary);
        }
        return toolbar;
      };
      const paint = () => {
        cancelDrawing?.();
        cancelDrawing = null;
        cancelTextDrag?.();
        cancelTextDrag = null;
        cancelShapeDrag?.();
        cancelShapeDrag = null;
        cancelLineGesture?.();
        cancelLineGesture = null;
        disposeShapePicker?.();
        disposeShapePicker = null;
        const previousViewport = dom.querySelector(".semlo-editor-mindmap-viewport");
        const restoreViewportFocus = previousViewport !== null && previousViewport === doc.activeElement;
        const previousHeightHandle = dom.querySelector(".semlo-editor-canvas-height-handle");
        const restoreHeightFocus = previousHeightHandle !== null && previousHeightHandle === doc.activeElement;
        layoutObserver?.disconnect();
        layoutObserver = null;
        removeResizeFallback?.();
        removeResizeFallback = null;
        dom.classList.toggle("is-maximized", maximized);
        dom.replaceChildren();
        if (!dataSupported()) {
          const message = doc.createElement("p");
          message.textContent = "思维导图数据格式不受支持，暂无法编辑。";
          message.setAttribute("role", "status");
          dom.append(message);
          return;
        }
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        if (selected && !itemAt(tree, selected)) selected = null;
        if (!selected) selectedRange = null;
        if (selectedRange) {
          const parent = itemAt(tree, selectedRange.parent);
          if (!parent || selectedRange.first < 0 || selectedRange.last >= parent.children.length) selectedRange = null;
        }
        const rootLayout = (current.attrs.layout ?? "right") as MindmapLayout;
        const rootSide: BranchSide = rootLayout === "left" || rootLayout.endsWith("left") ? "left" : "right";
        const treeGroups: Array<{ label: HTMLElement; children: HTMLElement; side: BranchSide }> = [];
        type TimelineNode = { label: HTMLElement; color: string; width: number; line: boolean };
        type TimelineGroup = { side: BranchSide; nodes: TimelineNode[] };
        const timelineGroups: TimelineGroup[] = [];
        const nodeEntries: Array<{ item: MindmapItem; path: number[]; label: HTMLElement }> = [];
        const groupedSummaries: Array<{
          parent: number[];
          first: number;
          span: number;
          side: BranchSide;
          layout: MindmapLayout;
          row: HTMLElement;
          label: HTMLElement;
        }> = [];
        const links: Array<{
          parent: HTMLElement;
          child: HTMLElement;
          color: string;
          width: number;
          parentLine: boolean;
          childLine: boolean;
          summary: boolean;
          side: BranchSide;
          layout: MindmapLayout;
        }> = [];
        const colors = ["#a48ed5", "#7989d5", "#8cc5bd", "#d5ba74", "#db9292"];
        const render = (
          item: MindmapItem,
          path: number[],
          parent?: HTMLElement,
          side: BranchSide = "right",
          inheritedColor?: string,
          parentLine = false,
          inheritedLayout: MindmapLayout = rootLayout,
          parentLayout: MindmapLayout = rootLayout,
          parentTimeline?: TimelineGroup,
        ): HTMLElement => {
          const layout = path.length ? resolveSubtreeLayout(item, inheritedLayout, side) : rootLayout;
          const vertical = layout === "up" || layout === "down";
          const treeLayout = isTreeLayout(layout);
          const timelineLayout = isTimelineLayout(layout);
          const treeUp = treeLayout && layout.includes("-up-");
          const treeSide: BranchSide =
            treeLayout || timelineLayout ? (layout.endsWith("left") ? "left" : "right") : side;
          const row = doc.createElement("div");
          row.className = `semlo-editor-mindmap-branch${path.length ? "" : " semlo-editor-mindmap-root"}`;
          if (timelineLayout) {
            row.classList.add("is-timeline");
            if (treeSide === "left") row.classList.add("is-timeline-left");
          } else if (treeLayout) {
            row.classList.add("is-tree");
            if (treeUp) row.classList.add("is-tree-up");
            if (treeSide === "left") row.classList.add("is-tree-left");
          } else if (vertical) {
            row.classList.add("is-vertical");
            if (layout === "up") row.classList.add("is-up");
          } else if (path.length && side === "left") row.classList.add("is-left");
          const labelWrap = doc.createElement("div");
          labelWrap.className = "semlo-editor-mindmap-label-wrap";
          if (timelineLayout && mindmapShape(item, !path.length) !== "line") labelWrap.classList.add("is-timeline-box");
          labelWrap.classList.toggle("is-selected", isSelected(path));
          const label: HTMLElement = editor.isEditable ? doc.createElement("button") : doc.createElement("div");
          if (editor.isEditable) (label as HTMLButtonElement).type = "button";
          label.className = "semlo-editor-mindmap-label";
          if (item.nodeId) label.dataset.mindmapNodeId = item.nodeId;
          nodeEntries.push({ item, path, label });
          const color =
            item.branch?.color ??
            (path.length > 1 ? inheritedColor : undefined) ??
            colors[(path[0] ?? 0) % colors.length];
          const timelineNode = {
            label,
            color,
            width: item.branch?.width ?? 3,
            line: mindmapShape(item, !path.length) === "line",
          };
          if (path.length && parent) {
            const groupedSummary = path[path.length - 1] === -1 && itemAt(tree, path.slice(0, -1))?.summarySpan;
            if (isTimelineLayout(parentLayout) && parentTimeline && !groupedSummary)
              parentTimeline.nodes.push(timelineNode);
            else
              links.push({
                parent,
                child: label,
                color,
                width: item.branch?.width ?? 3,
                parentLine,
                childLine: mindmapShape(item, false) === "line",
                summary: path[path.length - 1] === -1,
                side,
                layout: parentLayout,
              });
          }
          applyAppearance(label, item, !path.length, color, vertical);
          let ownTimeline: TimelineGroup | undefined;
          if (timelineLayout) {
            if (parentTimeline && isTimelineLayout(parentLayout) && parentLayout === layout)
              ownTimeline = parentTimeline;
            else {
              ownTimeline = { side: treeSide, nodes: [timelineNode] };
              timelineGroups.push(ownTimeline);
            }
          }
          for (const marker of itemMarkers(item)) {
            const badge = doc.createElement("span");
            badge.className = "semlo-editor-mindmap-marker";
            badge.setAttribute("aria-hidden", "true");
            badge.title = markerLabel(marker.kind, marker.value);
            badge.style.background = markerBackground(marker.kind, marker.value);
            badge.textContent = markerGlyph(marker.kind, marker.value);
            if (editor.isEditable)
              badge.addEventListener("click", (event) => {
                event.stopPropagation();
                selected = path;
                branchMenuOpen = false;
                shapeMenuOpen = false;
                styleMenuOpen = false;
                linkMenuOpen = false;
                linkSelection = null;
                markerCategory = marker.kind;
                markerMenuOpen = true;
                paint();
                dom
                  .querySelector<HTMLElement>(`[data-mindmap-marker-control="${marker.kind}-${marker.value}"]`)
                  ?.focus();
              });
            label.append(badge);
          }
          if (item.links?.length || (!editor.isEditable && item.href)) {
            let offset = 0;
            for (const link of itemLinks(item)) {
              if (offset < link.from) label.append(doc.createTextNode(item.text.slice(offset, link.from)));
              const segment = editor.isEditable ? doc.createElement("span") : doc.createElement("a");
              segment.className = "semlo-editor-mindmap-link-text";
              if (!editor.isEditable) {
                const anchor = segment as HTMLAnchorElement;
                anchor.href = link.href;
                anchor.target = "_blank";
                anchor.rel = "noopener noreferrer";
              }
              if (item.style?.color) segment.style.color = item.style.color;
              segment.textContent = item.text.slice(link.from, link.to);
              label.append(segment);
              offset = link.to;
            }
            if (offset < item.text.length) label.append(doc.createTextNode(item.text.slice(offset)));
          } else label.append(doc.createTextNode(item.text));
          applyTextStyle(label, item, path.length === 0);
          label.setAttribute(
            "aria-label",
            `${!path.length ? "中心节点" : path[path.length - 1] === -1 ? "概要" : "节点"}：${item.text}`,
          );
          if (itemMarkers(item).length)
            label.setAttribute(
              "aria-description",
              itemMarkers(item)
                .map(({ kind, value }) => markerLabel(kind, value))
                .join("，"),
            );
          if (editor.isEditable) label.setAttribute("aria-pressed", String(isSelected(path)));
          label.addEventListener("click", (event) => {
            if (!editor.isEditable) return;
            if (
              event.shiftKey &&
              selected &&
              path.length > 0 &&
              path[path.length - 1] >= 0 &&
              selected[selected.length - 1] >= 0 &&
              samePath(path.slice(0, -1), selected.slice(0, -1))
            ) {
              const parent = path.slice(0, -1);
              const anchor =
                selectedRange && samePath(selectedRange.parent, parent)
                  ? selectedRange.anchor
                  : selected[selected.length - 1];
              const target = path[path.length - 1];
              if (anchor !== target) {
                selectedRange = { parent, anchor, first: Math.min(anchor, target), last: Math.max(anchor, target) };
                selected = path;
                selectedText = null;
                selectedShape = null;
                clearLineSelection();
                branchMenuOpen = shapeMenuOpen = markerMenuOpen = styleMenuOpen = linkMenuOpen = false;
                markerCategory = null;
                linkSelection = null;
                paint();
                focusSelected();
                return;
              }
            }
            selectedRange = null;
            selected = path;
            selectedText = null;
            selectedShape = null;
            clearLineSelection();
            dom.querySelector(".semlo-editor-mindmap-shape-group")?.remove();
            dom.querySelector(".semlo-editor-mindmap-shape-toolbar")?.remove();
            dom.querySelectorAll(".semlo-editor-mindmap-canvas-shape.is-selected").forEach((element) => {
              element.classList.remove("is-selected");
              element.querySelector(".semlo-editor-mindmap-shape-toolbar")?.remove();
              element.querySelector(".semlo-editor-mindmap-shape-resize")?.remove();
              element.querySelector(".semlo-editor-mindmap-shape-rotate")?.remove();
              element.querySelector("button")?.setAttribute("aria-pressed", "false");
            });
            dom.querySelectorAll(".semlo-editor-mindmap-annotation.is-selected").forEach((element) => {
              element.classList.remove("is-selected");
              element.querySelector(".semlo-editor-mindmap-annotation-toolbar")?.remove();
              element.querySelector(".semlo-editor-mindmap-annotation-rotate")?.remove();
              element.querySelectorAll(".semlo-editor-mindmap-annotation-resize").forEach((handle) => handle.remove());
              element.querySelector("button")?.setAttribute("aria-pressed", "false");
            });
            branchMenuOpen = false;
            shapeMenuOpen = false;
            markerMenuOpen = false;
            markerCategory = null;
            styleMenuOpen = false;
            linkMenuOpen = false;
            linkSelection = null;
            dom
              .querySelectorAll<HTMLButtonElement>(".semlo-editor-mindmap-label")
              .forEach((button) => button.setAttribute("aria-pressed", String(button === label)));
            dom
              .querySelectorAll(".semlo-editor-mindmap-label-wrap.is-selected")
              .forEach((wrap) => wrap.classList.remove("is-selected"));
            labelWrap.classList.add("is-selected");
            dom.querySelectorAll(".semlo-editor-mindmap-add").forEach((button) => button.remove());
            dom.querySelectorAll(".semlo-editor-mindmap-structure").forEach((toolbar) => toolbar.remove());
            if (editor.isEditable) {
              labelWrap.append(makePlus(path));
              labelWrap.append(makeNodeToolbar(path, item, color));
              draw();
            }
          });
          label.addEventListener("dblclick", () => {
            selectedRange = null;
            selected = path;
            branchMenuOpen = false;
            shapeMenuOpen = false;
            markerMenuOpen = false;
            markerCategory = null;
            styleMenuOpen = false;
            linkMenuOpen = false;
            linkSelection = null;
            edit(path);
          });
          label.addEventListener("keydown", (event) => {
            if (!editor.isEditable || event.isComposing) return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
              event.preventDefault();
              (event.shiftKey ? redo : undo)(view.state, view.dispatch);
              focusSelected();
              return;
            }
            if (selectedRange && ["Tab", "Enter", "Backspace", "Delete"].includes(event.key)) {
              event.preventDefault();
              return;
            }
            if (event.key === "Tab" && !event.shiftKey) {
              event.preventDefault();
              add(path, false);
            } else if (event.key === "Enter" && path.length) {
              event.preventDefault();
              add(path, true);
            } else if ((event.key === "Backspace" || event.key === "Delete") && path.length) {
              event.preventDefault();
              remove(path);
            }
          });
          labelWrap.append(label);
          for (const link of editor.isEditable ? itemLinks(item) : []) {
            const openLink = doc.createElement("a");
            openLink.className = "semlo-editor-mindmap-open-link";
            openLink.href = link.href;
            openLink.target = "_blank";
            openLink.rel = "noopener noreferrer";
            openLink.setAttribute(
              "aria-label",
              item.href ? "打开节点链接" : `打开节点链接：${item.text.slice(link.from, link.to)}`,
            );
            openLink.title = "打开链接";
            openLink.textContent = "↗";
            labelWrap.append(openLink);
          }
          if ((item.children.length || (item.summary && !item.summarySpan)) && path.length) {
            const toggle = doc.createElement("button");
            toggle.type = "button";
            toggle.className = "semlo-editor-mindmap-collapse";
            toggle.setAttribute("aria-label", item.collapsed ? "展开分支" : "折叠分支");
            toggle.setAttribute("aria-expanded", String(!item.collapsed));
            toggle.textContent = item.collapsed ? String(hiddenDescendantCount(item)) : "‹";
            toggle.disabled = !editor.isEditable;
            toggle.addEventListener("click", () => toggleCollapsed(path));
            labelWrap.append(toggle);
            labelWrap.classList.add("has-children");
          }
          if (isActive(path) && editor.isEditable && !selectedRange) labelWrap.append(makePlus(path));
          if (editor.isEditable && selectedRange && isSelected(path) && path[path.length - 1] === selectedRange.first)
            labelWrap.append(makeNodeToolbar(path, item, color));
          else if (editor.isEditable && isActive(path) && !selectedRange)
            labelWrap.append(makeNodeToolbar(path, item, color));
          const makeChildren = (indexes: number[], childSide: BranchSide) => {
            const children = doc.createElement("div");
            children.className = "semlo-editor-mindmap-children";
            if (timelineLayout) {
              children.classList.add("is-timeline");
              if (treeSide === "left") children.classList.add("is-timeline-left");
            } else if (treeLayout) {
              children.classList.add("is-tree");
              if (treeUp) children.classList.add("is-tree-up");
              if (treeSide === "left") children.classList.add("is-tree-left");
              treeGroups.push({ label, children, side: treeSide });
            } else if (vertical) {
              children.classList.add("is-vertical");
              if (layout === "up") children.classList.add("is-up");
            } else if (childSide === "left") children.classList.add("is-left");
            indexes.forEach((index) => {
              const child = render(
                index === -1 ? item.summary! : item.children[index],
                [...path, index],
                label,
                childSide,
                color,
                mindmapShape(item, !path.length) === "line",
                layout === "balanced" ? childSide : layout,
                layout,
                ownTimeline,
              );
              children.append(child);
              const groupParentLayout = item.summarySpan ? subtreeLayoutAt(path.slice(0, -1)) : null;
              if (
                index === -1 &&
                item.summarySpan &&
                groupParentLayout &&
                (isTreeLayout(groupParentLayout) ||
                  isTimelineLayout(groupParentLayout) ||
                  ["left", "right", "balanced", "up", "down"].includes(groupParentLayout))
              ) {
                child.classList.add("is-group-summary");
                children.classList.add("has-group-summary");
                if (indexes.length === 1) children.classList.add("has-only-group-summary");
                const summaryLabel = child.querySelector<HTMLElement>(".semlo-editor-mindmap-label");
                if (summaryLabel)
                  groupedSummaries.push({
                    parent: path.slice(0, -1),
                    first: path[path.length - 1],
                    span: item.summarySpan,
                    side: childSide,
                    layout: groupParentLayout,
                    row: child,
                    label: summaryLabel,
                  });
              }
            });
            return children;
          };
          const indexes = item.collapsed
            ? item.summarySpan && item.summary
              ? [-1]
              : []
            : [...item.children.map((_, index) => index), ...(item.summary ? [-1] : [])];
          if (timelineLayout) {
            row.append(labelWrap);
            if (indexes.length) row.append(makeChildren(indexes, treeSide));
          } else if (treeLayout) {
            row.append(labelWrap);
            if (indexes.length) row.append(makeChildren(indexes, treeSide));
          } else if (vertical) {
            row.append(labelWrap);
            if (indexes.length) row.append(makeChildren(indexes, "right"));
          } else if (!path.length) {
            const split = layout === "balanced" ? balancedSplit(item.children) : undefined;
            const left = indexes.filter((index) => branchSide(layout, index, item.children, split) === "left");
            const right = indexes.filter((index) => branchSide(layout, index, item.children, split) === "right");
            if (left.length) row.append(makeChildren(left, "left"));
            row.append(labelWrap);
            if (right.length) row.append(makeChildren(right, "right"));
          } else {
            row.append(labelWrap);
            if (indexes.length) row.append(makeChildren(indexes, side));
          }
          return row;
        };
        const content = doc.createElement("div");
        content.className = "semlo-editor-mindmap-content";
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("semlo-editor-mindmap-lines");
        svg.setAttribute("aria-hidden", "true");
        content.append(svg, render(tree, [], undefined, rootSide));
        const frame = doc.createElement("div");
        frame.className = "semlo-editor-mindmap-frame";
        frame.append(content);
        const viewport = doc.createElement("div");
        viewport.className = "semlo-editor-mindmap-viewport";
        viewport.append(frame);
        dom.append(viewport);
        const annotations = readMindmapCanvasText(current.attrs.annotations);
        if (selectedText !== null && !annotations[selectedText]) selectedText = null;
        const annotationWrappers: HTMLElement[] = [];
        let repositionAnnotation: (() => void) | null = null;
        const annotationControlShift = (rect: DOMRect) => {
          const bounds = dom.getBoundingClientRect();
          const rail = dom.querySelector<HTMLElement>(".semlo-editor-mindmap-tools")?.getBoundingClientRect();
          // 只在纵向重叠时避开侧栏，同时将浮层尽量保留在画布内。
          const left = rail && rect.top < rail.bottom && rect.bottom > rail.top ? rail.right + 4 : bounds.left + 4;
          const target = Math.max(bounds.left + 4, Math.min(bounds.right - 4 - rect.width, Math.max(left, rect.left)));
          return target - rect.left;
        };
        const normalizeTextAngle = (angle: number) => ((((Math.round(angle) + 180) % 360) + 360) % 360) - 180;
        const positionAnnotationControls = (wrapper: HTMLElement, label: HTMLElement, rotation: number) => {
          const angle = (rotation * Math.PI) / 180;
          const extra = Math.max(
            0,
            (Math.abs(Math.sin(angle)) * label.offsetWidth +
              Math.abs(Math.cos(angle)) * label.offsetHeight -
              label.offsetHeight) /
              2,
          );
          const toolbar = wrapper.querySelector<HTMLElement>(".semlo-editor-mindmap-annotation-toolbar");
          const rotate = wrapper.querySelector<HTMLElement>(".semlo-editor-mindmap-annotation-rotate");
          if (toolbar) {
            toolbar.style.bottom = `${label.offsetHeight + extra + 24}px`;
            toolbar.style.transform = "translateX(-50%)";
            const shift = annotationControlShift(toolbar.getBoundingClientRect());
            if (shift) toolbar.style.transform = `translateX(calc(-50% + ${shift / (zoom / 100)}px))`;
          }
          if (rotate) rotate.style.top = `${-26 - extra}px`;
          wrapper.querySelectorAll<HTMLElement>(".semlo-editor-mindmap-annotation-resize").forEach((handle) => {
            const corner = handle.dataset.corner ?? "se";
            const x = ((corner.includes("e") ? 1 : -1) * label.offsetWidth) / 2;
            const y = ((corner.includes("s") ? 1 : -1) * label.offsetHeight) / 2;
            handle.style.left = `${label.offsetWidth / 2 + Math.cos(angle) * x - Math.sin(angle) * y}px`;
            handle.style.top = `${label.offsetHeight / 2 + Math.sin(angle) * x + Math.cos(angle) * y}px`;
          });
        };
        const focusAnnotation = (index: number) =>
          dom.querySelector<HTMLButtonElement>(`[data-mindmap-annotation="${index}"]`)?.focus({ preventScroll: true });
        const changeAnnotation = (index: number, change: (item: MindmapCanvasText) => void) => {
          const items = readMindmapCanvasText(current.attrs.annotations);
          const item = items[index];
          if (!item || selectedText !== index) return;
          annotationLinkOpen = false;
          annotationLinkSelection = null;
          change(item);
          if (commitAnnotations(items)) focusAnnotation(index);
        };
        const selectAnnotation = (index: number) => {
          const wrapper = annotationWrappers[index];
          const item = annotations[index];
          if (!wrapper || !item) return;
          if (selectedText === index && wrapper.querySelector(".semlo-editor-mindmap-annotation-toolbar")) return;
          if (selectedText !== index) {
            annotationLinkOpen = false;
            annotationLinkSelection = null;
          }
          selectedText = index;
          selected = null;
          selectedShape = null;
          clearLineSelection();
          dom.querySelector(".semlo-editor-mindmap-shape-group")?.remove();
          dom.querySelector(".semlo-editor-mindmap-shape-toolbar")?.remove();
          dom.querySelectorAll(".semlo-editor-mindmap-canvas-shape.is-selected").forEach((element) => {
            element.classList.remove("is-selected");
            element.querySelector(".semlo-editor-mindmap-shape-toolbar")?.remove();
            element.querySelector(".semlo-editor-mindmap-shape-resize")?.remove();
            element.querySelector(".semlo-editor-mindmap-shape-rotate")?.remove();
            element.querySelector("button")?.setAttribute("aria-pressed", "false");
          });
          dom
            .querySelectorAll(".semlo-editor-mindmap-label-wrap.is-selected")
            .forEach((element) => element.classList.remove("is-selected"));
          dom
            .querySelectorAll<HTMLButtonElement>(".semlo-editor-mindmap-label")
            .forEach((button) => button.setAttribute("aria-pressed", "false"));
          dom
            .querySelectorAll(".semlo-editor-mindmap-add, .semlo-editor-mindmap-structure")
            .forEach((element) => element.remove());
          annotationWrappers.forEach((element, position) => {
            element.classList.toggle("is-selected", position === index);
            element.querySelector("button")?.setAttribute("aria-pressed", String(position === index));
            element.querySelector(".semlo-editor-mindmap-annotation-toolbar")?.remove();
            element.querySelector(".semlo-editor-mindmap-annotation-rotate")?.remove();
            element.querySelectorAll(".semlo-editor-mindmap-annotation-resize").forEach((handle) => handle.remove());
          });
          const toolbar = doc.createElement("div");
          toolbar.className = "semlo-editor-mindmap-annotation-toolbar";
          toolbar.setAttribute("role", "toolbar");
          toolbar.setAttribute("aria-label", "画布文字样式");
          const size = doc.createElement("input");
          size.type = "number";
          size.min = "8";
          size.max = "96";
          size.value = String(item.size);
          size.setAttribute("aria-label", "画布文字字号");
          size.addEventListener("change", () => {
            const value = Number(size.value);
            if (Number.isFinite(value))
              changeAnnotation(index, (text) => (text.size = Math.max(8, Math.min(96, value))));
          });
          const sizeControl = doc.createElement("span");
          sizeControl.className = "semlo-editor-mindmap-annotation-size";
          sizeControl.append(size);
          const bold = doc.createElement("button");
          bold.type = "button";
          bold.setAttribute("aria-label", "画布文字加粗");
          bold.setAttribute("aria-pressed", String(item.bold));
          bold.textContent = "B";
          bold.addEventListener("click", () => changeAnnotation(index, (text) => (text.bold = !text.bold)));
          const toolbarNode = current;
          const toolbarEpoch = documentEpoch;
          const color = createMindmapColorControl(doc, "画布文字颜色", item.color, (value) => {
            if (destroyed || documentEpoch !== toolbarEpoch || !current.eq(toolbarNode)) return;
            changeAnnotation(index, (text) => (text.color = value));
          });
          const align = doc.createElement("select");
          align.setAttribute("aria-label", "画布文字水平对齐");
          for (const [value, name] of [
            ["left", "左"],
            ["center", "中"],
            ["right", "右"],
            ["justify", "两端"],
          ] as const) {
            const option = doc.createElement("option");
            option.value = value;
            option.textContent = name;
            align.append(option);
          }
          align.value = item.align ?? "left";
          align.addEventListener("change", () => {
            const value = align.value as NonNullable<MindmapCanvasText["align"]>;
            changeAnnotation(index, (text) => (text.align = value));
          });
          const vertical = doc.createElement("select");
          vertical.setAttribute("aria-label", "画布文字垂直对齐");
          for (const [value, name] of [
            ["top", "上"],
            ["middle", "中"],
            ["bottom", "下"],
          ] as const) {
            const option = doc.createElement("option");
            option.value = value;
            option.textContent = name;
            vertical.append(option);
          }
          vertical.value = item.verticalAlign ?? "middle";
          vertical.addEventListener("change", () => {
            const value = vertical.value as NonNullable<MindmapCanvasText["verticalAlign"]>;
            changeAnnotation(index, (text) => (text.verticalAlign = value));
          });
          const linkToggle = doc.createElement("button");
          linkToggle.type = "button";
          linkToggle.setAttribute("aria-label", "插入画布文字链接");
          linkToggle.setAttribute("aria-expanded", String(annotationLinkOpen));
          linkToggle.title = "插入链接";
          linkToggle.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 7l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
          const linkMenu = doc.createElement("div");
          linkMenu.className = "semlo-editor-mindmap-link-menu";
          linkMenu.setAttribute("role", "dialog");
          linkMenu.setAttribute("aria-label", "画布文字链接");
          linkMenu.hidden = !annotationLinkOpen;
          const existingLinks = itemLinks(item);
          const lastLink = existingLinks.at(-1);
          const initialRange =
            annotationLinkSelection?.index === index
              ? annotationLinkSelection
              : lastLink
                ? { from: item.text.length, to: item.text.length }
                : { from: 0, to: item.text.length };
          const matchingLink = existingLinks.find(
            (link) =>
              link.from <= initialRange.from && link.to >= initialRange.to && initialRange.from !== initialRange.to,
          );
          const textLabel = doc.createElement("label");
          textLabel.textContent = "文本";
          const linkText = doc.createElement("input");
          const selectedLinkText = item.text.slice(initialRange.from, initialRange.to);
          linkText.value = selectedLinkText || lastLink?.href || "链接";
          // 单行 input 会规范化换行；未改写文本时保留原本的多行选区。
          const displayedLinkText = linkText.value;
          textLabel.append(linkText);
          const urlLabel = doc.createElement("label");
          urlLabel.textContent = "链接";
          const linkURL = doc.createElement("input");
          linkURL.value = matchingLink?.href ?? (initialRange.from === item.text.length ? (lastLink?.href ?? "") : "");
          linkURL.placeholder = "链接地址";
          linkURL.autocomplete = "off";
          linkURL.dataset.annotationLinkUrl = "";
          urlLabel.append(linkURL);
          const actions = doc.createElement("div");
          actions.className = "semlo-editor-mindmap-link-actions";
          const confirm = doc.createElement("button");
          confirm.type = "button";
          confirm.textContent = "确定";
          const linkNode = current,
            linkEpoch = documentEpoch;
          const closeLink = () => {
            annotationLinkOpen = false;
            annotationLinkSelection = null;
            linkMenu.hidden = true;
            linkToggle.setAttribute("aria-expanded", "false");
          };
          const fitLinkMenu = () => {
            if (linkMenu.hidden) return;
            linkMenu.style.transform = "";
            const shift = annotationControlShift(linkMenu.getBoundingClientRect());
            if (shift) linkMenu.style.transform = `translateX(${shift / (zoom / 100)}px)`;
          };
          const updateLink = (remove: boolean) => {
            if (destroyed || documentEpoch !== linkEpoch || !current.eq(linkNode) || selectedText !== index) return;
            const href = remove ? null : normalizeLinkURL(linkURL.value);
            const replacementText =
              selectedLinkText && linkText.value === displayedLinkText ? selectedLinkText : linkText.value;
            if (!remove && (!href || !replacementText.trim())) {
              const field = !href ? linkURL : linkText;
              field.setCustomValidity(!href ? "请输入有效的链接地址" : "请输入链接文本");
              field.reportValidity();
              return;
            }
            const items = readMindmapCanvasText(current.attrs.annotations);
            const target = items[index];
            if (!target) return;
            let { from, to } = annotationLinkSelection ?? initialRange;
            if (remove && from === to) {
              const link = itemLinks(target).find((entry) => from > entry.from && from < entry.to);
              if (!link) return;
              from = link.from;
              to = link.to;
            }
            if (
              from < 0 ||
              to < from ||
              to > target.text.length ||
              !textBoundary(target.text, from) ||
              !textBoundary(target.text, to)
            )
              return;
            replaceItemText(target, from, to, remove ? target.text.slice(from, to) : replacementText, href);
            annotationLinkOpen = false;
            annotationLinkSelection = null;
            if (commitAnnotations(items)) focusAnnotation(index);
          };
          linkText.addEventListener("input", () => linkText.setCustomValidity(""));
          linkURL.addEventListener("input", () => linkURL.setCustomValidity(""));
          confirm.addEventListener("click", () => updateLink(false));
          actions.append(confirm);
          if (existingLinks.some((link) => link.from < initialRange.to && link.to > initialRange.from)) {
            const remove = doc.createElement("button");
            remove.type = "button";
            remove.textContent = "移除链接";
            remove.addEventListener("click", () => updateLink(true));
            actions.append(remove);
          }
          linkMenu.append(textLabel, urlLabel, actions);
          linkToggle.addEventListener("mousedown", (event) => event.preventDefault());
          linkToggle.addEventListener("click", () => {
            const field = wrapper.querySelector<HTMLTextAreaElement>(".semlo-editor-mindmap-annotation-input");
            if (field && finishInput) {
              const draft = field.value,
                from = field.selectionStart ?? 0,
                to = field.selectionEnd ?? from;
              finishInput(true);
              const live = readMindmapCanvasText(current.attrs.annotations)[index];
              if (destroyed || !editor.isEditable || selectedText !== index || live?.text !== draft) return;
              annotationLinkSelection = { index, from, to };
              annotationLinkOpen = true;
              paint();
              dom.querySelector<HTMLInputElement>("[data-annotation-link-url]")?.focus();
              return;
            }
            if (annotationLinkOpen) return closeLink();
            annotationLinkSelection = { index, from: initialRange.from, to: initialRange.to };
            annotationLinkOpen = true;
            linkMenu.hidden = false;
            linkToggle.setAttribute("aria-expanded", "true");
            fitLinkMenu();
            linkURL.focus();
          });
          linkMenu.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault();
              updateLink(false);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeLink();
              linkToggle.focus();
            }
          });
          toolbar.append(sizeControl, color.element, align, vertical, bold, linkToggle, linkMenu);
          const rotate = doc.createElement("button");
          rotate.type = "button";
          rotate.className = "semlo-editor-mindmap-annotation-rotate";
          rotate.setAttribute("aria-label", "旋转画布文字");
          rotate.title = "旋转";
          rotate.textContent = "↻";
          rotate.addEventListener("pointerdown", (event) => {
            if (drawingTool !== "select" || panEnabled || event.button !== 0 || cancelTextDrag) return;
            event.preventDefault();
            event.stopPropagation();
            if (finishInput) {
              finishInput(true);
              if (!wrapper.isConnected) return;
            }
            const label = wrapper.querySelector<HTMLElement>(`[data-mindmap-annotation="${index}"]`);
            if (!label) return;
            const source = current;
            const epoch = documentEpoch;
            const pointer = event.pointerId;
            const box = label.getBoundingClientRect();
            const centerX = box.left + box.width / 2;
            const centerY = box.top + box.height / 2;
            const start = Math.atan2(event.clientY - centerY, event.clientX - centerX);
            const original = item.rotation ?? 0;
            let rotation = original;
            let active = true;
            const show = () => {
              label.style.transform = `rotate(${rotation}deg)`;
              positionAnnotationControls(wrapper, label, rotation);
            };
            const cleanup = () => {
              if (!active) return;
              active = false;
              rotate.removeEventListener("pointermove", move);
              rotate.removeEventListener("pointerup", finish);
              rotate.removeEventListener("pointercancel", abort);
              rotate.removeEventListener("lostpointercapture", abort);
              if (rotate.hasPointerCapture?.(pointer)) rotate.releasePointerCapture(pointer);
              cancelTextDrag = null;
            };
            const abort = () => {
              cleanup();
              rotation = original;
              show();
            };
            const move = (next: PointerEvent) => {
              if (next.pointerId !== pointer) return;
              const angle =
                original + ((Math.atan2(next.clientY - centerY, next.clientX - centerX) - start) * 180) / Math.PI;
              rotation = normalizeTextAngle(next.shiftKey ? Math.round(angle / 15) * 15 : angle);
              show();
            };
            const finish = (next: PointerEvent) => {
              if (next.pointerId !== pointer) return;
              move(next);
              cleanup();
              if (destroyed || documentEpoch !== epoch || !current.eq(source)) return;
              if (rotation !== original) {
                const items = readMindmapCanvasText(current.attrs.annotations);
                if (items[index]) items[index].rotation = rotation;
                if (items[index] && commitAnnotations(items)) focusAnnotation(index);
                else abort();
              } else abort();
            };
            cancelTextDrag = abort;
            rotate.addEventListener("pointermove", move);
            rotate.addEventListener("pointerup", finish);
            rotate.addEventListener("pointercancel", abort);
            rotate.addEventListener("lostpointercapture", abort);
            try {
              rotate.setPointerCapture(pointer);
            } catch {
              abort();
            }
          });
          rotate.addEventListener("keydown", (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
              event.preventDefault();
              (event.shiftKey ? redo : undo)(view.state, view.dispatch);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home") {
              event.preventDefault();
              const amount = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 15 : 1);
              changeAnnotation(
                index,
                (text) =>
                  (text.rotation = event.key === "Home" ? 0 : normalizeTextAngle((text.rotation ?? 0) + amount)),
              );
            } else return;
            const handle = dom.querySelector<HTMLElement>(".semlo-editor-mindmap-annotation-rotate");
            if (handle) handle.focus({ preventScroll: true });
            else dom.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
          });
          wrapper.append(toolbar, rotate);
          const label = wrapper.querySelector<HTMLElement>(`[data-mindmap-annotation="${index}"]`);
          if (!label) return;
          for (const [corner, name] of [
            ["nw", "左上"],
            ["ne", "右上"],
            ["sw", "左下"],
            ["se", "右下"],
          ] as const) {
            const handle = doc.createElement("button");
            handle.type = "button";
            handle.className = "semlo-editor-mindmap-annotation-resize";
            handle.dataset.corner = corner;
            handle.setAttribute("aria-label", `调整画布文字大小：${name}`);
            const geometry = (dx: number, dy: number, width: number, height: number) => {
              const sx = corner.includes("e") ? 1 : -1;
              const sy = corner.includes("s") ? 1 : -1;
              const angle = ((item.rotation ?? 0) * Math.PI) / 180;
              const cos = Math.cos(angle),
                sin = Math.sin(angle);
              const w = Math.max(24, Math.min(5000, width + sx * (cos * dx + sin * dy)));
              const h = Math.max(24, Math.min(5000, height + sy * (-sin * dx + cos * dy)));
              const fixedX = item.x + width / 2 - (cos * sx * width) / 2 + (sin * sy * height) / 2;
              const fixedY = item.y + height / 2 - (sin * sx * width) / 2 - (cos * sy * height) / 2;
              const x = fixedX + (cos * sx * w) / 2 - (sin * sy * h) / 2 - w / 2;
              const y = fixedY + (sin * sx * w) / 2 + (cos * sy * h) / 2 - h / 2;
              return {
                x: Math.round(x * 100) / 100,
                y: Math.round(y * 100) / 100,
                width: Math.round(w * 100) / 100,
                height: Math.round(h * 100) / 100,
              };
            };
            const apply = (value: ReturnType<typeof geometry>) => {
              if (Math.abs(value.x) > 100000 || Math.abs(value.y) > 100000) return false;
              const items = readMindmapCanvasText(current.attrs.annotations);
              if (!items[index]) return false;
              Object.assign(items[index], value);
              return commitAnnotations(items);
            };
            handle.addEventListener("pointerdown", (event) => {
              if (drawingTool !== "select" || panEnabled || event.button !== 0 || cancelTextDrag) return;
              event.preventDefault();
              event.stopPropagation();
              if (finishInput) {
                finishInput(true);
                if (!wrapper.isConnected) return;
              }
              const source = current,
                epoch = documentEpoch,
                pointer = event.pointerId;
              const startX = event.clientX,
                startY = event.clientY;
              const width = label.offsetWidth,
                height = label.offsetHeight;
              let next = geometry(0, 0, width, height);
              let active = true;
              const show = () => {
                wrapper.style.left = `${next.x}px`;
                wrapper.style.top = `${next.y}px`;
                wrapper.style.width = `${next.width}px`;
                wrapper.style.height = `${next.height}px`;
                label.style.width = "100%";
                label.style.height = "100%";
                positionAnnotationControls(wrapper, label, item.rotation ?? 0);
              };
              const cleanup = () => {
                if (!active) return;
                active = false;
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", finish);
                handle.removeEventListener("pointercancel", abort);
                handle.removeEventListener("lostpointercapture", abort);
                try {
                  if (handle.hasPointerCapture?.(pointer)) handle.releasePointerCapture(pointer);
                } catch {
                  // 节点重绘后捕获可能已经由浏览器释放。
                }
                cancelTextDrag = null;
              };
              const abort = () => {
                cleanup();
                wrapper.style.left = `${item.x}px`;
                wrapper.style.top = `${item.y}px`;
                wrapper.style.width = item.width === undefined ? "" : `${item.width}px`;
                wrapper.style.height = item.height === undefined ? "" : `${item.height}px`;
                label.style.width = item.width === undefined ? "" : "100%";
                label.style.height = item.height === undefined ? "" : "100%";
                positionAnnotationControls(wrapper, label, item.rotation ?? 0);
              };
              const move = (nextEvent: PointerEvent) => {
                if (nextEvent.pointerId !== pointer) return;
                const scale = zoom / 100;
                next = geometry(
                  (nextEvent.clientX - startX) / scale,
                  (nextEvent.clientY - startY) / scale,
                  width,
                  height,
                );
                show();
              };
              const finish = (nextEvent: PointerEvent) => {
                if (nextEvent.pointerId !== pointer) return;
                move(nextEvent);
                cleanup();
                if (destroyed || documentEpoch !== epoch || !current.eq(source)) return;
                if (Math.abs(next.width - width) + Math.abs(next.height - height) > 1 && apply(next))
                  focusAnnotation(index);
                else abort();
              };
              cancelTextDrag = abort;
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
                event.stopPropagation();
                (event.shiftKey ? redo : undo)(view.state, view.dispatch);
                dom
                  .querySelector<HTMLElement>(`.semlo-editor-mindmap-annotation-resize[data-corner="${corner}"]`)
                  ?.focus({ preventScroll: true });
                return;
              }
              if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
              const amount = event.shiftKey ? 10 : 1;
              const dx = event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0;
              const dy = event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0;
              if (!dx && !dy) return;
              event.preventDefault();
              event.stopPropagation();
              if (apply(geometry(dx, dy, label.offsetWidth, label.offsetHeight)))
                dom
                  .querySelector<HTMLElement>(`.semlo-editor-mindmap-annotation-resize[data-corner="${corner}"]`)
                  ?.focus({ preventScroll: true });
            });
            wrapper.append(handle);
          }
          repositionAnnotation = () => {
            if (!wrapper.isConnected || selectedText !== index) return;
            positionAnnotationControls(wrapper, label, item.rotation ?? 0);
            fitLinkMenu();
          };
          repositionAnnotation();
        };
        const editAnnotation = (index: number) => {
          if (!editor.isEditable || finishInput || destroyed) return;
          const item = annotations[index];
          const label = annotationWrappers[index]?.querySelector<HTMLButtonElement>(
            `[data-mindmap-annotation="${index}"]`,
          );
          if (!item || !label) return;
          const source = current;
          const epoch = documentEpoch;
          const field = doc.createElement("textarea");
          field.className = "semlo-editor-mindmap-annotation-input";
          field.setAttribute("aria-label", "编辑画布文字");
          field.value = item.text;
          field.maxLength = 10000;
          field.style.fontSize = `${item.size}px`;
          field.style.fontWeight = item.bold ? "700" : "400";
          field.style.color = item.color;
          field.style.textAlign = item.align ?? "left";
          field.style.transform = `rotate(${item.rotation ?? 0}deg)`;
          field.style.width = `${item.width ?? Math.max(60, label.offsetWidth)}px`;
          field.style.height = `${item.height ?? Math.max(28, label.offsetHeight)}px`;
          if (item.height !== undefined) field.style.overflow = "auto";
          label.replaceWith(field);
          let done = false;
          const finish = (save: boolean) => {
            if (done) return;
            done = true;
            finishInput = null;
            if (destroyed || documentEpoch !== epoch || !current.eq(source)) return;
            if (save && field.value !== item.text) {
              const items = readMindmapCanvasText(current.attrs.annotations);
              changeItemText(items[index], field.value);
              if (commitAnnotations(items)) {
                focusAnnotation(index);
                return;
              }
              done = false;
              finishInput = finish;
              field.setCustomValidity("无法保存文字，请减少画布内容后重试。");
              field.reportValidity();
              field.focus({ preventScroll: true });
              return;
            }
            paint();
            focusAnnotation(index);
          };
          finishInput = finish;
          field.addEventListener("input", () => {
            field.setCustomValidity("");
            if (item.height !== undefined) return;
            field.style.height = "auto";
            field.style.height = `${Math.max(28, field.scrollHeight)}px`;
          });
          field.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              finish(false);
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              finish(true);
            }
          });
          field.addEventListener("blur", () => finish(true));
          field.focus();
          field.select();
        };
        annotations.forEach((item, index) => {
          const wrapper = doc.createElement("div");
          wrapper.className = "semlo-editor-mindmap-annotation";
          wrapper.style.left = `${item.x}px`;
          wrapper.style.top = `${item.y}px`;
          if (item.width !== undefined) wrapper.style.width = `${item.width}px`;
          if (item.height !== undefined) wrapper.style.height = `${item.height}px`;
          const label: HTMLElement = editor.isEditable ? doc.createElement("button") : doc.createElement("div");
          if (editor.isEditable) (label as HTMLButtonElement).type = "button";
          label.className = "semlo-editor-mindmap-annotation-label";
          label.dataset.mindmapAnnotation = String(index);
          label.setAttribute("aria-label", `画布文字：${item.text}`);
          if (editor.isEditable) label.setAttribute("aria-pressed", String(selectedText === index));
          label.style.fontSize = `${item.size}px`;
          label.style.fontWeight = item.bold ? "700" : "400";
          label.style.color = item.color;
          label.style.transform = `rotate(${item.rotation ?? 0}deg)`;
          label.style.textAlign = item.align ?? "left";
          label.style.justifyContent =
            item.verticalAlign === "top" ? "flex-start" : item.verticalAlign === "bottom" ? "flex-end" : "center";
          if (item.width !== undefined) label.style.width = "100%";
          if (item.height !== undefined) label.style.height = "100%";
          const text = doc.createElement("span");
          let textOffset = 0;
          for (const link of itemLinks(item)) {
            if (textOffset < link.from) text.append(doc.createTextNode(item.text.slice(textOffset, link.from)));
            const segment = editor.isEditable ? doc.createElement("span") : doc.createElement("a");
            segment.className = "semlo-editor-mindmap-link-text";
            if (!editor.isEditable) {
              const anchor = segment as HTMLAnchorElement;
              anchor.href = link.href;
              anchor.target = "_blank";
              anchor.rel = "noopener noreferrer";
            }
            segment.textContent = item.text.slice(link.from, link.to);
            text.append(segment);
            textOffset = link.to;
          }
          if (textOffset < item.text.length) text.append(doc.createTextNode(item.text.slice(textOffset)));
          if (!text.hasChildNodes()) text.textContent = " ";
          label.append(text);
          wrapper.append(label);
          if (editor.isEditable) {
            for (const [position, link] of itemLinks(item).entries()) {
              const open = doc.createElement("a");
              open.className = "semlo-editor-mindmap-annotation-open-link";
              open.style.right = `${position * 18}px`;
              open.href = link.href;
              open.target = "_blank";
              open.rel = "noopener noreferrer";
              open.setAttribute("aria-label", `打开画布文字链接：${item.text.slice(link.from, link.to)}`);
              open.textContent = "↗";
              wrapper.append(open);
            }
          }
          annotationWrappers.push(wrapper);
          content.append(wrapper);
          if (!editor.isEditable) return;
          label.addEventListener("pointerdown", (event) => {
            if (drawingTool !== "select" || panEnabled || event.button !== 0 || cancelTextDrag) return;
            event.preventDefault();
            event.stopPropagation();
            if (finishInput) {
              finishInput(true);
              if (!wrapper.isConnected) return;
            }
            selectAnnotation(index);
            const source = current;
            const epoch = documentEpoch;
            const pointer = event.pointerId;
            const startX = event.clientX;
            const startY = event.clientY;
            let x = item.x;
            let y = item.y;
            let active = true;
            const cleanup = () => {
              if (!active) return;
              active = false;
              label.removeEventListener("pointermove", move);
              label.removeEventListener("pointerup", finish);
              label.removeEventListener("pointercancel", abort);
              label.removeEventListener("lostpointercapture", abort);
              if (label.hasPointerCapture?.(pointer)) label.releasePointerCapture(pointer);
              cancelTextDrag = null;
            };
            const abort = () => {
              cleanup();
              wrapper.style.left = `${item.x}px`;
              wrapper.style.top = `${item.y}px`;
            };
            const move = (next: PointerEvent) => {
              if (next.pointerId !== pointer) return;
              const scale = zoom / 100;
              x = Math.round((item.x + (next.clientX - startX) / scale) * 100) / 100;
              y = Math.round((item.y + (next.clientY - startY) / scale) * 100) / 100;
              wrapper.style.left = `${x}px`;
              wrapper.style.top = `${y}px`;
            };
            const finish = (next: PointerEvent) => {
              if (next.pointerId !== pointer) return;
              move(next);
              cleanup();
              if (destroyed || documentEpoch !== epoch || !current.eq(source)) return;
              if (Math.abs(x - item.x) + Math.abs(y - item.y) > 1) {
                const items = readMindmapCanvasText(current.attrs.annotations);
                items[index].x = x;
                items[index].y = y;
                if (commitAnnotations(items)) focusAnnotation(index);
                else abort();
              } else focusAnnotation(index);
            };
            cancelTextDrag = abort;
            label.addEventListener("pointermove", move);
            label.addEventListener("pointerup", finish);
            label.addEventListener("pointercancel", abort);
            label.addEventListener("lostpointercapture", abort);
            try {
              label.setPointerCapture(pointer);
            } catch {
              abort();
            }
          });
          label.addEventListener("dblclick", () => editAnnotation(index));
          label.addEventListener("focus", () => {
            if (drawingTool === "select" && !panEnabled) selectAnnotation(index);
          });
          label.addEventListener("keydown", (event) => {
            if (event.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              selectAnnotation(index);
              editAnnotation(index);
            } else if (event.key === "Backspace" || event.key === "Delete") {
              event.preventDefault();
              const items = readMindmapCanvasText(current.attrs.annotations);
              items.splice(index, 1);
              selectedText = null;
              if (commitAnnotations(items))
                dom.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
            } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
              event.preventDefault();
              (event.shiftKey ? redo : undo)(view.state, view.dispatch);
              if (dom.querySelector(`[data-mindmap-annotation="${index}"]`)) focusAnnotation(index);
              else view.focus();
            } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
              event.preventDefault();
              const amount = event.shiftKey ? 10 : 1;
              changeAnnotation(index, (text) => {
                if (event.key === "ArrowLeft") text.x -= amount;
                else if (event.key === "ArrowRight") text.x += amount;
                else if (event.key === "ArrowUp") text.y -= amount;
                else text.y += amount;
              });
            }
          });
        });
        if (selectedText !== null && editor.isEditable) selectAnnotation(selectedText);
        const shapeData = readMindmapCanvasData(current.attrs.canvasShapes);
        const shapes = shapeData.shapes;
        const shapeIds = new Set(shapes.map((shape) => shape.id));
        const nodeShapes = (): CanvasShape[] => {
          const origin = content.getBoundingClientRect();
          const scale = zoom / 100;
          return nodeEntries.flatMap(({ item, path, label }) => {
            const bounds = label.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return [];
            const id = item.nodeId ? mindmapNodeReference(item.nodeId) : mindmapPendingNodeReference(path);
            if (shapeIds.has(id)) return [];
            return [
              {
                id,
                shape: "rectangle" as const,
                x: (bounds.left - origin.left) / scale,
                y: (bounds.top - origin.top) / scale,
                width: bounds.width / scale,
                height: bounds.height / scale,
                text: "",
              },
            ];
          });
        };
        let previewShapes: CanvasShape[] | null = null;
        let previewFrame: number | null = null;
        if (selectedShape && !shapes.some((item) => item.id === selectedShape)) selectedShape = null;
        const shapeWrappers = new Map<string, HTMLElement>();
        const shapeGroup = (id: string) => shapeData.groups?.find((group) => group.members.includes(id));
        const groupBounds = (items: CanvasShape[]) => {
          const boxes = items.map((item) => {
            const angle = ((item.rotation ?? 0) * Math.PI) / 180;
            const halfWidth = (Math.abs(Math.cos(angle)) * item.width + Math.abs(Math.sin(angle)) * item.height) / 2;
            const halfHeight = (Math.abs(Math.sin(angle)) * item.width + Math.abs(Math.cos(angle)) * item.height) / 2;
            const cx = item.x + item.width / 2;
            const cy = item.y + item.height / 2;
            return { x: cx - halfWidth, y: cy - halfHeight, right: cx + halfWidth, bottom: cy + halfHeight };
          });
          const x = Math.min(...boxes.map((box) => box.x));
          const y = Math.min(...boxes.map((box) => box.y));
          const right = Math.max(...boxes.map((box) => box.right));
          const bottom = Math.max(...boxes.map((box) => box.bottom));
          return { x, y, width: right - x, height: bottom - y };
        };
        let shapeGroupOverlay: HTMLElement | null = null;
        let shapeToolbarOverlay: HTMLElement | null = null;
        const clearShapeGroupOverlay = () => {
          shapeGroupOverlay?.remove();
          shapeGroupOverlay = null;
          shapeToolbarOverlay?.remove();
          shapeToolbarOverlay = null;
        };
        const positionShapeToolbar = (toolbar: HTMLElement, shape: CanvasShape) => {
          const angle = ((shape.rotation ?? 0) * Math.PI) / 180;
          const halfHeight = (Math.abs(Math.sin(angle)) * shape.width + Math.abs(Math.cos(angle)) * shape.height) / 2;
          toolbar.style.left = `${shape.x + shape.width / 2}px`;
          toolbar.style.top = `${shape.y + shape.height / 2 - halfHeight - 30}px`;
          toolbar.style.bottom = "auto";
          toolbar.style.transform = "translate(-50%, -100%)";
        };
        const shapeNames = new Map<string, string>();
        for (const category of shapeCatalog)
          for (const entry of category.entries)
            if (!shapeNames.has(entry.tool)) shapeNames.set(entry.tool, entry.label);
        shapeNames.set("text", "组合文字");
        shapeNames.set("smartStageFirst", "阶段图形");
        shapeNames.set("smartChevron", "阶段图形");
        shapeNames.set("smartPyramidMiddle", "金字塔图形");
        shapeNames.set("smartPyramidBase", "金字塔图形");
        const focusShape = (id: string) => {
          const button = [...dom.querySelectorAll<HTMLButtonElement>("[data-mindmap-shape]")].find(
            (element) => element.dataset.mindmapShape === id,
          );
          button?.focus({ preventScroll: true });
        };
        const changeShape = (id: string, change: (item: CanvasShape) => void) => {
          const items = readMindmapCanvasShapes(current.attrs.canvasShapes);
          const item = items.find((entry) => entry.id === id);
          if (!item || selectedShape !== id) return;
          change(item);
          if (commitShapes(items)) focusShape(id);
        };
        const selectShape = (id: string) => {
          const wrapper = shapeWrappers.get(id);
          const item = shapes.find((entry) => entry.id === id);
          if (!wrapper || !item) return;
          const group = shapeGroup(id);
          if (selectedShape === id && (shapeToolbarOverlay || shapeGroupOverlay)) return;
          selectedShape = id;
          selected = null;
          selectedText = null;
          clearLineSelection();
          dom
            .querySelectorAll(
              ".semlo-editor-mindmap-label-wrap.is-selected, .semlo-editor-mindmap-annotation.is-selected",
            )
            .forEach((element) => {
              element.classList.remove("is-selected");
              element.querySelector(".semlo-editor-mindmap-annotation-toolbar")?.remove();
              element.querySelector(".semlo-editor-mindmap-annotation-rotate")?.remove();
              element.querySelectorAll(".semlo-editor-mindmap-annotation-resize").forEach((handle) => handle.remove());
              element.querySelector("button")?.setAttribute("aria-pressed", "false");
            });
          dom
            .querySelectorAll(".semlo-editor-mindmap-add, .semlo-editor-mindmap-structure")
            .forEach((element) => element.remove());
          clearShapeGroupOverlay();
          shapeWrappers.forEach((element, key) => {
            element.classList.toggle("is-selected", !group && key === id);
            element
              .querySelector("button")
              ?.setAttribute("aria-pressed", String(group ? group.members.includes(key) : key === id));
            element.querySelector(".semlo-editor-mindmap-shape-toolbar")?.remove();
            element.querySelector(".semlo-editor-mindmap-shape-resize")?.remove();
            element.querySelector(".semlo-editor-mindmap-shape-rotate")?.remove();
          });
          const toolbar = doc.createElement("div");
          toolbar.className = "semlo-editor-mindmap-shape-toolbar";
          toolbar.setAttribute("role", "toolbar");
          toolbar.setAttribute("aria-label", "画布图形样式");
          let owner = wrapper;
          if (group) {
            const members = shapes.filter((entry) => group.members.includes(entry.id));
            const bounds = groupBounds(members);
            shapeGroupOverlay = doc.createElement("div");
            shapeGroupOverlay.className = "semlo-editor-mindmap-shape-group";
            shapeGroupOverlay.style.left = `${bounds.x}px`;
            shapeGroupOverlay.style.top = `${bounds.y}px`;
            shapeGroupOverlay.style.width = `${bounds.width}px`;
            shapeGroupOverlay.style.height = `${bounds.height}px`;
            content.append(shapeGroupOverlay);
            owner = shapeGroupOverlay;
            const ungroup = doc.createElement("button");
            ungroup.type = "button";
            ungroup.setAttribute("aria-label", "取消图形编组");
            ungroup.title = "取消编组";
            ungroup.textContent = "取消编组";
            ungroup.addEventListener("click", () => {
              const data = readMindmapCanvasData(current.attrs.canvasShapes);
              const groups = (data.groups ?? []).filter((entry) => entry.id !== group.id);
              if (commitShapes(data.shapes, groups)) focusShape(id);
            });
            toolbar.append(ungroup);
          } else {
            const source = current;
            const epoch = documentEpoch;
            const canApply = () => !destroyed && documentEpoch === epoch && current.eq(source);
            const fill = createMindmapColorControl(
              doc,
              "图形填充颜色",
              item.fill === "transparent" ? "#ffffff" : (item.fill ?? "#ffffff"),
              (value) => {
                if (canApply()) changeShape(id, (shape) => (shape.fill = value));
              },
            );
            const stroke = createMindmapColorControl(doc, "图形描边颜色", item.stroke ?? "#555555", (value) => {
              if (canApply()) changeShape(id, (shape) => (shape.stroke = value));
            });
            const transparent = doc.createElement("button");
            transparent.type = "button";
            transparent.setAttribute("aria-label", "图形无填充");
            transparent.title = "无填充";
            transparent.textContent = "◌";
            transparent.addEventListener("click", () => changeShape(id, (shape) => (shape.fill = "transparent")));
            const width = doc.createElement("input");
            width.type = "number";
            width.min = "1";
            width.max = "10";
            width.value = String(item.strokeWidth ?? 2);
            width.setAttribute("aria-label", "图形描边粗细");
            width.addEventListener("change", () => {
              const value = Number(width.value);
              if (Number.isFinite(value))
                changeShape(id, (shape) => (shape.strokeWidth = Math.max(1, Math.min(10, Math.round(value)))));
            });
            toolbar.append(fill.element, transparent, stroke.element, width);
          }
          const resize = doc.createElement("button");
          resize.type = "button";
          resize.className = "semlo-editor-mindmap-shape-resize";
          resize.setAttribute("aria-label", "调整图形大小");
          resize.addEventListener("pointerdown", (event) => startShapeGesture(event, item, owner, true));
          resize.addEventListener("keydown", (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
              event.preventDefault();
              (event.shiftKey ? redo : undo)(view.state, view.dispatch);
              const handle = dom.querySelector<HTMLElement>(".semlo-editor-mindmap-shape-resize");
              if (handle) handle.focus({ preventScroll: true });
              else dom.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
              return;
            }
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const amount = event.shiftKey ? 10 : 1;
            if (group) {
              const data = readMindmapCanvasData(current.attrs.canvasShapes);
              const members = data.shapes.filter((shape) => group.members.includes(shape.id));
              const bounds = groupBounds(members);
              let nextWidth = Math.max(
                20,
                Math.min(
                  5000,
                  bounds.width + (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0),
                ),
              );
              let nextHeight = Math.max(
                20,
                Math.min(
                  5000,
                  bounds.height + (event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0),
                ),
              );
              if (members.some((shape) => shape.rotation)) {
                const factor = Math.max(
                  Math.max(20 / bounds.width, 20 / bounds.height),
                  Math.min(
                    Math.min(5000 / bounds.width, 5000 / bounds.height),
                    event.key === "ArrowLeft" || event.key === "ArrowRight"
                      ? nextWidth / bounds.width
                      : nextHeight / bounds.height,
                  ),
                );
                nextWidth = bounds.width * factor;
                nextHeight = bounds.height * factor;
              }
              for (const shape of members) {
                shape.x = bounds.x + ((shape.x - bounds.x) * nextWidth) / bounds.width;
                shape.y = bounds.y + ((shape.y - bounds.y) * nextHeight) / bounds.height;
                shape.width *= nextWidth / bounds.width;
                shape.height *= nextHeight / bounds.height;
              }
              if (commitShapes(data.shapes)) focusShape(id);
            } else
              changeShape(id, (shape) => {
                const width = Math.max(
                  20,
                  Math.min(
                    5000,
                    shape.width + (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0),
                  ),
                );
                const height = Math.max(
                  20,
                  Math.min(
                    5000,
                    shape.height + (event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0),
                  ),
                );
                Object.assign(shape, resizedShape(shape, width, height));
              });
            dom.querySelector<HTMLElement>(".semlo-editor-mindmap-shape-resize")?.focus({ preventScroll: true });
          });
          if (group) owner.append(toolbar);
          else {
            positionShapeToolbar(toolbar, item);
            shapeToolbarOverlay = toolbar;
            content.append(toolbar);
          }
          owner.append(resize);
          {
            const rotate = doc.createElement("button");
            rotate.type = "button";
            rotate.className = "semlo-editor-mindmap-shape-rotate";
            rotate.setAttribute("aria-label", group ? "旋转图形组合" : "旋转图形");
            rotate.title = "旋转";
            rotate.textContent = "↻";
            rotate.addEventListener("pointerdown", (event) => {
              if (group) startGroupRotation(event, item, group, owner);
              else startShapeRotation(event, item, wrapper, toolbar);
            });
            rotate.addEventListener("keydown", (event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                event.preventDefault();
                (event.shiftKey ? redo : undo)(view.state, view.dispatch);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowRight" || (event.key === "Home" && !group)) {
                event.preventDefault();
                const amount = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 15 : 1);
                if (group) {
                  const data = readMindmapCanvasData(current.attrs.canvasShapes);
                  const members = data.shapes.filter((shape) => group.members.includes(shape.id));
                  const rotated = rotateGroupShapes(members, groupBounds(members), amount);
                  const byId = new Map(rotated.map((shape) => [shape.id, shape]));
                  if (commitShapes(data.shapes.map((shape) => byId.get(shape.id) ?? shape))) focusShape(id);
                } else
                  changeShape(
                    id,
                    (shape) =>
                      (shape.rotation = event.key === "Home" ? 0 : normalizeAngle((shape.rotation ?? 0) + amount)),
                  );
              } else return;
              const handle = dom.querySelector<HTMLElement>(".semlo-editor-mindmap-shape-rotate");
              if (handle) handle.focus({ preventScroll: true });
              else dom.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
            });
            owner.append(rotate);
          }
        };
        const normalizeAngle = (angle: number) => ((((Math.round(angle) + 180) % 360) + 360) % 360) - 180;
        const rotateGroupShapes = (items: CanvasShape[], bounds: ReturnType<typeof groupBounds>, degrees: number) => {
          const cx = bounds.x + bounds.width / 2;
          const cy = bounds.y + bounds.height / 2;
          const angle = (degrees * Math.PI) / 180;
          return items.map((shape) => {
            const dx = shape.x + shape.width / 2 - cx;
            const dy = shape.y + shape.height / 2 - cy;
            return {
              ...shape,
              x: Math.round((cx + dx * Math.cos(angle) - dy * Math.sin(angle) - shape.width / 2) * 100) / 100,
              y: Math.round((cy + dx * Math.sin(angle) + dy * Math.cos(angle) - shape.height / 2) * 100) / 100,
              rotation: normalizeAngle((shape.rotation ?? 0) + degrees),
            };
          });
        };
        const resizedShape = (shape: CanvasShape, width: number, height: number) => {
          const angle = ((shape.rotation ?? 0) * Math.PI) / 180;
          const shiftX = (width - shape.width) / 2;
          const shiftY = (height - shape.height) / 2;
          const centerX = shape.x + shape.width / 2 + shiftX * Math.cos(angle) - shiftY * Math.sin(angle);
          const centerY = shape.y + shape.height / 2 + shiftX * Math.sin(angle) + shiftY * Math.cos(angle);
          return { x: centerX - width / 2, y: centerY - height / 2, width, height };
        };
        function startShapeRotation(
          event: PointerEvent,
          item: CanvasShape,
          wrapper: HTMLElement,
          toolbar: HTMLElement,
        ) {
          if (drawingTool !== "select" || panEnabled || event.button !== 0 || cancelShapeDrag) return;
          event.preventDefault();
          event.stopPropagation();
          if (finishInput) {
            finishInput(true);
            if (!wrapper.isConnected) return;
          }
          const source = current;
          const epoch = documentEpoch;
          const target = event.currentTarget as HTMLElement;
          const pointer = event.pointerId;
          const origin = content.getBoundingClientRect();
          const scale = zoom / 100;
          const centerX = origin.left + (item.x + item.width / 2) * scale;
          const centerY = origin.top + (item.y + item.height / 2) * scale;
          const start = Math.atan2(event.clientY - centerY, event.clientX - centerX);
          const original = item.rotation ?? 0;
          let rotation = original;
          let active = true;
          const show = () => {
            wrapper.style.transform = `rotate(${rotation}deg)`;
            positionShapeToolbar(toolbar, { ...item, rotation });
            if (shapeData.edges.length) {
              previewShapes = shapes.map((shape) => (shape.id === item.id ? { ...shape, rotation } : shape));
              if (previewFrame === null && doc.defaultView)
                previewFrame = doc.defaultView.requestAnimationFrame(() => {
                  previewFrame = null;
                  if (content.isConnected) lineLayer.refresh();
                });
            }
          };
          const cleanup = () => {
            if (!active) return;
            active = false;
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", finish);
            target.removeEventListener("pointercancel", abort);
            target.removeEventListener("lostpointercapture", abort);
            if (target.hasPointerCapture?.(pointer)) target.releasePointerCapture(pointer);
            if (previewFrame !== null) doc.defaultView?.cancelAnimationFrame(previewFrame);
            previewFrame = null;
            cancelShapeDrag = null;
          };
          const abort = () => {
            cleanup();
            rotation = original;
            show();
            if (previewFrame !== null) doc.defaultView?.cancelAnimationFrame(previewFrame);
            previewFrame = null;
            previewShapes = null;
            if (shapeData.edges.length) lineLayer.refresh();
          };
          const move = (next: PointerEvent) => {
            if (next.pointerId !== pointer) return;
            const angle =
              original + ((Math.atan2(next.clientY - centerY, next.clientX - centerX) - start) * 180) / Math.PI;
            rotation = normalizeAngle(next.shiftKey ? Math.round(angle / 15) * 15 : angle);
            show();
          };
          const finish = (next: PointerEvent) => {
            if (next.pointerId !== pointer) return;
            move(next);
            cleanup();
            if (destroyed || documentEpoch !== epoch || !current.eq(source)) return;
            if (rotation !== original) {
              const items = readMindmapCanvasShapes(current.attrs.canvasShapes);
              const changed = items.find((shape) => shape.id === item.id);
              if (changed) changed.rotation = rotation;
              if (changed && commitShapes(items)) focusShape(item.id);
              else abort();
            } else abort();
          };
          cancelShapeDrag = abort;
          target.addEventListener("pointermove", move);
          target.addEventListener("pointerup", finish);
          target.addEventListener("pointercancel", abort);
          target.addEventListener("lostpointercapture", abort);
          try {
            target.setPointerCapture(pointer);
          } catch {
            abort();
          }
        }
        function startGroupRotation(event: PointerEvent, item: CanvasShape, group: CanvasGroup, overlay: HTMLElement) {
          if (drawingTool !== "select" || panEnabled || event.button !== 0 || cancelShapeDrag) return;
          event.preventDefault();
          event.stopPropagation();
          if (finishInput) {
            finishInput(true);
            if (!overlay.isConnected) return;
          }
          const source = current;
          const epoch = documentEpoch;
          const target = event.currentTarget as HTMLElement;
          const pointer = event.pointerId;
          const originals = shapes.filter((shape) => group.members.includes(shape.id));
          if (originals.length !== group.members.length) return;
          const bounds = groupBounds(originals);
          const origin = content.getBoundingClientRect();
          const scale = zoom / 100;
          const centerX = origin.left + (bounds.x + bounds.width / 2) * scale;
          const centerY = origin.top + (bounds.y + bounds.height / 2) * scale;
          const start = Math.atan2(event.clientY - centerY, event.clientX - centerX);
          let degrees = 0;
          let active = true;
          const transformed = () => (degrees ? rotateGroupShapes(originals, bounds, degrees) : originals);
          const show = () => {
            const rotated = transformed();
            for (const shape of rotated) {
              const visual = shapeWrappers.get(shape.id);
              if (!visual) continue;
              visual.style.left = `${shape.x}px`;
              visual.style.top = `${shape.y}px`;
              visual.style.transform = `rotate(${shape.rotation ?? 0}deg)`;
            }
            const box = groupBounds(rotated);
            overlay.style.left = `${box.x}px`;
            overlay.style.top = `${box.y}px`;
            overlay.style.width = `${box.width}px`;
            overlay.style.height = `${box.height}px`;
            if (shapeData.edges.length) {
              const byId = new Map(rotated.map((shape) => [shape.id, shape]));
              previewShapes = shapes.map((shape) => byId.get(shape.id) ?? shape);
              if (previewFrame === null && doc.defaultView)
                previewFrame = doc.defaultView.requestAnimationFrame(() => {
                  previewFrame = null;
                  if (content.isConnected) lineLayer.refresh();
                });
            }
          };
          const cleanup = () => {
            if (!active) return;
            active = false;
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", finish);
            target.removeEventListener("pointercancel", abort);
            target.removeEventListener("lostpointercapture", abort);
            if (target.hasPointerCapture?.(pointer)) target.releasePointerCapture(pointer);
            if (previewFrame !== null) doc.defaultView?.cancelAnimationFrame(previewFrame);
            previewFrame = null;
            cancelShapeDrag = null;
          };
          const abort = () => {
            cleanup();
            degrees = 0;
            show();
            if (previewFrame !== null) doc.defaultView?.cancelAnimationFrame(previewFrame);
            previewFrame = null;
            previewShapes = null;
            if (shapeData.edges.length) lineLayer.refresh();
          };
          const move = (next: PointerEvent) => {
            if (next.pointerId !== pointer) return;
            const angle = ((Math.atan2(next.clientY - centerY, next.clientX - centerX) - start) * 180) / Math.PI;
            degrees = normalizeAngle(next.shiftKey ? Math.round(angle / 15) * 15 : angle);
            show();
          };
          const finish = (next: PointerEvent) => {
            if (next.pointerId !== pointer) return;
            move(next);
            cleanup();
            if (destroyed || documentEpoch !== epoch || !current.eq(source)) return;
            if (degrees) {
              const items = readMindmapCanvasShapes(current.attrs.canvasShapes);
              const byId = new Map(transformed().map((shape) => [shape.id, shape]));
              if (
                originals.every((shape) => items.some((entry) => entry.id === shape.id)) &&
                commitShapes(items.map((shape) => byId.get(shape.id) ?? shape))
              )
                focusShape(item.id);
              else abort();
            } else abort();
          };
          cancelShapeDrag = abort;
          target.addEventListener("pointermove", move);
          target.addEventListener("pointerup", finish);
          target.addEventListener("pointercancel", abort);
          target.addEventListener("lostpointercapture", abort);
          try {
            target.setPointerCapture(pointer);
          } catch {
            abort();
          }
        }
        function startShapeGesture(event: PointerEvent, item: CanvasShape, wrapper: HTMLElement, resize: boolean) {
          if (drawingTool !== "select" || panEnabled || event.button !== 0 || cancelShapeDrag) return;
          event.preventDefault();
          event.stopPropagation();
          if (finishInput) {
            finishInput(true);
            if (!wrapper.isConnected) return;
          }
          selectShape(item.id);
          const target = event.currentTarget as HTMLElement;
          const source = current;
          const epoch = documentEpoch;
          const pointer = event.pointerId;
          const startX = event.clientX;
          const startY = event.clientY;
          const group = shapeGroup(item.id);
          const originals = group ? shapes.filter((entry) => group.members.includes(entry.id)) : [item];
          const bounds = groupBounds(originals);
          let x = bounds.x,
            y = bounds.y,
            width = bounds.width,
            height = bounds.height,
            active = true;
          const transform = (shape: CanvasShape) => ({
            x: x + ((shape.x - bounds.x) * width) / bounds.width,
            y: y + ((shape.y - bounds.y) * height) / bounds.height,
            width: (shape.width * width) / bounds.width,
            height: (shape.height * height) / bounds.height,
          });
          const show = () => {
            for (const original of originals) {
              const visual = shapeWrappers.get(original.id);
              if (!visual) continue;
              const box = transform(original);
              visual.style.left = `${box.x}px`;
              visual.style.top = `${box.y}px`;
              visual.style.width = `${box.width}px`;
              visual.style.height = `${box.height}px`;
              if (!group && shapeToolbarOverlay) positionShapeToolbar(shapeToolbarOverlay, { ...original, ...box });
            }
            if (group && shapeGroupOverlay) {
              shapeGroupOverlay.style.left = `${x}px`;
              shapeGroupOverlay.style.top = `${y}px`;
              shapeGroupOverlay.style.width = `${width}px`;
              shapeGroupOverlay.style.height = `${height}px`;
            }
            if (shapeData.edges.length) {
              const originalById = new Map(originals.map((entry) => [entry.id, entry]));
              previewShapes = shapes.map((entry) => {
                const original = originalById.get(entry.id);
                return original ? { ...entry, ...transform(original) } : entry;
              });
              if (previewFrame === null && doc.defaultView)
                previewFrame = doc.defaultView.requestAnimationFrame(() => {
                  previewFrame = null;
                  if (content.isConnected) lineLayer.refresh();
                });
            }
          };
          const cleanup = () => {
            if (!active) return;
            active = false;
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", finish);
            target.removeEventListener("pointercancel", abort);
            target.removeEventListener("lostpointercapture", abort);
            if (target.hasPointerCapture?.(pointer)) target.releasePointerCapture(pointer);
            if (previewFrame !== null) doc.defaultView?.cancelAnimationFrame(previewFrame);
            previewFrame = null;
            cancelShapeDrag = null;
          };
          const abort = () => {
            cleanup();
            x = bounds.x;
            y = bounds.y;
            width = bounds.width;
            height = bounds.height;
            show();
            if (previewFrame !== null) doc.defaultView?.cancelAnimationFrame(previewFrame);
            previewFrame = null;
            previewShapes = null;
            if (shapeData.edges.length) lineLayer.refresh();
          };
          const move = (next: PointerEvent) => {
            if (next.pointerId !== pointer) return;
            const dx = (next.clientX - startX) / (zoom / 100);
            const dy = (next.clientY - startY) / (zoom / 100);
            if (resize) {
              const angle = group ? 0 : ((item.rotation ?? 0) * Math.PI) / 180;
              const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
              const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
              width = Math.max(20, Math.min(5000, Math.round((bounds.width + localX) * 100) / 100));
              height = Math.max(20, Math.min(5000, Math.round((bounds.height + localY) * 100) / 100));
              if (group && originals.some((shape) => shape.rotation)) {
                const xScale = width / bounds.width;
                const yScale = height / bounds.height;
                const factor = Math.max(
                  Math.max(20 / bounds.width, 20 / bounds.height),
                  Math.min(
                    Math.min(5000 / bounds.width, 5000 / bounds.height),
                    Math.abs(xScale - 1) >= Math.abs(yScale - 1) ? xScale : yScale,
                  ),
                );
                width = bounds.width * factor;
                height = bounds.height * factor;
              }
              if (!group) ({ x, y } = resizedShape(item, width, height));
            } else {
              x = Math.round((bounds.x + dx) * 100) / 100;
              y = Math.round((bounds.y + dy) * 100) / 100;
            }
            show();
          };
          const finish = (next: PointerEvent) => {
            if (next.pointerId !== pointer) return;
            move(next);
            cleanup();
            if (destroyed || documentEpoch !== epoch || !current.eq(source)) return;
            if (
              Math.abs(x - bounds.x) +
                Math.abs(y - bounds.y) +
                Math.abs(width - bounds.width) +
                Math.abs(height - bounds.height) >
              1
            ) {
              const items = readMindmapCanvasShapes(current.attrs.canvasShapes);
              let changed = 0;
              for (const original of originals) {
                const targetItem = items.find((entry) => entry.id === original.id);
                if (targetItem) {
                  Object.assign(targetItem, transform(original));
                  changed++;
                }
              }
              if (changed === originals.length && commitShapes(items)) focusShape(item.id);
              else abort();
            } else focusShape(item.id);
          };
          cancelShapeDrag = abort;
          target.addEventListener("pointermove", move);
          target.addEventListener("pointerup", finish);
          target.addEventListener("pointercancel", abort);
          target.addEventListener("lostpointercapture", abort);
          try {
            target.setPointerCapture(pointer);
          } catch {
            abort();
          }
        }
        const editShape = (item: CanvasShape, wrapper: HTMLElement) => {
          if (!editor.isEditable || finishInput || destroyed) return;
          const source = current;
          const epoch = documentEpoch;
          const field = doc.createElement("textarea");
          field.className = "semlo-editor-mindmap-shape-input";
          field.setAttribute("aria-label", "编辑图形文字");
          field.value = item.text;
          field.maxLength = 10000;
          wrapper.append(field);
          let done = false;
          const finish = (save: boolean) => {
            if (done) return;
            done = true;
            finishInput = null;
            if (destroyed || documentEpoch !== epoch || !current.eq(source)) return;
            if (save && field.value !== item.text) {
              const items = readMindmapCanvasShapes(current.attrs.canvasShapes);
              const changed = items.find((entry) => entry.id === item.id);
              if (changed) changed.text = field.value;
              if (changed && commitShapes(items)) {
                focusShape(item.id);
                return;
              }
              done = false;
              finishInput = finish;
              field.setCustomValidity("无法保存文字，请重试。");
              field.reportValidity();
              field.focus({ preventScroll: true });
              return;
            }
            field.remove();
            focusShape(item.id);
          };
          finishInput = finish;
          field.addEventListener("input", () => field.setCustomValidity(""));
          field.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              finish(false);
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              finish(true);
            }
          });
          field.addEventListener("blur", () => finish(true));
          field.focus();
          field.select();
        };
        shapes.forEach((item) => {
          const wrapper = doc.createElement("div");
          wrapper.className = "semlo-editor-mindmap-canvas-shape";
          wrapper.style.left = `${item.x}px`;
          wrapper.style.top = `${item.y}px`;
          wrapper.style.width = `${item.width}px`;
          wrapper.style.height = `${item.height}px`;
          wrapper.style.transform = `rotate(${item.rotation ?? 0}deg)`;
          const label: HTMLElement = editor.isEditable ? doc.createElement("button") : doc.createElement("div");
          if (editor.isEditable) (label as HTMLButtonElement).type = "button";
          label.className = "semlo-editor-mindmap-canvas-shape-label";
          label.dataset.mindmapShape = item.id;
          label.setAttribute(
            "aria-label",
            `图形：${shapeNames.get(item.shape) ?? item.shape}${item.text ? `，${item.text}` : ""}`,
          );
          if (editor.isEditable) label.setAttribute("aria-pressed", String(selectedShape === item.id));
          const svg = DOMSerializer.renderSpec(
            doc,
            exportCanvas({ shapes: [{ ...item, x: 0, y: 0, rotation: 0 }], edges: [] }),
          ).dom as Element;
          svg.setAttribute("viewBox", `-3 -3 ${item.width + 6} ${item.height + 6}`);
          svg.setAttribute("width", "100%");
          svg.setAttribute("height", "100%");
          svg.setAttribute("aria-hidden", "true");
          svg.removeAttribute("role");
          label.append(svg);
          wrapper.append(label);
          shapeWrappers.set(item.id, wrapper);
          content.append(wrapper);
          if (!editor.isEditable) return;
          label.addEventListener("pointerdown", (event) => startShapeGesture(event, item, wrapper, false));
          label.addEventListener("dblclick", () => editShape(item, wrapper));
          label.addEventListener("focus", () => {
            if (drawingTool === "select" && !panEnabled) selectShape(item.id);
          });
          label.addEventListener("keydown", (event) => {
            if (event.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              selectShape(item.id);
              editShape(item, wrapper);
            } else if (event.key === "Delete" || event.key === "Backspace") {
              event.preventDefault();
              const data = readMindmapCanvasData(current.attrs.canvasShapes);
              const group = shapeGroup(item.id);
              const removed = new Set(group ? group.members : [item.id]);
              const items = data.shapes.filter((entry) => !removed.has(entry.id));
              const groups = data.groups?.filter((entry) => entry.id !== group?.id);
              selectedShape = null;
              if (commitShapes(items, groups))
                dom.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
            } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
              event.preventDefault();
              (event.shiftKey ? redo : undo)(view.state, view.dispatch);
              if (readMindmapCanvasShapes(current.attrs.canvasShapes).some((entry) => entry.id === item.id))
                focusShape(item.id);
              else view.focus();
            } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
              event.preventDefault();
              const amount = event.shiftKey ? 10 : 1;
              const group = shapeGroup(item.id);
              const data = readMindmapCanvasData(current.attrs.canvasShapes);
              for (const shape of data.shapes.filter((entry) =>
                group ? group.members.includes(entry.id) : entry.id === item.id,
              )) {
                if (event.key === "ArrowLeft") shape.x -= amount;
                else if (event.key === "ArrowRight") shape.x += amount;
                else if (event.key === "ArrowUp") shape.y -= amount;
                else shape.y += amount;
              }
              if (commitShapes(data.shapes)) focusShape(item.id);
            }
          });
        });
        if (selectedShape && editor.isEditable) selectShape(selectedShape);
        if (selectedLine && !shapeData.edges.some((edge) => edge.id === selectedLine)) selectedLine = null;
        const lineLayer = createMindmapLineLayer({
          doc,
          root: dom,
          content,
          data: () => {
            const data = readMindmapCanvasData(current.attrs.canvasShapes);
            const needsNodes =
              drawingTool === "line" ||
              selectedLine !== null ||
              data.edges.some(
                (edge) => edge.from.startsWith(mindmapNodePrefix) || edge.to.startsWith(mindmapNodePrefix),
              );
            return needsNodes
              ? { ...data, shapes: [...nodeShapes(), ...(previewShapes ?? data.shapes)] }
              : previewShapes
                ? { ...data, shapes: previewShapes }
                : data;
          },
          pending: () => pendingLine,
          selected: () => selectedLine,
          editable: () => editor.isEditable,
          canSelect: () => drawingTool === "select" && !panEnabled,
          scale: () => zoom / 100,
          guard: () => {
            const source = current;
            const epoch = documentEpoch;
            return () => !destroyed && editor.isEditable && documentEpoch === epoch && current.eq(source);
          },
          setCancel: (cancel) => {
            cancelLineGesture = cancel;
          },
          select: (id) => {
            selected = null;
            selectedText = null;
            selectedShape = null;
            selectedLine = id;
            paint();
          },
          clear: () => {
            selectedLine = null;
          },
          commit: commitEdges,
          history: (redoing) => (redoing ? redo : undo)(view.state, view.dispatch),
          beginInput: (finish) => {
            if (finishInput) return false;
            finishInput = finish;
            return true;
          },
          endInput: (finish) => {
            if (finishInput === finish) finishInput = null;
          },
        });
        lineLayer.refresh();
        viewport.addEventListener("pointerdown", (event) => {
          if (
            drawingTool !== "select" ||
            panEnabled ||
            (selectedText === null && selectedShape === null && selectedLine === null)
          )
            return;
          const target = event.target as Element | null;
          if (
            target?.closest(
              ".semlo-editor-mindmap-annotation, .semlo-editor-mindmap-canvas-shape, .semlo-editor-mindmap-shape-group, .semlo-editor-mindmap-shape-toolbar, .semlo-editor-mindmap-line-toolbar, [data-mindmap-line], .semlo-editor-mindmap-line-handle",
            )
          )
            return;
          selectedText = null;
          selectedShape = null;
          clearLineSelection();
          clearShapeGroupOverlay();
          annotationWrappers.forEach((element) => {
            element.classList.remove("is-selected");
            element.querySelector(".semlo-editor-mindmap-annotation-toolbar")?.remove();
            element.querySelector(".semlo-editor-mindmap-annotation-rotate")?.remove();
            element.querySelectorAll(".semlo-editor-mindmap-annotation-resize").forEach((handle) => handle.remove());
            element.querySelector("button")?.setAttribute("aria-pressed", "false");
          });
          shapeWrappers.forEach((element) => {
            element.classList.remove("is-selected");
            element.querySelector(".semlo-editor-mindmap-shape-toolbar")?.remove();
            element.querySelector(".semlo-editor-mindmap-shape-resize")?.remove();
            element.querySelector(".semlo-editor-mindmap-shape-rotate")?.remove();
            element.querySelector("button")?.setAttribute("aria-pressed", "false");
          });
        });
        if (maximized) {
          const header = doc.createElement("div");
          header.className = "semlo-editor-mindmap-return-bar";
          const back = doc.createElement("button");
          back.type = "button";
          back.textContent = "‹ 返回文档";
          back.setAttribute("aria-label", "返回文档");
          back.addEventListener("click", () => {
            if (finishInput) finishInput(true);
            maximized = false;
            paint();
            dom.querySelector<HTMLButtonElement>('[aria-label="最大化思维导图"]')?.focus();
          });
          header.append(back);
          const history = doc.createElement("div");
          history.className = "semlo-editor-mindmap-history";
          for (const [name, icon, action] of [
            ["撤销", "↶", undo],
            ["重做", "↷", redo],
          ] as const) {
            const button = doc.createElement("button");
            button.type = "button";
            button.setAttribute("aria-label", name);
            button.title = name;
            button.textContent = icon;
            button.disabled = !editor.isEditable || !action(view.state);
            button.addEventListener("click", () => {
              if (finishInput) finishInput(true);
              action(view.state, view.dispatch);
            });
            history.append(button);
          }
          dom.append(header, history);
        } else {
          const expand = doc.createElement("button");
          expand.type = "button";
          expand.className = "semlo-editor-mindmap-expand";
          expand.setAttribute("aria-label", "最大化思维导图");
          expand.title = "最大化";
          expand.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M4 4l6 6m10-6-6 6m6 10-6-6M4 20l6-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
          expand.addEventListener("click", () => {
            if (finishInput) finishInput(true);
            maximized = true;
            paint();
            dom.querySelector<HTMLButtonElement>('[aria-label="返回文档"]')?.focus();
          });
          dom.append(expand);
        }
        const draw = () => {
          if (destroyed || !content.isConnected) return;
          const scale = zoom / 100;
          const origin = content.getBoundingClientRect();
          const groupedLinks = new Map<HTMLElement, { x: number; top: number; bottom: number }>();
          const verticalGroupedLinks = new Map<
            HTMLElement,
            { y: number; left: number; right: number; down: boolean }
          >();
          for (const group of groupedSummaries) group.row.style.transform = "";
          for (const group of [...groupedSummaries].sort((a, b) => a.parent.length - b.parent.length)) {
            const members = nodeEntries.filter(
              (entry) =>
                entry.path.length === group.parent.length + 1 &&
                samePath(entry.path.slice(0, -1), group.parent) &&
                entry.path[entry.path.length - 1] >= group.first &&
                entry.path[entry.path.length - 1] < group.first + group.span,
            );
            if (members.length !== group.span) continue;
            const visible = nodeEntries.filter((entry) => {
              const index = entry.path[group.parent.length];
              return (
                entry.path.length > group.parent.length &&
                samePath(entry.path.slice(0, group.parent.length), group.parent) &&
                index >= group.first &&
                index < group.first + group.span &&
                !(index === group.first && entry.path[group.parent.length + 1] === -1)
              );
            });
            const boxes = visible.map((entry) => entry.label.getBoundingClientRect());
            const top = Math.min(...boxes.map((box) => box.top));
            const bottom = Math.max(...boxes.map((box) => box.bottom));
            const left = Math.min(...boxes.map((box) => box.left));
            const right = Math.max(...boxes.map((box) => box.right));
            const summary = group.label.getBoundingClientRect();
            if (group.layout === "up" || group.layout === "down" || isTimelineLayout(group.layout)) {
              const down = group.layout === "down";
              const timeline = isTimelineLayout(group.layout);
              const y = down ? bottom : top;
              const targetX = (left + right - summary.width) / 2;
              const targetY = down ? y + 40 * scale : y - 40 * scale - summary.height;
              group.row.style.transform = `translate(${(targetX - summary.left) / scale}px, ${(targetY - summary.top) / scale}px)`;
              const toolbar = group.label.parentElement?.querySelector<HTMLElement>(
                ":scope > .semlo-editor-mindmap-structure",
              );
              if (toolbar) {
                if (down || timeline) {
                  toolbar.style.top = "auto";
                  toolbar.style.bottom = down ? `calc(100% + ${(targetY - top) / scale + 8}px)` : "calc(100% + 8px)";
                } else {
                  toolbar.style.bottom = "auto";
                  toolbar.style.top = `calc(100% + ${(bottom - targetY - summary.height) / scale + 8}px)`;
                }
              }
              for (const member of members) {
                const memberToolbar = member.label.parentElement?.querySelector<HTMLElement>(
                  ":scope > .semlo-editor-mindmap-structure",
                );
                if (!memberToolbar) continue;
                const bounds = member.label.getBoundingClientRect();
                if (down || timeline) {
                  memberToolbar.style.top = "auto";
                  memberToolbar.style.bottom = `calc(100% + ${(bounds.top - (timeline ? targetY : top)) / scale + 8}px)`;
                } else {
                  memberToolbar.style.bottom = "auto";
                  memberToolbar.style.top = `calc(100% + ${(bottom - bounds.bottom) / scale + 8}px)`;
                }
              }
              verticalGroupedLinks.set(group.label, { y, left, right, down });
              continue;
            }
            const x = group.side === "right" ? right : left;
            const targetX = group.side === "right" ? x + 40 * scale : x - 40 * scale - summary.width;
            const targetY = (top + bottom - summary.height) / 2;
            group.row.style.transform = `translate(${(targetX - summary.left) / scale}px, ${(targetY - summary.top) / scale}px)`;
            const toolbar = group.label.parentElement?.querySelector<HTMLElement>(
              ":scope > .semlo-editor-mindmap-structure",
            );
            if (toolbar) {
              toolbar.style.top = "auto";
              toolbar.style.bottom = `calc(100% + ${(targetY - top) / scale + 8}px)`;
            }
            for (const member of members) {
              const memberToolbar = member.label.parentElement?.querySelector<HTMLElement>(
                ":scope > .semlo-editor-mindmap-structure",
              );
              if (memberToolbar) {
                const offset = (member.label.getBoundingClientRect().top - top) / scale;
                memberToolbar.style.top = "auto";
                memberToolbar.style.bottom = `calc(100% + ${offset + 8}px)`;
              }
            }
            groupedLinks.set(group.label, { x, top, bottom });
          }
          if (selectedRange) {
            const { parent, first } = selectedRange;
            const anchor = nodeEntries.find(
              (entry) =>
                entry.path.length === parent.length + 1 &&
                samePath(entry.path.slice(0, -1), parent) &&
                entry.path[entry.path.length - 1] === first,
            );
            const related = nodeEntries.filter(
              (entry) => entry.path.length > parent.length && samePath(entry.path.slice(0, parent.length), parent),
            );
            const toolbar = anchor?.label.parentElement?.querySelector<HTMLElement>(
              ":scope > .semlo-editor-mindmap-structure",
            );
            if (anchor && toolbar && related.length) {
              const top = Math.min(...related.map((entry) => entry.label.getBoundingClientRect().top));
              const offset = (anchor.label.getBoundingClientRect().top - top) / scale;
              toolbar.style.top = "auto";
              toolbar.style.bottom = `calc(100% + ${offset + 8}px)`;
            }
          }
          svg.setAttribute("width", String(content.offsetWidth));
          svg.setAttribute("height", String(content.offsetHeight));
          lineLayer.svg.setAttribute("width", String(content.offsetWidth));
          lineLayer.svg.setAttribute("height", String(content.offsetHeight));
          svg.replaceChildren();
          const strokes = readMindmapStrokes(current.attrs.drawing);
          const visibleStrokes = strokes.filter((_, index) => !pendingErased?.has(index));
          if (pendingStroke) visibleStrokes.push(pendingStroke);
          for (const stroke of visibleStrokes) {
            const path = doc.createElementNS(svg.namespaceURI, "path");
            path.classList.add("semlo-editor-mindmap-stroke");
            path.setAttribute("d", strokePath(stroke));
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", stroke.color);
            path.setAttribute("stroke-width", String(stroke.width));
            path.setAttribute("stroke-linecap", stroke.kind === "marker" ? "square" : "round");
            path.setAttribute("stroke-linejoin", "round");
            if (stroke.kind === "marker") path.setAttribute("stroke-opacity", "0.5");
            svg.append(path);
          }
          for (const group of timelineGroups) {
            for (let index = 1; index < group.nodes.length; index++) {
              const previous = group.nodes[index - 1].label.getBoundingClientRect();
              const node = group.nodes[index];
              const child = node.label.getBoundingClientRect();
              const startX = ((group.side === "right" ? previous.right : previous.left) - origin.left) / scale;
              const endX = ((group.side === "right" ? child.left : child.right) - origin.left) / scale;
              const y = ((node.line ? child.bottom - scale : child.top + child.height / 2) - origin.top) / scale;
              const path = doc.createElementNS(svg.namespaceURI, "path");
              path.classList.add("semlo-editor-mindmap-line");
              path.setAttribute("d", `M ${startX} ${y} H ${endX}`);
              path.setAttribute("fill", "none");
              path.setAttribute("stroke", node.color);
              path.setAttribute("stroke-width", String(node.width));
              svg.append(path);
            }
          }
          const orderedLinks = [
            ...links.filter((link) => !isTreeLayout(link.layout)),
            ...links.filter((link) => isTreeLayout(link.layout)).reverse(),
          ];
          for (const link of orderedLinks) {
            const layout = link.layout;
            const vertical = layout === "up" || layout === "down";
            const treeLayout = isTreeLayout(layout);
            const treeUp = treeLayout && layout.includes("-up-");
            const parent = link.parent.getBoundingClientRect(),
              child = link.child.getBoundingClientRect();
            if (!parent.width || !child.width) continue;
            const x1 =
              (vertical || treeLayout
                ? parent.left + parent.width / 2
                : link.side === "right"
                  ? parent.right
                  : parent.left) - origin.left;
            const x2 =
              (vertical ? child.left + child.width / 2 : link.side === "right" ? child.left : child.right) -
              origin.left;
            const y1 =
              (treeLayout
                ? treeUp
                  ? parent.top
                  : parent.bottom
                : vertical
                  ? layout === "down"
                    ? parent.bottom
                    : parent.top
                  : link.summary
                    ? parent.top + parent.height / 2
                    : link.parentLine
                      ? parent.bottom - scale
                      : parent.top + parent.height / 2) - origin.top;
            const y2 =
              (vertical
                ? layout === "down"
                  ? child.top
                  : child.bottom
                : link.summary
                  ? child.top + child.height / 2
                  : link.childLine
                    ? child.bottom - scale
                    : child.top + child.height / 2) - origin.top;
            const path = doc.createElementNS(svg.namespaceURI, "path");
            path.classList.add("semlo-editor-mindmap-line");
            const startX = x1 / scale,
              endX = x2 / scale,
              startY = y1 / scale,
              endY = y2 / scale;
            const group = groupedLinks.get(link.child);
            const verticalGroup = verticalGroupedLinks.get(link.child);
            path.setAttribute(
              "d",
              verticalGroup
                ? mindmapVerticalGroupSummaryLine(
                    (verticalGroup.y - origin.top) / scale,
                    (verticalGroup.left - origin.left) / scale,
                    (verticalGroup.right - origin.left) / scale,
                    (child.left + child.width / 2 - origin.left) / scale,
                    ((verticalGroup.down ? child.top : child.bottom) - origin.top) / scale,
                  )
                : group
                  ? mindmapGroupSummaryLine(
                      (group.x - origin.left) / scale,
                      (group.top - origin.top) / scale,
                      (group.bottom - origin.top) / scale,
                      endX,
                      endY,
                    )
                  : link.summary && !treeLayout && !vertical
                    ? mindmapSummaryLine(startX, startY, endX, endY)
                    : treeLayout
                      ? mindmapTreeLine(startX, startY, endX, endY, tree.branchType ?? "curve")
                      : mindmapLine(startX, startY, endX, endY, vertical, tree.branchType ?? "curve"),
            );
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", link.summary ? "#b6b9b9" : link.color);
            path.setAttribute("stroke-width", String(link.summary ? 2 : link.width));
            svg.append(path);
          }
          if (
            !finishInput &&
            shapeData.edges.some(
              (edge) => edge.from.startsWith(mindmapNodePrefix) || edge.to.startsWith(mindmapNodePrefix),
            )
          ) {
            const active = doc.activeElement;
            const focusedLine = active?.getAttribute("data-mindmap-line");
            const focusedHandle = active?.classList.contains("semlo-editor-mindmap-line-handle")
              ? active.getAttribute("aria-label")
              : null;
            lineLayer.refresh();
            if (focusedLine) lineLayer.focusLine(focusedLine);
            else if (focusedHandle) {
              [...dom.querySelectorAll<SVGElement>(".semlo-editor-mindmap-line-handle")]
                .find((handle) => handle.getAttribute("aria-label") === focusedHandle)
                ?.focus({ preventScroll: true });
            }
          }
        };
        const applyViewport = () => {
          const scale = zoom / 100;
          for (const group of treeGroups) {
            const indent = `${group.label.offsetWidth / 2 + 16}px`;
            if (group.side === "left") group.children.style.paddingRight = indent;
            else group.children.style.paddingLeft = indent;
          }
          content.style.transform = `scale(${scale})`;
          frame.style.width = `${content.offsetWidth * scale}px`;
          frame.style.height = `${content.offsetHeight * scale}px`;
          frame.style.transform = `translate(${panX}px, ${panY}px)`;
          draw();
          repositionAnnotation?.();
        };
        const drawingStatus = doc.createElement("div");
        drawingStatus.className = "semlo-editor-mindmap-drawing-status";
        drawingStatus.setAttribute("role", "status");
        drawingStatus.hidden = true;
        dom.append(drawingStatus);
        viewport.classList.toggle("is-drawing", drawingTool !== "select" && !panEnabled && editor.isEditable);
        viewport.addEventListener(
          "pointerdown",
          (event) => {
            if (drawingTool === "select" || panEnabled || !editor.isEditable || event.button !== 0 || cancelDrawing)
              return;
            event.preventDefault();
            event.stopPropagation();
            viewport.focus({ preventScroll: true });
            if (drawingTool === "line") {
              const source = current;
              const epoch = documentEpoch;
              const pointer = event.pointerId;
              const canvasData = readMindmapCanvasData(current.attrs.canvasShapes);
              const data = { ...canvasData, shapes: [...nodeShapes(), ...canvasData.shapes] };
              const start = (() => {
                const origin = content.getBoundingClientRect();
                const scale = zoom / 100;
                return {
                  x: Math.round(((event.clientX - origin.left) / scale) * 100) / 100,
                  y: Math.round(((event.clientY - origin.top) / scale) * 100) / 100,
                };
              })();
              const startShape = [...data.shapes].reverse().find((shape) => shapeContains(shape, start, 4));
              const ids = new Set(data.edges.map((edge) => edge.id));
              let number = 1;
              while (ids.has(`line-${number}`)) number++;
              const id = `line-${number}`;
              pendingLine = {
                id,
                from: startShape?.id ?? "",
                to: "",
                fromPoint: start,
                toPoint: start,
                text: "",
                dashed: false,
                arrow: true,
                route: lineRoute,
              };
              let active = true;
              let moved = false;
              const cleanup = () => {
                if (!active) return;
                active = false;
                viewport.removeEventListener("pointermove", move);
                viewport.removeEventListener("pointerup", finish);
                viewport.removeEventListener("pointercancel", abort);
                viewport.removeEventListener("lostpointercapture", abort);
                if (viewport.hasPointerCapture?.(pointer)) viewport.releasePointerCapture(pointer);
                cancelDrawing = null;
              };
              const abort = () => {
                cleanup();
                pendingLine = null;
                lineLayer.refresh();
              };
              const move = (next: PointerEvent) => {
                if (next.pointerId !== pointer || !pendingLine) return;
                const origin = content.getBoundingClientRect();
                const scale = zoom / 100;
                pendingLine.toPoint = {
                  x: Math.round(((next.clientX - origin.left) / scale) * 100) / 100,
                  y: Math.round(((next.clientY - origin.top) / scale) * 100) / 100,
                };
                moved = Math.hypot(pendingLine.toPoint.x - start.x, pendingLine.toPoint.y - start.y) > 2;
                lineLayer.refresh();
              };
              const finish = (next: PointerEvent) => {
                if (next.pointerId !== pointer) return;
                move(next);
                const edge = pendingLine;
                cleanup();
                pendingLine = null;
                if (!edge || !moved || destroyed || documentEpoch !== epoch || !current.eq(source)) {
                  lineLayer.refresh();
                  return;
                }
                const target = [...data.shapes].reverse().find((shape) => shapeContains(shape, edge.toPoint!, 4));
                if (target && target.id !== edge.from) edge.to = target.id;
                selected = null;
                selectedText = null;
                selectedShape = null;
                selectedLine = id;
                drawingTool = "select";
                if (commitEdges([...data.edges, edge])) lineLayer.focusLine(id);
                else {
                  selectedLine = null;
                  drawingTool = "line";
                  drawingStatus.textContent = "无法添加连线，请重试。";
                  drawingStatus.hidden = false;
                  lineLayer.refresh();
                }
              };
              cancelDrawing = abort;
              viewport.addEventListener("pointermove", move);
              viewport.addEventListener("pointerup", finish);
              viewport.addEventListener("pointercancel", abort);
              viewport.addEventListener("lostpointercapture", abort);
              try {
                viewport.setPointerCapture(pointer);
              } catch {
                abort();
              }
              return;
            }
            if (drawingTool === "shape" && pendingShape) {
              const origin = content.getBoundingClientRect();
              const scale = zoom / 100;
              const data = readMindmapCanvasData(current.attrs.canvasShapes);
              const items = data.shapes;
              const groups = data.groups ?? [];
              const used = new Set([...items.map((item) => item.id), ...groups.map((group) => group.id)]);
              let number = 1;
              const newId = () => {
                while (used.has(`shape-${number}`)) number++;
                const id = `shape-${number++}`;
                used.add(id);
                return id;
              };
              const type = pendingShape;
              const x = Math.round(((event.clientX - origin.left) / scale) * 100) / 100;
              const y = Math.round(((event.clientY - origin.top) / scale) * 100) / 100;
              let id: string;
              if (isSmartTemplate(type)) {
                const template = createSmartTemplate(type, { x, y }, newId);
                items.push(...template.shapes);
                groups.push(template.group);
                id = template.group.members[0];
              } else {
                id = newId();
                const [width, height] = shapeGraphic(type)?.size ?? [100, 100];
                items.push({
                  id,
                  shape: type,
                  x,
                  y,
                  width,
                  height,
                  text: "",
                  ...(type === "swimlaneVertical" || type === "swimlaneHorizontal" ? { lanes: ["", "", ""] } : {}),
                });
              }
              selected = null;
              selectedText = null;
              selectedShape = id;
              selectedLine = null;
              pendingShape = null;
              drawingTool = "select";
              if (commitShapes(items, groups.length ? groups : undefined)) focusShape(id);
              else {
                selectedShape = null;
                pendingShape = type;
                drawingTool = "shape";
                drawingStatus.textContent = "无法添加图形，请减少画布内容后重试。";
                drawingStatus.hidden = false;
              }
              return;
            }
            if (drawingTool === "text") {
              const origin = content.getBoundingClientRect();
              const scale = zoom / 100;
              const items = readMindmapCanvasText(current.attrs.annotations);
              items.push({
                x: Math.round(((event.clientX - origin.left) / scale) * 100) / 100,
                y: Math.round(((event.clientY - origin.top) / scale) * 100) / 100,
                text: "文本",
                size: 14,
                color: "#303233",
                bold: false,
              });
              selected = null;
              selectedText = items.length - 1;
              selectedShape = null;
              selectedLine = null;
              drawingTool = "select";
              if (commitAnnotations(items)) focusAnnotation(selectedText);
              else {
                selectedText = null;
                drawingTool = "text";
                drawingStatus.textContent = "无法添加文字，请减少画布内容后重试。";
                drawingStatus.hidden = false;
              }
              return;
            }
            const source = current,
              epoch = documentEpoch,
              pointer = event.pointerId;
            const strokes = readMindmapStrokes(current.attrs.drawing);
            const coordinates = (point: Pick<PointerEvent, "clientX" | "clientY">): MindmapPoint => {
              const origin = content.getBoundingClientRect(),
                scale = zoom / 100;
              return {
                x: Math.round(((point.clientX - origin.left) / scale) * 100) / 100,
                y: Math.round(((point.clientY - origin.top) / scale) * 100) / 100,
              };
            };
            let previous = coordinates(event),
              tooLong = false,
              active = true;
            pendingStroke =
              drawingTool === "pen"
                ? { points: [previous], color: inkColor, width: inkWidth }
                : drawingTool === "marker"
                  ? { points: [previous], color: markerColor, width: markerWidth, kind: "marker" }
                  : null;
            pendingErased = drawingTool === "eraser" ? new Set<number>() : null;
            const sample = (point: MindmapPoint) => {
              if (pendingStroke && (point.x !== previous.x || point.y !== previous.y)) {
                if (pendingStroke.points.length >= maxMindmapStrokePoints) tooLong = true;
                else pendingStroke.points.push(point);
              }
              if (pendingErased)
                strokes.forEach((stroke, index) => {
                  if (strokeHit(stroke, previous, point)) pendingErased!.add(index);
                });
              previous = point;
              draw();
            };
            const cleanup = () => {
              if (!active) return;
              active = false;
              viewport.removeEventListener("pointermove", move);
              viewport.removeEventListener("pointerup", finish);
              viewport.removeEventListener("pointercancel", abort);
              viewport.removeEventListener("lostpointercapture", abort);
              if (viewport.hasPointerCapture?.(pointer)) viewport.releasePointerCapture(pointer);
              pendingStroke = null;
              pendingErased = null;
              cancelDrawing = null;
            };
            const abort = () => {
              cleanup();
              draw();
            };
            const move = (next: PointerEvent) => {
              if (next.pointerId === pointer) sample(coordinates(next));
            };
            const finish = (next: PointerEvent) => {
              if (next.pointerId !== pointer) return;
              sample(coordinates(next));
              const changed = pendingStroke !== null || !!pendingErased?.size;
              const result = pendingStroke
                ? [...strokes, pendingStroke]
                : strokes.filter((_, index) => !pendingErased?.has(index));
              cleanup();
              if (tooLong) {
                drawingStatus.textContent = "笔画过长，请分段绘制。";
                drawingStatus.hidden = false;
                draw();
              } else if (
                changed &&
                !destroyed &&
                documentEpoch === epoch &&
                current.eq(source) &&
                !commitDrawing(result)
              ) {
                drawingStatus.textContent = "无法保存笔迹，请减少笔迹后重试。";
                drawingStatus.hidden = false;
                draw();
              } else if (!changed) draw();
            };
            cancelDrawing = abort;
            viewport.addEventListener("pointermove", move);
            viewport.addEventListener("pointerup", finish);
            viewport.addEventListener("pointercancel", abort);
            viewport.addEventListener("lostpointercapture", abort);
            try {
              viewport.setPointerCapture(pointer);
            } catch {
              abort();
              return;
            }
            sample(previous);
          },
          true,
        );
        if (editor.isEditable) {
          const tools = doc.createElement("div");
          tools.className = "semlo-editor-mindmap-tools";
          tools.setAttribute("role", "toolbar");
          tools.setAttribute("aria-label", "导图画布工具");
          const selectTool = doc.createElement("button");
          selectTool.type = "button";
          selectTool.setAttribute("aria-label", "选择工具");
          selectTool.title = "选择";
          selectTool.setAttribute("aria-pressed", String(drawingTool === "select"));
          selectTool.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l13 9-6 1-2 6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
          selectTool.addEventListener("click", () => {
            if (finishInput) finishInput(true);
            drawingTool = "select";
            drawingMenuOpen = false;
            lineMenuOpen = false;
            pendingShape = null;
            panEnabled = false;
            paint();
          });
          const brush = doc.createElement("button");
          brush.type = "button";
          brush.setAttribute("aria-label", "画笔工具");
          brush.title = "画笔";
          brush.setAttribute("aria-expanded", String(drawingMenuOpen));
          brush.setAttribute("aria-pressed", String(["pen", "marker", "eraser"].includes(drawingTool)));
          brush.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19c3-5 4-11 7-14l3 2c-2 4-5 8-7 12H4zm9-2c1 0 2-2 3-2s1 2 2 2h2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          const menu = doc.createElement("div");
          menu.className = "semlo-editor-mindmap-tool-menu";
          menu.hidden = !drawingMenuOpen;
          for (const [mode, name, icon] of [
            [
              "pen",
              "画笔",
              "M4 20l1.5-5 9.9-9.9a1.7 1.7 0 012.4 0l1.1 1.1a1.7 1.7 0 010 2.4L9 18.5 4 20zm9.5-13 3.5 3.5",
            ],
            [
              "marker",
              "马克笔",
              "M5 15l8.3-8.3 4 4L9 19H5v-4zm8.3-8.3 1.8-1.8a1.4 1.4 0 012 0l2 2a1.4 1.4 0 010 2l-1.8 1.8M4 20h10",
            ],
            [
              "eraser",
              "橡皮擦",
              "M4 14l7.7-7.7a2 2 0 012.8 0l4.2 4.2a2 2 0 010 2.8L13 19H9l-5-5zm4.5 4.5 8.3-8.3M13 19h6",
            ],
          ] as const) {
            const button = doc.createElement("button");
            button.type = "button";
            button.setAttribute("aria-label", name);
            button.title = name;
            button.setAttribute("aria-pressed", String(drawingTool === mode));
            button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            button.addEventListener("click", () => {
              if (finishInput) finishInput(true);
              drawingTool = mode;
              drawingMenuOpen = false;
              lineMenuOpen = false;
              panEnabled = false;
              selected = null;
              selectedText = null;
              selectedShape = null;
              selectedLine = null;
              pendingShape = null;
              paint();
              dom.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
            });
            menu.append(button);
          }
          const width = doc.createElement("input");
          width.type = "number";
          width.min = "1";
          width.max = "20";
          width.step = "1";
          const colorTool = drawingTool === "marker" ? "marker" : "pen";
          width.value = String(colorTool === "marker" ? markerWidth : inkWidth);
          width.setAttribute("aria-label", colorTool === "marker" ? "马克笔粗细" : "画笔粗细");
          width.addEventListener("change", () => {
            const value = Number(width.value);
            const next = Number.isFinite(value) ? Math.max(1, Math.min(20, Math.round(value))) : 3;
            if (colorTool === "marker") markerWidth = next;
            else inkWidth = next;
            width.value = String(next);
          });
          const colorEpoch = documentEpoch;
          const color = createMindmapColorControl(
            doc,
            colorTool === "marker" ? "马克笔颜色" : "画笔颜色",
            colorTool === "marker" ? markerColor : inkColor,
            (value) => {
              if (destroyed || !editor.isEditable || colorEpoch !== documentEpoch) return;
              if (colorTool === "marker") markerColor = value;
              else inkColor = value;
              paint();
            },
          );
          menu.append(width, color.element);
          brush.addEventListener("click", () => {
            drawingMenuOpen = !drawingMenuOpen;
            menu.hidden = !drawingMenuOpen;
            brush.setAttribute("aria-expanded", String(drawingMenuOpen));
          });
          menu.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            drawingMenuOpen = false;
            lineMenuOpen = false;
            menu.hidden = true;
            brush.setAttribute("aria-expanded", "false");
            brush.focus();
          });
          const textTool = doc.createElement("button");
          textTool.type = "button";
          textTool.setAttribute("aria-label", "画布文字工具");
          textTool.title = "文字";
          textTool.setAttribute("aria-pressed", String(drawingTool === "text"));
          textTool.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8m-4 0v8m-2 0h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          textTool.addEventListener("click", () => {
            if (finishInput) finishInput(true);
            drawingTool = "text";
            drawingMenuOpen = false;
            lineMenuOpen = false;
            panEnabled = false;
            selected = null;
            selectedText = null;
            selectedShape = null;
            selectedLine = null;
            pendingShape = null;
            paint();
            dom.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
          });
          tools.append(selectTool, brush, textTool, menu);
          dom.append(tools);
          disposeShapePicker = createShapePicker({
            doc,
            toolbar: dom,
            parent: tools,
            enabled: () => !destroyed && editor.isEditable && dataSupported(),
            constrainTo: dom,
            choose: (entry) => {
              if (finishInput) finishInput(true);
              pendingShape = entry.tool;
              drawingTool = "shape";
              drawingMenuOpen = false;
              lineMenuOpen = false;
              panEnabled = false;
              selected = null;
              selectedText = null;
              selectedShape = null;
              selectedLine = null;
              paint();
              dom.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
            },
          });
          const shapeTrigger = tools.querySelector<HTMLButtonElement>(".semlo-editor-canvas-more-shapes");
          if (shapeTrigger) {
            shapeTrigger.setAttribute("aria-label", "图形工具");
            shapeTrigger.setAttribute("aria-pressed", String(drawingTool === "shape"));
            shapeTrigger.title = "图形";
            shapeTrigger.innerHTML =
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h12v12H3zM11 11a5 5 0 1 0 10 0 5 5 0 0 0-10 0z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
          }
          const lineControl = doc.createElement("div");
          lineControl.className = "semlo-editor-mindmap-line-control";
          const lineButton = doc.createElement("button");
          lineButton.type = "button";
          lineButton.setAttribute("aria-label", "连线工具");
          lineButton.setAttribute("aria-expanded", String(lineMenuOpen));
          lineButton.setAttribute("aria-pressed", String(drawingTool === "line"));
          lineButton.title = "连线";
          lineButton.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18L19 5m-5 0h5v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          const lineMenu = doc.createElement("div");
          lineMenu.className = "semlo-editor-mindmap-line-menu";
          lineMenu.hidden = !lineMenuOpen;
          for (const [route, name, path] of [
            ["straight", "绘制直线", "M4 17L20 7m-5 0h5v5"],
            ["curved", "绘制曲线", "M4 17C4 7 14 17 20 7m-5 0h5v5"],
            ["orthogonal", "绘制折线", "M4 17h8V7h8m-5 0h5v5"],
          ] as const) {
            const choice = doc.createElement("button");
            choice.type = "button";
            choice.setAttribute("aria-label", name);
            choice.title = name;
            choice.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            choice.addEventListener("click", () => {
              if (finishInput) finishInput(true);
              lineRoute = route;
              lineMenuOpen = false;
              drawingMenuOpen = false;
              drawingTool = "line";
              panEnabled = false;
              selected = null;
              selectedText = null;
              selectedShape = null;
              selectedLine = null;
              pendingShape = null;
              paint();
              dom.querySelector<HTMLElement>(".semlo-editor-mindmap-viewport")?.focus({ preventScroll: true });
            });
            lineMenu.append(choice);
          }
          lineButton.addEventListener("click", () => {
            lineMenuOpen = !lineMenuOpen;
            lineMenu.hidden = !lineMenuOpen;
            lineButton.setAttribute("aria-expanded", String(lineMenuOpen));
          });
          lineMenu.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            lineMenuOpen = false;
            lineMenu.hidden = true;
            lineButton.setAttribute("aria-expanded", "false");
            lineButton.focus();
          });
          lineControl.append(lineButton, lineMenu);
          tools.append(lineControl);
        }
        const controls = doc.createElement("div");
        controls.className = "semlo-editor-mindmap-view-controls";
        const control = (name: string, text: string) => {
          const button = doc.createElement("button");
          button.type = "button";
          button.setAttribute("aria-label", name);
          button.title = name;
          button.textContent = text;
          return button;
        };
        const withIcon = (button: HTMLButtonElement, pathData: string) => {
          const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("viewBox", "0 0 24 24");
          icon.setAttribute("aria-hidden", "true");
          const path = doc.createElementNS(icon.namespaceURI, "path");
          path.setAttribute("d", pathData);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", "currentColor");
          path.setAttribute("stroke-width", "1.4");
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          icon.append(path);
          button.append(icon);
        };
        const pan = control("平移画布", "");
        withIcon(
          pan,
          "M7 11V6a2 2 0 0 1 4 0v4-6a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-5-2-7-5l-2-3a2 2 0 0 1 3-2l1 1",
        );
        pan.setAttribute("aria-pressed", String(panEnabled));
        const fit = control("适应画布", "");
        withIcon(fit, "M4 9V5h4 M16 5h4v4 M20 15v4h-4 M8 19H4v-4 M8 9h8v6H8z");
        const minus = control("缩小画布", "−");
        const value = doc.createElement("output");
        value.setAttribute("aria-label", "缩放比例");
        const plus = control("放大画布", "+");
        const refreshControls = () => {
          value.textContent = `${zoom}%`;
          minus.disabled = zoom <= 20;
          plus.disabled = zoom >= 200;
          pan.setAttribute("aria-pressed", String(panEnabled));
          viewport.classList.toggle("is-panning", panEnabled);
          viewport.tabIndex = panEnabled || drawingTool !== "select" ? 0 : -1;
          if (panEnabled) viewport.setAttribute("aria-label", "平移思维导图");
          else if (drawingTool !== "select")
            viewport.setAttribute(
              "aria-label",
              drawingTool === "eraser"
                ? "擦除笔迹"
                : drawingTool === "text"
                  ? "添加画布文字"
                  : drawingTool === "shape"
                    ? "添加画布图形"
                    : drawingTool === "line"
                      ? "绘制连线"
                      : "绘制笔迹",
            );
          else viewport.setAttribute("aria-label", "思维导图画布");
        };
        const setZoom = (next: number) => {
          zoom = Math.min(200, Math.max(20, next));
          applyViewport();
          refreshControls();
        };
        pan.addEventListener("click", () => {
          panEnabled = !panEnabled;
          if (panEnabled && drawingTool !== "select") {
            drawingTool = "select";
            drawingMenuOpen = false;
            lineMenuOpen = false;
            pendingShape = null;
            paint();
            return;
          }
          refreshControls();
        });
        fit.addEventListener("click", () => {
          const width = Math.max(1, viewport.clientWidth - 64);
          const height = Math.max(1, viewport.clientHeight - 64);
          let left = 0,
            top = 0,
            right = content.offsetWidth,
            bottom = content.offsetHeight;
          const include = (x: number, y: number, w: number, h: number, margin = 0) => {
            left = Math.min(left, x - margin);
            top = Math.min(top, y - margin);
            right = Math.max(right, x + w + margin);
            bottom = Math.max(bottom, y + h + margin);
          };
          const origin = content.getBoundingClientRect();
          const scale = zoom / 100;
          content
            .querySelectorAll<HTMLElement>("[data-mindmap-annotation], [data-mindmap-shape]")
            .forEach((element) => {
              const bounds = element.getBoundingClientRect();
              include(
                (bounds.left - origin.left) / scale,
                (bounds.top - origin.top) / scale,
                bounds.width / scale,
                bounds.height / scale,
              );
            });
          content
            .querySelectorAll<SVGGraphicsElement>(
              ".semlo-editor-mindmap-stroke, .semlo-editor-mindmap-canvas-line, .semlo-editor-mindmap-line-label",
            )
            .forEach((element) => {
              const bounds = element.getBBox();
              include(bounds.x, bounds.y, bounds.width, bounds.height, 10);
            });
          const next = Math.min(
            100,
            Math.max(20, Math.floor(Math.min(width / (right - left), height / (bottom - top)) * 100)),
          );
          panX = (content.offsetWidth / 2 - (left + right) / 2) * (next / 100);
          panY = (content.offsetHeight / 2 - (top + bottom) / 2) * (next / 100);
          setZoom(next);
          viewport.scrollLeft = viewport.scrollTop = 0;
        });
        minus.addEventListener("click", () => setZoom(zoom - 20));
        plus.addEventListener("click", () => setZoom(zoom + 20));
        viewport.addEventListener(
          "pointerdown",
          (event) => {
            if (!panEnabled || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const startX = event.clientX,
              startY = event.clientY,
              originalX = panX,
              originalY = panY;
            const pointer = event.pointerId;
            viewport.setPointerCapture(pointer);
            viewport.classList.add("is-dragging");
            const move = (next: PointerEvent) => {
              if (next.pointerId !== pointer) return;
              panX = originalX + next.clientX - startX;
              panY = originalY + next.clientY - startY;
              applyViewport();
            };
            const finish = (next: PointerEvent) => {
              if (next.pointerId !== pointer) return;
              if (next.type === "pointercancel") {
                panX = originalX;
                panY = originalY;
                applyViewport();
              }
              viewport.classList.remove("is-dragging");
              viewport.removeEventListener("pointermove", move);
              viewport.removeEventListener("pointerup", finish);
              viewport.removeEventListener("pointercancel", finish);
            };
            viewport.addEventListener("pointermove", move);
            viewport.addEventListener("pointerup", finish);
            viewport.addEventListener("pointercancel", finish);
          },
          true,
        );
        viewport.addEventListener(
          "click",
          (event) => {
            if (!panEnabled) return;
            event.preventDefault();
            event.stopPropagation();
          },
          true,
        );
        viewport.addEventListener("keydown", (event) => {
          if (
            (drawingTool !== "select" || event.target === viewport) &&
            !event.isComposing &&
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "z"
          ) {
            event.preventDefault();
            event.stopPropagation();
            cancelDrawing?.();
            (event.shiftKey ? redo : undo)(view.state, view.dispatch);
            return;
          }
          if (!panEnabled || event.target !== viewport) return;
          const delta = 30;
          if (event.key === "ArrowLeft") panX -= delta;
          else if (event.key === "ArrowRight") panX += delta;
          else if (event.key === "ArrowUp") panY -= delta;
          else if (event.key === "ArrowDown") panY += delta;
          else return;
          event.preventDefault();
          applyViewport();
        });
        controls.append(pan, fit, minus, value, plus);
        dom.append(controls);
        refreshControls();
        if (restoreViewportFocus) viewport.focus({ preventScroll: true });
        applyViewport();
        doc.defaultView?.requestAnimationFrame(applyViewport);
        if (doc.defaultView?.ResizeObserver) {
          layoutObserver = new doc.defaultView.ResizeObserver(applyViewport);
          layoutObserver.observe(content);
        } else if (doc.defaultView) {
          const win = doc.defaultView;
          win.addEventListener("resize", applyViewport);
          removeResizeFallback = () => win.removeEventListener("resize", applyViewport);
        }
        mountCanvasHeight(dom, current.attrs.height, editor.isEditable, commitHeight);
        if (restoreHeightFocus && editor.isEditable)
          dom.querySelector<HTMLElement>(".semlo-editor-canvas-height-handle")?.focus({ preventScroll: true });
      };
      let editable = editor.isEditable;
      const refreshEditable = () => {
        if (editable === editor.isEditable || destroyed) return;
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
        if (destroyed) return;
        const transactions = [transaction, ...appendedTransactions];
        if (!transactions.some((entry) => entry.docChanged)) return;
        const outOfOrder = observedDocument !== transaction.before;
        observedDocument = view.state.doc;
        const previousNode = observedNode;
        let position = observedPosition;
        const finalPosition = getPos();
        const finalNode = typeof finalPosition === "number" ? view.state.doc.nodeAt(finalPosition) : null;
        observedNode = finalNode ?? current;
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
        documentEpoch++;
        selected = null;
        selectedText = null;
        selectedShape = null;
        pendingShape = null;
        selectedLine = null;
        pendingLine = null;
        lineRoute = "straight";
        lineMenuOpen = false;
        input = null;
        zoom = 100;
        panX = panY = 0;
        panEnabled = false;
        maximized = false;
        drawingTool = "select";
        drawingMenuOpen = false;
        inkColor = "#585a5a";
        inkWidth = 3;
        markerColor = "#d8b95b";
        markerWidth = 16;
        branchMenuOpen = false;
        shapeMenuOpen = false;
        markerMenuOpen = false;
        markerCategory = null;
        styleMenuOpen = false;
        linkMenuOpen = false;
        linkSelection = null;
        paint();
      };
      editor.on("update", refreshEditable);
      editor.on("transaction", resetAfterDocumentReplacement);
      view.dom.addEventListener("semlo-editor:editable", refreshEditable);
      paint();
      return {
        dom,
        update(node) {
          if (node.type !== current.type) return false;
          if (linkMenuOpen && !current.eq(node)) {
            linkMenuOpen = false;
            linkSelection = null;
          }
          current = node;
          input = null;
          finishInput = null;
          paint();
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy() {
          destroyed = true;
          cancelDrawing?.();
          cancelDrawing = null;
          cancelTextDrag?.();
          cancelTextDrag = null;
          cancelShapeDrag?.();
          cancelShapeDrag = null;
          cancelLineGesture?.();
          cancelLineGesture = null;
          disposeShapePicker?.();
          disposeShapePicker = null;
          layoutObserver?.disconnect();
          removeResizeFallback?.();
          editor.off("update", refreshEditable);
          editor.off("transaction", resetAfterDocumentReplacement);
          view.dom.removeEventListener("semlo-editor:editable", refreshEditable);
          input = null;
          finishInput = null;
        },
      };
    };
  },
});
