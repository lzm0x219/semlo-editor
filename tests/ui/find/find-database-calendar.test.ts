import { expect, test, type Locator, type Page } from "@rstest/playwright";

import { createDatabaseData, createDatabaseView } from "../../../packages/core/src/features/database/model";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    calendarFindEditor?: EditorController;
  }
}

function fixture(): EditorContent {
  const data = createDatabaseData();
  const [title, , date] = data.fields;
  title.name = "事项";
  date.name = "日期";
  data.records[0].values[title.id] = "日程甲";
  data.records[0].values[date.id] = "2026-11-03";
  data.records[1].values[title.id] = "日程乙";
  data.records[1].values[date.id] = "2026-11-04";
  const calendar = createDatabaseView("日历视图", "calendar");
  calendar.calendar.titleFieldId = title.id;
  calendar.calendar.startFieldId = date.id;
  calendar.calendar.endFieldId = date.id;
  data.views.push(calendar);
  data.activeViewId = calendar.id;
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      { type: "semloEditorDatabase", attrs: { data } },
      { type: "paragraph" },
    ],
  };
}

async function mount(page: Page) {
  const content = fixture();
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'calendar-find'
      document.body.prepend(host)
      window.calendarFindEditor = createEditor({
        element: host,
        outline: false,
        content: ${JSON.stringify(content)},
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.calendarFindEditor));
  const host = page.locator("#calendar-find");
  const database = host.locator(".semlo-editor-database");
  await expect(database.getByRole("grid", { name: "2026年11月日历" })).toBeVisible();
  return { host, database };
}

async function switchView(database: Locator, name: string) {
  await database.getByRole("button", { name: "切换视图" }).click();
  await database
    .getByRole("dialog", { name: "切换视图" })
    .getByRole("button", { name: `切换到${name}` })
    .click();
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("calendar find includes records outside the displayed month without changing the month", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { host, database } = await mount(page);
  for (let month = 0; month < 10; month++) await database.getByRole("button", { name: "上个月" }).click();
  const january = database.getByRole("grid", { name: "2026年1月日历" });
  await expect(january).toBeVisible();
  await expect(database.getByRole("button", { name: "日程：日程甲" })).toHaveCount(0);

  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const search = panel.getByRole("textbox", { name: "查找内容" });
  const counter = panel.locator(".semlo-editor-find-counter");
  await search.fill("日程甲");
  await expect(counter).toHaveText("1/1");
  await panel.getByRole("button", { name: "下一个" }).click();
  await expect(january).toBeVisible();
  await expect(database.getByRole("button", { name: "日程：日程甲" })).toHaveCount(0);

  await search.fill("2026-11-03");
  await expect(counter).toHaveText("1/1");
  await panel.getByRole("button", { name: "下一个" }).click();
  await expect(january).toBeVisible();
  await search.fill("没有此内容");
  await expect(counter).toHaveText("0");

  await search.fill("日程甲");
  await database.getByRole("button", { name: "今天", exact: true }).click();
  await expect(database.getByRole("grid", { name: "2026年11月日历" })).toBeVisible();
  await expect(database.getByRole("button", { name: "日程：日程甲" })).toHaveClass(/semlo-editor-find-match-current/);
  expect(errors).toEqual([]);
});

test("calendar find respects its filter and switches views without mutating a read-only document", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { host, database } = await mount(page);
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const search = panel.getByRole("textbox", { name: "查找内容" });
  const counter = panel.locator(".semlo-editor-find-counter");
  await search.fill("日程");
  await expect(counter).toHaveText("1/2");

  await database.getByRole("button", { name: "筛选", exact: true }).click();
  const filter = database.getByRole("dialog", { name: "筛选" });
  await filter.getByLabel("筛选列").selectOption({ label: "事项" });
  await filter.getByLabel("筛选条件").selectOption("equals");
  await filter.getByLabel("筛选值").fill("日程甲");
  await expect(counter).toHaveText("1/1");
  await expect(database.getByRole("button", { name: "日程：日程乙" })).toHaveCount(0);
  await filter.getByRole("button", { name: "关闭" }).click();

  const before = await page.evaluate(() => window.__semloRequireFixture("calendarFindEditor").getSnapshot().json);
  await page.evaluate(() => window.__semloRequireFixture("calendarFindEditor").setEditable(false));
  await switchView(database, "表格视图");
  await search.fill("日程乙");
  await expect(counter).toHaveText("1/1");
  await expect(database.getByLabel("第 2 行 事项")).toHaveValue("日程乙");
  await expect(database.getByLabel("第 2 行 事项")).toHaveAttribute("readonly", "");

  await switchView(database, "日历视图");
  await expect(counter).toHaveText("0");
  await search.fill("日程甲");
  await expect(counter).toHaveText("1/1");
  await expect(database.getByRole("button", { name: "日程：日程甲" })).toHaveClass(/semlo-editor-find-match-current/);
  await switchView(database, "表格视图");
  await search.fill("2026-11-04");
  await expect(counter).toHaveText("1/1");
  expect(await page.evaluate(() => window.__semloRequireFixture("calendarFindEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(errors).toEqual([]);
});
