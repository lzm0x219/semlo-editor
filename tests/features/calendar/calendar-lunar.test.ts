import { expect, test } from "@rstest/core";

import { calendarLunarLabel } from "../../../packages/core/src/features/database/views/calendar/lunar";

test("lunar labels match observed dates, solar terms and a traditional festival", () => {
  const observed: Record<string, string> = {
    "2026-01-01": "十三",
    "2026-01-19": "初一",
    "2026-01-26": "腊八节",
    "2026-02-16": "除夕",
    "2026-02-17": "春节",
    "2026-02-18": "雨水",
    "2026-03-03": "元宵节",
    "2026-03-19": "初一",
    // The same day is also 春分; the lunar festival takes precedence.
    "2026-03-20": "龙头节",
    "2026-10-01": "廿一",
    "2026-10-08": "寒露",
    "2026-10-18": "重阳节",
    "2026-10-23": "霜降",
    "2026-11-01": "廿三",
    "2026-11-03": "廿五",
    "2026-11-07": "立冬",
    "2026-11-09": "初一",
    "2026-11-22": "小雪",
  };
  for (const [date, expected] of Object.entries(observed)) {
    expect(calendarLunarLabel(date), date).toBe(expected);
  }
});

test("invalid dates do not produce a calendar label", () => {
  for (const date of ["", "2026-02-29", "2026-13-01", "2026-2-01", "not a date"]) {
    expect(calendarLunarLabel(date), date).toBe("");
  }
  expect(calendarLunarLabel("2024-02-29")).not.toBe("");
});
