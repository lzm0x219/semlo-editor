import { expect, test } from "@rstest/playwright";

import {
  createDatabaseChart,
  createDatabaseData,
  createDatabaseField,
} from "../../../packages/core/src/features/database/model";
import { calculateHeatmapCalendar } from "../../../packages/core/src/features/database/views/chart/heatmap";
import { calculateDatabaseChart } from "../../../packages/core/src/features/database/views/chart/render";

test("heatmap groups automatic timestamps by local date rather than their display format", () => {
  const data = createDatabaseData();
  const field = createDatabaseField("创建时间", "createdTime");
  field.timeFormat = "year";
  data.fields.push(field);
  data.records[0].values[field.id] = new Date(2026, 10, 4, 1).toISOString();
  data.records[1].values[field.id] = new Date(2026, 10, 4, 23).toISOString();
  data.records[2].values[field.id] = new Date(2026, 10, 5, 12).toISOString();
  const chart = createDatabaseChart("heatmap", data.fields);
  chart.fieldId = field.id;
  const result = calculateDatabaseChart(data, chart, data.records);
  expect(result.buckets.map((entry) => [entry.key, entry.value])).toEqual([
    ["2026-11-04", 2],
    ["2026-11-05", 1],
  ]);
  const days = calculateHeatmapCalendar(result.buckets, 4, 100, new Date(2026, 10, 5)).flat();
  expect(days.find((entry) => entry.date === "2026-11-04")?.value).toBe(2);
  expect(days.find((entry) => entry.date === "2026-11-05")?.value).toBe(1);
  const textField = data.fields[0];
  data.records[0].values[textField.id] = "2026-11-04";
  data.records[1].values[textField.id] = "非日期";
  data.records[2].values[textField.id] = "2026-11-04";
  chart.fieldId = textField.id;
  expect(calculateDatabaseChart(data, chart, data.records).buckets.map((entry) => [entry.key, entry.value])).toEqual([
    ["2026-11-04", 2],
  ]);
});
