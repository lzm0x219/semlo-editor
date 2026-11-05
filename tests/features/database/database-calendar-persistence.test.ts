import { expect, test, type Page } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    calendarPersistenceEditors?: EditorController[];
    calendarPersistenceContent?: EditorContent;
    createCalendarPersistenceEditor?: (id: string, content: EditorContent) => EditorController;
    calendarPersistenceStaleInput?: HTMLInputElement;
  }
}

function fixture(duplicates = false): EditorContent {
  const data = createDatabaseData();
  const [title, status, start] = data.fields;
  title.name = "事项";
  start.name = "开始";
  const end = createDatabaseField("结束", "date");
  data.fields.push(end);
  data.records[0].values[title.id] = "原记录";
  data.records[0].values[status.id] = status.options[0].id;
  data.records[0].values[start.id] = "2026-11-03";
  data.records[0].values[end.id] = "2026-11-06";
  const calendar = createDatabaseView("日历视图", "calendar");
  calendar.calendar.titleFieldId = title.id;
  calendar.calendar.startFieldId = start.id;
  calendar.calendar.endFieldId = end.id;
  data.views.push(calendar);
  data.activeViewId = calendar.id;
  const node = { type: "semloEditorDatabase", attrs: { data } };
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      node,
      ...(duplicates ? [{ type: "paragraph" }, structuredClone(node)] : []),
      { type: "paragraph" },
    ],
  };
}

async function install(page: Page, content: EditorContent, hosts = 1) {
  await page.evaluate((value) => {
    window.calendarPersistenceContent = value;
  }, content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const wrapper = document.createElement('div')
      wrapper.id = 'calendar-persistence-wrapper'
      wrapper.style.display = 'flex'
      wrapper.style.alignItems = 'flex-start'
      document.body.prepend(wrapper)
      window.createCalendarPersistenceEditor = (id, value) => {
        const element = document.getElementById(id)
        if (!element) throw new Error('Missing calendar test host')
        return createEditor({ element, outline: false, content: structuredClone(value) })
      }
      window.calendarPersistenceEditors = []
      for (let index = 0; index < ${hosts}; index++) {
        const host = document.createElement('div')
        host.id = 'calendar-persistence-' + index
        host.style.width = ${hosts === 1 ? "'100%'" : "'50%'"}
        wrapper.append(host)
        window.calendarPersistenceEditors.push(window.createCalendarPersistenceEditor(host.id, window.calendarPersistenceContent))
      }
    `,
  });
  await page.waitForFunction((count) => window.calendarPersistenceEditors?.length === count, hosts);
  await expect(page.locator("#calendar-persistence-0 .semlo-editor-database-calendar").first()).toBeVisible();
}

async function open(page: Page, content: EditorContent, hosts = 1) {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await install(page, content, hosts);
}

function database(page: Page, host: number, occurrence = 0) {
  return page.locator(`#calendar-persistence-${host} .semlo-editor-database`).nth(occurrence);
}

async function editorJson(page: Page, host = 0) {
  return page.evaluate(
    (index) => window.__semloRequireFixture("calendarPersistenceEditors")[index].getSnapshot().json,
    host,
  );
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("month browsing does not change document history and survives remount and refresh", async ({ page }) => {
  await open(page, fixture());
  const root = database(page, 0);
  const paragraph = page.locator("#calendar-persistence-0 .semlo-editor-prose p").first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("修改");
  await expect(paragraph).toHaveText("正文修改");
  const edited = await editorJson(page);

  await root.getByRole("button", { name: "上个月" }).click();
  await expect(root.getByRole("grid", { name: "2026年10月日历" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.entries(sessionStorage).filter(([key]) => key.startsWith("semlo-editor:database-calendar:")),
    ),
  ).toEqual([expect.arrayContaining([expect.stringMatching(/^semlo-editor:database-calendar:/), "2026-10"])]);
  expect(await editorJson(page)).toEqual(edited);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("calendarPersistenceEditors")[0].editor.commands.undo()),
  ).toBe(true);
  await expect(paragraph).toHaveText("正文");
  await expect(root.getByRole("grid", { name: "2026年10月日历" })).toBeVisible();
  const afterUndo = await editorJson(page);

  await page.evaluate(() => {
    const current = window.__semloRequireFixture("calendarPersistenceEditors")[0];
    const content = current.getSnapshot().json;
    current.destroy();
    window.__semloRequireFixture("calendarPersistenceEditors")[0] = window.__semloRequireFixture(
      "createCalendarPersistenceEditor",
    )("calendar-persistence-0", content);
  });
  await expect(root.getByRole("grid", { name: "2026年10月日历" })).toBeVisible();
  expect(await editorJson(page)).toEqual(afterUndo);

  await page.reload();
  await install(page, afterUndo);
  await expect(database(page, 0).getByRole("grid", { name: "2026年10月日历" })).toBeVisible();
  expect(await editorJson(page)).toEqual(afterUndo);
});

test("copied database IDs keep month preferences separate for each host and occurrence", async ({ page }) => {
  await open(page, fixture(true), 2);
  const first = database(page, 0, 0);
  const second = database(page, 0, 1);
  const otherFirst = database(page, 1, 0);
  const otherSecond = database(page, 1, 1);

  await first.getByRole("button", { name: "上个月" }).click();
  await second.getByRole("button", { name: "下个月" }).click();
  await otherFirst.getByRole("button", { name: "上个月" }).click();
  await otherFirst.getByRole("button", { name: "上个月" }).click();
  const expectMonths = async () => {
    await expect(first.getByRole("grid", { name: "2026年10月日历" })).toBeVisible();
    await expect(second.getByRole("grid", { name: "2026年12月日历" })).toBeVisible();
    await expect(otherFirst.getByRole("grid", { name: "2026年9月日历" })).toBeVisible();
    await expect(otherSecond.getByRole("grid", { name: "2026年11月日历" })).toBeVisible();
  };
  await expectMonths();
  const snapshots = [await editorJson(page, 0), await editorJson(page, 1)];
  await page.evaluate(() => {
    window.calendarPersistenceEditors = window
      .__semloRequireFixture("calendarPersistenceEditors")
      .map((current, index) => {
        const content = current.getSnapshot().json;
        current.destroy();
        return window.__semloRequireFixture("createCalendarPersistenceEditor")(
          `calendar-persistence-${index}`,
          content,
        );
      });
  });
  await expectMonths();
  expect(await editorJson(page, 0)).toEqual(snapshots[0]);
  expect(await editorJson(page, 1)).toEqual(snapshots[1]);
});

test("blocked sessionStorage falls back to in-memory month navigation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, fixture());
  const root = database(page, 0);
  const before = await editorJson(page);
  await root.getByRole("button", { name: "上个月" }).click();
  await expect(root.getByRole("grid", { name: "2026年10月日历" })).toBeVisible();
  await root.getByRole("button", { name: "下个月" }).click();
  await expect(root.getByRole("grid", { name: "2026年11月日历" })).toBeVisible();
  expect(await editorJson(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("calendar settings round-trip and an obsolete popup cannot write after replacement or destroy", async ({
  page,
}) => {
  await open(page, fixture(), 2);
  const root = database(page, 0);
  await root.getByRole("button", { name: "日历设置" }).click();
  const settings = root.getByRole("dialog", { name: "日历设置" });
  await settings.getByLabel("星期日在首位").check();
  await settings.getByLabel("农历及节假日").check();
  await settings.getByRole("button", { name: "日程颜色 3" }).click();
  await settings.getByRole("button", { name: "关闭" }).click();

  const saved = await page.evaluate(() => window.__semloRequireFixture("calendarPersistenceEditors")[0].getSnapshot());
  const extract = (content: typeof saved.json) => {
    const node = content.content?.find((entry) => entry.type === "semloEditorDatabase");
    if (!node?.attrs?.data) throw new Error("Missing calendar database");
    return node.attrs.data as DatabaseData;
  };
  const expected = extract(saved.json);
  await page.evaluate((html) => {
    const editor = window.__semloRequireFixture("calendarPersistenceEditors")[0];
    editor.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    editor.setContent(html);
  }, saved.html);
  expect(extract(await editorJson(page))).toEqual(expected);
  await page.evaluate((json) => {
    const editor = window.__semloRequireFixture("calendarPersistenceEditors")[0];
    editor.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    editor.setContent(json);
  }, saved.json);
  expect(extract(await editorJson(page))).toEqual(expected);
  await expect(root.getByRole("grid", { name: "2026年11月日历" }).getByRole("columnheader").first()).toHaveText(
    "星期日",
  );

  await root.getByRole("button", { name: "日程：原记录" }).click();
  const popup = root.getByRole("dialog", { name: "日程详情" });
  await expect(popup.getByLabel("第 1 行 事项")).toBeVisible();
  const otherBefore = await editorJson(page, 1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("calendarPersistenceEditors")[0];
    window.calendarPersistenceStaleInput =
      document.querySelector<HTMLInputElement>(
        '#calendar-persistence-0 .semlo-editor-database-popover input[aria-label="第 1 行 事项"]',
      ) ?? undefined;
    if (!window.calendarPersistenceStaleInput) throw new Error("Missing old calendar input");
    const replacement = structuredClone(editor.getSnapshot().json);
    const node = replacement.content?.find((entry) => entry.type === "semloEditorDatabase");
    if (!node?.attrs?.data) throw new Error("Missing database replacement");
    const data = node.attrs.data as DatabaseData;
    data.id = "replacement-calendar-database";
    data.records[0].values[data.fields[0].id] = "替换后的记录";
    editor.setContent(replacement);
    const stale = window.calendarPersistenceStaleInput;
    stale.value = "不应写入";
    stale.dispatchEvent(new Event("input", { bubbles: true }));
    stale.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(popup).toHaveCount(0);
  await expect(root.getByRole("button", { name: "日程：替换后的记录" })).toBeVisible();
  expect(extract(await editorJson(page)).records[0].values[expected.fields[0].id]).toBe("替换后的记录");
  await page.evaluate(() => {
    window.__semloRequireFixture("calendarPersistenceEditors")[0].destroy();
    window.calendarPersistenceStaleInput?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#calendar-persistence-0 .semlo-editor-database")).toHaveCount(0);
  expect(await editorJson(page, 1)).toEqual(otherBefore);
});
