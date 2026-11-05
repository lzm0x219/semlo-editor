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

async function seedDuplicateIds(page: import("@rstest/playwright").Page) {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.evaluate(() => {
    window.__semloRequireFixture("touchCalendarEditor").setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCalendar",
          attrs: {
            events: [
              { id: "same", title: "首个事项", start: "2026-11-04", end: "2026-11-04", description: "", color: 0 },
              { id: "same", title: "第二事项", start: "2026-11-06", end: "2026-11-06", description: "", color: 1 },
            ],
          },
        },
      ],
    });
  });
}

test("duplicate ids: conflicting event opens no editor and keeps all data", async ({ page }) => {
  await seedDuplicateIds(page);
  const before = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json);
  await page.getByRole("button", { name: "日程：第二事项" }).click();
  await expect(page.getByRole("alert")).toContainText("日程标识重复");
  await expect(page.getByRole("dialog", { name: "编辑日程" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("duplicate ids: dragging or clicking cannot delete or alter either event", async ({ page }) => {
  await seedDuplicateIds(page);
  const before = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
  const item = page.getByRole("button", { name: "日程：首个事项" });
  const source = await item.boundingBox();
  const target = await page.locator('[data-date="2026-11-07"]').first().boundingBox();
  if (!source || !target) throw new Error("missing calendar drag targets");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 4 });
  await page.mouse.up();
  await item.click();
  await expect(page.getByRole("alert")).toContainText("日程标识重复");
  const after = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
  expect(after.json.content![0].attrs!.events).toEqual(before.json.content![0].attrs!.events);
  const restored = await page.evaluate((html) => {
    const c = window.__semloRequireFixture("touchCalendarEditor");
    c.setContent(html);
    return c.getSnapshot().json;
  }, before.html);
  expect(restored.content![0].attrs!.events).toEqual(before.json.content![0].attrs!.events);
});

test("duplicate ids do not prevent an unrelated unique event from being edited", async ({ page }) => {
  await seedDuplicateIds(page);
  await page.evaluate(() => {
    const c = window.__semloRequireFixture("touchCalendarEditor");
    const content = c.getSnapshot().json;
    content.content![0].attrs!.events.push({
      id: "unique",
      title: "独立事项",
      start: "2026-11-08",
      end: "2026-11-08",
      description: "",
      color: 0,
    });
    c.setContent(content);
  });
  await page.getByRole("button", { name: "日程：独立事项" }).click();
  await page.getByRole("dialog", { name: "编辑日程" }).getByLabel("日程标题").fill("独立修改");
  const events = await page.evaluate(
    () => window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json.content![0].attrs!.events,
  );
  expect(events.map((item: { title: string }) => item.title)).toEqual(["首个事项", "第二事项", "独立修改"]);
});

test("a new event cannot reuse an existing id even when clock and random values collide", async ({ page }) => {
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
          attrs: {
            events: [{ id, title: "已有事项", start: "2026-11-04", end: "2026-11-04", description: "", color: 0 }],
          },
        },
      ],
    });
  });
  await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]').click({ position: { x: 20, y: 45 } });
  const dialog = page.getByRole("dialog", { name: "添加日程" });
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  const events = await page.evaluate(
    () => window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json.content![0].attrs!.events,
  );
  expect(events).toHaveLength(2);
  expect(events[0].title).toBe("已有事项");
  expect(new Set(events.map((event: { id: string }) => event.id)).size).toBe(2);
});

test("an external same-id insertion after the new-event popup opens is not overwritten by that popup", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]').click({ position: { x: 20, y: 45 } });
  const dialog = page.getByRole("dialog", { name: "添加日程" });
  const result = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("touchCalendarEditor");
    const staleTitle = document.querySelector<HTMLTextAreaElement>('[aria-label="日程标题"]')!;
    const content = controller.getSnapshot().json;
    const calendar = content.content!.find((node) => node.type === "semloEditorCalendar")!;
    const draft = calendar.attrs!.events.find((event: { start: string }) => event.start === "2026-11-02");
    const foreign = { ...draft, title: "外部同 ID 日程", start: "2026-11-06", end: "2026-11-06" };
    calendar.attrs!.events.push(foreign);
    controller.setContent(content);
    staleTitle.value = "过期草稿";
    staleTitle.dispatchEvent(new Event("input", { bubbles: true }));
    return controller.getSnapshot().json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
  });
  await expect(dialog).toHaveCount(0);
  expect(result.filter((event: { title: string }) => event.title === "外部同 ID 日程")).toHaveLength(1);
  expect(result.some((event: { title: string }) => event.title === "过期草稿")).toBe(false);
});

test("an externally deleted existing event is not reinserted by its stale popup", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  const result = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("touchCalendarEditor");
    const staleTitle = document.querySelector<HTMLTextAreaElement>('[aria-label="日程标题"]')!;
    const content = controller.getSnapshot().json;
    content.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events = [];
    controller.setContent(content);
    staleTitle.value = "过期草稿";
    staleTitle.dispatchEvent(new Event("input", { bubbles: true }));
    return controller.getSnapshot().json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
  });
  await expect(dialog).toHaveCount(0);
  expect(result).toEqual([]);
});

test("a host inserting a same-id event during new-event onChange cannot have its event overwritten", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("touchCalendarEditor");
    let pending = true;
    controller.editor.on("update", () => {
      if (!pending) return;
      const content = controller.getSnapshot().json;
      const events = content.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
      const draft = events.find((event: { start: string }) => event.start === "2026-11-02");
      if (!draft) return;
      pending = false;
      events.push({ ...draft, title: "同步插入的外部事项", start: "2026-11-06", end: "2026-11-06" });
      controller.setContent(content);
    });
  });
  await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]').click({ position: { x: 20, y: 45 } });
  const dialog = page.getByRole("dialog", { name: "添加日程" });
  await expect(dialog).toHaveCount(0);
  const events = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("touchCalendarEditor")
        .getSnapshot()
        .json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events,
  );
  expect(events.filter((event: { title: string }) => event.title === "同步插入的外部事项")).toHaveLength(1);
  expect(events.some((event: { title: string }) => event.title === "尝试覆盖")).toBe(false);
});

test("a host deleting an event during its update does not let the popup recreate it", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("touchCalendarEditor");
    let pending = true;
    controller.editor.on("update", () => {
      if (!pending) return;
      pending = false;
      const content = controller.getSnapshot().json;
      content.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events = [];
      controller.setContent(content);
    });
  });
  await dialog.getByLabel("日程标题").fill("触发宿主删除");
  await expect(dialog).toHaveCount(0);
  const events = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("touchCalendarEditor")
        .getSnapshot()
        .json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events,
  );
  expect(events).toEqual([]);
});

test("a host replacing the just-created draft with its own sole same-id event cannot be overwritten", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("touchCalendarEditor");
    let pending = true;
    controller.editor.on("update", () => {
      if (!pending) return;
      const content = controller.getSnapshot().json;
      const calendar = content.content!.find((node) => node.type === "semloEditorCalendar")!;
      const events = calendar.attrs!.events;
      const draft = events.find((event: { start: string }) => event.start === "2026-11-02");
      if (!draft) return;
      pending = false;
      calendar.attrs!.events = [{ ...draft, title: "唯一外部事项", start: "2026-11-06", end: "2026-11-06" }];
      controller.setContent(content);
    });
  });
  await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]').click({ position: { x: 20, y: 45 } });
  const dialog = page.getByRole("dialog", { name: "添加日程" });
  if (await dialog.count()) await dialog.getByLabel("日程标题").fill("过期草稿");
  const events = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("touchCalendarEditor")
        .getSnapshot()
        .json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events,
  );
  expect(events).toHaveLength(1);
  expect(events[0].title).toBe("唯一外部事项");
});

for (const echo of ["equal", "normalized"] as const) {
  test(`new event host ${echo} echo preserves host data and uses a safe popup state`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
    await page.evaluate((mode) => {
      const controller = window.__semloRequireFixture("touchCalendarEditor");
      let pending = true;
      controller.editor.on("update", () => {
        if (!pending) return;
        const content = controller.getSnapshot().json;
        const events = content.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
        const draft = events.find((event: { start: string }) => event.start === "2026-11-02");
        if (!draft) return;
        pending = false;
        if (mode === "normalized") draft.description = "宿主规范化";
        controller.setContent(content);
      });
    }, echo);
    await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]').click({ position: { x: 20, y: 45 } });
    const dialog = page.getByRole("dialog", { name: "添加日程" });
    if (echo === "equal") await expect(dialog).toBeVisible();
    else await expect(dialog).toHaveCount(0);
    const events = await page.evaluate(
      () =>
        window
          .__semloRequireFixture("touchCalendarEditor")
          .getSnapshot()
          .json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events,
    );
    const saved = events.find((event: { start: string }) => event.start === "2026-11-02");
    expect(saved.description).toBe(echo === "equal" ? "" : "宿主规范化");
  });
}
