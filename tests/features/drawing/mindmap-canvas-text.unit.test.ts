import { expect, test } from "@rstest/core";

import {
  exportMindmapCanvasText,
  readMindmapCanvasText,
} from "../../../packages/core/src/features/drawing/mindmap/canvas-text";

const original = { x: 10, y: 20, text: "画布文字", size: 14, color: "#303233", bold: false };

test("旧文字数据保持不变，文字框及对齐可读取", () => {
  expect(readMindmapCanvasText([original])).toEqual([original]);
  const boxed = { ...original, width: 120, height: 80, align: "right", verticalAlign: "bottom" };
  expect(readMindmapCanvasText([boxed])).toEqual([boxed]);
});

test("无效尺寸与未知对齐方式不会作为可编辑数据载入", () => {
  for (const value of [
    { ...original, width: 23 },
    { ...original, height: Infinity },
    { ...original, align: "unknown" },
    { ...original, verticalAlign: "unknown" },
  ]) {
    let invalid = false;
    expect(readMindmapCanvasText([value], () => (invalid = true))).toEqual([]);
    expect(invalid).toBe(true);
  }
});

test("固定窄框中溢出的文字仍包含在静态 SVG 范围内", () => {
  const result = exportMindmapCanvasText(
    ["svg", { viewBox: "0 0 10 10" }],
    [{ ...original, x: 0, y: 0, text: "文".repeat(50), width: 24, height: 24, verticalAlign: "top" }],
  );
  if (!Array.isArray(result) || !result[1] || typeof result[1] !== "object" || Array.isArray(result[1]))
    throw new Error("无效 SVG 输出");
  const [, y, , height] = String(result[1].viewBox).split(/\s+/).map(Number);
  expect(y + height).toBeGreaterThan(16 + 50 * original.size * 1.4);
});

test("画布文字链接保留分段，并拒绝不安全地址和拆开的代理对", () => {
  const linked = { ...original, text: "甲😀乙", links: [{ from: 1, to: 3, href: "https://example.com/" }] };
  expect(readMindmapCanvasText([linked])).toEqual([linked]);
  for (const links of [
    [{ from: 1, to: 2, href: "https://example.com/" }],
    [{ from: 0, to: 1, href: "javascript:alert(1)" }],
    [
      { from: 0, to: 3, href: "https://example.com/" },
      { from: 1, to: 3, href: "https://example.com/" },
    ],
  ]) {
    let invalid = false;
    expect(readMindmapCanvasText([{ ...original, text: "甲😀乙", links }], () => (invalid = true))).toEqual([]);
    expect(invalid).toBe(true);
  }
});
