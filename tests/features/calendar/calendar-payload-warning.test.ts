import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "./calendar-unknown-data.test";

let origin: string;
let closeServer: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/calendar/calendar-touch-fixture.ts"));
});
afterAll(async () => closeServer?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
});

test("日历显示可识别日程，同时提示并保留无法展示的记录", async ({ page }) => {
  const before = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("touchCalendarEditor");
    const events = [
      {
        id: "known",
        title: "正常日程",
        start: "2026-11-05",
        end: "2026-11-05",
        description: "",
        color: 0,
        extra: "保留",
      },
      { id: "unknown", title: "无法展示", start: "未来格式", end: "未来格式", extra: { value: 1 } },
    ];
    editor.setContent({ type: "doc", content: [{ type: "semloEditorCalendar", attrs: { events } }] });
    return editor.getSnapshot().json.content![0].attrs!.events;
  });
  await expect(page.getByRole("status").filter({ hasText: "部分日程数据格式不受支持" })).toBeVisible();
  await page.getByRole("button", { name: "日程：正常日程" }).click();
  await page.getByRole("dialog", { name: "编辑日程" }).getByLabel("日程标题").fill("已编辑");
  const after = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("touchCalendarEditor");
    const snapshot = editor.getSnapshot();
    editor.setContent(snapshot.html);
    return {
      html: snapshot.html,
      text: snapshot.text,
      events: editor.getSnapshot().json.content![0].attrs!.events,
    };
  });
  expect(after.events).toEqual([{ ...before[0], title: "已编辑" }, before[1]]);
  expect(after.html).toContain("部分日程数据格式不受支持");
  expect(after.text).toContain("部分日程数据格式不受支持");
  await expect(page.getByRole("status").filter({ hasText: "部分日程数据格式不受支持" })).toBeVisible();
});

test("日历数据不是数组时直接提示且不提供新建操作", async ({ page }) => {
  for (const events of [null, "损坏的日程", { future: ["保留"] }]) {
    const result = await page.evaluate((events) => {
      const editor = window.__semloRequireFixture("touchCalendarEditor");
      editor.setContent({ type: "doc", content: [{ type: "semloEditorCalendar", attrs: { events } }] });
      const before = editor.getSnapshot();
      editor.setContent(before.html);
      return {
        before: before.json.content![0].attrs!.events,
        after: editor.getSnapshot().json.content![0].attrs!.events,
      };
    }, events);
    expect(result.before).toEqual(events);
    expect(result.after).toEqual(events);
    await expect(page.getByRole("status").filter({ hasText: "日程数据格式不受支持" })).toBeVisible();
    await expect(page.locator(".semlo-editor-calendar-add")).toHaveCount(0);
    await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]').click({ position: { x: 20, y: 45 } });
    await expect(page.getByRole("dialog", { name: "添加日程" })).toHaveCount(0);
  }
});

test("日程中的无害扩展属性不会触发损坏提示", async ({ page }) => {
  await page.evaluate(() => {
    window.__semloRequireFixture("touchCalendarEditor").setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCalendar",
          attrs: {
            events: [
              { id: "valid", title: "可见日程", start: "2026-11-05", end: "2026-11-05", extra: { preserved: true } },
            ],
          },
        },
      ],
    });
  });
  await expect(page.getByRole("button", { name: "日程：可见日程" })).toBeVisible();
  await expect(page.locator(".semlo-editor-calendar-payload-warning")).toHaveCount(0);
});
