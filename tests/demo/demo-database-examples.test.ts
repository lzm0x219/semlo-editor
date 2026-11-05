import { expect, test, type Page } from "@rstest/playwright";
import type { Locator } from "playwright";

import { createDemoDatabase } from "../../demo/database-example";
import type { DatabaseData, DatabaseView } from "../../packages/core/src/features/database/model";

async function switchView(database: Locator, name: string) {
  await database.getByRole("button", { name: "切换视图" }).click();
  await database
    .getByRole("dialog", { name: "切换视图" })
    .getByRole("button", { name: `切换到${name}` })
    .click();
}

async function openDatabase(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("database");
  const database = page.locator("#editor-host .semlo-editor-database").first();
  await expect(database).toBeVisible();
  return database;
}

test("database example can initialize each view with its own independent data", () => {
  const views: DatabaseView["kind"][] = ["table", "gallery", "kanban", "calendar", "chart"];
  const examples = views.map(
    (kind) => createDemoDatabase(new Date("2026-11-03T12:00:00"), kind).attrs?.data as DatabaseData,
  );
  expect(new Set(examples.map((data) => data.id)).size).toBe(views.length);
  expect(examples.map((data) => data.views.find((view) => view.id === data.activeViewId)?.kind)).toEqual(views);
  const firstName = examples[0].fields[0].id;
  const secondName = examples[1].fields[0].id;
  examples[0].records[0].values[firstName] = "只修改第一个示例";
  expect(examples[1].records[0].values[secondName]).toBe("收集灵感");
});

test("dedicated view examples open directly and keep their own edits", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openDatabase(page);
  const selector = page.getByRole("combobox", { name: "选择示例" });
  for (const [id, kind, content] of [
    ["database-gallery", "gallery", ".semlo-editor-database-gallery"],
    ["database-board", "kanban", ".semlo-editor-database-board"],
    ["database-calendar", "calendar", ".semlo-editor-database-calendar"],
    ["database-chart", "chart", ".semlo-editor-database-chart-canvas"],
  ]) {
    await selector.selectOption(id);
    await expect(database).toHaveAttribute("data-semlo-editor-database-view-kind", kind);
    await expect(database.locator(content)).toBeVisible();
  }
  await expect(database.locator(".semlo-editor-database-chart-card")).toHaveCount(10);
  await expect(
    database
      .locator(".semlo-editor-database-chart-card")
      .filter({ hasText: "每日工作量热力图" })
      .locator("rect[data-value]"),
  ).toHaveCount(3);
  await selector.selectOption("database-gallery");
  await database.getByRole("button", { name: "记录：收集灵感" }).click();
  const detail = database.getByRole("dialog", { name: "记录详情" });
  await detail.getByLabel("第 1 行 事项").fill("画册独立修改");
  await detail.getByLabel("第 1 行 事项").press("Tab");
  await detail.getByRole("button", { name: "关闭" }).click();
  await selector.selectOption("database");
  await expect(database.getByLabel("第 1 行 事项")).toHaveValue("收集灵感");
  await selector.selectOption("database-gallery");
  await expect(database.getByRole("button", { name: "记录：画册独立修改" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("database example exposes every supported field and shares edits across views and adapters", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openDatabase(page);
  const cell = (name: string) => database.getByLabel(`第 1 行 ${name}`);
  await expect(cell("事项")).toHaveValue("收集灵感");
  await expect(cell("状态")).toContainText("待开始");
  await expect(cell("日期")).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await expect(cell("标签")).toContainText("灵感");
  await expect(cell("工作量（小时）")).toHaveValue("3");
  await expect(cell("已归档")).not.toBeChecked();
  await expect(database.getByLabel("第 3 行 已归档")).toBeChecked();
  await expect(cell("参考链接")).toHaveValue("https://example.com/notes/1");
  await expect(cell("联系邮箱")).toHaveValue("hello@example.com");
  await expect(cell("联系电话")).toHaveValue("13800000000");
  await expect(cell("评分")).toHaveValue("4");
  await expect(cell("进度")).toHaveValue("15");

  await cell("标签").click();
  await database.getByRole("dialog", { name: "标签 选项" }).getByRole("button", { name: "写作" }).click();
  await expect(cell("标签")).toContainText("写作");
  await cell("工作量（小时）").fill("6");
  await cell("工作量（小时）").press("Tab");
  await cell("已归档").check();

  await switchView(database, "画册视图");
  const gallery = database.locator(".semlo-editor-database-gallery");
  await expect(gallery.locator(".semlo-editor-database-card")).toHaveCount(3);
  const card = gallery.getByRole("button", { name: "记录：收集灵感" });
  await expect(card).toContainText("写作");
  await card.click();
  const detail = database.getByRole("dialog", { name: "记录详情" });
  await detail.getByLabel("第 1 行 事项").fill("收集生活灵感");
  await detail.getByLabel("第 1 行 事项").press("Tab");
  await detail.getByRole("button", { name: "关闭" }).click();
  await expect(gallery.getByRole("button", { name: "记录：收集生活灵感" })).toBeVisible();

  await switchView(database, "看板视图");
  const board = database.locator(".semlo-editor-database-board");
  await expect(board.getByRole("group", { name: "看板分组：待开始" })).toContainText("收集生活灵感");
  await expect(board.getByRole("group", { name: "看板分组：进行中" })).toContainText("整理内容");
  await expect(board.getByRole("group", { name: "看板分组：已完成" })).toContainText("回顾与分享");

  for (const framework of ["React", "SolidJS", "原生 JS", "Vue"]) {
    await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: framework, exact: true }).click();
    await expect(database.locator(".semlo-editor-database-board")).toBeVisible();
    await expect(database.getByRole("button", { name: "记录：收集生活灵感" })).toBeVisible();
  }
  await switchView(database, "日历视图");
  await expect(database.locator(".semlo-editor-database-calendar-lunar").first()).toBeVisible();
  await expect(database.locator(".semlo-editor-database-calendar")).toBeVisible();
  await expect(database.getByRole("button", { name: "日程：收集生活灵感" }).first()).toBeVisible();
  await switchView(database, "图表视图");
  await expect(database.locator(".semlo-editor-database-chart-card")).toHaveCount(10);
  await expect(database.locator(".semlo-editor-database-chart-card").first().getByRole("img")).toHaveAttribute(
    "aria-label",
    /待开始：1/,
  );
  await expect(database.locator(".semlo-editor-database-chart-card").filter({ hasText: "事项总数" })).toContainText(
    "3",
  );
  await expect(
    database.locator(".semlo-editor-database-chart-card").filter({ hasText: "各事项工作量" }).getByRole("img"),
  ).toHaveAttribute("aria-label", /收集生活灵感：6/);
  await switchView(database, "表格视图");
  await expect(cell("事项")).toHaveValue("收集生活灵感");
  await expect(cell("标签")).toContainText("写作");
  await expect(cell("工作量（小时）")).toHaveValue("6");
  await expect(cell("已归档")).toBeChecked();
  expect(errors).toEqual([]);
});

test("all supported chart examples render real data and survive example and framework switches", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openDatabase(page);
  await switchView(database, "图表视图");
  const chart = (title: string) => database.locator(".semlo-editor-database-chart-card").filter({ hasText: title });
  const assertCharts = async (effort: number) => {
    await expect(database.locator(".semlo-editor-database-chart-card")).toHaveCount(10);
    for (const [title, kind] of [
      ["状态分布", "column"],
      ["各事项工作量（小时）", "bar"],
      ["状态占比", "pie"],
      ["事项总数", "number"],
      ["每日工作量面积图（小时）", "area"],
      ["每日工作量趋势（小时）", "line"],
      ["各状态工作量散点（小时）", "scatter"],
      ["每日工作量热力图（小时）", "heatmap"],
      ["事项进度漏斗", "funnel"],
      ["标签词云", "wordcloud"],
    ]) {
      await expect(chart(title).locator(".semlo-editor-database-chart-render")).toHaveAttribute(
        "data-chart-kind",
        kind,
      );
      await expect(chart(title).getByRole("img")).not.toHaveAttribute("aria-label", /暂无数据/);
    }
    await expect(chart("各事项工作量（小时）").getByRole("img")).toHaveAttribute(
      "aria-label",
      new RegExp(`收集灵感：${effort}`),
    );
    await expect(chart("事项总数")).toContainText("3");
    await expect(chart("每日工作量面积图（小时）").locator('path[data-chart-area="true"]')).not.toHaveCount(0);
    await expect(chart("每日工作量趋势（小时）").locator('path[data-chart-line="true"]')).not.toHaveCount(0);
    await expect(chart("各状态工作量散点（小时）").locator("circle[data-chart-value]")).not.toHaveCount(0);
    await expect(chart("每日工作量热力图（小时）").locator("rect[data-value]")).not.toHaveCount(0);
    await expect(chart("事项进度漏斗").getByRole("img")).toHaveAttribute("aria-label", /待开始：3/);
    await expect(chart("标签词云").getByRole("img")).toHaveAttribute("aria-label", /灵感：2/);
  };
  await assertCharts(3);
  await switchView(database, "表格视图");
  await database.getByLabel("第 1 行 工作量（小时）").fill("7");
  await database.getByLabel("第 1 行 工作量（小时）").press("Tab");
  await switchView(database, "图表视图");
  await assertCharts(7);

  for (const framework of ["React", "SolidJS", "原生 JS", "Vue"]) {
    await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: framework, exact: true }).click();
    await assertCharts(7);
  }
  const selector = page.getByRole("combobox", { name: "选择示例" });
  await selector.selectOption("text");
  await selector.selectOption("database");
  await assertCharts(7);
  expect(errors).toEqual([]);
});

test("database example shows a cross-week event in the current month", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  const database = await openDatabase(page);
  await expect(database.getByLabel("第 2 行 日期")).toHaveValue("2026-11-15");
  await expect(database.getByLabel("第 2 行 结束日期")).toHaveValue("2026-11-17");
  await switchView(database, "日历视图");
  const event = database.getByRole("button", { name: "日程：整理内容" });
  await expect(event).toHaveCount(2);
  await expect(event.nth(0)).toHaveAttribute("data-date", "2026-11-15");
  await expect(event.nth(0)).toHaveClass(/continues-after/);
  await expect(event.nth(1)).toHaveAttribute("data-date", "2026-11-16");
  await expect(event.nth(1)).toHaveClass(/continues-before/);
});

test("calendar navigation is independent across examples and reset restores the current month", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  const database = await openDatabase(page);
  const selector = page.getByRole("combobox", { name: "选择示例" });
  await switchView(database, "日历视图");
  await database.getByRole("button", { name: "下个月" }).click();
  await expect(database.getByRole("grid", { name: "2026年12月日历" })).toBeVisible();

  await page.getByRole("button", { name: "查看全部示例" }).click();
  await expect(selector).toHaveValue("all");
  await switchView(database, "日历视图");
  await expect(database.getByRole("grid", { name: "2026年11月日历" })).toBeVisible();
  await database.getByRole("button", { name: "上个月" }).click();
  await expect(database.getByRole("grid", { name: "2026年10月日历" })).toBeVisible();

  await selector.selectOption("database-calendar");
  await expect(database.getByRole("grid", { name: "2026年11月日历" })).toBeVisible();
  await database.getByRole("button", { name: "下个月" }).click();
  await database.getByRole("button", { name: "下个月" }).click();
  await expect(database.getByRole("grid", { name: "2027年1月日历" })).toBeVisible();

  await selector.selectOption("database");
  await expect(database.getByRole("grid", { name: "2026年12月日历" })).toBeVisible();
  await page.getByRole("button", { name: "恢复示例" }).click();
  await switchView(database, "日历视图");
  await expect(database.getByRole("grid", { name: "2026年11月日历" })).toBeVisible();

  await selector.selectOption("database-calendar");
  await expect(database.getByRole("grid", { name: "2027年1月日历" })).toBeVisible();
  await selector.selectOption("all");
  await expect(database.getByRole("grid", { name: "2026年10月日历" })).toBeVisible();
  await page.getByRole("button", { name: "恢复示例" }).click();
  await switchView(database, "日历视图");
  await expect(database.getByRole("grid", { name: "2026年11月日历" })).toBeVisible();
});
