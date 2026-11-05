import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    autoTimeCalendarEditor?: EditorController;
  }
}

test("calendar can use automatic timestamps and keeps them read-only", async ({ page }) => {
  const data = createDatabaseData();
  const created = createDatabaseField("创建时间", "createdTime");
  const modified = createDatabaseField("修改时间", "modifiedTime");
  data.fields.push(created, modified);
  for (const record of data.records) {
    record.createdAt = new Date(2026, 10, 4, 10).toISOString();
    record.modifiedAt = new Date(2026, 10, 5, 10).toISOString();
    record.values[created.id] = record.createdAt;
    record.values[modified.id] = record.modifiedAt;
  }
  data.records[0].values[data.fields[0].id] = "测试日程";
  const calendar = createDatabaseView("日历", "calendar");
  calendar.calendar.titleFieldId = data.fields[0].id;
  calendar.calendar.startFieldId = created.id;
  calendar.calendar.endFieldId = modified.id;
  data.views.push(calendar);
  data.activeViewId = calendar.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.clock.setFixedTime(new Date(2026, 10, 4, 12));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "autoTimeCalendarContent", initial), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'auto-time-calendar-test'
    document.body.prepend(host)
    window.autoTimeCalendarEditor = createEditor({ element: host, outline: false, content: window.autoTimeCalendarContent })
  `,
  });
  const root = page.locator("#auto-time-calendar-test .semlo-editor-database");
  const grid = root.getByRole("grid", { name: "2026年11月日历" });
  const event = grid.getByRole("button", { name: "日程：测试日程" });
  await expect(event).toBeVisible();
  await expect(event).toHaveAttribute("data-start-date", "2026-11-04");
  await expect(event).toHaveAttribute("data-end-date", "2026-11-05");
  await expect(event.locator(".semlo-editor-database-calendar-resize")).toHaveCount(0);
  const before = await page.evaluate(() => window.__semloRequireFixture("autoTimeCalendarEditor").getSnapshot().json);
  await event.dragTo(grid.locator('[data-date="2026-11-06"]').first());
  expect(await page.evaluate(() => window.__semloRequireFixture("autoTimeCalendarEditor").getSnapshot().json)).toEqual(
    before,
  );
  await root.getByRole("button", { name: "日历设置" }).click();
  const settings = root.getByRole("dialog", { name: "日历设置" });
  await expect(settings.getByLabel("开始日期").locator(`option[value="${created.id}"]`)).toHaveCount(1);
  await expect(settings.getByLabel("结束日期").locator(`option[value="${modified.id}"]`)).toHaveCount(1);
  await settings.getByLabel("结束日期").selectOption(data.fields[2].id);
  await settings.getByRole("button", { name: "关闭" }).click();
  await grid.getByRole("button", { name: "2026-11-06 添加日程" }).click();
  const saved = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("autoTimeCalendarEditor")
        .getSnapshot()
        .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
  );
  expect(saved.records).toHaveLength(4);
  expect(saved.records[3].values[created.id]).toBe(new Date(2026, 10, 4, 12).toISOString());
  expect(saved.records[3].values[modified.id]).toBe(saved.records[3].values[created.id]);
  expect(saved.records[3].values[data.fields[2].id]).toBe("2026-11-06");
  expect(await page.evaluate(() => window.__semloRequireFixture("autoTimeCalendarEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(grid.getByRole("button", { name: "日程：添加日程标题" })).toHaveCount(2);
});
