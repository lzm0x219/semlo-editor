import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type { EditorController, EditorSnapshot } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

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
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/calendar/calendar-touch-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => server.close();
});
afterAll(async () => closeServer?.());

test("unsupported event payload is preserved and event creation is unavailable", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  const before = await page.evaluate(() => {
    const c = window.__semloRequireFixture("touchCalendarEditor");
    c.setContent({
      type: "doc",
      content: [
        { type: "semloEditorCalendar", attrs: { events: { format: "future", records: [{ token: "preserve" }] } } },
      ],
    });
    return c.getSnapshot().json.content![0].attrs!.events;
  });
  await expect(page.getByRole("status")).toContainText("日程数据格式不受支持");
  await expect(page.locator(".semlo-editor-calendar-add")).toHaveCount(0);
  await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]').click({ position: { x: 20, y: 45 } });
  await expect(page.getByRole("status")).toContainText("日程数据格式不受支持");
  await expect(page.getByRole("dialog", { name: "添加日程" })).toHaveCount(0);
  const after = await page.evaluate(
    () => window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json.content![0].attrs!.events,
  );
  expect(after).toEqual(before);
});

test("HTML export and import must not silently replace an unsupported event payload", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  const result = await page.evaluate(() => {
    const c = window.__semloRequireFixture("touchCalendarEditor");
    c.setContent({
      type: "doc",
      content: [
        { type: "semloEditorCalendar", attrs: { events: { format: "future", records: [{ token: "preserve" }] } } },
      ],
    });
    const first = c.getSnapshot();
    c.setContent(first.html);
    return { before: first.json.content![0].attrs!.events, after: c.getSnapshot().json.content![0].attrs!.events };
  });
  expect(result.after).toEqual(result.before);
});

for (const payload of [null, "legacy payload", 7] as const) {
  test(`unsupported ${String(payload)} event payload survives HTML round trip`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
    const result = await page.evaluate((raw) => {
      const c = window.__semloRequireFixture("touchCalendarEditor");
      c.setContent({ type: "doc", content: [{ type: "semloEditorCalendar", attrs: { events: raw } }] });
      const before = c.getSnapshot();
      c.setContent(before.html);
      return {
        original: before.json.content![0].attrs!.events,
        restored: c.getSnapshot().json.content![0].attrs!.events,
      };
    }, payload);
    expect(result.original).toEqual(payload);
    expect(result.restored).toEqual(payload);
  });
}

test("invalid JSON in an HTML data-events attribute is retained as an unsupported string", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  const result = await page.evaluate(() => {
    const c = window.__semloRequireFixture("touchCalendarEditor");
    c.setContent('<div data-semlo-editor-calendar data-events="not-json"></div>');
    const first = c.getSnapshot();
    c.setContent(first.html);
    return { original: first.json.content![0].attrs!.events, restored: c.getSnapshot().json.content![0].attrs!.events };
  });
  expect(result).toEqual({ original: "not-json", restored: "not-json" });
});
