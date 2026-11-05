import { expect, test, type Locator, type Page } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import { calendarDayNumber, shiftCalendarDate } from "../../../packages/core/src/shared/date/civil-date";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    calendarDragEditor?: EditorController;
  }
}

function fixture(singleDate = false) {
  const data = createDatabaseData();
  const [title, , start] = data.fields;
  title.name = "事项";
  start.name = "日期";
  let end = start;
  if (!singleDate) {
    end = createDatabaseField("结束", "date");
    data.fields.push(end);
  }
  data.records[0].values[title.id] = "日程甲";
  data.records[0].values[start.id] = "2026-11-03";
  if (!singleDate) data.records[0].values[end.id] = "2026-11-06";
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
  return { data, content, startId: start.id, endId: end.id, recordId: data.records[0].id };
}

async function mount(page: Page, singleDate = false) {
  const initial = fixture(singleDate);
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'calendar-drag-test'
      document.body.prepend(host)
      window.calendarDragEditor = createEditor({ element: host, outline: false, content: ${JSON.stringify(initial.content)} })
    `,
  });
  await page.waitForFunction(() => !!window.calendarDragEditor);
  const root = page.locator("#calendar-drag-test .semlo-editor-database");
  await expect(root.locator(".semlo-editor-database-calendar")).toBeVisible();
  return { ...initial, root };
}

async function current(page: Page): Promise<DatabaseData> {
  return page.evaluate(() => {
    const data = window
      .__semloRequireFixture("calendarDragEditor")
      .getSnapshot()
      .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data;
    if (!data) throw new Error("Missing database content");
    return data as DatabaseData;
  });
}

function cell(root: Locator, date: string) {
  return root.locator(`.semlo-editor-database-calendar-cell[data-date="${date}"]`);
}

async function dragTo(page: Page, source: Locator, destination: Locator, offset?: { x: number; y: number }) {
  await source.scrollIntoViewIfNeeded();
  const [from, to] = await Promise.all([source.boundingBox(), destination.boundingBox()]);
  if (!from || !to) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + (offset?.x ?? from.width / 2), from.y + (offset?.y ?? from.height / 2));
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("civil-date movement is independent of daylight saving and rejects overflow", () => {
  expect(shiftCalendarDate("2026-03-08", 1)).toBe("2026-03-09");
  expect(shiftCalendarDate("2026-11-01", -1)).toBe("2026-10-31");
  expect(calendarDayNumber("2026-03-09")! - calendarDayNumber("2026-03-08")!).toBe(1);
  expect(shiftCalendarDate("0099-12-31", 1)).toBe("0100-01-01");
  expect(shiftCalendarDate("9999-12-31", 1)).toBeNull();
  expect(shiftCalendarDate("2026-02-30", 1)).toBeNull();
});

test("moving and resizing an event updates both fields once and supports undo", async ({ page }) => {
  const { root, startId, endId, recordId } = await mount(page);
  const event = root.getByRole("button", { name: "日程：日程甲" });
  const first = event.first();
  const startCell = await cell(root, "2026-11-03").boundingBox();
  const eventBox = await first.boundingBox();
  if (!startCell || !eventBox) throw new Error("Missing event geometry");
  await dragTo(page, first, cell(root, "2026-11-06"), { x: startCell.x - eventBox.x + 30, y: eventBox.height / 2 });
  let record = (await current(page)).records.find((entry) => entry.id === recordId)!;
  expect([record.values[startId], record.values[endId]]).toEqual(["2026-11-06", "2026-11-09"]);
  await expect(event).toHaveCount(2);
  expect(await page.evaluate(() => window.__semloRequireFixture("calendarDragEditor").editor.commands.undo())).toBe(
    true,
  );
  record = (await current(page)).records.find((entry) => entry.id === recordId)!;
  expect([record.values[startId], record.values[endId]]).toEqual(["2026-11-03", "2026-11-06"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("calendarDragEditor").editor.commands.redo())).toBe(
    true,
  );
  await dragTo(page, event.last(), cell(root, "2026-11-11"), { x: 30, y: eventBox.height / 2 });
  record = (await current(page)).records.find((entry) => entry.id === recordId)!;
  expect([record.values[startId], record.values[endId]]).toEqual(["2026-11-08", "2026-11-11"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("calendarDragEditor").editor.commands.undo())).toBe(
    true,
  );
  await dragTo(page, event.first().locator('[data-calendar-edge="start"]'), cell(root, "2026-11-04"));
  await dragTo(page, event.last().locator('[data-calendar-edge="end"]'), cell(root, "2026-11-11"));
  record = (await current(page)).records.find((entry) => entry.id === recordId)!;
  expect([record.values[startId], record.values[endId]]).toEqual(["2026-11-04", "2026-11-11"]);
});

test("extending a single-date event creates an end field in the same undoable change", async ({ page }) => {
  const { root, startId, recordId } = await mount(page, true);
  const event = root.getByRole("button", { name: "日程：日程甲" });
  await dragTo(page, event.locator('[data-calendar-edge="end"]'), cell(root, "2026-11-05"));
  const after = await current(page);
  const calendar = after.views.find((entry) => entry.kind === "calendar")!;
  expect(calendar.calendar.endFieldId).not.toBe(startId);
  expect(after.fields.find((field) => field.id === calendar.calendar.endFieldId)?.name).toBe("日期 1");
  const record = after.records.find((entry) => entry.id === recordId)!;
  expect([record.values[startId], record.values[calendar.calendar.endFieldId]]).toEqual(["2026-11-03", "2026-11-05"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("calendarDragEditor").editor.commands.undo())).toBe(
    true,
  );
  const undone = await current(page);
  expect(undone.fields).toHaveLength(after.fields.length - 1);
  expect(undone.views.find((entry) => entry.kind === "calendar")!.calendar.endFieldId).toBe(startId);
});

test("normal clicks open details and a cancelled or read-only drag never changes dates", async ({ page }) => {
  const { root, startId, endId, recordId } = await mount(page);
  const event = root.getByRole("button", { name: "日程：日程甲" });
  await event.click();
  await expect(root.getByRole("dialog", { name: "日程详情" })).toBeVisible();
  await root.getByRole("dialog", { name: "日程详情" }).getByRole("button", { name: "关闭" }).click();
  const from = await event.boundingBox();
  const to = await cell(root, "2026-11-05").boundingBox();
  if (!from || !to) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  let record = (await current(page)).records.find((entry) => entry.id === recordId)!;
  expect([record.values[startId], record.values[endId]]).toEqual(["2026-11-03", "2026-11-06"]);

  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.evaluate(() => window.__semloRequireFixture("calendarDragEditor").setEditable(false));
  await page.mouse.up();
  record = (await current(page)).records.find((entry) => entry.id === recordId)!;
  expect([record.values[startId], record.values[endId]]).toEqual(["2026-11-03", "2026-11-06"]);
  await expect(event.locator("[data-calendar-edge]")).toHaveCount(0);
});

test("replacing the document with identical IDs or dropping outside cancels the old drag", async ({ page }) => {
  const { root, startId, endId, recordId } = await mount(page);
  const event = root.getByRole("button", { name: "日程：日程甲" });
  let from = await event.boundingBox();
  let to = await cell(root, "2026-11-05").boundingBox();
  if (!from || !to) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("calendarDragEditor");
    const content = controller.getSnapshot().json;
    // Make this a real document replacement while retaining all database IDs and dates.
    content.content![0] = { type: "paragraph", content: [{ type: "text", text: "替换后的正文" }] };
    controller.setContent(content);
  });
  await expect(page.locator("#calendar-drag-test .semlo-editor-prose")).toContainText("替换后的正文");
  await page.mouse.up();
  let record = (await current(page)).records.find((entry) => entry.id === recordId)!;
  expect([record.values[startId], record.values[endId]]).toEqual(["2026-11-03", "2026-11-06"]);

  from = await event.boundingBox();
  to = await cell(root, "2026-11-05").boundingBox();
  if (!from || !to) throw new Error("Missing restored drag geometry");
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.move(5, 5, { steps: 12 });
  await page.mouse.up();
  record = (await current(page)).records.find((entry) => entry.id === recordId)!;
  expect([record.values[startId], record.values[endId]]).toEqual(["2026-11-03", "2026-11-06"]);
  await expect(root.locator(".is-calendar-drop-target")).toHaveCount(0);
});
