import { expect, test } from "@rstest/core";

import {
  createDatabaseChart,
  createDatabaseData,
  createDatabaseField,
} from "../../../packages/core/src/features/database/model";
import { calculateDatabaseChart } from "../../../packages/core/src/features/database/views/chart/render";
import {
  calculateFunnelLevels,
  calculateWordcloudWords,
} from "../../../packages/core/src/features/database/views/chart/special-charts";

test("funnel reorders stable keys and can accumulate subsequent levels without mutating buckets", () => {
  const buckets = [
    { key: "pending-id", label: "待开始", value: 2 },
    { key: "active-id", label: "进行中", value: 1 },
    { key: "done-id", label: "已完成", value: 1 },
  ];
  const before = JSON.stringify(buckets);
  expect(calculateFunnelLevels(buckets, [], true).map(({ value }) => value)).toEqual([4, 2, 1]);
  expect(calculateFunnelLevels(buckets, [], false).map(({ value }) => value)).toEqual([2, 1, 1]);
  const order = ["done-id", "removed-id", "pending-id", "done-id"];
  expect(calculateFunnelLevels(buckets, order, false)).toEqual([
    { key: "done-id", label: "已完成", rawValue: 1, value: 1 },
    { key: "pending-id", label: "待开始", rawValue: 2, value: 2 },
    { key: "active-id", label: "进行中", rawValue: 1, value: 1 },
  ]);
  expect(calculateFunnelLevels(buckets, order, true).map(({ value }) => value)).toEqual([4, 3, 1]);
  expect(JSON.stringify(buckets)).toBe(before);
});

test("special charts respect filtered records, multi-select values and renamed or deleted options", () => {
  const data = createDatabaseData();
  const [name] = data.fields;
  const tags = createDatabaseField("标签", "multiSelect");
  tags.options = [
    { id: "writing", label: "写作", color: 0 },
    { id: "review", label: "回顾", color: 1 },
    { id: "old", label: "旧标签", color: 2 },
  ];
  data.fields.push(tags);
  data.records[0].values = { [name.id]: "保留", [tags.id]: ["writing", "review"] };
  data.records[1].values = { [name.id]: "", [tags.id]: ["writing"] };
  data.records[2].values = { [name.id]: "保留", [tags.id]: ["review", "old"] };
  const chart = createDatabaseChart("funnel", data.fields);
  chart.fieldId = tags.id;
  chart.filters = [{ id: "filter", fieldId: name.id, operator: "notEmpty", value: "" }];
  chart.funnelOrder = ["old", "review", "writing"];
  tags.options[1].label = "复盘";
  tags.options = tags.options.filter((option) => option.id !== "old");

  const result = calculateDatabaseChart(data, chart, data.records);
  expect(calculateFunnelLevels(result.buckets, chart.funnelOrder, false)).toEqual([
    { key: "review", label: "复盘", rawValue: 2, value: 2 },
    { key: "writing", label: "写作", rawValue: 1, value: 1 },
  ]);
  expect(calculateWordcloudWords(result.buckets, tags.type, 20, "复盘")).toEqual([
    { key: "writing", label: "写作", value: 1 },
  ]);
});

test("wordcloud orders weighted option labels, excludes exact words and handles removed options", () => {
  const buckets = [
    { key: "a", label: "写作", value: 2 },
    { key: "b", label: "整理", value: 5 },
    { key: "c", label: "回顾", value: 3 },
  ];
  expect(calculateWordcloudWords(buckets, "singleSelect", 2, "回顾 其他")).toEqual([
    { key: "b", label: "整理", value: 5 },
    { key: "a", label: "写作", value: 2 },
  ]);
  expect(calculateWordcloudWords([], "singleSelect", 20, "")).toEqual([]);
  expect(calculateWordcloudWords(buckets, "singleSelect", 1, "").map((item) => item.label)).toEqual(["整理"]);
  const many = Array.from({ length: 110 }, (_, index) => ({ key: String(index), label: String(index), value: 1 }));
  expect(calculateWordcloudWords(many, "singleSelect", 1000, "")).toHaveLength(100);
  expect(calculateWordcloudWords(many, "singleSelect", 0, "")).toHaveLength(1);
  expect(calculateWordcloudWords(many, "singleSelect", Number.NaN, "")).toHaveLength(20);
});

test("wordcloud treats each text cell as one complete word", () => {
  const buckets = [
    { key: "a", label: "苹果 苹果 香蕉", value: 1 },
    { key: "b", label: "书法测试 hello,world", value: 1 },
    { key: "c", label: "苹果香蕉苹果", value: 2 },
  ];
  expect(calculateWordcloudWords(buckets, "text", 20, "")).toEqual([
    { key: "c", label: "苹果香蕉苹果", value: 2 },
    { key: "a", label: "苹果 苹果 香蕉", value: 1 },
    { key: "b", label: "书法测试 hello,world", value: 1 },
  ]);
});
