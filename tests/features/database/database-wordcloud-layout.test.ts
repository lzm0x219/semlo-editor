import { expect, test } from "@rstest/core";

import {
  layoutWordcloud,
  type WordcloudShape,
} from "../../../packages/core/src/features/database/views/chart/wordcloud-layout";

const measure = (text: string, size: number) => Array.from(text).length * size * 0.72;
const intersects = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("word clouds arrange measured words without overlap inside each shape", () => {
  const words = Array.from({ length: 20 }, (_, index) => ({
    key: `word-${index}`,
    label: `词条${index}`,
    value: 20 - index,
  }));
  for (const shape of ["cloud", "circle", "ellipse"] satisfies WordcloudShape[]) {
    const placed = layoutWordcloud(words, shape, measure);
    expect(placed).toHaveLength(words.length);
    expect(layoutWordcloud(words, shape, measure)).toEqual(placed);
    expect(placed.map((word) => word.rotation)).toEqual(expect.arrayContaining([-20, 0, 20]));
    for (const [index, current] of placed.entries()) {
      expect(current.bounds.x).toBeGreaterThanOrEqual(4);
      expect(current.bounds.y).toBeGreaterThanOrEqual(4);
      expect(current.bounds.x + current.bounds.width).toBeLessThanOrEqual(316);
      expect(current.bounds.y + current.bounds.height).toBeLessThanOrEqual(196);
      for (const other of placed.slice(index + 1)) expect(intersects(current.bounds, other.bounds)).toBe(false);
    }
  }
});

test("word clouds do not display zero, negative or invalid counts and handle long labels", () => {
  const words = [
    { key: "long", label: "很多很长的词条".repeat(8), value: 5 },
    { key: "empty", label: "", value: 3 },
    { key: "zero", label: "零", value: 0 },
    { key: "invalid", label: "无效", value: Number.NaN },
  ];
  const placed = layoutWordcloud(words, "ellipse", measure);
  expect(placed).toHaveLength(1);
  expect(placed[0].label).toBe(words[0].label);
  expect(placed[0].bounds.x + placed[0].bounds.width).toBeLessThanOrEqual(316);
});
