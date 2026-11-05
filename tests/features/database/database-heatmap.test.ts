import { expect, test } from "@rstest/core";

import {
  calculateHeatmapCalendar,
  heatmapLevel,
} from "../../../packages/core/src/features/database/views/chart/heatmap";

test("observed heat levels follow the maximum, distinguishing zero from empty", () => {
  expect([heatmapLevel(2, 10), heatmapLevel(1, 10)]).toEqual([2, 1]);
  expect([heatmapLevel(2, 12), heatmapLevel(1, 12)]).toEqual([1, 0]);
  expect([heatmapLevel(2, 5), heatmapLevel(1, 5)]).toEqual([5, 5]);
  expect([heatmapLevel(2, 100), heatmapLevel(1, 100)]).toEqual([0, 0]);
  expect(heatmapLevel(1, 0)).toBe(5);
  expect(heatmapLevel(0, 0)).toBe(0);
  expect(heatmapLevel(-3, 10)).toBe(0);
});

test("calendar ends on Saturday and uses Sunday-to-Saturday weekly columns", () => {
  const cells = calculateHeatmapCalendar(
    [
      { key: "2026-11-03", value: 2 },
      { key: "2026-11-02", value: 1 },
      { key: "2026-10-12", value: 1 },
      { key: "2026-10-13", value: 0 },
      { key: "2026-11-08", value: 7 },
    ],
    4,
    10,
    new Date(2026, 10, 3, 12),
  );
  expect(cells).toHaveLength(4);
  expect(cells.every((week) => week.length === 7)).toBe(true);
  expect(cells[0][0]).toEqual({ date: "2026-10-11", value: null, level: -1 });
  expect(cells[3][6]).toEqual({ date: "2026-11-07", value: null, level: -1 });
  expect(cells[3][1]).toEqual({ date: "2026-11-02", value: 1, level: 1 });
  expect(cells[3][2]).toEqual({ date: "2026-11-03", value: 2, level: 2 });
  expect(cells[0][1]).toEqual({ date: "2026-10-12", value: 1, level: 1 });
  expect(cells[0][2]).toEqual({ date: "2026-10-13", value: 0, level: 0 });
});

test("civil dates cross years, leap days and DST without skipping a day", () => {
  const acrossYear = calculateHeatmapCalendar([], 4, 100, new Date(2026, 0, 2, 12)).flat();
  expect(acrossYear[0].date).toBe("2025-12-07");
  expect(acrossYear.at(-1)?.date).toBe("2026-01-03");
  const acrossLeapDay = calculateHeatmapCalendar([], 4, 100, new Date(2024, 2, 10, 12)).flat();
  expect(acrossLeapDay[0].date).toBe("2024-02-18");
  expect(acrossLeapDay.at(-1)?.date).toBe("2024-03-16");
  expect(acrossLeapDay.map((cell) => cell.date)).toContain("2024-02-29");
  expect(new Set(acrossLeapDay.map((cell) => cell.date)).size).toBe(28);
});

test("week count is safely bounded to four through fifty-two", () => {
  const today = new Date(2026, 10, 3, 12);
  expect(calculateHeatmapCalendar([], -1, 100, today)).toHaveLength(4);
  expect(calculateHeatmapCalendar([], 100, 100, today)).toHaveLength(52);
  expect(calculateHeatmapCalendar([], Number.NaN, 100, today)).toHaveLength(52);
  expect(calculateHeatmapCalendar([], 4.6, 100, today)).toHaveLength(5);
});
