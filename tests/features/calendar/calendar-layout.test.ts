import { expect, test } from "@rstest/core";

import { layoutCalendarWeek } from "../../../packages/core/src/features/calendar/calendar-layout";

test("splits ranges at the week edge and uses separate lanes only for overlapping days", () => {
  const days = Array.from({ length: 7 }, (_, index) => `2026-11-${String(index + 8).padStart(2, "0")}`);
  const events = [
    { id: "long", start: "2026-11-05", end: "2026-11-14" },
    { id: "first", start: "2026-11-09", end: "2026-11-10" },
    { id: "second", start: "2026-11-10", end: "2026-11-12" },
    { id: "later", start: "2026-11-13", end: "2026-11-15" },
    { id: "outside", start: "2026-11-16", end: "2026-11-18" },
  ];
  const result = layoutCalendarWeek(events, days);
  expect(
    result.map(({ event, startColumn, endColumn, lane, continuesBefore, continuesAfter }) => ({
      id: event.id,
      startColumn,
      endColumn,
      lane,
      continuesBefore,
      continuesAfter,
    })),
  ).toEqual([
    { id: "long", startColumn: 0, endColumn: 6, lane: 0, continuesBefore: true, continuesAfter: false },
    { id: "first", startColumn: 1, endColumn: 2, lane: 1, continuesBefore: false, continuesAfter: false },
    { id: "second", startColumn: 2, endColumn: 4, lane: 2, continuesBefore: false, continuesAfter: false },
    { id: "later", startColumn: 5, endColumn: 6, lane: 1, continuesBefore: false, continuesAfter: true },
  ]);
});

test("longer events starting on the same date use the first available lane", () => {
  const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"];
  const result = layoutCalendarWeek(
    [
      { id: "short", start: "2026-11-05", end: "2026-11-05" },
      { id: "long", start: "2026-11-05", end: "2026-11-10" },
    ],
    days,
  );
  expect(result.map(({ event, lane, continuesAfter }) => [event.id, lane, continuesAfter])).toEqual([
    ["long", 0, true],
    ["short", 1, false],
  ]);
  expect(layoutCalendarWeek([], [])).toEqual([]);
});
