import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type { EditorController, EditorSnapshot } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    touchCalendarEditor?: EditorController;
    touchCalendarChange?: EditorSnapshot;
  }
}

let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/calendar/calendar-touch-fixture.ts"));
});
afterAll(async () => closeServer?.());

for (const scenario of ["unknown-field", "unrecognized-event"] as const) {
  test(`editing a known event preserves ${scenario} from host JSON`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
    const before = await page.evaluate((kind) => {
      const controller = window.__semloRequireFixture("touchCalendarEditor");
      const known = {
        id: "known",
        title: "有效事项",
        start: "2026-11-05",
        end: "2026-11-05",
        description: "",
        color: 0,
        futureField: { token: "preserve" },
      };
      const unsupported = {
        id: "future",
        title: "未来格式",
        start: "future-date",
        end: "future-date",
        futureField: "preserve",
      };
      const events = kind === "unknown-field" ? [known] : [known, unsupported];
      controller.setContent({ type: "doc", content: [{ type: "semloEditorCalendar", attrs: { events } }] });
      return controller.getSnapshot().json.content![0].attrs!.events;
    }, scenario);
    await page.getByRole("button", { name: "日程：有效事项" }).click();
    await page.getByRole("dialog", { name: "编辑日程" }).getByLabel("日程标题").fill("已修改");
    const after = await page.evaluate(
      () => window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json.content![0].attrs!.events,
    );
    if (scenario === "unknown-field") expect(after[0].futureField).toEqual(before[0].futureField);
    else expect(after[1]).toEqual(before[1]);
  });
}

test("unknown event fields and unrecognized records survive the HTML round trip", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  const result = await page.evaluate(() => {
    const c = window.__semloRequireFixture("touchCalendarEditor");
    const events = [
      {
        id: "known",
        title: "有效事项",
        start: "2026-11-05",
        end: "2026-11-05",
        description: "",
        color: 0,
        futureField: { token: "preserve" },
      },
      { id: "future", title: "未来格式", start: "future-date", end: "future-date", extra: "preserve" },
      { otherType: "future" },
    ];
    c.setContent({ type: "doc", content: [{ type: "semloEditorCalendar", attrs: { events } }] });
    const original = c.getSnapshot();
    c.setContent(original.html);
    return { before: original.json.content![0].attrs!.events, after: c.getSnapshot().json.content![0].attrs!.events };
  });
  expect(result.after).toEqual(result.before);
});

test("deleting a valid event preserves an unrecognized event", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.evaluate(() => {
    const c = window.__semloRequireFixture("touchCalendarEditor");
    c.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCalendar",
          attrs: {
            events: [
              { id: "known", title: "有效事项", start: "2026-11-05", end: "2026-11-05", description: "", color: 0 },
              { id: "future", title: "未来格式", start: "future-date", end: "future-date", extra: "preserve" },
            ],
          },
        },
      ],
    });
  });
  await page.getByRole("button", { name: "日程：有效事项" }).click();
  await page.getByRole("dialog", { name: "编辑日程" }).getByRole("button", { name: "删除日程" }).click();
  const events = await page.evaluate(
    () => window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json.content![0].attrs!.events,
  );
  expect(events).toEqual([
    { id: "future", title: "未来格式", start: "future-date", end: "future-date", extra: "preserve" },
  ]);
});

test("a valid event sharing an ID with an unrecognized event cannot be changed ambiguously", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  const before = await page.evaluate(() => {
    const c = window.__semloRequireFixture("touchCalendarEditor");
    c.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCalendar",
          attrs: {
            events: [
              { id: "same", title: "有效事项", start: "2026-11-05", end: "2026-11-05", description: "", color: 0 },
              { id: "same", title: "未知事项", start: "unknown", end: "unknown", extra: "preserve" },
            ],
          },
        },
      ],
    });
    return c.getSnapshot().json.content![0].attrs!.events;
  });
  await page.getByRole("button", { name: "日程：有效事项" }).click();
  await expect(page.getByRole("alert")).toContainText("日程标识重复");
  await expect(page.getByRole("dialog", { name: "编辑日程" })).toHaveCount(0);
  const after = await page.evaluate(
    () => window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json.content![0].attrs!.events,
  );
  expect(after).toEqual(before);
});

test("new event id allocation also avoids ids on unrecognized records", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.evaluate(() => {
    const c = window.__semloRequireFixture("touchCalendarEditor");
    Math.random = () => 0.5;
    const id = `e${Date.now().toString(36)}${Math.random().toString(36).slice(2)}-0`;
    c.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCalendar",
          attrs: { events: [{ id, title: "未知事项", start: "unknown", end: "unknown", extra: "preserve" }] },
        },
      ],
    });
  });
  await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]').click({ position: { x: 20, y: 45 } });
  await page.getByRole("dialog", { name: "添加日程" }).getByRole("button", { name: "关闭日程" }).click();
  const events = await page.evaluate(
    () => window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json.content![0].attrs!.events,
  );
  expect(events).toHaveLength(2);
  expect(events[0].extra).toBe("preserve");
  expect(new Set(events.map((event: { id: string }) => event.id)).size).toBe(2);
});

test("unknown host fields added during synchronous normalization survive the next edit", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  await page.evaluate(() => {
    const c = window.__semloRequireFixture("touchCalendarEditor");
    let pending = true;
    c.editor.on("update", () => {
      if (!pending) return;
      pending = false;
      const content = c.getSnapshot().json;
      content.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0].futureField = {
        source: "host",
      };
      c.setContent(content);
    });
  });
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("日程标题").fill("第一次");
  await dialog.getByLabel("日程标题").fill("第二次");
  const event = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("touchCalendarEditor")
        .getSnapshot()
        .json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0],
  );
  expect(event.title).toBe("第二次");
  expect(event.futureField).toEqual({ source: "host" });
});
