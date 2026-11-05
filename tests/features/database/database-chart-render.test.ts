import { expect, test, type Page } from "@rstest/playwright";

import {
  createDatabaseChart,
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  type DatabaseChart,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import { calculateDatabaseChart } from "../../../packages/core/src/features/database/views/chart/render";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    chartRenderEditor?: EditorController;
  }
}

function fixture() {
  const data = createDatabaseData();
  const [name, status] = data.fields;
  const amount = createDatabaseField("数值", "number");
  const tags = createDatabaseField("标签", "multiSelect");
  tags.options = [
    { id: "one", label: "写作", color: 0 },
    { id: "two", label: "回顾", color: 1 },
  ];
  data.fields.push(amount, tags);
  const [first, second, third] = data.records;
  first.values = { [name.id]: "甲", [status.id]: status.options[0].id, [amount.id]: "1.5", [tags.id]: ["one", "two"] };
  second.values = { [name.id]: "", [status.id]: status.options[1].id, [amount.id]: "invalid", [tags.id]: ["one"] };
  third.values = { [name.id]: "甲", [status.id]: status.options[0].id, [amount.id]: "2", [tags.id]: [] };
  return { data, name, status, amount, tags };
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("chart groups option IDs, tracks renamed labels and sorts counted records", () => {
  const { data, status } = fixture();
  const chart = createDatabaseChart("column", data.fields);
  expect(chart.fieldId).toBe(status.id);
  const result = calculateDatabaseChart(data, chart, data.records);
  expect(result.buckets.map(({ label, value }) => [label, value])).toEqual([
    ["待开始", 2],
    ["进行中", 1],
  ]);
  chart.sort = "count-asc";
  status.options[0].label = "准备";
  expect(calculateDatabaseChart(data, chart, data.records).buckets.map(({ label, value }) => [label, value])).toEqual([
    ["进行中", 1],
    ["准备", 2],
  ]);
});

test("component filters apply only to already visible records and preserve multi-select buckets", () => {
  const { data, name, tags } = fixture();
  const chart = createDatabaseChart("pie", data.fields);
  chart.fieldId = tags.id;
  chart.filters = [{ id: "filter", fieldId: name.id, operator: "notEmpty", value: "" }];
  const result = calculateDatabaseChart(data, chart, data.records.slice(0, 2));
  expect(result.records.map((record) => record.id)).toEqual([data.records[0].id]);
  expect(result.buckets.map(({ label, value }) => [label, value])).toEqual([
    ["写作", 1],
    ["回顾", 1],
  ]);
});

test("number calculations distinguish empty, unique and invalid numeric values", () => {
  const { data, name, amount } = fixture();
  const chart = createDatabaseChart("number", data.fields);
  chart.fieldId = name.id;
  chart.statistic = "filledPercent";
  chart.precision = 2;
  expect(calculateDatabaseChart(data, chart, data.records).formattedValue).toBe("66.67%");
  chart.statistic = "unique";
  expect(calculateDatabaseChart(data, chart, data.records).value).toBe(1);
  chart.fieldId = amount.id;
  chart.precision = 0;
  chart.statistic = "average";
  expect(calculateDatabaseChart(data, chart, data.records).value).toBe(1.75);
  expect(calculateDatabaseChart(data, chart, data.records).formattedValue).toBe("1.75");
  chart.statistic = "sum";
  expect(calculateDatabaseChart(data, chart, data.records).value).toBe(3.5);
});

test("median and distinct use finite numeric values, both for the whole table and grouped metrics", () => {
  const { data, name, status, amount } = fixture();
  const chart = createDatabaseChart("number", data.fields);
  chart.fieldId = amount.id;
  chart.statistic = "median";
  expect(calculateDatabaseChart(data, chart, data.records).value).toBe(1.75);
  data.records.push(
    { id: "fourth", values: { [status.id]: status.options[0].id, [amount.id]: "1.50" } },
    { id: "fifth", values: { [status.id]: status.options[1].id, [amount.id]: "-3" } },
    { id: "sixth", values: { [status.id]: status.options[1].id, [amount.id]: "Infinity" } },
    { id: "seventh", values: { [status.id]: status.options[1].id, [amount.id]: "" } },
  );
  expect(calculateDatabaseChart(data, chart, data.records).value).toBe(1.5);
  chart.statistic = "distinct";
  expect(calculateDatabaseChart(data, chart, data.records).value).toBe(3);
  chart.kind = "column";
  chart.fieldId = status.id;
  chart.metricFieldId = amount.id;
  chart.statistic = "median";
  const grouped = calculateDatabaseChart(data, chart, data.records).buckets;
  expect(grouped.map(({ label, value }) => [label, value])).toEqual([
    ["待开始", 1.5],
    ["进行中", -3],
  ]);
  chart.statistic = "distinct";
  expect(calculateDatabaseChart(data, chart, data.records).buckets.map(({ value }) => value)).toEqual([2, 1]);
  chart.kind = "number";
  chart.fieldId = name.id;
  chart.metricFieldId = "";
  expect(calculateDatabaseChart(data, chart, data.records).value).toBe(1);
});

test("grouped bar metrics count multi-select and empty groups and sort by the measured value", () => {
  const { data, status, tags, amount } = fixture();
  const chart = createDatabaseChart("bar", data.fields);
  chart.fieldId = status.id;
  chart.groupFieldId = tags.id;
  chart.metricFieldId = amount.id;
  chart.statistic = "sum";
  chart.sort = "count-asc";
  const result = calculateDatabaseChart(data, chart, data.records);
  expect(result.series.map(({ label }) => label)).toEqual(["写作", "回顾", "（空）"]);
  expect(result.buckets.map(({ label, value, series }) => ({ label, value, series }))).toEqual([
    { label: "进行中", value: 0, series: [{ key: "one", label: "写作", value: 0 }] },
    {
      label: "待开始",
      value: 3.5,
      series: [
        { key: "one", label: "写作", value: 1.5 },
        { key: "two", label: "回顾", value: 1.5 },
        { key: "", label: "（空）", value: 2 },
      ],
    },
  ]);
});

async function mountCharts(page: Page, data: DatabaseData, charts: DatabaseChart[]) {
  const chartView = createDatabaseView("图表视图", "chart");
  chartView.charts.push(...charts);
  data.views.push(chartView);
  data.activeViewId = chartView.id;
  const content = {
    type: "doc",
    content: [{ type: "paragraph" }, { type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }],
  };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'chart-render-test'
      document.body.prepend(host)
      window.chartRenderEditor = createEditor({ element: host, outline: false, content: ${JSON.stringify(content)} })
    `,
  });
  return page.locator("#chart-render-test .semlo-editor-database-chart-card");
}

test("funnel layers follow cumulative values, custom ordering and proportional seams", async ({ page }) => {
  const { data, status } = fixture();
  data.records.push({ id: "fourth", values: { [status.id]: status.options[2].id } });
  const cumulative = createDatabaseChart("funnel", data.fields);
  cumulative.title = "状态漏斗";
  const ordered = createDatabaseChart("funnel", data.fields);
  ordered.title = "自定义漏斗";
  ordered.funnelCumulative = false;
  ordered.funnelOrder = [status.options[2].id, status.options[0].id, status.options[1].id];
  const cards = await mountCharts(page, data, [cumulative, ordered]);
  const plot = cards.nth(0).getByRole("img");
  await expect(plot).toHaveAttribute("aria-label", "状态漏斗：待开始：4，进行中：2，已完成：1");
  await expect(plot.locator("svg")).toHaveAttribute("preserveAspectRatio", "none");
  await expect(plot.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(plot.locator("polygon[data-chart-value]")).toHaveCount(3);
  const layers = await plot.locator("polygon").evaluateAll((elements) =>
    elements.map((element) => {
      const numbers = element.getAttribute("points")!.split(/[ ,]+/).map(Number);
      return {
        value: Number(element.getAttribute("data-chart-value")),
        raw: Number(element.getAttribute("data-chart-raw-value")),
        upper: numbers[2] - numbers[0],
        lower: numbers[4] - numbers[6],
        color: element.getAttribute("fill"),
      };
    }),
  );
  expect(layers.map(({ value, raw, color }) => ({ value, raw, color }))).toEqual([
    { value: 4, raw: 2, color: "#7092f1" },
    { value: 2, raw: 1, color: "#82d5b1" },
    { value: 1, raw: 1, color: "#8d9cb4" },
  ]);
  expect(layers[0].upper).toBeCloseTo(layers[1].upper * 2);
  expect(layers[0].lower).toBeCloseTo(layers[1].upper);
  expect(layers[1].lower).toBeCloseTo(layers[2].upper);
  expect(layers[2].lower).toBeCloseTo(layers[2].upper);
  await expect(plot.locator(".semlo-editor-chart-funnel-label")).toHaveText(["待开始 4", "进行中 2", "已完成 1"]);
  await expect(plot.locator("[data-chart-percent]")).toHaveText(["50%", "25%"]);
  await expect(plot.locator("polygon").first().locator("title")).toHaveText("待开始：4");

  const reordered = cards.nth(1).getByRole("img");
  await expect(reordered).toHaveAttribute("aria-label", "自定义漏斗：已完成：1，待开始：2，进行中：1");
  await expect(reordered.locator(".semlo-editor-chart-funnel-label")).toHaveText(["已完成 1", "待开始 2", "进行中 1"]);
  await expect(reordered.locator("[data-chart-percent]")).toHaveText(["100%", "50%"]);
  const firstPolygon = (await reordered.locator("polygon").first().getAttribute("points"))!.split(/[ ,]+/).map(Number);
  expect(firstPolygon[4] - firstPolygon[6]).toBeCloseTo((firstPolygon[2] - firstPolygon[0]) * 2);
});

test("funnel retains fixed side margins across card and dialog sizes", async ({ page }) => {
  const { data, status } = fixture();
  data.records.push({ id: "fourth", values: { [status.id]: status.options[2].id } });
  const chart = createDatabaseChart("funnel", data.fields);
  chart.title = "响应式漏斗";
  const card = await mountCharts(page, data, [chart]);
  const plot = card.getByRole("img");
  for (const width of [243, 375, 655]) {
    await plot.evaluate(async (element, nextWidth) => {
      const style = (element as SVGSVGElement).style;
      style.width = `${nextWidth}px`;
      style.height = "200px";
      style.flex = "none";
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }, width);
    const geometry = await plot.evaluate((element) => {
      const graphic = element.getBoundingClientRect();
      const top = element.querySelector("polygon")!.getBoundingClientRect();
      const label = element.querySelector(".semlo-editor-chart-funnel-label")!;
      const labelBox = label.getBoundingClientRect();
      const guide = element.querySelector(".semlo-editor-chart-funnel-guide")!.getBoundingClientRect();
      const percent = element.querySelector(".semlo-editor-chart-funnel-percent")!.getBoundingClientRect();
      const hit = document.elementFromPoint(top.left + top.width / 2, top.top + 3);
      return {
        width: top.width,
        left: top.left - graphic.left,
        labelWidth: labelBox.width,
        labelFontSize: getComputedStyle(label).fontSize,
        guideLeft: guide.left - graphic.left,
        guideRight: guide.right - graphic.left,
        guideTop: guide.top - graphic.top,
        percentLeft: percent.left - graphic.left,
        hitTag: hit?.tagName,
      };
    });
    expect(geometry.left).toBeCloseTo(90);
    expect(geometry.width, JSON.stringify(geometry)).toBeCloseTo(width - 180);
    expect(geometry.labelWidth).toBeLessThan(geometry.width);
    expect(geometry.labelFontSize).toBe("12px");
    expect(geometry.guideLeft).toBeCloseTo(width / 2 + (width - 180) / 4 + 2, 1);
    expect(geometry.guideRight).toBeCloseTo(width - 75);
    expect(geometry.guideTop).toBeCloseTo(15 + 170 / 3, 1);
    expect(geometry.percentLeft).toBeCloseTo(width - 70);
    if (width === 243) expect(geometry.hitTag).toBe("polygon");
  }
  // An exceptionally narrow host must not fall back to the SVG's 218-unit width.
  await plot.evaluate(async (element) => {
    (element as SVGSVGElement).style.width = "160px";
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect((await plot.locator("polygon").first().boundingBox())!.width).toBeLessThanOrEqual(1);
});

test("wordcloud uses filtered frequencies, exclusions and limits and stays readable when resized", async ({ page }) => {
  const { data, status } = fixture();
  const previousIds = status.options.map((option) => option.id);
  status.options.forEach((option, index) => (option.id = ["word-a", "word-c", "word-b"][index]));
  for (const record of data.records) {
    const index = previousIds.indexOf(String(record.values[status.id]));
    if (index >= 0) record.values[status.id] = status.options[index].id;
  }
  data.records.push({ id: "fourth", values: { [status.id]: status.options[2].id } });
  const cloud = createDatabaseChart("wordcloud", data.fields);
  cloud.title = "状态词云";
  cloud.wordcloudMaxWords = 2;
  cloud.wordcloudExclude = "进行中";
  cloud.wordcloudShape = "ellipse";
  const empty = createDatabaseChart("wordcloud", data.fields);
  empty.title = "空词云";
  empty.filters = [{ id: "missing", fieldId: status.id, operator: "equals", value: "不存在" }];
  const cards = await mountCharts(page, data, [cloud, empty]);
  const plot = cards.nth(0).getByRole("img");
  await expect(plot).toHaveAttribute("aria-label", "状态词云：待开始：2，已完成：1");
  await expect(plot).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
  const words = plot.locator("text[data-chart-word]");
  await expect(words).toHaveCount(2);
  await expect(words.first().locator("title")).toHaveText("待开始：2");
  expect(Number(await words.first().getAttribute("font-size"))).toBeGreaterThan(
    Number(await words.last().getAttribute("font-size")),
  );
  await cards.nth(0).evaluate((element) => {
    (element as HTMLElement).style.width = "160px";
    (element as HTMLElement).style.height = "160px";
  });
  const bounds = await words.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        x: element.getAttribute("x"),
        y: element.getAttribute("y"),
        fontSize: element.getAttribute("font-size"),
        transform: element.getAttribute("transform"),
        text: element.textContent,
      };
    }),
  );
  expect(
    bounds[0].right <= bounds[1].left ||
      bounds[1].right <= bounds[0].left ||
      bounds[0].bottom <= bounds[1].top ||
      bounds[1].bottom <= bounds[0].top,
    JSON.stringify(bounds),
  ).toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("chartRenderEditor").setEditable(false));
  await expect(plot).toHaveAttribute("aria-label", "状态词云：待开始：2，已完成：1");
  await expect(words).toHaveCount(2);
  await page.evaluate(() => window.__semloRequireFixture("chartRenderEditor").setEditable(true));
  await expect(words).toHaveCount(2);
  await expect(cards.nth(1).getByRole("img")).toHaveAttribute("aria-label", "空词云：暂无数据");
  await expect(cards.nth(1).getByRole("img").locator("text[data-chart-word]")).toHaveCount(0);
});

test("horizontal bars show category order, proportional values, an axis and matching legend", async ({ page }) => {
  const { data } = fixture();
  const chart = createDatabaseChart("bar", data.fields);
  chart.title = "状态统计";
  const card = await mountCharts(page, data, [chart]);
  const chartImage = card.getByRole("img");
  await expect(chartImage).toHaveAttribute("aria-label", "状态统计：待开始：2，进行中：1");
  const bars = chartImage.locator("rect[data-chart-value]");
  await expect(bars).toHaveCount(2);
  const geometry = await bars.evaluateAll((elements) =>
    elements.map((element) => ({
      value: Number(element.getAttribute("data-chart-value")),
      x: Number(element.getAttribute("x")),
      y: Number(element.getAttribute("y")),
      width: Number(element.getAttribute("width")),
      height: Number(element.getAttribute("height")),
      color: element.getAttribute("fill"),
    })),
  );
  expect(geometry.map((bar) => bar.value)).toEqual([2, 1]);
  expect(geometry[0].y).toBeLessThan(geometry[1].y);
  expect(geometry[0].x).toBe(geometry[1].x);
  expect(geometry[0].width).toBeCloseTo(geometry[1].width * 2);
  expect(geometry.every((bar) => bar.height <= chart.barWidth)).toBe(true);
  expect(geometry.map((bar) => bar.color)).toEqual(["#7092f1", "#82d5b1"]);
  const labels = await chartImage.locator(".semlo-editor-chart-axis-label").allTextContents();
  expect(labels).toEqual(expect.arrayContaining(["0", "0.5", "1", "1.5", "2", "待开始", "进行中"]));
  await expect(chartImage.locator(".semlo-editor-chart-grid-line")).toHaveCount(5);
  await expect(chartImage.locator(".semlo-editor-chart-bar-label")).toHaveCount(0);
  await expect(card.locator(".semlo-editor-database-chart-legend")).toHaveText("待开始进行中");
});

test("grouped bars render only existing values with stable series colors and accessible details", async ({ page }) => {
  const { data, status, tags, amount } = fixture();
  const chart = createDatabaseChart("bar", data.fields);
  chart.title = "分组金额";
  chart.fieldId = status.id;
  chart.groupFieldId = tags.id;
  chart.metricFieldId = amount.id;
  chart.statistic = "sum";
  chart.sort = "count-asc";
  chart.precision = 1;
  const card = await mountCharts(page, data, [chart]);
  const plot = card.getByRole("img");
  await expect(plot).toHaveAttribute(
    "aria-label",
    "分组金额：进行中：0（写作：0），待开始：3.5（写作：1.5，回顾：1.5，（空）：2）",
  );
  const bars = plot.locator("rect[data-chart-value]");
  await expect(bars).toHaveCount(4);
  const rows = await bars.evaluateAll((elements) =>
    elements.map((element) => ({
      category: element.getAttribute("data-chart-category"),
      series: element.getAttribute("data-chart-series"),
      value: Number(element.getAttribute("data-chart-value")),
      y: Number(element.getAttribute("y")),
      color: element.getAttribute("fill"),
    })),
  );
  expect(rows.map(({ category, series, value, color }) => ({ category, series, value, color }))).toEqual([
    { category: status.options[1].id, series: "one", value: 0, color: "#7092f1" },
    { category: status.options[0].id, series: "one", value: 1.5, color: "#7092f1" },
    { category: status.options[0].id, series: "two", value: 1.5, color: "#82d5b1" },
    { category: status.options[0].id, series: "", value: 2, color: "#f6c961" },
  ]);
  expect(rows[0].y).toBeLessThan(rows[1].y);
  await expect(card.locator(".semlo-editor-database-chart-legend")).toHaveText("写作回顾（空）");
});

test("area charts leave missing groups disconnected and stack real observations", async ({ page }) => {
  const { data, status, tags } = fixture();
  data.records[2].values[tags.id] = ["one"];
  const isolated = createDatabaseChart("area", data.fields);
  isolated.title = "离散分组";
  isolated.fieldId = status.id;
  isolated.groupFieldId = status.id;
  const stacked = createDatabaseChart("area", data.fields);
  stacked.title = "堆叠面积";
  stacked.fieldId = status.id;
  stacked.groupFieldId = tags.id;
  const separate = createDatabaseChart("area", data.fields);
  separate.title = "非堆叠面积";
  separate.fieldId = status.id;
  separate.groupFieldId = tags.id;
  separate.stacked = false;
  const smooth = createDatabaseChart("area", data.fields);
  smooth.title = "平滑面积";
  smooth.fieldId = status.id;
  smooth.groupFieldId = tags.id;
  smooth.smooth = true;
  const cards = await mountCharts(page, data, [isolated, stacked, separate, smooth]);
  const isolatedPlot = cards.nth(0).getByRole("img");
  await expect(isolatedPlot.locator("circle[data-chart-category]")).toHaveCount(2);
  await expect(isolatedPlot.locator("[data-chart-line], [data-chart-area]")).toHaveCount(0);

  const stackedPlot = cards.nth(1).getByRole("img");
  const separatePlot = cards.nth(2).getByRole("img");
  const groupPoint = (plot: typeof stackedPlot, group: string) =>
    plot.locator(`circle[data-chart-series="${group}"][data-chart-category="${status.options[0].id}"]`);
  await expect(groupPoint(stackedPlot, "one")).toHaveAttribute("data-chart-stack-base", "0");
  await expect(groupPoint(stackedPlot, "two")).toHaveAttribute("data-chart-stack-base", "2");
  await expect(groupPoint(separatePlot, "two")).toHaveAttribute("data-chart-stack-base", "0");
  expect(Number(await groupPoint(stackedPlot, "two").getAttribute("cy"))).toBeLessThan(
    Number(await groupPoint(stackedPlot, "one").getAttribute("cy")),
  );
  expect(Number(await groupPoint(separatePlot, "two").getAttribute("cy"))).toBeGreaterThan(
    Number(await groupPoint(separatePlot, "one").getAttribute("cy")),
  );
  // The second group has no value in the second category: it remains a point,
  // rather than a filled polygon or a line to a synthetic zero.
  await expect(stackedPlot.locator('[data-chart-line][data-chart-series="two"]')).toHaveCount(0);
  await expect(stackedPlot.locator('[data-chart-area][data-chart-series="two"]')).toHaveCount(0);
  await expect(stackedPlot.locator('[data-chart-line][data-chart-series="one"]')).toHaveAttribute("d", / L /);
  const smoothPlot = cards.nth(3).getByRole("img");
  await expect(smoothPlot.locator('[data-chart-line][data-chart-series="one"]')).toHaveAttribute("d", / C /);
});

test("an ungrouped line has one continuous path without a category legend or permanent points", async ({ page }) => {
  const { data } = fixture();
  const line = createDatabaseChart("line", data.fields);
  line.title = "状态变化";
  const card = await mountCharts(page, data, [line]);
  const plot = card.getByRole("img");
  await expect(plot.locator("[data-chart-line]")).toHaveCount(1);
  await expect(plot.locator("circle[data-chart-category]")).toHaveCount(0);
  await expect(card.locator(".semlo-editor-database-chart-legend")).toHaveCount(0);
  await expect(plot).toHaveAttribute("aria-label", "状态变化：待开始：2，进行中：1");
});

test("grouped lines keep isolated data points without connecting across missing categories", async ({ page }) => {
  const { data, status } = fixture();
  const line = createDatabaseChart("line", data.fields);
  line.title = "分组变化";
  line.fieldId = status.id;
  line.groupFieldId = status.id;
  const card = await mountCharts(page, data, [line]);
  const plot = card.getByRole("img");
  await expect(plot.locator("[data-chart-line]")).toHaveCount(0);
  await expect(plot.locator("circle[data-chart-category]")).toHaveCount(2);
  await expect(card.locator(".semlo-editor-database-chart-legend")).toHaveText("待开始进行中");
});

test("scatter points use their actual extent, category colors and legend", async ({ page }) => {
  const { data, status } = fixture();
  const scatter = createDatabaseChart("scatter", data.fields);
  scatter.title = "状态散点";
  const card = await mountCharts(page, data, [scatter]);
  const plot = card.getByRole("img");
  await expect(plot).toHaveAttribute("aria-label", "状态散点：待开始：2，进行中：1");
  const points = plot.locator("circle[data-chart-category]");
  await expect(points).toHaveCount(2);
  const geometry = await points.evaluateAll((elements) =>
    elements.map((element) => ({
      category: element.getAttribute("data-chart-category"),
      value: Number(element.getAttribute("data-chart-value")),
      x: Number(element.getAttribute("cx")),
      y: Number(element.getAttribute("cy")),
      color: element.getAttribute("fill"),
    })),
  );
  expect(geometry.map(({ category, value, color }) => ({ category, value, color }))).toEqual([
    { category: status.options[0].id, value: 2, color: "#7092f1" },
    { category: status.options[1].id, value: 1, color: "#82d5b1" },
  ]);
  expect(geometry[0].x).toBeLessThan(geometry[1].x);
  expect(geometry[0].y).toBeLessThan(geometry[1].y);
  expect(await plot.locator(".semlo-editor-chart-axis-label").allTextContents()).toEqual([
    "2",
    "1.75",
    "1.5",
    "1.25",
    "1",
    "待开始",
    "进行中",
  ]);
  await expect(card.locator(".semlo-editor-database-chart-legend")).toHaveText("待开始进行中");
  await expect(card.locator(".semlo-editor-database-chart-legend i").first()).toHaveCSS("border-radius", "50%");
  await expect(plot.locator("[data-chart-line]")).toHaveCount(0);
});

test("grouped scatter uses existing filtered metric values without inventing missing points", async ({ page }) => {
  const { data, name, status, tags, amount } = fixture();
  const scatter = createDatabaseChart("scatter", data.fields);
  scatter.title = "分组散点";
  scatter.fieldId = status.id;
  scatter.groupFieldId = tags.id;
  scatter.metricFieldId = amount.id;
  scatter.statistic = "sum";
  scatter.filters = [{ id: "nonempty", fieldId: name.id, operator: "notEmpty", value: "" }];
  const result = calculateDatabaseChart(data, scatter, data.records);
  expect(result.buckets.map(({ label, value }) => [label, value])).toEqual([["待开始", 3.5]]);
  const card = await mountCharts(page, data, [scatter]);
  const plot = card.getByRole("img");
  await expect(plot).toHaveAttribute("aria-label", /待开始：4（写作：2，回顾：2，（空）：2）/);
  const points = plot.locator("circle[data-chart-category]");
  await expect(points).toHaveCount(3);
  const dataPoints = await points.evaluateAll((elements) =>
    elements.map((element) => ({
      category: element.getAttribute("data-chart-category"),
      series: element.getAttribute("data-chart-series"),
      value: Number(element.getAttribute("data-chart-value")),
      color: element.getAttribute("fill"),
    })),
  );
  expect(dataPoints).toEqual([
    { category: status.options[0].id, series: "one", value: 1.5, color: "#7092f1" },
    { category: status.options[0].id, series: "two", value: 1.5, color: "#7092f1" },
    { category: status.options[0].id, series: "", value: 2, color: "#7092f1" },
  ]);
  await expect(card.locator(".semlo-editor-database-chart-legend")).toHaveText("待开始");
});

test("grouped scatter uses category colors when multiple group points overlap", async ({ page }) => {
  const { data, name, status } = fixture();
  data.records.forEach((record, index) => (record.values[name.id] = ["甲", "乙", "丙"][index]));
  const scatter = createDatabaseChart("scatter", data.fields);
  scatter.title = "按文本分组";
  scatter.groupFieldId = name.id;
  const card = await mountCharts(page, data, [scatter]);
  const points = card.getByRole("img").locator("circle[data-chart-category]");
  await expect(points).toHaveCount(3);
  const geometry = await points.evaluateAll((elements) =>
    elements.map((element) => ({
      category: element.getAttribute("data-chart-category"),
      value: Number(element.getAttribute("data-chart-value")),
      x: Number(element.getAttribute("cx")),
      y: Number(element.getAttribute("cy")),
      color: element.getAttribute("fill"),
    })),
  );
  expect(geometry.map(({ category, value, color }) => ({ category, value, color }))).toEqual([
    { category: status.options[0].id, value: 1, color: "#7092f1" },
    { category: status.options[0].id, value: 1, color: "#7092f1" },
    { category: status.options[1].id, value: 1, color: "#82d5b1" },
  ]);
  expect(geometry[0].x).toBe(geometry[1].x);
  expect(geometry[0].y).toBe(geometry[1].y);
  await expect(card.locator(".semlo-editor-database-chart-legend")).toHaveText("待开始进行中");
});

test("scatter shows separate grouped values at the same category", async ({ page }) => {
  const { data, name, status } = fixture();
  data.records.forEach((record, index) => (record.values[name.id] = ["甲", "乙", "丙"][index]));
  data.records.push({ id: "fourth", values: { [name.id]: "甲", [status.id]: status.options[0].id } });
  const scatter = createDatabaseChart("scatter", data.fields);
  scatter.groupFieldId = name.id;
  const card = await mountCharts(page, data, [scatter]);
  const points = card.getByRole("img").locator("circle[data-chart-category]");
  await expect(points).toHaveCount(3);
  const geometry = await points.evaluateAll((elements) =>
    elements.map((element) => ({
      category: element.getAttribute("data-chart-category"),
      value: Number(element.getAttribute("data-chart-value")),
      x: Number(element.getAttribute("cx")),
      y: Number(element.getAttribute("cy")),
      color: element.getAttribute("fill"),
    })),
  );
  expect(geometry.map(({ category, value, color }) => ({ category, value, color }))).toEqual([
    { category: status.options[0].id, value: 2, color: "#7092f1" },
    { category: status.options[0].id, value: 1, color: "#7092f1" },
    { category: status.options[1].id, value: 1, color: "#82d5b1" },
  ]);
  expect(geometry[0].x).toBe(geometry[1].x);
  expect(geometry[0].y).toBeLessThan(geometry[1].y);
  await expect(card.locator(".semlo-editor-database-chart-legend")).toHaveText("待开始进行中");
});

test("scatter plots remain finite for identical values and render an empty state", async ({ page }) => {
  const { data, status } = fixture();
  const equal = createDatabaseChart("scatter", data.fields);
  equal.title = "单一数值";
  const empty = createDatabaseChart("scatter", data.fields);
  empty.title = "没有数据";
  empty.filters = [{ id: "missing", fieldId: status.id, operator: "equals", value: "不存在" }];
  data.records = data.records.slice(0, 1);
  const cards = await mountCharts(page, data, [equal, empty]);
  const point = cards.nth(0).getByRole("img").locator("circle[data-chart-category]");
  await expect(point).toHaveCount(1);
  await expect(cards.nth(0).getByRole("img").locator(".semlo-editor-chart-axis-label")).toHaveText([
    "2",
    "1.5",
    "1",
    "0.5",
    "0",
    "待开始",
  ]);
  expect(Number(await point.getAttribute("cy"))).toBeGreaterThanOrEqual(0);
  expect(Number(await point.getAttribute("cy"))).toBeLessThanOrEqual(200);
  await expect(cards.nth(1).getByRole("img")).toHaveAttribute("aria-label", "没有数据：暂无数据");
  await expect(cards.nth(1).getByRole("img").locator('rect[fill="#dcdcdc"]')).toHaveCount(1);
  await expect(cards.nth(1).locator(".semlo-editor-database-chart-unsupported")).toHaveCount(0);
});

test("a single scatter point of value two uses the observed zero-to-four extent", async ({ page }) => {
  const { data, status } = fixture();
  const scatter = createDatabaseChart("scatter", data.fields);
  scatter.filters = [{ id: "first-status", fieldId: status.id, operator: "equals", value: "待开始" }];
  const card = await mountCharts(page, data, [scatter]);
  const plot = card.getByRole("img");
  await expect(plot.locator('circle[data-chart-value="2"]')).toHaveCount(1);
  await expect(plot.locator(".semlo-editor-chart-axis-label")).toHaveText(["4", "3", "2", "1", "0", "待开始"]);
});

test("heatmap shows a Sunday-first calendar, daily counts and observed color levels", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  const { data, status, amount } = fixture();
  const date = data.fields[2];
  data.records[0].values[date.id] = "2026-11-03";
  data.records[1].values[date.id] = "2026-11-03";
  data.records[2].values[date.id] = "2026-11-02";
  data.records.push({
    id: "fourth",
    values: { [date.id]: "2026-10-12", [status.id]: status.options[1].id, [amount.id]: "4" },
  });
  const chart = createDatabaseChart("heatmap", data.fields);
  chart.title = "每日记录";
  chart.heatmapWeeks = 4;
  chart.heatmapMax = 10;
  const card = await mountCharts(page, data, [chart]);
  const plot = card.getByRole("img");
  const days = plot.locator("rect[data-date]");
  await expect(days).toHaveCount(28);
  await expect(days.first()).toHaveAttribute("data-date", "2026-10-11");
  await expect(days.last()).toHaveAttribute("data-date", "2026-11-07");
  await expect(plot).toHaveAttribute("aria-label", "每日记录：2026-10-12：1，2026-11-02：1，2026-11-03：2");
  await expect(plot.locator('text[data-month="2026-11"]')).toHaveText("11月");
  const day = (date: string) => plot.locator(`rect[data-date="${date}"]`);
  await expect(day("2026-11-03")).toHaveAttribute("data-value", "2");
  await expect(day("2026-11-03")).toHaveAttribute("data-level", "2");
  await expect(day("2026-11-03")).toHaveAttribute("fill", "#c7f0df");
  await expect(day("2026-11-02")).toHaveAttribute("data-level", "1");
  await expect(day("2026-11-02")).toHaveAttribute("fill", "#daf6ea");
  await expect(day("2026-10-12")).toHaveAttribute("data-level", "1");
  await expect(day("2026-10-11")).toHaveAttribute("data-level", "-1");
  const geometry = await plot.locator("rect[data-date]").evaluateAll((elements) =>
    elements.map((element) => ({
      date: element.getAttribute("data-date"),
      x: Number(element.getAttribute("x")),
      y: Number(element.getAttribute("y")),
      width: Number(element.getAttribute("width")),
      height: Number(element.getAttribute("height")),
      radius: Number(element.getAttribute("rx")),
    })),
  );
  expect(geometry[0]).toEqual({ date: "2026-10-11", x: 0, y: 0, width: 14, height: 14, radius: 2 });
  expect(geometry[1].y).toBe(19);
  expect(geometry[7].x).toBe(19);
});

test("heatmap filters and aggregates measurements and retains a complete empty calendar", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  const { data, status, amount } = fixture();
  const date = data.fields[2];
  data.records[0].values[date.id] = "2026-11-03";
  data.records[1].values[date.id] = "2026-11-03";
  data.records[2].values[date.id] = "2026-11-02";
  const filtered = createDatabaseChart("heatmap", data.fields);
  filtered.title = "筛选热力";
  filtered.heatmapWeeks = 4;
  filtered.heatmapMax = 5;
  filtered.metricFieldId = amount.id;
  filtered.statistic = "sum";
  filtered.filters = [{ id: "first-status", fieldId: status.id, operator: "equals", value: "待开始" }];
  const empty = createDatabaseChart("heatmap", data.fields);
  empty.title = "没有日程";
  empty.heatmapWeeks = 4;
  empty.filters = [{ id: "missing", fieldId: status.id, operator: "equals", value: "不存在" }];
  const cards = await mountCharts(page, data, [filtered, empty]);
  const plot = cards.nth(0).getByRole("img");
  await expect(plot).toHaveAttribute("aria-label", "筛选热力：2026-11-02：2，2026-11-03：1.5");
  for (const date of ["2026-11-02", "2026-11-03"]) {
    await expect(plot.locator(`rect[data-date="${date}"]`)).toHaveAttribute("data-level", "5");
    await expect(plot.locator(`rect[data-date="${date}"]`)).toHaveAttribute("fill", "#00663b");
  }
  const emptyPlot = cards.nth(1).getByRole("img");
  await expect(emptyPlot).toHaveAttribute("aria-label", "没有日程：暂无数据");
  await expect(emptyPlot.locator('rect[data-date][data-level="-1"]')).toHaveCount(28);
});

test("heatmap renders observed intermediate levels and keeps a recorded zero-level day distinct from empty", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  const { data } = fixture();
  const date = data.fields[2];
  data.records = Array.from({ length: 7 }, (_, index) => ({
    id: `day-${index}`,
    values: { [date.id]: index < 3 ? "2026-11-02" : "2026-11-03" },
  }));
  const levels = createDatabaseChart("heatmap", data.fields);
  levels.title = "不同热度";
  levels.heatmapWeeks = 4;
  levels.heatmapMax = 6;
  const low = createDatabaseChart("heatmap", data.fields);
  low.title = "低热度";
  low.heatmapWeeks = 4;
  const cards = await mountCharts(page, data, [levels, low]);
  const plot = cards.nth(0).getByRole("img");
  await expect(plot.locator('rect[data-date="2026-11-02"]')).toHaveAttribute("data-level", "3");
  await expect(plot.locator('rect[data-date="2026-11-02"]')).toHaveAttribute("fill", "#82edc0");
  await expect(plot.locator('rect[data-date="2026-11-03"]')).toHaveAttribute("data-level", "4");
  await expect(plot.locator('rect[data-date="2026-11-03"]')).toHaveAttribute("fill", "#009456");
  const lowDay = cards.nth(1).getByRole("img").locator('rect[data-date="2026-11-03"]');
  await expect(lowDay).toHaveAttribute("data-value", "4");
  await expect(lowDay).toHaveAttribute("data-level", "0");
  await expect(lowDay).toHaveAttribute("fill", "#f4f5f5");
});

test("a year-long heatmap keeps fixed-size days and clips within a narrow chart", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  const { data } = fixture();
  const chart = createDatabaseChart("heatmap", data.fields);
  chart.title = "全年热力";
  const card = await mountCharts(page, data, [chart]);
  const scroll = card.locator(".semlo-editor-database-heatmap-scroll");
  const days = card.getByRole("img").locator("rect[data-date]");
  await expect(days).toHaveCount(364);
  await expect(days.first()).toHaveAttribute("data-date", "2025-11-09");
  await expect(days.last()).toHaveAttribute("data-date", "2026-11-07");
  const sizes = await scroll.evaluate((element) => {
    const box = element.querySelector("rect[data-date]")!.getBoundingClientRect();
    return { width: element.clientWidth, scrollWidth: element.scrollWidth, dayWidth: box.width, dayHeight: box.height };
  });
  expect(sizes.scrollWidth).toBeGreaterThan(sizes.width);
  expect(sizes.dayWidth).toBeCloseTo(14);
  expect(sizes.dayHeight).toBeCloseTo(14);
  await expect(scroll).toHaveCSS("overflow-x", "hidden");
});

test("a month label in the final heatmap week remains within its SVG", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  const { data } = fixture();
  const chart = createDatabaseChart("heatmap", data.fields);
  chart.heatmapWeeks = 8;
  const card = await mountCharts(page, data, [chart]);
  const label = card.getByRole("img").locator('text[data-month="2026-11"]');
  await expect(label).toHaveText("11月");
  const bounds = await label.evaluate((element) => {
    const text = element as SVGGraphicsElement;
    const box = text.getBBox();
    const viewport = text.ownerSVGElement!.viewBox.baseVal;
    return { left: box.x, right: box.x + box.width, viewLeft: viewport.x, viewRight: viewport.x + viewport.width };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.viewLeft);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewRight + 0.1);
});
