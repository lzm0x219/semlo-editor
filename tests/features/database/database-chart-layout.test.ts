import { expect, test } from "@rstest/core";

import { createDatabaseChart, type DatabaseChartLayout } from "../../../packages/core/src/features/database/model";
import {
  compactChartLayouts,
  findChartVacancy,
  resizeChartLayouts,
  resolveChartLayouts,
} from "../../../packages/core/src/features/database/views/chart/layout";

const grid = (x: number, y: number, w = 4, h = 4): DatabaseChartLayout => ({ x, y, w, h });

test("charts without saved layouts fill the first available default-size cells", () => {
  const charts = Array.from({ length: 3 }, () => createDatabaseChart("column", []));
  const layouts = resolveChartLayouts(charts);
  expect(charts.map((chart) => layouts.get(chart.id))).toEqual([grid(0, 0), grid(4, 0), grid(8, 0)]);
  expect(charts.every((chart) => chart.layout === undefined)).toBe(true);
});

test("saved positions are reserved before unpositioned charts fill the gaps", () => {
  const first = createDatabaseChart("bar", []);
  const saved = createDatabaseChart("pie", []);
  saved.layout = grid(0, 0);
  const later = createDatabaseChart("line", []);
  later.layout = grid(8, 0);
  const layouts = resolveChartLayouts([first, saved, later]);
  expect([...layouts.keys()]).toEqual([first.id, saved.id, later.id]);
  expect(layouts.get(first.id)).toEqual(grid(4, 0));
  expect(layouts.get(saved.id)).toEqual(grid(0, 0));
  expect(layouts.get(later.id)).toEqual(grid(8, 0));
});

test("adding and copying reuse the earliest hole without moving other cards", () => {
  const occupied = [grid(0, 0), grid(8, 0), grid(0, 4)];
  expect(findChartVacancy(occupied, 4, 4)).toEqual(grid(4, 0));
  expect(findChartVacancy(occupied, 8, 4)).toEqual(grid(4, 4, 8, 4));
  expect(occupied).toEqual([grid(0, 0), grid(8, 0), grid(0, 4)]);
  expect(findChartVacancy([grid(0, 100_000)], 4, 4)).toEqual(grid(0, 0));
});

test("deleting a card packs vertically while preserving horizontal gaps", () => {
  const remaining = new Map([
    ["under", grid(0, 1)],
    ["middle", grid(4, 0)],
    ["right", grid(8, 0)],
  ]);
  const packed = compactChartLayouts(remaining);
  expect([...packed.entries()]).toEqual([
    ["under", grid(0, 0)],
    ["middle", grid(4, 0)],
    ["right", grid(8, 0)],
  ]);
  expect(remaining.get("under")).toEqual(grid(0, 1));
  packed.delete("under");
  const horizontalGap = compactChartLayouts(packed);
  expect(horizontalGap.get("middle")).toEqual(grid(4, 0));
  expect(horizontalGap.get("right")).toEqual(grid(8, 0));
  expect(findChartVacancy(horizontalGap.values(), 4, 4)).toEqual(grid(0, 0));
});

test("resize pushes only intersected cards down, including collision chains", () => {
  const original = new Map([
    ["first", grid(0, 0)],
    ["middle", grid(4, 0)],
    ["right", grid(8, 0)],
    ["next", grid(4, 4)],
    ["unaffected", grid(8, 4)],
  ]);
  const resized = resizeChartLayouts(original, "first", { w: 7, h: 5 });
  expect([...resized.entries()]).toEqual([
    ["first", grid(0, 0, 7, 5)],
    ["middle", grid(4, 5)],
    ["right", grid(8, 0)],
    ["next", grid(4, 9)],
    ["unaffected", grid(8, 4)],
  ]);
  expect(original.get("middle")).toEqual(grid(4, 0));
  const shrunk = resizeChartLayouts(resized, "first", { w: 4, h: 4 });
  expect(shrunk.get("middle")).toEqual(grid(4, 0));
  expect(shrunk.get("next")).toEqual(grid(4, 4));
  expect(shrunk.get("right")).toEqual(grid(8, 0));
});

test("layout resolution repairs overlapping imports and keeps resizing within bounds", () => {
  const first = createDatabaseChart("column", []);
  first.layout = grid(0, 0);
  const second = createDatabaseChart("bar", []);
  second.layout = grid(0, 0);
  const layouts = resolveChartLayouts([first, second]);
  expect(layouts.get(second.id)).toEqual(grid(0, 4));
  expect(second.layout).toEqual(grid(0, 0));
  const constrained = resizeChartLayouts(new Map([["card", grid(8, 0)]]), "card", { w: 50, h: 1000 });
  expect(constrained.get("card")).toEqual(grid(8, 0, 4, 500));
  expect(resizeChartLayouts(constrained, "missing", { w: 1, h: 1 })).toEqual(constrained);
});

test("repeated resizes keep cards non-overlapping and retain their top-left anchor", () => {
  let seed = 94823;
  const next = (limit: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % limit;
  };
  for (let scenario = 0; scenario < 50; scenario++) {
    const layouts = new Map<string, DatabaseChartLayout>();
    for (let index = 0; index < 12; index++) {
      const w = 2 + next(5);
      const h = 2 + next(5);
      layouts.set(String(index), findChartVacancy(layouts.values(), w, h));
    }
    const id = String(next(layouts.size));
    const before = layouts.get(id)!;
    const resized = resizeChartLayouts(layouts, id, { w: 1 + next(12), h: 1 + next(8) });
    expect(resized.get(id)).toMatchObject({ x: before.x, y: before.y });
    const cards = [...resized.values()];
    for (let a = 0; a < cards.length; a++) {
      expect(cards[a].x + cards[a].w).toBeLessThanOrEqual(12);
      for (let b = a + 1; b < cards.length; b++) {
        const first = cards[a];
        const second = cards[b];
        const intersects =
          first.x < second.x + second.w &&
          second.x < first.x + first.w &&
          first.y < second.y + second.h &&
          second.y < first.y + first.h;
        expect(intersects).toBe(false);
      }
    }
  }
  const atLimit = new Map([
    ["first", grid(0, 99_999, 4, 1)],
    ["second", grid(4, 99_999, 4, 1)],
  ]);
  expect(resizeChartLayouts(atLimit, "first", { w: 7, h: 2 })).toEqual(atLimit);
});
