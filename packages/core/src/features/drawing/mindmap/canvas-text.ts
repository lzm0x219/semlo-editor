import type { DOMOutputSpec } from "@tiptap/pm/model";

import { itemLinks, validTextLinks, type MindmapLink, type MindmapLinkedText } from "./text-links";

export interface MindmapCanvasText extends MindmapLinkedText {
  x: number;
  y: number;
  size: number;
  color: string;
  bold: boolean;
  rotation?: number;
  width?: number;
  height?: number;
  align?: "left" | "center" | "right" | "justify";
  verticalAlign?: "top" | "middle" | "bottom";
}

export function readMindmapCanvasText(value: unknown, invalid: () => void = () => {}): MindmapCanvasText[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 1000) {
    invalid();
    return [];
  }
  let total = 0;
  const items: MindmapCanvasText[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some(
        (key) =>
          ![
            "x",
            "y",
            "text",
            "size",
            "color",
            "bold",
            "rotation",
            "width",
            "height",
            "align",
            "verticalAlign",
            "href",
            "links",
          ].includes(key),
      ) ||
      typeof item.x !== "number" ||
      !Number.isFinite(item.x) ||
      Math.abs(item.x) > 100000 ||
      typeof item.y !== "number" ||
      !Number.isFinite(item.y) ||
      Math.abs(item.y) > 100000 ||
      typeof item.text !== "string" ||
      item.text.length > 10000 ||
      !validTextLinks(item.text, item.href, item.links) ||
      typeof item.size !== "number" ||
      !Number.isFinite(item.size) ||
      item.size < 8 ||
      item.size > 96 ||
      typeof item.color !== "string" ||
      !/^#[\da-f]{6}$/i.test(item.color) ||
      typeof item.bold !== "boolean" ||
      (item.rotation !== undefined && (typeof item.rotation !== "number" || !Number.isFinite(item.rotation))) ||
      (item.width !== undefined &&
        (typeof item.width !== "number" || !Number.isFinite(item.width) || item.width < 24 || item.width > 5000)) ||
      (item.height !== undefined &&
        (typeof item.height !== "number" || !Number.isFinite(item.height) || item.height < 24 || item.height > 5000)) ||
      (item.align !== undefined && !["left", "center", "right", "justify"].includes(item.align)) ||
      (item.verticalAlign !== undefined && !["top", "middle", "bottom"].includes(item.verticalAlign))
    ) {
      invalid();
      return [];
    }
    total += item.text.length;
    if (total > 100000) {
      invalid();
      return [];
    }
    items.push({
      x: item.x,
      y: item.y,
      text: item.text,
      size: item.size,
      color: item.color,
      bold: item.bold,
      ...(item.rotation === undefined ? {} : { rotation: item.rotation }),
      ...(item.width === undefined ? {} : { width: item.width }),
      ...(item.height === undefined ? {} : { height: item.height }),
      ...(item.align === undefined ? {} : { align: item.align }),
      ...(item.verticalAlign === undefined ? {} : { verticalAlign: item.verticalAlign }),
      ...(item.href === undefined ? {} : { href: item.href }),
      ...(item.links === undefined ? {} : { links: (item.links as MindmapLink[]).map((link) => ({ ...link })) }),
    });
  }
  return items;
}

function htmlText(item: MindmapCanvasText): Array<DOMOutputSpec | string> {
  const parts: Array<DOMOutputSpec | string> = [];
  let offset = 0;
  for (const link of itemLinks(item)) {
    if (offset < link.from) parts.push(item.text.slice(offset, link.from));
    parts.push([
      "a",
      {
        href: link.href,
        target: "_blank",
        rel: "noopener noreferrer",
        style: "color:#1677ff;text-decoration:underline",
      },
      item.text.slice(link.from, link.to),
    ]);
    offset = link.to;
  }
  if (offset < item.text.length) parts.push(item.text.slice(offset));
  return parts.length ? parts : [" "];
}

function svgText(item: MindmapCanvasText, x: number): DOMOutputSpec[] {
  const parts: DOMOutputSpec[] = [];
  const links = itemLinks(item);
  let offset = 0;
  for (const [lineIndex, line] of item.text.split("\n").entries()) {
    const end = offset + line.length;
    let cursor = offset;
    let first = true;
    const add = (value: string, href?: string) => {
      const attrs = first ? { x, dy: lineIndex ? item.size * 1.4 : 0 } : {};
      first = false;
      const span: DOMOutputSpec = ["tspan", attrs, value || " "];
      parts.push(href ? ["a", { href, target: "_blank", rel: "noopener noreferrer" }, span] : span);
    };
    for (const link of links) {
      const from = Math.max(offset, link.from),
        to = Math.min(end, link.to);
      if (to <= from) continue;
      if (cursor < from) add(item.text.slice(cursor, from));
      add(item.text.slice(from, to), link.href);
      cursor = to;
    }
    if (cursor < end) add(item.text.slice(cursor, end));
    if (first) add(" ");
    offset = end + 1;
  }
  return parts;
}

export function exportMindmapCanvasText(svg: DOMOutputSpec, items: MindmapCanvasText[]): DOMOutputSpec {
  if (!items.length || !Array.isArray(svg) || typeof svg[1] !== "object" || !svg[1] || Array.isArray(svg[1]))
    return svg;
  const attrs = svg[1] as Record<string, string | number>;
  let [minX, minY, width, height] = String(attrs.viewBox ?? "0 0 0 0")
    .split(/\s+/)
    .map(Number);
  let maxX = minX + width;
  let maxY = minY + height;
  const text: DOMOutputSpec[] = [];
  for (const item of items) {
    const x = item.x + 16;
    const y = item.y + 16;
    const lines = item.text.split("\n");
    const estimatedWidth = Math.max(
      16,
      ...lines.map((line) =>
        Array.from(line).reduce((n, char) => n + (char.codePointAt(0)! > 255 ? item.size : item.size * 0.6), 0),
      ),
    );
    const textHeight = lines.length * item.size * 1.4;
    const boxed =
      item.width !== undefined ||
      item.height !== undefined ||
      item.align !== undefined ||
      item.verticalAlign !== undefined ||
      item.href !== undefined ||
      item.links !== undefined;
    const boxWidth = item.width ?? (boxed ? estimatedWidth + 8 : estimatedWidth);
    const boxHeight = item.height ?? (boxed ? textHeight + 8 : textHeight);
    const wrappedLines = lines.reduce((count, line) => {
      const width = Array.from(line).reduce(
        (n, char) => n + (char.codePointAt(0)! > 255 ? item.size : item.size * 0.6),
        0,
      );
      // 留出换词、不同字体及宽字符造成的额外行数，防止导出的画布裁掉溢出文字。
      return count + Math.max(1, Math.ceil(width / Math.max(1, boxWidth - 8)) * 2);
    }, 0);
    const visibleHeight = boxed ? Math.max(boxHeight, wrappedLines * item.size * 1.4 + 8) : boxHeight;
    const cx = x + boxWidth / 2;
    const cy = y + boxHeight / 2;
    const angle = ((item.rotation ?? 0) * Math.PI) / 180;
    // 文本超过固定框时可能从任一侧溢出；旋转后为溢出的高度和单字宽度预留空间。
    const overflowY = Math.max(0, visibleHeight - boxHeight);
    const overflowX = boxed ? Math.max(0, item.size + 8 - boxWidth) : 0;
    const halfWidth =
      (Math.abs(Math.cos(angle)) * boxWidth + Math.abs(Math.sin(angle)) * boxHeight) / 2 +
      Math.abs(Math.cos(angle)) * overflowX +
      Math.abs(Math.sin(angle)) * overflowY;
    const halfHeight =
      (Math.abs(Math.sin(angle)) * boxWidth + Math.abs(Math.cos(angle)) * boxHeight) / 2 +
      Math.abs(Math.sin(angle)) * overflowX +
      Math.abs(Math.cos(angle)) * overflowY;
    minX = Math.min(minX, cx - halfWidth - 4);
    minY = Math.min(minY, cy - halfHeight - 4);
    maxX = Math.max(maxX, cx + halfWidth + 4);
    maxY = Math.max(maxY, cy + halfHeight + 4);
    const transform = item.rotation ? { transform: `rotate(${item.rotation} ${cx} ${cy})` } : {};
    if (!boxed) {
      text.push([
        "text",
        {
          x,
          y: y + item.size,
          "font-size": item.size,
          "font-weight": item.bold ? "700" : "400",
          fill: item.color,
          ...transform,
        },
        ...lines.map((line, index): DOMOutputSpec => ["tspan", { x, dy: index ? item.size * 1.4 : 0 }, line || " "]),
      ]);
      continue;
    }
    const align = item.align ?? "left";
    const horizontal = align === "right" ? x + boxWidth - 4 : align === "center" ? x + boxWidth / 2 : x + 4;
    const top =
      item.verticalAlign === "bottom"
        ? y + boxHeight - textHeight - 4
        : item.verticalAlign === "middle"
          ? y + (boxHeight - textHeight) / 2
          : y + 4;
    const vertical =
      item.verticalAlign === "bottom" ? "flex-end" : item.verticalAlign === "middle" ? "center" : "flex-start";
    text.push([
      "switch",
      transform,
      [
        "foreignObject",
        {
          x,
          y,
          width: boxWidth,
          height: boxHeight,
          requiredExtensions: "http://www.w3.org/1999/xhtml",
          style: "overflow:visible",
        },
        [
          "div",
          {
            xmlns: "http://www.w3.org/1999/xhtml",
            style: `box-sizing:border-box;display:flex;flex-direction:column;justify-content:${vertical};width:100%;height:100%;padding:4px;overflow:visible`,
          },
          [
            "div",
            {
              style: `width:100%;white-space:pre-wrap;overflow-wrap:anywhere;font-size:${item.size}px;line-height:1.4;font-weight:${item.bold ? "700" : "400"};text-align:${align};color:${item.color}`,
            },
            ...htmlText(item),
          ],
        ],
      ],
      [
        "text",
        {
          x: horizontal,
          y: top + item.size,
          "text-anchor": align === "right" ? "end" : align === "center" ? "middle" : "start",
          "font-size": item.size,
          "font-weight": item.bold ? "700" : "400",
          fill: item.color,
        },
        ...svgText(item, horizontal),
      ],
    ]);
  }
  width = maxX - minX;
  height = maxY - minY;
  return [
    svg[0],
    { ...attrs, viewBox: `${minX} ${minY} ${width} ${height}` },
    ...svg.slice(2),
    ...text,
  ] as DOMOutputSpec;
}
