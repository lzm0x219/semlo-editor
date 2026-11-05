import { expect, test } from "@rstest/core";

import {
  createDatabaseChart,
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  normalizeDatabaseData,
} from "../../../packages/core/src/features/database/model";

test("new chart views start empty and charts select an appropriate initial field", () => {
  const data = createDatabaseData();
  const view = createDatabaseView("图表视图", "chart");
  expect(view.charts).toEqual([]);
  expect(createDatabaseChart("column", data.fields)).toMatchObject({
    kind: "column",
    fieldId: data.fields[1].id,
    metricFieldId: "",
    statistic: "count",
    legend: "bottom",
    barWidth: 40,
    precision: 0,
  });
  expect(createDatabaseChart("number", data.fields).fieldId).toBe(data.fields[0].id);
  expect(createDatabaseChart("pie", []).fieldId).toBe("");
});

test("area charts default to a date axis, text measure and group, with stacked display", () => {
  const data = createDatabaseData();
  const chart = createDatabaseChart("area", data.fields);
  expect(chart).toMatchObject({
    fieldId: data.fields[2].id,
    metricFieldId: data.fields[0].id,
    groupFieldId: data.fields[0].id,
    stacked: true,
    smooth: false,
    legend: "right",
  });
  const fallback = createDatabaseChart("area", [data.fields[1]]);
  expect([fallback.fieldId, fallback.metricFieldId, fallback.groupFieldId]).toEqual([
    data.fields[1].id,
    data.fields[1].id,
    data.fields[1].id,
  ]);
  expect(createDatabaseChart("area", [])).toMatchObject({ fieldId: "", metricFieldId: "", groupFieldId: "" });
  const numeric = createDatabaseField("工作量", "number");
  const text = createDatabaseField("事项", "text");
  expect(createDatabaseChart("area", [numeric, text]).fieldId).toBe(text.id);
  expect(createDatabaseChart("area", [numeric]).fieldId).toBe("");
});

test("area chart stacking and smoothing survive round trips and use defaults for missing values", () => {
  const data = createDatabaseData();
  const view = createDatabaseView("图表视图", "chart");
  const chart = createDatabaseChart("area", data.fields);
  chart.stacked = false;
  chart.smooth = true;
  view.charts.push(chart);
  data.views.push(view);
  const raw = JSON.parse(JSON.stringify(data));
  expect(normalizeDatabaseData(raw).views[1].charts[0]).toEqual(chart);
  delete raw.views[1].charts[0].stacked;
  delete raw.views[1].charts[0].smooth;
  delete raw.views[1].charts[0].legend;
  expect(normalizeDatabaseData(raw).views[1].charts[0]).toMatchObject({
    fieldId: chart.fieldId,
    stacked: true,
    smooth: false,
    legend: "right",
  });
  raw.views[1].charts[0].kind = "column";
  expect(normalizeDatabaseData(raw).views[1].charts[0]).toMatchObject({
    stacked: false,
    smooth: false,
    legend: "bottom",
  });
});

test("heatmap starts with the first date field, 52 weeks and a maximum of 100", () => {
  const data = createDatabaseData();
  const secondDate = createDatabaseField("结束日期", "date");
  const heatmap = createDatabaseChart("heatmap", [...data.fields, secondDate]);
  expect(heatmap).toMatchObject({
    fieldId: data.fields[2].id,
    metricFieldId: "",
    statistic: "count",
    heatmapWeeks: 52,
    heatmapMax: 100,
  });
  expect(createDatabaseChart("heatmap", data.fields.slice(0, 2)).fieldId).toBe("");
});

test("heatmap settings survive serialization and normalize out-of-range or missing values", () => {
  const data = createDatabaseData();
  const view = createDatabaseView("图表视图", "chart");
  const chart = createDatabaseChart("heatmap", data.fields);
  chart.heatmapWeeks = 8;
  chart.heatmapMax = 0;
  view.charts.push(chart);
  data.views.push(view);
  const raw = JSON.parse(JSON.stringify(data));
  expect(normalizeDatabaseData(raw).views[1].charts[0]).toEqual(chart);
  raw.views[1].charts[0].heatmapWeeks = 3;
  raw.views[1].charts[0].heatmapMax = 12.5;
  expect(normalizeDatabaseData(raw).views[1].charts[0]).toMatchObject({ heatmapWeeks: 4, heatmapMax: 12.5 });
  raw.views[1].charts[0].heatmapWeeks = 55;
  raw.views[1].charts[0].heatmapMax = -1;
  expect(normalizeDatabaseData(raw).views[1].charts[0]).toMatchObject({ heatmapWeeks: 52, heatmapMax: 100 });
  delete raw.views[1].charts[0].heatmapWeeks;
  delete raw.views[1].charts[0].heatmapMax;
  const normalized = normalizeDatabaseData(raw);
  expect(normalized.views[1].charts[0]).toMatchObject({ heatmapWeeks: 52, heatmapMax: 100 });
  expect(normalizeDatabaseData(normalized)).toEqual(normalized);
});

test("funnel and wordcloud settings round-trip with stable layer keys and defaults", () => {
  const data = createDatabaseData();
  const view = createDatabaseView("图表视图", "chart");
  const funnel = createDatabaseChart("funnel", data.fields);
  const cloud = createDatabaseChart("wordcloud", data.fields);
  expect(funnel).toMatchObject({
    fieldId: data.fields[1].id,
    metricFieldId: "",
    funnelCumulative: true,
    funnelOrder: [],
  });
  expect(cloud).toMatchObject({
    fieldId: data.fields[1].id,
    wordcloudShape: "cloud",
    wordcloudMaxWords: 20,
    wordcloudExclude: "",
  });
  funnel.funnelCumulative = false;
  funnel.funnelOrder = [data.fields[1].options[1].id, data.fields[1].options[0].id];
  cloud.wordcloudShape = "ellipse";
  cloud.wordcloudMaxWords = 35;
  cloud.wordcloudExclude = "一个词 另一个词";
  view.charts.push(funnel, cloud);
  data.views.push(view);
  const raw = JSON.parse(JSON.stringify(data));
  expect(normalizeDatabaseData(raw).views[1].charts).toEqual([funnel, cloud]);
  const normalized = normalizeDatabaseData(raw);
  expect(normalizeDatabaseData(normalized)).toEqual(normalized);

  delete raw.views[1].charts[0].funnelCumulative;
  delete raw.views[1].charts[0].funnelOrder;
  delete raw.views[1].charts[1].wordcloudShape;
  delete raw.views[1].charts[1].wordcloudMaxWords;
  delete raw.views[1].charts[1].wordcloudExclude;
  expect(normalizeDatabaseData(raw).views[1].charts[0]).toMatchObject({ funnelCumulative: true, funnelOrder: [] });
  expect(normalizeDatabaseData(raw).views[1].charts[1]).toMatchObject({
    wordcloudShape: "cloud",
    wordcloudMaxWords: 20,
    wordcloudExclude: "",
  });
});

test("special chart normalization bounds malformed data without retaining a removed dimension", () => {
  const data = createDatabaseData();
  const view = createDatabaseView("图表视图", "chart");
  const funnel = createDatabaseChart("funnel", data.fields);
  const cloud = createDatabaseChart("wordcloud", data.fields);
  view.charts.push(funnel, cloud);
  data.views.push(view);
  const raw = JSON.parse(JSON.stringify(data));
  raw.views[1].charts[0].funnelOrder = ["one", "two", "one", 3, null];
  raw.views[1].charts[1].wordcloudShape = "unsupported";
  raw.views[1].charts[1].wordcloudMaxWords = -2;
  raw.views[1].charts[1].wordcloudExclude = null;
  const result = normalizeDatabaseData(raw);
  expect(result.views[1].charts[0].funnelOrder).toEqual(["one", "two"]);
  expect(result.views[1].charts[1]).toMatchObject({
    wordcloudShape: "cloud",
    wordcloudMaxWords: 1,
    wordcloudExclude: "",
  });
  raw.views[1].charts[1].wordcloudMaxWords = 1000;
  expect(normalizeDatabaseData(raw).views[1].charts[1].wordcloudMaxWords).toBe(100);
  raw.views[1].charts[1].wordcloudMaxWords = Number.NaN;
  expect(normalizeDatabaseData(raw).views[1].charts[1].wordcloudMaxWords).toBe(20);
  raw.views[1].charts[0].fieldId = "deleted-field";
  expect(normalizeDatabaseData(raw).views[1].charts[0]).toMatchObject({ fieldId: "", funnelOrder: [] });
});

test("multiple chart settings and valid field references survive a JSON round trip", () => {
  const data = createDatabaseData();
  const view = createDatabaseView("图表视图", "chart");
  const column = createDatabaseChart("column", data.fields);
  column.title = "状态分布";
  column.metricFieldId = data.fields[0].id;
  column.groupFieldId = data.fields[2].id;
  column.filters = [{ id: "filter-a", fieldId: data.fields[1].id, operator: "equals", value: "进行中" }];
  column.filterMode = "or";
  column.sort = "count-desc";
  column.legend = "right";
  column.barWidth = 60;
  const number = createDatabaseChart("number", data.fields);
  number.title = "完成比例";
  number.statistic = "filledPercent";
  number.description = "已填写占比";
  number.color = "#3bc07a";
  number.precision = 2;
  view.charts.push(column, number);
  data.views.push(view);
  data.activeViewId = view.id;

  const restored = normalizeDatabaseData(JSON.parse(JSON.stringify(data)));
  expect(restored.views.find((item) => item.id === view.id)).toEqual(view);
  expect(restored.activeViewId).toBe(view.id);
  expect(normalizeDatabaseData(restored)).toEqual(restored);
});

test("saved grid coordinates survive normalization and malformed layouts are discarded", () => {
  const data = createDatabaseData();
  const view = createDatabaseView("图表视图", "chart");
  const chart = createDatabaseChart("column", data.fields);
  chart.layout = { x: 4, y: 5, w: 7, h: 6 };
  view.charts.push(chart);
  data.views.push(view);
  const raw = JSON.parse(JSON.stringify(data));
  const restored = normalizeDatabaseData(raw);
  expect(restored.views[1].charts[0]).toEqual(chart);
  expect(normalizeDatabaseData(restored)).toEqual(restored);

  for (const layout of [
    { x: 11, y: 0, w: 2, h: 4 },
    { x: -1, y: 0, w: 4, h: 4 },
    { x: 0, y: Number.POSITIVE_INFINITY, w: 4, h: 4 },
    { x: 0, y: 0, w: 4, h: 501 },
    { x: 0, y: 0, w: "4", h: 4 },
  ]) {
    raw.views[1].charts[0].layout = layout;
    const repaired = normalizeDatabaseData(raw).views[1].charts[0];
    expect(repaired.layout).toBeUndefined();
  }
  delete raw.views[1].charts[0].layout;
  expect(normalizeDatabaseData(raw).views[1].charts[0].layout).toBeUndefined();
});

test("normalization repairs malformed chart data without rebinding removed fields", () => {
  const data = createDatabaseData();
  const view = createDatabaseView("图表视图", "chart");
  const chart = createDatabaseChart("pie", data.fields);
  chart.metricFieldId = data.fields[0].id;
  chart.groupFieldId = data.fields[2].id;
  chart.filters = [{ id: "filter-a", fieldId: data.fields[0].id, operator: "contains", value: "A" }];
  view.charts.push(chart, { ...chart });
  data.views.push(view);
  data.fields.splice(0, 1);
  const raw = JSON.parse(JSON.stringify(data));
  raw.views[1].charts[0].color = "url(javascript:alert(1))";
  raw.views[1].charts[0].legend = "invalid";
  raw.views[1].charts[0].precision = -1;
  expect(() => normalizeDatabaseData(raw)).toThrow(/数据表.*长度/);
  raw.views[1].charts[0].color = "invalid";
  const result = normalizeDatabaseData(raw);
  const [first, second] = result.views[1].charts;
  expect(first.fieldId).toBe(chart.fieldId);
  expect(first.metricFieldId).toBe("");
  expect(first.groupFieldId).toBe(chart.groupFieldId);
  expect(first.filters).toEqual([]);
  expect(first.color).toBe("#262626");
  expect(first.legend).toBe("bottom");
  expect(first.precision).toBe(0);
  expect(second.id).not.toBe(first.id);

  delete raw.views[0].charts;
  expect(normalizeDatabaseData(raw).views[0].charts).toEqual([]);
});

test("numeric chart aggregation keeps median and distinct modes after normalization", () => {
  const data = createDatabaseData();
  const view = createDatabaseView("图表视图", "chart");
  for (const statistic of ["median", "distinct"] as const) {
    const chart = createDatabaseChart("column", data.fields);
    chart.statistic = statistic;
    view.charts.push(chart);
  }
  data.views.push(view);
  const restored = normalizeDatabaseData(JSON.parse(JSON.stringify(data)));
  expect(restored.views[1].charts.map((chart) => chart.statistic)).toEqual(["median", "distinct"]);
});
