import { expect, test, type Locator, type Page } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import { databaseCalendarMonthGrid } from "../../../packages/core/src/features/database/views/calendar/view";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseCalendarEditors?: EditorController[];
  }
}

function makeFixture() {
  const data = createDatabaseData();
  const [title, status, start] = data.fields;
  title.name = "事项";
  start.name = "开始";
  const end = createDatabaseField("结束", "date");
  data.fields.push(end);
  const [first, second, undated] = data.records;
  first.values[title.id] = "跨日事项";
  first.values[status.id] = status.options[0].id;
  first.values[start.id] = "2026-11-03";
  first.values[end.id] = "2026-11-06";
  second.values[title.id] = "单日日程";
  second.values[start.id] = "2026-11-04";
  second.values[end.id] = "2026-11-04";
  undated.values[title.id] = "没有日期的记录";
  undated.values[start.id] = "";
  undated.values[end.id] = "";
  const calendar = createDatabaseView("日历视图", "calendar");
  calendar.calendar.titleFieldId = title.id;
  calendar.calendar.startFieldId = start.id;
  calendar.calendar.endFieldId = end.id;
  data.views.push(calendar);
  data.activeViewId = calendar.id;
  const content: EditorContent = {
    type: "doc",
    content: [{ type: "paragraph" }, { type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }],
  };
  return { data, content };
}

async function mount(page: Page, count = 1) {
  const fixture = makeFixture();
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.databaseCalendarEditors = []
      const container = document.createElement('div')
      container.style.display = 'flex'
      container.style.alignItems = 'flex-start'
      document.body.prepend(container)
      for (let index = 0; index < ${count}; index++) {
        const host = document.createElement('div')
        host.id = 'calendar-database-' + index
        host.style.width = ${count === 1 ? "'100%'" : "'50%'"}
        container.append(host)
        window.databaseCalendarEditors.push(createEditor({
          element: host,
          outline: false,
          content: ${JSON.stringify(fixture.content)},
        }))
      }
    `,
  });
  await page.waitForFunction((expected) => window.databaseCalendarEditors?.length === expected, count);
  const root = page.locator("#calendar-database-0 .semlo-editor-database");
  await expect(root.locator(".semlo-editor-database-calendar")).toBeVisible();
  return { ...fixture, root, other: page.locator("#calendar-database-1 .semlo-editor-database") };
}

async function snapshot(page: Page, index = 0): Promise<DatabaseData> {
  return page.evaluate((selected) => {
    const node = window
      .__semloRequireFixture("databaseCalendarEditors")
      [selected].getSnapshot()
      .json.content?.find((entry) => entry.type === "semloEditorDatabase");
    if (!node?.attrs?.data) throw new Error("Missing database content");
    return node.attrs.data as DatabaseData;
  }, index);
}

function day(root: Locator, date: string) {
  return root.locator(`.semlo-editor-database-calendar-cell[data-date="${date}"]`);
}

async function switchView(root: Locator, name: string) {
  await root.getByRole("button", { name: "切换视图" }).click();
  await root
    .getByRole("dialog", { name: "切换视图" })
    .getByRole("button", { name: `切换到${name}` })
    .click();
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("month grids start on the selected weekday and contain complete variable-length local weeks", () => {
  const monday = databaseCalendarMonthGrid(2026, 10, false);
  expect(monday).toHaveLength(42);
  expect([monday[0].date, monday[monday.length - 1].date]).toEqual(["2026-10-26", "2026-12-06"]);
  const sunday = databaseCalendarMonthGrid(2026, 10, true);
  expect(sunday).toHaveLength(35);
  expect([sunday[0].date, sunday[sunday.length - 1].date]).toEqual(["2026-11-01", "2026-12-05"]);
  const fourWeeks = databaseCalendarMonthGrid(2027, 1, false);
  expect(fourWeeks).toHaveLength(28);
  expect([fourWeeks[0].date, fourWeeks[27].date]).toEqual(["2027-02-01", "2027-02-28"]);
});

test("calendar renders shared dated records, week settings, lunar labels and month navigation", async ({ page }) => {
  const { root } = await mount(page);
  const grid = root.getByRole("grid", { name: "2026年11月日历" });
  await expect(grid.getByRole("columnheader").first()).toHaveText("星期一");
  await expect(grid.getByRole("gridcell")).toHaveCount(42);
  await expect(day(root, "2026-10-26")).toHaveClass(/is-outside/);
  await expect(day(root, "2026-11-03").locator(".semlo-editor-database-calendar-day")).toHaveClass(/is-today/);
  const spanning = root.getByRole("button", { name: "日程：跨日事项" });
  const single = root.getByRole("button", { name: "日程：单日日程" });
  await expect(spanning).toHaveCount(1);
  await expect(single).toBeVisible();
  const [bar, startDay, endDay, overlapping] = await Promise.all([
    spanning.boundingBox(),
    day(root, "2026-11-03").boundingBox(),
    day(root, "2026-11-06").boundingBox(),
    single.boundingBox(),
  ]);
  if (!bar || !startDay || !endDay || !overlapping) throw new Error("Missing calendar bar or date bounds");
  expect(bar.x).toBeGreaterThanOrEqual(startDay.x);
  expect(bar.x).toBeLessThan(startDay.x + 20);
  expect(bar.x + bar.width).toBeGreaterThan(endDay.x + endDay.width - 20);
  expect(bar.x + bar.width).toBeLessThanOrEqual(endDay.x + endDay.width);
  expect(overlapping.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  await expect(root.getByRole("button", { name: "日程：没有日期的记录" })).toHaveCount(0);

  await spanning.click();
  const detail = root.getByRole("dialog", { name: "日程详情" });
  await detail.getByLabel("第 1 行 结束").fill("2026-11-10");
  await detail.getByLabel("第 1 行 结束").press("Tab");
  await detail.getByRole("button", { name: "关闭" }).click();

  await root.getByRole("button", { name: "日历设置" }).click();
  const settings = root.getByRole("dialog", { name: "日历设置" });
  await settings.getByLabel("星期日在首位").check();
  await expect(root.getByRole("grid", { name: "2026年11月日历" }).getByRole("gridcell")).toHaveCount(35);
  await expect(root.getByRole("grid", { name: "2026年11月日历" }).getByRole("columnheader").first()).toHaveText(
    "星期日",
  );
  await expect(spanning).toHaveCount(2);
  await expect(spanning.nth(0)).toHaveAttribute("data-date", "2026-11-03");
  await expect(spanning.nth(0)).toHaveClass(/continues-after/);
  await expect(spanning.nth(1)).toHaveAttribute("data-date", "2026-11-08");
  await expect(spanning.nth(1)).toHaveClass(/continues-before/);
  await settings.getByLabel("农历及节假日").check();
  await expect(day(root, "2026-11-03").locator(".semlo-editor-database-calendar-lunar")).toHaveText("廿五");
  await expect(day(root, "2026-11-07").locator(".semlo-editor-database-calendar-lunar")).toHaveText("立冬");
  await settings.getByLabel("颜色显示").selectOption("field");
  await settings.getByRole("button", { name: "关闭" }).click();
  await spanning.first().click();
  await expect(root.getByRole("dialog", { name: "日程详情" }).getByLabel("第 1 行 单选")).toContainText("待开始");
  await root.getByRole("dialog", { name: "日程详情" }).getByRole("button", { name: "关闭" }).click();

  await root.getByRole("button", { name: "下个月" }).click();
  await expect(root.getByRole("grid", { name: "2026年12月日历" })).toBeVisible();
  await root.getByRole("button", { name: "今天", exact: true }).click();
  await expect(root.getByRole("grid", { name: "2026年11月日历" })).toBeVisible();
});

test("calendar event edits and additions update the same records as the table view", async ({ page }) => {
  const { root } = await mount(page);
  await root.getByRole("button", { name: "日程：跨日事项" }).click();
  const detail = root.getByRole("dialog", { name: "日程详情" });
  await detail.getByLabel("第 1 行 事项").fill("修改后的事项");
  await detail.getByLabel("第 1 行 事项").press("Tab");
  await detail.getByRole("button", { name: "关闭" }).click();
  await expect(root.getByRole("button", { name: "日程：修改后的事项" })).toBeVisible();

  await day(root, "2026-11-12").hover();
  await day(root, "2026-11-12").getByRole("button", { name: "2026-11-12 添加日程" }).click();
  const added = root.getByRole("dialog", { name: "记录详情" });
  await expect(added.getByLabel("第 4 行 开始")).toHaveValue("2026-11-12");
  await expect(added.getByLabel("第 4 行 结束")).toHaveValue("2026-11-12");
  await added.getByLabel("第 4 行 事项").fill("新日程");
  await added.getByLabel("第 4 行 事项").press("Tab");
  await added.getByRole("button", { name: "关闭" }).click();
  await expect(root.getByRole("button", { name: "日程：新日程" })).toBeVisible();

  await switchView(root, "表格视图");
  await expect(root.getByLabel("第 1 行 事项")).toHaveValue("修改后的事项");
  await expect(root.getByLabel("第 4 行 事项")).toHaveValue("新日程");
  await expect(root.getByLabel("第 4 行 开始")).toHaveValue("2026-11-12");
});

test("calendar view settings round-trip and read-only navigation stays local to each instance", async ({ page }) => {
  const { root, other } = await mount(page, 2);
  await root.getByRole("button", { name: "日历设置" }).click();
  const settings = root.getByRole("dialog", { name: "日历设置" });
  await settings.getByLabel("星期日在首位").check();
  await settings.getByRole("button", { name: "日程颜色 3" }).click();
  await settings.getByRole("button", { name: "关闭" }).click();
  const before = await snapshot(page);
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("databaseCalendarEditors")[0];
    controller.setContent(controller.getSnapshot().html);
    controller.setEditable(false);
  });
  await expect(root.getByRole("grid", { name: "2026年11月日历" }).getByRole("columnheader").first()).toHaveText(
    "星期日",
  );
  expect((await snapshot(page)).views.find((view) => view.kind === "calendar")?.calendar).toEqual(
    before.views.find((view) => view.kind === "calendar")?.calendar,
  );
  await expect(root.getByRole("button", { name: "2026-11-12 添加日程" })).toHaveCount(0);
  await root.getByRole("button", { name: "下个月" }).click();
  await expect(root.getByRole("grid", { name: "2026年12月日历" })).toBeVisible();
  await expect(other.getByRole("grid", { name: "2026年11月日历" })).toBeVisible();
  await root.getByRole("button", { name: "上个月" }).click();
  await root.getByRole("button", { name: "日程：跨日事项" }).click();
  await expect(root.getByRole("dialog", { name: "日程详情" }).getByLabel("第 1 行 事项")).toHaveAttribute(
    "readonly",
    "",
  );
});
