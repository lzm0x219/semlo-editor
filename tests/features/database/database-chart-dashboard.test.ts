import { expect, test, type Locator, type Page } from "@rstest/playwright";

async function openChart(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("database");
  const database = page.locator("#editor-host .semlo-editor-database");
  await database.getByRole("button", { name: "新建视图" }).click();
  await database.getByRole("dialog", { name: "新建视图" }).getByRole("button", { name: "图表", exact: true }).click();
  await expect(database.locator(".semlo-editor-database-chart-canvas")).toBeVisible();
  return database;
}

async function addColumnChart(page: Page, database: Locator, title = "状态统计") {
  await database.getByRole("button", { name: "柱状图", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加图表" });
  await dialog.getByLabel("图表名称").fill(title);
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(database.locator(".semlo-editor-database-chart-card").filter({ hasText: title })).toHaveCount(1);
}

async function cardMenu(page: Page, card: Locator, action: string) {
  await card.getByRole("button", { name: "图表操作" }).click();
  await page.getByRole("menu", { name: "图表操作" }).getByRole("menuitem", { name: action }).click();
}

async function addAnotherColumnChart(page: Page, database: Locator, title: string) {
  await database.getByRole("button", { name: "添加组件" }).click();
  await page.getByRole("dialog", { name: "添加图表组件" }).getByRole("button", { name: "柱状图" }).click();
  const dialog = page.getByRole("dialog", { name: "添加图表" });
  await dialog.getByLabel("图表名称").fill(title);
  await dialog.getByRole("button", { name: "确定" }).click();
}

async function expectGridPosition(card: Locator, x: number, y: number, w: number, h: number) {
  await expect(card).toHaveAttribute("data-grid-x", String(x));
  await expect(card).toHaveAttribute("data-grid-y", String(y));
  await expect(card).toHaveAttribute("data-grid-w", String(w));
  await expect(card).toHaveAttribute("data-grid-h", String(h));
}

const observedChartFieldLabels = ["T 事项", "◉ 状态", "▦ 日期", "# 工作量（小时）", "☷ 标签"];

async function expectObservedChartFields(dialog: Locator, controlName: string) {
  const control = dialog.getByLabel(controlName);
  for (const label of observedChartFieldLabels) {
    await control.selectOption({ label });
    await expect(control.locator("option:checked")).toHaveText(label);
    await expect(dialog.getByRole("img")).not.toHaveAttribute("aria-label", /暂无数据/);
  }
  await control.selectOption({ label: "◉ 状态" });
}

test("bar chart uses the X axis for measures and Y axis for categories in its draft and saved configuration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openChart(page);
  await database.getByRole("button", { name: "条形图", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "添加图表" });
  await expect(dialog.locator(".semlo-editor-database-chart-section")).toHaveText(["X轴", "Y轴"]);
  await expect(dialog.getByLabel("X轴显示内容")).toHaveValue("");
  await expect(dialog.getByLabel("Y轴显示内容").locator("option:checked")).toHaveText("◉ 状态");
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /待开始：1/);
  await dialog.getByLabel("图表名称").fill("取消的条形图");
  await dialog.getByLabel("X轴显示内容").selectOption({ label: "# 工作量（小时）" });
  await expect(dialog.getByLabel("X轴统计方式")).toHaveValue("sum");
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  await expect(database.locator(".semlo-editor-database-chart-card")).toHaveCount(0);

  await database.getByRole("button", { name: "条形图", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "添加图表" });
  await expect(dialog.getByLabel("X轴显示内容")).toHaveValue("");
  await dialog.getByLabel("图表名称").fill("投入分布");
  await dialog.getByLabel("X轴显示内容").selectOption({ label: "# 工作量（小时）" });
  await dialog.getByLabel("排序方式").selectOption("count-desc");
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /进行中：5，待开始：3，已完成：2/);
  await expect(dialog.locator("svg rect[data-chart-value]").first()).toHaveAttribute("data-chart-value", "5");
  await dialog.getByLabel("分组方式").selectOption({ label: "☷ 标签" });
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByLabel("柱子最大宽度")).toHaveValue("40");
  await dialog.getByLabel("柱子最大宽度").fill("28");
  await dialog.getByRole("button", { name: "确定" }).click();
  const card = database.locator(".semlo-editor-database-chart-card").filter({ hasText: "投入分布" });
  await expect(card.locator(".semlo-editor-database-chart-render")).toHaveAttribute("data-chart-kind", "bar");
  await expect(card.getByRole("img")).toHaveAttribute("aria-label", /进行中：5.*待开始：3.*已完成：2/);

  await cardMenu(page, card, "编辑图表");
  dialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialog.getByLabel("X轴显示内容").locator("option:checked")).toHaveText("# 工作量（小时）");
  await expect(dialog.getByLabel("X轴统计方式")).toHaveValue("sum");
  await expect(dialog.getByLabel("Y轴显示内容").locator("option:checked")).toHaveText("◉ 状态");
  await expect(dialog.getByLabel("排序方式")).toHaveValue("count-desc");
  await expect(dialog.getByLabel("分组方式").locator("option:checked")).toHaveText("☷ 标签");
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByLabel("柱子最大宽度")).toHaveValue("28");
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  expect(errors).toEqual([]);
});

test("area chart uses date, grouping, stacking and smooth controls and keeps its settings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openChart(page);
  await database.getByRole("button", { name: "面积图", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "添加图表" });
  await expect(dialog.locator(".semlo-editor-database-chart-section")).toHaveText(["X轴", "Y轴"]);
  const dimension = dialog.getByLabel("X轴显示内容");
  await expect(dimension.locator("option:checked")).toHaveText("▦ 日期");
  await expect(dimension.locator("option", { hasText: "# 工作量（小时）" })).toHaveCount(0);
  await expect(dialog.getByLabel("分组方式").locator("option:checked")).toHaveText("T 事项");
  await expect(dialog.getByLabel("Y轴显示内容").locator("option:checked")).toHaveText("T 事项");
  await expect(dialog.getByRole("checkbox", { name: "是否堆叠" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "是否平滑" })).not.toBeChecked();
  await expect(dialog.getByLabel("排序方式")).toHaveCount(0);
  await dialog.getByLabel("图表名称").fill("面积示例");
  await dimension.selectOption({ label: "◉ 状态" });
  await dialog.getByLabel("分组方式").selectOption("");
  await dialog.getByLabel("Y轴显示内容").selectOption({ label: "# 工作量（小时）" });
  await expect(dialog.getByLabel("Y轴统计方式")).toHaveValue("sum");
  await dialog.getByLabel("Y轴统计方式").selectOption("median");
  await dialog.getByRole("checkbox", { name: "是否堆叠" }).uncheck();
  await dialog.getByRole("checkbox", { name: "是否平滑" }).check();
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /待开始：3/);
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByLabel("图例位置")).toHaveValue("right");
  await expect(dialog.getByLabel("柱子最大宽度")).toHaveCount(0);
  await dialog.getByLabel("图例位置").selectOption("top");
  await dialog.getByRole("button", { name: "确定" }).click();

  const card = database.locator(".semlo-editor-database-chart-card").filter({ hasText: "面积示例" });
  await expect(card.locator(".semlo-editor-database-chart-render")).toHaveAttribute("data-chart-kind", "area");
  await cardMenu(page, card, "编辑图表");
  dialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialog.getByLabel("X轴显示内容").locator("option:checked")).toHaveText("◉ 状态");
  await expect(dialog.getByLabel("分组方式")).toHaveValue("");
  await expect(dialog.getByLabel("Y轴统计方式")).toHaveValue("median");
  await expect(dialog.getByRole("checkbox", { name: "是否堆叠" })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "是否平滑" })).toBeChecked();
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByLabel("图例位置")).toHaveValue("top");
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  expect(errors).toEqual([]);
});

test("line chart uses category and measure axes without column or area style options", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openChart(page);
  await database.getByRole("button", { name: "折线图", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "添加图表" });
  await expect(dialog.locator(".semlo-editor-database-chart-section")).toHaveText(["X轴", "Y轴"]);
  await expect(dialog.getByLabel("X轴显示内容").locator("option:checked")).toHaveText("◉ 状态");
  await expect(dialog.getByLabel("排序方式")).toHaveValue("default");
  await expect(dialog.getByLabel("Y轴显示内容")).toHaveValue("");
  await expect(dialog.getByLabel("分组方式")).toHaveValue("");
  await expect(dialog.getByRole("checkbox", { name: "是否堆叠" })).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: "是否平滑" })).toHaveCount(0);
  await dialog.getByLabel("图表名称").fill("折线示例");
  await dialog.getByLabel("Y轴显示内容").selectOption({ label: "# 工作量（小时）" });
  await expect(dialog.getByLabel("Y轴统计方式")).toHaveValue("sum");
  await dialog.getByLabel("Y轴统计方式").selectOption("max");
  await dialog.getByLabel("排序方式").selectOption("text-asc");
  await dialog.getByLabel("分组方式").selectOption({ label: "☷ 标签" });
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /待开始：3/);
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByLabel("图例位置")).toHaveValue("bottom");
  await expect(dialog.getByLabel("柱子最大宽度")).toHaveCount(0);
  await dialog.getByLabel("图例位置").selectOption("left");
  await dialog.getByRole("button", { name: "确定" }).click();

  const card = database.locator(".semlo-editor-database-chart-card").filter({ hasText: "折线示例" });
  await expect(card.locator(".semlo-editor-database-chart-render")).toHaveAttribute("data-chart-kind", "line");
  await cardMenu(page, card, "编辑图表");
  dialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialog.getByLabel("X轴显示内容").locator("option:checked")).toHaveText("◉ 状态");
  await expect(dialog.getByLabel("排序方式")).toHaveValue("text-asc");
  await expect(dialog.getByLabel("Y轴统计方式")).toHaveValue("max");
  await expect(dialog.getByLabel("分组方式").locator("option:checked")).toHaveText("☷ 标签");
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByLabel("图例位置")).toHaveValue("left");
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  expect(errors).toEqual([]);
});

test("scatter chart keeps axis, grouping, filter and legend settings when edited or copied", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openChart(page);
  await database.getByRole("button", { name: "散点图", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "添加图表" });
  await expect(dialog.locator(".semlo-editor-database-chart-section")).toHaveText(["X轴", "Y轴"]);
  await expect(dialog.getByLabel("X轴显示内容").locator("option:checked")).toHaveText("◉ 状态");
  await expect(dialog.getByLabel("排序方式")).toHaveValue("default");
  await expect(dialog.getByLabel("Y轴显示内容")).toHaveValue("");
  await expect(dialog.getByLabel("分组方式")).toHaveValue("");
  await expect(dialog.getByRole("checkbox", { name: "是否堆叠" })).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: "是否平滑" })).toHaveCount(0);

  await dialog.getByLabel("图表名称").fill("投入散点");
  await dialog.getByLabel("Y轴显示内容").selectOption({ label: "# 工作量（小时）" });
  await expect(dialog.getByLabel("Y轴统计方式")).toHaveValue("sum");
  await dialog.getByLabel("Y轴统计方式").selectOption("average");
  await dialog.getByLabel("排序方式").selectOption("count-desc");
  await dialog.getByLabel("分组方式").selectOption({ label: "☷ 标签" });
  await dialog.getByRole("button", { name: "添加筛选规则" }).click();
  await dialog.getByLabel("筛选列").selectOption({ label: "◉ 状态" });
  await dialog.getByLabel("筛选条件").selectOption("contains");
  await dialog.getByLabel("筛选值").fill("进行中");
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /进行中：5/);
  await expect(dialog.getByRole("img")).not.toHaveAttribute("aria-label", /待开始/);
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByLabel("图例位置")).toHaveValue("bottom");
  await expect(dialog.getByLabel("柱子最大宽度")).toHaveCount(0);
  await dialog.getByLabel("图例位置").selectOption("right");
  await dialog.getByRole("button", { name: "确定" }).click();

  const cards = database.locator(".semlo-editor-database-chart-card");
  const card = cards.first();
  await expect(card.locator(".semlo-editor-database-chart-render")).toHaveAttribute("data-chart-kind", "scatter");
  await expect(card.getByRole("img")).toHaveAttribute("aria-label", /进行中：5/);
  await cardMenu(page, card, "复制图表");
  await expect(cards).toHaveCount(2);
  await cardMenu(page, cards.last(), "编辑图表");
  dialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialog.getByLabel("X轴显示内容").locator("option:checked")).toHaveText("◉ 状态");
  await expect(dialog.getByLabel("Y轴显示内容").locator("option:checked")).toHaveText("# 工作量（小时）");
  await expect(dialog.getByLabel("Y轴统计方式")).toHaveValue("average");
  await expect(dialog.getByLabel("排序方式")).toHaveValue("count-desc");
  await expect(dialog.getByLabel("分组方式").locator("option:checked")).toHaveText("☷ 标签");
  await expect(dialog.getByLabel("筛选列").locator("option:checked")).toHaveText("◉ 状态");
  await expect(dialog.getByLabel("筛选值")).toHaveValue("进行中");
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByLabel("图例位置")).toHaveValue("right");
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  expect(errors).toEqual([]);
});

test("heatmap preview and settings follow date, metric, filter, maximum and week controls", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openChart(page);
  await database.getByRole("button", { name: "热力图", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "添加图表" });
  const date = dialog.getByLabel("日期字段");
  const metric = dialog.getByLabel("热点计算");
  const maximum = dialog.getByLabel("热度最大值");
  const weeks = dialog.getByLabel("显示周数");
  await expect(date.locator("option")).toHaveText([
    "T 事项",
    "◉ 状态",
    "▦ 日期",
    "☷ 标签",
    "# 工作量（小时）",
    "☑ 已归档",
    "↗ 参考链接",
    "✉ 联系邮箱",
    "☎ 联系电话",
    "☆ 评分",
    "▰ 进度",
    "▦ 结束日期",
  ]);
  await expect(date.locator("option:checked")).toHaveText("▦ 日期");
  await expect(metric).toHaveValue("");
  await expect(maximum).toHaveValue("100");
  await expect(maximum).toHaveAttribute("min", "0");
  await expect(maximum).toHaveAttribute("step", "1");
  await expect(weeks).toHaveValue("52");
  await expect(weeks).toHaveAttribute("min", "4");
  await expect(weeks).toHaveAttribute("max", "52");

  await maximum.fill("-5");
  await maximum.press("Tab");
  await expect(maximum).toHaveValue("0");
  await weeks.fill("2");
  await weeks.press("Tab");
  await expect(weeks).toHaveValue("4");
  await expect(dialog.locator(".semlo-editor-database-heatmap-svg rect[data-date]")).toHaveCount(28);
  await weeks.fill("60");
  await weeks.press("Tab");
  await expect(weeks).toHaveValue("52");
  await maximum.fill("120");
  await weeks.fill("12");
  await weeks.press("Tab");
  await dialog.getByLabel("图表名称").fill("近期工作热力");
  await metric.selectOption({ label: "# 工作量（小时）" });
  await expect(dialog.getByLabel("Y轴统计方式")).toHaveValue("sum");
  await dialog.getByRole("button", { name: "添加筛选规则" }).click();
  await dialog.getByLabel("筛选列").selectOption({ label: "◉ 状态" });
  await dialog.getByLabel("筛选值").fill("待开始");
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /2026-11-03：3/);
  await expect(dialog.getByRole("img")).not.toHaveAttribute("aria-label", /2026-11-09/);
  const todayCell = dialog.locator('.semlo-editor-database-heatmap-svg rect[data-date="2026-11-03"]');
  await expect(todayCell).toHaveAttribute("data-level", "0");
  await maximum.fill("1");
  await expect(todayCell).toHaveAttribute("data-level", "5");
  await maximum.fill("120");
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByText("暂无配置")).toBeVisible();
  await expect(dialog.getByLabel("图例位置")).toHaveCount(0);
  await dialog.getByRole("button", { name: "确定" }).click();

  const cards = database.locator(".semlo-editor-database-chart-card");
  await expect(cards.first().locator(".semlo-editor-database-chart-render")).toHaveAttribute(
    "data-chart-kind",
    "heatmap",
  );
  await expect(cards.first().getByRole("img")).toHaveAttribute("aria-label", /2026-11-03：3/);
  await cardMenu(page, cards.first(), "复制图表");
  await expect(cards).toHaveCount(2);
  await cardMenu(page, cards.last(), "编辑图表");
  dialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialog.getByLabel("日期字段").locator("option:checked")).toHaveText("▦ 日期");
  await expect(dialog.getByLabel("热点计算").locator("option:checked")).toHaveText("# 工作量（小时）");
  await expect(dialog.getByLabel("筛选值")).toHaveValue("待开始");
  await expect(dialog.getByLabel("热度最大值")).toHaveValue("120");
  await expect(dialog.getByLabel("显示周数")).toHaveValue("12");
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  expect(errors).toEqual([]);
});

test("funnel settings keep their draft, order, numeric measure, filter and copied configuration", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openChart(page);
  await database.getByRole("button", { name: "漏斗图", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "添加图表" });
  await expect(dialog.getByLabel("内容显示").locator("option:checked")).toHaveText("◉ 状态");
  await expect(dialog.getByLabel("每层表示")).toHaveValue("");
  await expect(dialog.getByRole("checkbox", { name: "累计合并下层数据" })).toBeChecked();
  await expect(dialog.locator(".semlo-editor-database-chart-order-item > span")).toHaveText([
    "待开始",
    "进行中",
    "已完成",
  ]);
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /待开始：3，进行中：2，已完成：1/);
  await expectObservedChartFields(dialog, "内容显示");
  await dialog.getByLabel("图表名称").fill("取消的漏斗图");
  await dialog.getByRole("button", { name: "添加筛选规则" }).click();
  await dialog.getByLabel("筛选列").selectOption({ label: "☷ 标签" });
  await dialog.getByLabel("筛选值").fill("回顾");
  await expect(dialog.locator(".semlo-editor-database-chart-order-item > span")).toHaveText(["已完成"]);
  await dialog.getByRole("button", { name: "删除筛选规则" }).click();
  await expect(dialog.locator(".semlo-editor-database-chart-order-item > span")).toHaveText([
    "已完成",
    "待开始",
    "进行中",
  ]);
  await dialog.getByLabel("内容显示").selectOption({ label: "T 事项" });
  await expect(dialog.locator(".semlo-editor-database-chart-order-item > span")).toHaveText([
    "收集灵感",
    "整理内容",
    "回顾与分享",
  ]);
  await dialog.getByLabel("内容显示").selectOption({ label: "◉ 状态" });
  await expect(dialog.locator(".semlo-editor-database-chart-order-item > span")).toHaveText([
    "待开始",
    "进行中",
    "已完成",
  ]);
  await dialog.getByRole("button", { name: "下移 待开始" }).click();
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  await expect(database.locator(".semlo-editor-database-chart-card")).toHaveCount(0);

  await database.getByRole("button", { name: "漏斗图", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "添加图表" });
  await expect(dialog.locator(".semlo-editor-database-chart-order-item > span")).toHaveText([
    "待开始",
    "进行中",
    "已完成",
  ]);
  await dialog.getByLabel("图表名称").fill("项目漏斗");
  const order = dialog.locator(".semlo-editor-database-chart-order-item");
  await order.nth(2).dragTo(order.nth(0));
  await expect(order.locator("span")).toHaveText(["已完成", "待开始", "进行中"]);
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /已完成：3，待开始：2，进行中：1/);
  await dialog.getByRole("button", { name: "添加筛选规则" }).click();
  await dialog.getByLabel("筛选列").selectOption({ label: "☷ 标签" });
  await dialog.getByLabel("筛选值").fill("灵感");
  await expect(order.locator("span")).toHaveText(["待开始", "进行中"]);
  await dialog.getByRole("button", { name: "删除筛选规则" }).click();
  await expect(order.locator("span")).toHaveText(["待开始", "进行中", "已完成"]);
  await dialog.getByRole("button", { name: "下移 待开始" }).click();
  await expect(order.locator("span")).toHaveText(["进行中", "待开始", "已完成"]);
  await expect(dialog.getByRole("button", { name: "下移 待开始" })).toBeFocused();
  await dialog.getByLabel("每层表示").selectOption({ label: "# 工作量（小时）" });
  await expect(dialog.getByLabel("每层统计方式")).toHaveValue("sum");
  await dialog.getByLabel("每层统计方式").selectOption("average");
  await dialog.getByRole("checkbox", { name: "累计合并下层数据" }).uncheck();
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /进行中：5，待开始：3，已完成：2/);
  await dialog.getByRole("button", { name: "添加筛选规则" }).click();
  await dialog.getByLabel("筛选列").selectOption({ label: "◉ 状态" });
  await dialog.getByLabel("筛选条件").selectOption("notEmpty");
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByText("暂无配置")).toBeVisible();
  await dialog.getByRole("button", { name: "确定" }).click();

  const cards = database.locator(".semlo-editor-database-chart-card");
  await expect(cards.first().locator(".semlo-editor-database-chart-render")).toHaveAttribute(
    "data-chart-kind",
    "funnel",
  );
  await cardMenu(page, cards.first(), "复制图表");
  await expect(cards).toHaveCount(2);
  await cardMenu(page, cards.last(), "编辑图表");
  dialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialog.getByLabel("每层表示").locator("option:checked")).toHaveText("# 工作量（小时）");
  await expect(dialog.getByLabel("每层统计方式")).toHaveValue("average");
  await expect(dialog.getByRole("checkbox", { name: "累计合并下层数据" })).not.toBeChecked();
  await expect(dialog.locator(".semlo-editor-database-chart-order-item > span")).toHaveText([
    "进行中",
    "待开始",
    "已完成",
  ]);
  await expect(dialog.getByLabel("筛选条件")).toHaveValue("notEmpty");
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  expect(errors).toEqual([]);
});

test("word cloud settings retain shape, word count, exclusions and filter when copied and edited", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openChart(page);
  await database.getByRole("button", { name: "词云", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "添加图表" });
  await expect(dialog.getByLabel("显示内容").locator("option:checked")).toHaveText("◉ 状态");
  await expect(dialog.getByLabel("形状")).toHaveValue("cloud");
  await expect(dialog.getByLabel("形状").locator("option")).toHaveText(["云朵", "正圆", "椭圆"]);
  await expect(dialog.getByLabel("最大数量")).toHaveValue("20");
  await expect(dialog.getByLabel("最大数量")).toHaveAttribute("min", "1");
  await expect(dialog.getByLabel("最大数量")).toHaveAttribute("max", "100");
  await expect(dialog.getByLabel("排除词")).toHaveAttribute("placeholder", "使用空格分隔");
  await expectObservedChartFields(dialog, "显示内容");
  await dialog.getByLabel("图表名称").fill("项目词云");
  await dialog.getByLabel("形状").selectOption("ellipse");
  await dialog.getByLabel("最大数量").fill("999");
  await dialog.getByLabel("最大数量").blur();
  await expect(dialog.getByLabel("最大数量")).toHaveValue("100");
  await dialog.getByLabel("最大数量").fill("0");
  await dialog.getByLabel("最大数量").blur();
  await expect(dialog.getByLabel("最大数量")).toHaveValue("1");
  await expect(dialog.locator(".semlo-editor-chart-wordcloud-word")).toHaveCount(1);
  await dialog.getByLabel("最大数量").fill("4");
  await dialog.getByLabel("排除词").fill("待开始 已完成");
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /进行中：1/);
  await expect(dialog.getByRole("img")).not.toHaveAttribute("aria-label", /待开始|已完成/);
  await dialog.getByRole("button", { name: "添加筛选规则" }).click();
  await dialog.getByLabel("筛选列").selectOption({ label: "T 事项" });
  await dialog.getByLabel("筛选条件").selectOption("notEmpty");
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await expect(dialog.getByText("暂无配置")).toBeVisible();
  await dialog.getByRole("button", { name: "确定" }).click();

  const cards = database.locator(".semlo-editor-database-chart-card");
  await expect(cards.first().locator(".semlo-editor-database-chart-render")).toHaveAttribute(
    "data-chart-kind",
    "wordcloud",
  );
  await cardMenu(page, cards.first(), "复制图表");
  await cardMenu(page, cards.last(), "编辑图表");
  dialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialog.getByLabel("形状")).toHaveValue("ellipse");
  await expect(dialog.getByLabel("最大数量")).toHaveValue("4");
  await expect(dialog.getByLabel("排除词")).toHaveValue("待开始 已完成");
  await expect(dialog.getByLabel("筛选条件")).toHaveValue("notEmpty");
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  expect(errors).toEqual([]);
});

test("chart dashboard keeps edits in a draft until confirmed and supports card operations", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const database = await openChart(page);
  await expect(database.getByText("选择一个组件，开始搭建你的数据可视化")).toBeVisible();
  await database.getByRole("button", { name: "柱状图", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "添加图表" });
  await dialog.getByLabel("图表名称").fill("取消的图表");
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(database.locator(".semlo-editor-database-chart-card")).toHaveCount(0);

  await addColumnChart(page, database);
  let card = database.locator(".semlo-editor-database-chart-card").first();
  await expect(card.getByRole("img")).toHaveAttribute("aria-label", /待开始：1/);
  await cardMenu(page, card, "编辑图表");
  dialog = page.getByRole("dialog", { name: "编辑图表" });
  await dialog.getByLabel("图表名称").fill("更新后的统计");
  await dialog.getByLabel("Y轴显示内容").selectOption({ label: "# 工作量（小时）" });
  await expect(dialog.getByLabel("Y轴统计方式")).toHaveValue("sum");
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", /待开始：3/);
  await dialog.getByLabel("Y轴统计方式").selectOption("average");
  await dialog.getByRole("tab", { name: "样式配置" }).click();
  await dialog.getByLabel("柱子最大宽度").fill("24");
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(card).toContainText("更新后的统计");
  await expect(card.getByRole("img")).toHaveAttribute("aria-label", /待开始：3/);
  await cardMenu(page, card, "编辑图表");
  dialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialog.getByLabel("Y轴统计方式")).toHaveValue("average");
  await dialog.getByRole("button", { name: "关闭图表设置" }).click();
  await cardMenu(page, card, "复制图表");
  await expect(database.locator(".semlo-editor-database-chart-card")).toHaveCount(2);
  await cardMenu(page, database.locator(".semlo-editor-database-chart-card").last(), "删除图表");
  await expect(database.locator(".semlo-editor-database-chart-card")).toHaveCount(1);
  await expect(database.locator(".semlo-editor-database-chart-card").first()).toContainText("更新后的统计");
  expect(errors).toEqual([]);
});

test("multiple chart components use shared records and individual filters", async ({ page }) => {
  const database = await openChart(page);
  await addColumnChart(page, database);
  await database.getByRole("button", { name: "添加组件" }).click();
  const picker = page.getByRole("dialog", { name: "添加图表组件" });
  await picker.getByRole("button", { name: "饼图", exact: true }).click();
  const pie = page.getByRole("dialog", { name: "添加图表" });
  await pie.getByLabel("图表名称").fill("进行中占比");
  await pie.getByRole("button", { name: "添加筛选规则" }).click();
  await pie.getByLabel("筛选列").selectOption({ label: "◉ 状态" });
  await pie.getByLabel("筛选条件").selectOption("contains");
  await pie.getByLabel("筛选值").fill("进行中");
  await expect(pie.getByRole("img")).toHaveAttribute("aria-label", /进行中：1/);
  await expect(pie.getByRole("img")).not.toHaveAttribute("aria-label", /待开始/);
  await pie.getByRole("button", { name: "确定" }).click();
  await expect(database.locator(".semlo-editor-database-chart-card")).toHaveCount(2);
  const first = database.locator(".semlo-editor-database-chart-card").first();
  const second = database.locator(".semlo-editor-database-chart-card").last();
  await expect(first.getByRole("img")).toHaveAttribute("aria-label", /待开始：1/);
  await expect(second.getByRole("img")).toHaveAttribute("aria-label", /进行中：1/);
  await expect(second.getByRole("img")).not.toHaveAttribute("aria-label", /待开始/);

  await database.getByRole("button", { name: "添加组件" }).click();
  await page.getByRole("dialog", { name: "添加图表组件" }).getByRole("button", { name: "统计数字" }).click();
  const number = page.getByRole("dialog", { name: "添加图表" });
  await number.getByLabel("图表名称").fill("记录数");
  await expect(number.getByText("3", { exact: true })).toBeVisible();
  await number.getByRole("button", { name: "确定" }).click();
  await expect(database.locator(".semlo-editor-database-chart-card")).toHaveCount(3);
  await expect(database.locator(".semlo-editor-database-chart-card").last()).toContainText("3");
});

test("read-only transition and remount invalidate an open chart editor", async ({ page }) => {
  const database = await openChart(page);
  await addColumnChart(page, database, "原始图表");
  const card = database.locator(".semlo-editor-database-chart-card").first();
  await cardMenu(page, card, "编辑图表");
  const dialog = page.getByRole("dialog", { name: "编辑图表" });
  await dialog.getByLabel("图表名称").fill("不应保存");
  const staleConfirm = await dialog.getByRole("button", { name: "确定" }).elementHandle();
  if (!staleConfirm) throw new Error("Missing chart confirmation button");
  await page.locator("#readonly").evaluate((button) => (button as HTMLButtonElement).click());
  await expect(dialog).toHaveCount(0);
  await staleConfirm.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(database.locator(".semlo-editor-database-chart-card").first()).toContainText("原始图表");
  await expect(
    database.locator(".semlo-editor-database-chart-card").getByRole("button", { name: "图表操作" }),
  ).toHaveCount(0);
  await page.locator("#readonly").evaluate((button) => (button as HTMLButtonElement).click());

  await cardMenu(page, database.locator(".semlo-editor-database-chart-card").first(), "编辑图表");
  const remountDialog = page.getByRole("dialog", { name: "编辑图表" });
  await remountDialog.getByLabel("图表名称").fill("旧编辑器的草稿");
  const staleAfterRemount = await remountDialog.getByRole("button", { name: "确定" }).elementHandle();
  if (!staleAfterRemount) throw new Error("Missing chart confirmation before remount");
  await page
    .getByRole("button", { name: "React", exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(remountDialog).toHaveCount(0);
  await staleAfterRemount.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(database.locator(".semlo-editor-database-chart-card").first()).toContainText("原始图表");
});

test("chart resizing commits once and cancels on Escape and read-only transition", async ({ page }) => {
  const database = await openChart(page);
  await addColumnChart(page, database);
  const card = database.locator(".semlo-editor-database-chart-card").first();
  const handle = card.getByRole("button", { name: "调整图表大小" });
  const before = await card.boundingBox();
  if (!before) throw new Error("Missing chart card");
  const grid = await database.locator(".semlo-editor-database-chart-grid").boundingBox();
  if (!grid) throw new Error("Missing chart grid");
  const cell = grid.width / 12;
  await card.hover();
  let point = await handle.boundingBox();
  if (!point) throw new Error("Missing chart resize handle");
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2 + cell, point.y + point.height / 2 + cell, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 50);
  const resized = await card.boundingBox();
  if (!resized) throw new Error("Chart disappeared after resizing");
  expect(resized.height).toBeGreaterThan(before.height + 30);
  const toolbar = page.locator("#editor-host").getByRole("toolbar", { name: "文本格式" });
  await toolbar.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => Math.round((await card.boundingBox())?.width ?? 0)).toBe(Math.round(before.width));
  await toolbar.getByRole("button", { name: "重做", exact: true }).click();
  await expect.poll(async () => Math.round((await card.boundingBox())?.width ?? 0)).toBe(Math.round(resized.width));

  await card.hover();
  point = await handle.boundingBox();
  if (!point) throw new Error("Missing resize handle after repaint");
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + 65, point.y + 45, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(async () => Math.round((await card.boundingBox())?.width ?? 0)).toBe(Math.round(resized.width));
  await expect.poll(async () => Math.round((await card.boundingBox())?.height ?? 0)).toBe(Math.round(resized.height));

  await card.hover();
  point = await handle.boundingBox();
  if (!point) throw new Error("Missing resize handle before read-only transition");
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + 60, point.y + 40, { steps: 4 });
  await page.locator("#readonly").evaluate((button) => (button as HTMLButtonElement).click());
  await page.mouse.up();
  await expect(database.locator(".semlo-editor-database-chart-resize")).toHaveCount(0);
  await expect.poll(async () => Math.round((await card.boundingBox())?.width ?? 0)).toBe(Math.round(resized.width));
  await expect.poll(async () => Math.round((await card.boundingBox())?.height ?? 0)).toBe(Math.round(resized.height));

  await page.locator("#readonly").click();
  await card.hover();
  point = await handle.boundingBox();
  if (!point) throw new Error("Missing resize handle before remount");
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + 70, point.y + 50, { steps: 4 });
  await page
    .getByRole("button", { name: "React", exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await page.mouse.up();
  await expect.poll(async () => Math.round((await card.boundingBox())?.width ?? 0)).toBe(Math.round(resized.width));
  await expect.poll(async () => Math.round((await card.boundingBox())?.height ?? 0)).toBe(Math.round(resized.height));
});

test("chart positions compact vertically after deletion and new charts fill available cells", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("database-chart");
  const database = page.locator("#editor-host .semlo-editor-database");
  const cards = database.locator(".semlo-editor-database-chart-card");
  await expect(cards).toHaveCount(10);
  await expectGridPosition(cards.nth(0), 0, 0, 4, 4);
  await expectGridPosition(cards.nth(1), 4, 0, 4, 4);
  await expectGridPosition(cards.nth(2), 8, 0, 4, 4);
  await expectGridPosition(cards.nth(8), 8, 8, 4, 4);
  await expectGridPosition(cards.nth(9), 0, 12, 4, 4);
  const secondBefore = await cards.nth(1).boundingBox();
  const thirdBefore = await cards.nth(2).boundingBox();
  await cardMenu(page, cards.nth(0), "删除图表");
  await expect(cards).toHaveCount(9);
  await expectGridPosition(cards.nth(0), 4, 0, 4, 4);
  await expectGridPosition(cards.nth(1), 8, 0, 4, 4);
  await expectGridPosition(cards.nth(2), 0, 0, 4, 4);
  expect((await cards.nth(0).boundingBox())?.x).toBeCloseTo(secondBefore!.x, 1);
  expect((await cards.nth(1).boundingBox())?.x).toBeCloseTo(thirdBefore!.x, 1);

  await addAnotherColumnChart(page, database, "填入空位");
  const added = cards.filter({ hasText: "填入空位" });
  await expectGridPosition(added, 0, 12, 4, 4);
  await cardMenu(page, added, "复制图表");
  await expect(cards).toHaveCount(11);
  const copy = cards.last();
  await expect(copy).toContainText("填入空位");
  await expectGridPosition(copy, 4, 12, 4, 4);

  await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: "React" }).click();
  await expectGridPosition(cards.nth(0), 4, 0, 4, 4);
  await expectGridPosition(cards.nth(9), 0, 12, 4, 4);
  await expectGridPosition(cards.nth(10), 4, 12, 4, 4);
});

test("deleting an upper card compacts cards in its column and preserves other columns", async ({ page }) => {
  const database = await openChart(page);
  await addColumnChart(page, database, "小图");
  await addAnotherColumnChart(page, database, "右侧图一");
  await addAnotherColumnChart(page, database, "右侧图二");
  const cards = database.locator(".semlo-editor-database-chart-card");
  const first = cards.filter({ hasText: "小图" });
  const rightOne = cards.filter({ hasText: "右侧图一" });
  const rightTwo = cards.filter({ hasText: "右侧图二" });
  const gridBounds = await database.locator(".semlo-editor-database-chart-grid").boundingBox();
  await first.hover();
  const handleBounds = await first.getByRole("button", { name: "调整图表大小" }).boundingBox();
  if (!gridBounds || !handleBounds) throw new Error("Missing chart grid or resize handle");
  const x = handleBounds.x + handleBounds.width / 2;
  const y = handleBounds.y + handleBounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - gridBounds.width / 4, y - gridBounds.width / 4, { steps: 6 });
  await page.mouse.up();
  await expectGridPosition(first, 0, 0, 1, 1);

  await addAnotherColumnChart(page, database, "下方图");
  const lower = cards.filter({ hasText: "下方图" });
  await expectGridPosition(lower, 0, 1, 4, 4);
  await cardMenu(page, first, "删除图表");
  await expectGridPosition(lower, 0, 0, 4, 4);
  await expectGridPosition(rightOne, 4, 0, 4, 4);
  await expectGridPosition(rightTwo, 8, 0, 4, 4);

  const toolbar = page.locator("#editor-host").getByRole("toolbar", { name: "文本格式" });
  await toolbar.getByRole("button", { name: "撤销", exact: true }).click();
  await expectGridPosition(first, 0, 0, 1, 1);
  await expectGridPosition(lower, 0, 1, 4, 4);
  await toolbar.getByRole("button", { name: "重做", exact: true }).click();
  await expect(first).toHaveCount(0);
  await expectGridPosition(lower, 0, 0, 4, 4);
});

test("chart resize snaps to cells, pushes collisions, compacts on shrink, and remains undoable", async ({ page }) => {
  const database = await openChart(page);
  await addColumnChart(page, database, "甲图");
  await addAnotherColumnChart(page, database, "乙图");
  await addAnotherColumnChart(page, database, "丙图");
  const cards = database.locator(".semlo-editor-database-chart-card");
  const first = cards.filter({ hasText: "甲图" });
  const second = cards.filter({ hasText: "乙图" });
  const third = cards.filter({ hasText: "丙图" });
  await expectGridPosition(first, 0, 0, 4, 4);
  await expectGridPosition(second, 4, 0, 4, 4);
  await expectGridPosition(third, 8, 0, 4, 4);
  const grid = database.locator(".semlo-editor-database-chart-grid");
  const gridBounds = await grid.boundingBox();
  if (!gridBounds) throw new Error("Missing chart grid");
  const cell = gridBounds.width / 12;
  const resize = async (dx: number, dy: number) => {
    await first.hover();
    const point = await first.getByRole("button", { name: "调整图表大小" }).boundingBox();
    if (!point) throw new Error("Missing chart resize handle");
    const x = point.x + point.width / 2;
    const y = point.y + point.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx * cell, y + dy * cell, { steps: 6 });
    await page.mouse.up();
  };
  await resize(3, 1);
  await expectGridPosition(first, 0, 0, 7, 5);
  await expectGridPosition(second, 4, 5, 4, 4);
  await expectGridPosition(third, 8, 0, 4, 4);
  const firstBounds = await first.boundingBox();
  const secondBounds = await second.boundingBox();
  if (!firstBounds || !secondBounds) throw new Error("Missing resized chart cards");
  expect(secondBounds.y).toBeGreaterThanOrEqual(firstBounds.y + firstBounds.height);

  await resize(-3, -1);
  await expectGridPosition(first, 0, 0, 4, 4);
  await expectGridPosition(second, 4, 0, 4, 4);
  const toolbar = page.locator("#editor-host").getByRole("toolbar", { name: "文本格式" });
  await toolbar.getByRole("button", { name: "撤销", exact: true }).click();
  await expectGridPosition(first, 0, 0, 7, 5);
  await expectGridPosition(second, 4, 5, 4, 4);
  await toolbar.getByRole("button", { name: "重做", exact: true }).click();
  await expectGridPosition(first, 0, 0, 4, 4);
  await expectGridPosition(second, 4, 0, 4, 4);

  await resize(-3, -3);
  await expectGridPosition(first, 0, 0, 1, 1);
  await page.setViewportSize({ width: 320, height: 720 });
  await expectGridPosition(third, 8, 0, 4, 4);
  await expect
    .poll(async () => {
      const box = await first.boundingBox();
      return box ? Math.abs(box.width - box.height) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(1);
  const narrowFirst = await first.boundingBox();
  const narrowSecond = await second.boundingBox();
  if (!narrowFirst || !narrowSecond) throw new Error("Missing chart cards after viewport change");
  expect(narrowSecond.x).toBeGreaterThanOrEqual(narrowFirst.x + narrowFirst.width);
});
