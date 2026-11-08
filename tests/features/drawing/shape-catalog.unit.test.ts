import { expect, test } from "@rstest/core";

import { exportCanvas } from "../../../packages/core/src/features/drawing/canvas/export";
import { edgeGeometry, shapeContains } from "../../../packages/core/src/features/drawing/canvas/geometry";
import { dataFrom, markerOptions, type CanvasShape } from "../../../packages/core/src/features/drawing/canvas/model";
import { shapeCatalog } from "../../../packages/core/src/features/drawing/canvas/shape-catalog";
import {
  graphicPaths,
  libraryShapeNames,
  shapeGraphic,
} from "../../../packages/core/src/features/drawing/canvas/shape-library";
import {
  createSmartTemplate,
  isSmartTemplate,
  smartTemplateNames,
} from "../../../packages/core/src/features/drawing/canvas/smart-templates";

const shape = (type: CanvasShape["shape"]): CanvasShape => ({
  id: "sample",
  shape: type,
  x: 10,
  y: 20,
  width: 120,
  height: 80,
  text: "图形文字",
  fill: "#fff0cc",
  stroke: "#332211",
  strokeWidth: 3,
  strokeDashed: true,
  rotation: 30,
  bold: true,
  fontSize: 18,
});
function paths(spec: unknown): string[] {
  if (!Array.isArray(spec)) return [];
  const result = spec[0] === "path" && typeof spec[1]?.d === "string" ? [spec[1].d as string] : [];
  return [...result, ...spec.flatMap((child) => (Array.isArray(child) ? paths(child) : []))];
}

test("连线端点样式可保存并以相同几何导出", () => {
  expect(markerOptions).toHaveLength(21);
  for (const [marker] of markerOptions) {
    const sample = {
      shapes: [],
      edges: [
        {
          id: "line",
          from: "",
          to: "",
          fromPoint: { x: 50, y: 50 },
          toPoint: { x: 150, y: 100 },
          text: "",
          dashed: false,
          arrow: true,
          startArrow: true,
          startMarker: marker,
          endMarker: marker,
          route: "straight" as const,
        },
      ],
    };
    let invalid = false;
    const parsed = dataFrom(JSON.parse(JSON.stringify(sample)), "board", () => (invalid = true));
    expect(invalid, marker).toBe(false);
    expect(parsed.edges[0].startMarker, marker).toBe(marker);
    expect(parsed.edges[0].endMarker, marker).toBe(marker);
    const geometry = edgeGeometry(
      { x: 50, y: 50, width: 0, height: 0 },
      { x: 150, y: 100, width: 0, height: 0 },
      "straight",
      marker,
      marker,
    )!;
    expect(paths(exportCanvas(parsed)), marker).toEqual(expect.arrayContaining([geometry.startArrow, geometry.arrow]));
  }
});

test("五类有限目录与当前观察清单一致，入口ID唯一且均有实际工具", () => {
  expect(shapeCatalog.map((category) => [category.label, category.entries.length])).toEqual([
    ["基础图形", 22],
    ["流程图", 28],
    ["Smart", 4],
    ["UML", 30],
    ["ER", 9],
  ]);
  const entries = shapeCatalog.flatMap((category) => category.entries);
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(93);
  for (const entry of entries) {
    expect(entry.label).not.toBe("");
    if (isSmartTemplate(entry.tool)) continue;
    let invalid = false;
    const sample = shape(entry.tool);
    if (entry.tool === "swimlaneVertical" || entry.tool === "swimlaneHorizontal") sample.lanes = ["甲", "乙"];
    const parsed = dataFrom({ shapes: [sample], edges: [] }, "board", () => {
      invalid = true;
    });
    expect(invalid, entry.id).toBe(false);
    expect(parsed.shapes[0].shape, entry.id).toBe(entry.tool);
  }
});

for (const type of libraryShapeNames) {
  test(`${type} 保留格式及JSON往返，静态SVG使用其实际轮廓和内部线`, () => {
    const input = { shapes: [shape(type)], edges: [] };
    let invalid = false;
    const parsed = dataFrom(input, "board", () => {
      invalid = true;
    });
    expect(invalid).toBe(false);
    expect(parsed.shapes).toEqual(input.shapes);
    expect(dataFrom(JSON.parse(JSON.stringify(parsed)), "board")).toEqual(parsed);
    const graphic = shapeGraphic(type)!;
    expect(graphic.boundary.split(" ").length).toBeGreaterThanOrEqual(3);
    expect(graphic.paths.length).toBeGreaterThan(0);
    const exported = paths(exportCanvas(parsed));
    for (const path of graphic.paths) {
      expect(path.d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz\d.,\s+-]+$/);
      expect(exported, `${type}: ${path.d}`).toContain(path.d);
    }
    const styled = graphicPaths(type, { fill: "#fff0cc", stroke: "#332211", width: 3, dashed: true });
    expect(
      styled.every(
        (part) => part.stroke === "#332211" && part["stroke-width"] === 3 && part["stroke-dasharray"] === "5 4",
      ),
    ).toBe(true);
  });
}

test("旧图形值和未知字段的保守策略不被图形库扩充改写", () => {
  for (const type of [
    "rectangle",
    "rounded",
    "roundedRect",
    "ellipse",
    "actor",
    "triangle",
    "cloud",
    "leftBracket",
  ] as const) {
    const input = { shapes: [shape(type)], edges: [] };
    const before = JSON.stringify(input);
    expect(dataFrom(input, "uml").shapes).toEqual(input.shapes);
    expect(JSON.stringify(input)).toBe(before);
  }
  for (const extra of [{ future: { preserve: "原始数据" } }, { shape: "future-symbol" }]) {
    const input = { shapes: [{ ...shape("rectangle"), ...extra }], edges: [] };
    const before = JSON.stringify(input);
    let invalid = false;
    dataFrom(input, "uml", () => {
      invalid = true;
    });
    expect(invalid).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  }
});

test("实心开始点和同步条保留默认实心外观，并接纳显式填色", () => {
  for (const type of ["umlStart", "umlSynchronization"] as const) {
    expect(shapeGraphic(type)?.defaultFill).toBe("#555555");
    const styled = graphicPaths(type, { fill: "#aabbcc", stroke: "#224466", width: 2 });
    expect(styled[0].fill).toBe("#aabbcc");
  }
});

test("新圆形和非矩形轮廓参与命中、旋转及连线端点计算", () => {
  const circle = { ...shape("circle"), x: 0, y: 0, width: 100, height: 100, rotation: 0 };
  expect(shapeContains(circle, { x: 0, y: 0 }, 0)).toBe(false);
  expect(shapeContains(circle, { x: 50, y: 50 }, 0)).toBe(true);
  const rotated = { ...shape("merge"), x: 0, y: 0, width: 100, height: 100, rotation: 180 };
  expect(shapeContains(rotated, { x: 50, y: 90 }, 0)).toBe(true);
  expect(shapeContains(rotated, { x: 5, y: 90 }, 0)).toBe(true);
  const target = { ...shape("rectangle"), id: "target", x: 200, y: 0, width: 100, height: 100, rotation: 0 };
  const geometry = edgeGeometry(circle, target);
  expect(geometry?.x1).toBeCloseTo(100);
  expect(geometry?.y1).toBeCloseTo(50);
});

for (const type of smartTemplateNames) {
  test(`${type} 由真实分区与独立文字构成可保存的单组`, () => {
    let next = 0;
    const point = Object.freeze({ x: 400, y: 250 });
    const template = createSmartTemplate(type, point, () => `shape-${next++}`);
    expect(template.group.members).toEqual(template.shapes.map((shape) => shape.id));
    expect(new Set(template.group.members).size).toBe(template.shapes.length);
    const labels = template.shapes.filter((shape) => shape.shape === "text").map((shape) => shape.text);
    expect(labels).toEqual(
      type === "smartPyramid"
        ? ["第一层", "第二层", "第三层"]
        : type === "smartSegmentedPyramid"
          ? ["观点一", "观点二", "观点三", "观点四"]
          : type === "smartStages"
            ? ["阶段一", "阶段二", "阶段三"]
            : ["模块1.1", "模块1.2", "模块2", "模块3.1", "模块3.2"],
    );
    const left = Math.min(...template.shapes.map((shape) => shape.x));
    const top = Math.min(...template.shapes.map((shape) => shape.y));
    const right = Math.max(...template.shapes.map((shape) => shape.x + shape.width));
    const bottom = Math.max(...template.shapes.map((shape) => shape.y + shape.height));
    expect(left).toBe(point.x);
    expect(top).toBe(point.y);
    expect(right - left).toBe(450);
    expect(bottom - top).toBe(type === "smartStages" ? 50 : 450);
    const input = { shapes: template.shapes, edges: [], groups: [template.group] };
    let invalid = false;
    const parsed = dataFrom(input, "board", () => {
      invalid = true;
    });
    expect(invalid).toBe(false);
    expect(dataFrom(JSON.parse(JSON.stringify(parsed)), "board")).toEqual(parsed);
  });
}
