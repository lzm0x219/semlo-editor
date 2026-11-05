import type { DOMOutputSpec } from "@tiptap/pm/model";

import { edgeGeometry, endpointBox, textBaseline } from "./geometry";
import { polygonPoints, specialShapePath, type CanvasData } from "./model";

export function exportCanvas(data: CanvasData): DOMOutputSpec {
  const parts: DOMOutputSpec[] = [];
  let left = 0,
    top = 0,
    right = 800,
    bottom = 440;
  const include = (x: number, y: number, padding = 0) => {
    left = Math.min(left, x - padding);
    top = Math.min(top, y - padding);
    right = Math.max(right, x + padding);
    bottom = Math.max(bottom, y + padding);
  };
  for (const item of data.shapes) {
    const cx = item.x + item.width / 2,
      cy = item.y + item.height / 2;
    const angle = ((item.rotation ?? 0) * Math.PI) / 180;
    const halfWidth = (Math.abs(Math.cos(angle)) * item.width + Math.abs(Math.sin(angle)) * item.height) / 2;
    const halfHeight = (Math.abs(Math.sin(angle)) * item.width + Math.abs(Math.cos(angle)) * item.height) / 2;
    include(cx - halfWidth, cy - halfHeight, (item.strokeWidth ?? 2) / 2 + 1);
    include(
      cx + halfWidth,
      cy + halfHeight + (item.shape === "actor" && item.text ? (item.fontSize ?? 14) : 0),
      (item.strokeWidth ?? 2) / 2 + 1,
    );
    if (item.text && item.shape !== "image") {
      const fontSize = item.fontSize ?? 14;
      const lines = item.text.split("\n");
      const width = lines.reduce((maximum, line) => Math.max(maximum, Array.from(line).length * fontSize), 0);
      const align = item.textAlign ?? "center";
      const anchorX =
        align === "left" || align === "justify" ? item.x + 8 : align === "right" ? item.x + item.width - 8 : cx;
      const textLeft =
        align === "left" || align === "justify" ? anchorX : align === "right" ? anchorX - width : anchorX - width / 2;
      const textY = textBaseline(item, lines.length);
      // The browser can wrap XHTML text independently of the SVG text fallback.
      // Keep a conservative vertical extent without relying on a DOM or installed fonts.
      if (item.shape !== "actor") {
        const contentWidth = Math.max(1, item.width - 2 * (6 + (item.strokeWidth ?? 2)));
        const charactersPerLine = Math.max(1, Math.floor(contentWidth / (fontSize * 2)));
        const lineCount = lines.reduce(
          (count, line) => count + Math.max(1, Math.ceil((Array.from(line).length * 2) / charactersPerLine)),
          0,
        );
        const textHeight = lineCount * fontSize * 2;
        const textTop =
          item.verticalAlign === "top"
            ? item.y + 8
            : item.verticalAlign === "bottom"
              ? item.y + item.height - 8 - textHeight
              : cy - textHeight / 2;
        for (const x of [item.x - fontSize * 2, item.x + item.width + fontSize * 2])
          for (const y of [textTop, textTop + textHeight])
            include(
              cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle),
              cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle),
              2,
            );
      }
      for (const x of [textLeft, textLeft + width])
        for (const y of [textY - fontSize, textY + (lines.length - 1) * fontSize * 1.2 + fontSize * 0.3])
          include(
            cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle),
            cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle),
            2,
          );
    }
  }
  for (const stroke of data.strokes ?? [])
    for (const point of stroke.points) include(point.x, point.y, (stroke.width ?? 3) / 2);
  for (const edge of data.edges) {
    if (edge.fromPoint) include(edge.fromPoint.x, edge.fromPoint.y, 10);
    if (edge.toPoint) include(edge.toPoint.x, edge.toPoint.y, 10);
    const from = endpointBox(data, edge.from, edge.fromPoint),
      to = endpointBox(data, edge.to, edge.toPoint);
    const geometry =
      from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
    if (geometry) include(geometry.midX, geometry.midY, (edge.width ?? 2) / 2 + 1);
    if (geometry && edge.text) {
      const halfWidth = (Array.from(edge.text).length * 14) / 2;
      include(geometry.midX - halfWidth, geometry.midY - 19);
      include(geometry.midX + halfWidth, geometry.midY);
    }
  }
  for (const edge of data.edges) {
    const from = endpointBox(data, edge.from, edge.fromPoint),
      to = endpointBox(data, edge.to, edge.toPoint);
    const g = from && to ? edgeGeometry(from, to, edge.route, edge.startMarker, edge.endMarker, edge.bendOffset) : null;
    if (!g) continue;
    parts.push([
      "path",
      {
        d: g.path,
        fill: "none",
        stroke: edge.color ?? "#555",
        "stroke-width": edge.width ?? 2,
        ...(edge.dashed ? { "stroke-dasharray": "5 4" } : {}),
      },
    ]);
    if (edge.arrow)
      parts.push([
        "path",
        {
          d: g.arrow,
          fill: g.endFill === "currentColor" ? (edge.color ?? "#555") : g.endFill,
          stroke: edge.color ?? "#555",
        },
      ]);
    if (edge.startArrow)
      parts.push([
        "path",
        {
          d: g.startArrow,
          fill: g.startFill === "currentColor" ? (edge.color ?? "#555") : g.startFill,
          stroke: edge.color ?? "#555",
        },
      ]);
    if (edge.text)
      parts.push([
        "text",
        { x: g.midX, y: g.midY - 5, "text-anchor": "middle", "font-size": 14, fill: "#222" },
        edge.text,
      ]);
  }
  for (const stroke of data.strokes ?? [])
    parts.push([
      "path",
      {
        d: stroke.points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" "),
        fill: "none",
        stroke: stroke.color ?? "#555555",
        "stroke-width": stroke.width ?? 3,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
    ]);
  for (const item of data.shapes) {
    const partStart = parts.length;
    const style = {
      fill: item.fill === "transparent" || (item.lanes && item.fill === undefined) ? "none" : (item.fill ?? "#fff"),
      stroke: item.stroke ?? "#555",
      "stroke-width": item.strokeWidth ?? 2,
      ...(item.strokeDashed ? { "stroke-dasharray": "5 4" } : {}),
    };
    if (item.shape === "image") {
      parts.push([
        "image",
        {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          href: item.imageSrc!,
          preserveAspectRatio: "none",
        },
      ]);
    } else if (item.lanes) {
      const vertical = item.shape === "swimlaneVertical";
      const count = item.lanes.length;
      const header = Math.min(60, (vertical ? item.height : item.width) / 2);
      parts.push(["rect", { x: item.x, y: item.y, width: item.width, height: item.height, ...style }]);
      for (let index = 0; index < count; index++) {
        if (index > 0) {
          const x = item.x + (item.width * index) / count;
          const y = item.y + (item.height * index) / count;
          parts.push([
            "path",
            {
              d: vertical ? `M ${x} ${item.y} V ${item.y + item.height}` : `M ${item.x} ${y} H ${item.x + item.width}`,
              fill: "none",
              stroke: item.stroke ?? "#555",
              "stroke-width": item.strokeWidth ?? 2,
              ...(item.strokeDashed ? { "stroke-dasharray": "5 4" } : {}),
            },
          ]);
        }
        parts.push([
          "text",
          {
            x: vertical ? item.x + (item.width * (index + 0.5)) / count : item.x + header / 2,
            y: vertical ? item.y + header / 2 + 5 : item.y + (item.height * (index + 0.5)) / count + 5,
            "text-anchor": "middle",
            "font-size": item.fontSize ?? 14,
            "font-weight": item.bold === false ? "normal" : "bold",
            "font-style": item.italic ? "italic" : "normal",
            "text-decoration":
              [item.underline && "underline", item.strike && "line-through"].filter(Boolean).join(" ") || "none",
            fill: item.textColor ?? "#222",
          },
          item.lanes[index],
        ]);
      }
      parts.push([
        "path",
        {
          d: vertical
            ? `M ${item.x} ${item.y + header} H ${item.x + item.width}`
            : `M ${item.x + header} ${item.y} V ${item.y + item.height}`,
          fill: "none",
          stroke: item.stroke ?? "#555",
          "stroke-width": item.strokeWidth ?? 2,
          ...(item.strokeDashed ? { "stroke-dasharray": "5 4" } : {}),
        },
      ]);
    } else if (item.shape === "rectangle" || item.shape === "rounded" || item.shape === "roundedRect")
      parts.push([
        "rect",
        {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          rx: item.shape === "rounded" ? item.height / 2 : item.shape === "roundedRect" ? 8 : 0,
          ...style,
        },
      ]);
    else if (item.shape === "ellipse")
      parts.push([
        "ellipse",
        {
          cx: item.x + item.width / 2,
          cy: item.y + item.height / 2,
          rx: item.width / 2,
          ry: item.height / 2,
          ...style,
        },
      ]);
    else if (item.shape === "diamond")
      parts.push([
        "path",
        {
          d: `M ${item.x + item.width / 2} ${item.y} L ${item.x + item.width} ${item.y + item.height / 2} L ${item.x + item.width / 2} ${item.y + item.height} L ${item.x} ${item.y + item.height / 2} Z`,
          ...style,
        },
      ]);
    else if (specialShapePath(item.shape))
      parts.push([
        "path",
        {
          d: specialShapePath(item.shape),
          transform: `translate(${item.x} ${item.y}) scale(${item.width / 100} ${item.height / 100})`,
          ...style,
          ...(item.shape === "leftBracket" || item.shape === "rightBracket" ? { fill: "none" } : {}),
          "vector-effect": "non-scaling-stroke",
          "stroke-linejoin": "round",
        },
      ]);
    else if (polygonPoints(item.shape)) {
      const points = polygonPoints(item.shape)!
        .split(" ")
        .map((point) => {
          const [x, y] = point.split(",").map(Number);
          return `${item.x + (x * item.width) / 100},${item.y + (y * item.height) / 100}`;
        })
        .join(" ");
      parts.push(["polygon", { points, ...style, "stroke-linejoin": "round" }]);
    } else if (item.shape === "actor") {
      const cx = item.x + item.width / 2,
        y = item.y,
        h = item.height;
      parts.push([
        "circle",
        {
          cx,
          cy: y + h * 0.15,
          r: h * 0.12,
          fill: "none",
          stroke: item.stroke ?? "#555",
          "stroke-width": item.strokeWidth ?? 2,
          ...(item.strokeDashed ? { "stroke-dasharray": "5 4" } : {}),
        },
      ]);
      parts.push([
        "path",
        {
          d: `M ${cx} ${y + h * 0.27} L ${cx} ${y + h * 0.58} M ${cx - h * 0.25} ${y + h * 0.4} L ${cx + h * 0.25} ${y + h * 0.4} M ${cx} ${y + h * 0.58} L ${cx - h * 0.22} ${y + h * 0.88} M ${cx} ${y + h * 0.58} L ${cx + h * 0.22} ${y + h * 0.88}`,
          fill: "none",
          stroke: item.stroke ?? "#555",
          "stroke-width": item.strokeWidth ?? 2,
          ...(item.strokeDashed ? { "stroke-dasharray": "5 4" } : {}),
        },
      ]);
    }
    if (item.text && item.shape !== "image") {
      const lines = item.text.split("\n");
      const fontSize = item.fontSize ?? 14;
      const align = item.textAlign ?? "center";
      const x =
        align === "left" || align === "justify"
          ? item.x + 8
          : align === "right"
            ? item.x + item.width - 8
            : item.x + item.width / 2;
      const anchor = align === "left" || align === "justify" ? "start" : align === "right" ? "end" : "middle";
      const lineHeight = fontSize * 1.2;
      const y = textBaseline(item, lines.length);
      const fallback: DOMOutputSpec = [
        "text",
        {
          x,
          y,
          "text-anchor": anchor,
          "font-size": fontSize,
          "font-weight": item.bold ? "bold" : "normal",
          "font-style": item.italic ? "italic" : "normal",
          "text-decoration":
            [item.underline && "underline", item.strike && "line-through"].filter(Boolean).join(" ") || "none",
          fill: item.textColor ?? (item.shape === "text" ? item.stroke : undefined) ?? "#222222",
        },
        ...lines.map((line, index) => ["tspan", { x, dy: index ? lineHeight : 0 }, line] as DOMOutputSpec),
      ];
      if (item.shape === "actor") parts.push(fallback);
      else {
        const inset =
          item.verticalAlign && item.verticalAlign !== "middle"
            ? 8
            : polygonPoints(item.shape)
              ? 6
              : item.shape === "text"
                ? 8
                : 6 + (item.strokeWidth ?? 2);
        const alignY =
          item.verticalAlign === "top" ? "flex-start" : item.verticalAlign === "bottom" ? "flex-end" : "center";
        const decoration =
          [item.underline && "underline", item.strike && "line-through"].filter(Boolean).join(" ") || "none";
        const color = item.textColor ?? (item.shape === "text" ? item.stroke : undefined) ?? "#222222";
        parts.push([
          "switch",
          {},
          [
            "foreignObject",
            {
              x: item.x + inset,
              y: item.y,
              width: Math.max(1, item.width - 2 * inset),
              height: item.height,
              requiredExtensions: "http://www.w3.org/1999/xhtml",
              style: "overflow:visible",
            },
            [
              "http://www.w3.org/1999/xhtml div",
              {
                xmlns: "http://www.w3.org/1999/xhtml",
                style: `box-sizing:border-box;display:flex;flex-direction:column;justify-content:${alignY};height:100%;padding:8px 0;overflow:visible`,
              },
              [
                "div",
                {
                  style: `white-space:pre-wrap;overflow-wrap:anywhere;width:100%;font-size:${fontSize}px;line-height:normal;font-weight:${item.bold ? "bold" : "normal"};font-style:${item.italic ? "italic" : "normal"};text-decoration:${decoration};text-align:${align};color:${color}`,
                },
                item.text,
              ],
            ],
          ],
          fallback,
        ]);
      }
    }
    if (item.rotation) {
      const children = parts.splice(partStart);
      parts.push([
        "g",
        { transform: `rotate(${item.rotation} ${item.x + item.width / 2} ${item.y + item.height / 2})` },
        ...children,
      ]);
    }
  }
  return [
    "http://www.w3.org/2000/svg svg",
    { viewBox: `${left} ${top} ${right - left} ${bottom - top}`, width: "100%", role: "img", "aria-label": "画布图形" },
    ...parts,
  ];
}
