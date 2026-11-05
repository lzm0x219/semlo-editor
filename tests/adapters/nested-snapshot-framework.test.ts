import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type { SnapshotFramework } from "../fixtures/contracts/nested-snapshot-framework-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

type CalendarEvent = { id: string; title: string; start: string; end: string; description: string; color: number };

const initialEvents: CalendarEvent[] = [
  { id: "first", title: "原始日程", start: "2026-11-05", end: "2026-11-05", description: "初始说明", color: 0 },
  { id: "second", title: "第二日程", start: "2026-11-06", end: "2026-11-06", description: "第二说明", color: 1 },
];
const hostEvent: CalendarEvent = {
  id: "host",
  title: "宿主新增",
  start: "2026-11-07",
  end: "2026-11-07",
  description: "宿主说明",
  color: 2,
};

let origin: string;
let closeServer: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/contracts/nested-snapshot-framework-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": "./packages/core/src/index.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => server.close();
});
afterAll(async () => closeServer?.());

async function settle(page: Page) {
  await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").settle());
}

async function mount(page: Page, framework: SnapshotFramework, pageErrors: string[]) {
  try {
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function", null, { timeout: 5_000 });
  } catch {
    throw new Error(
      `Fixture did not load: ${JSON.stringify(pageErrors)}; page: ${(await page.content()).slice(0, 1200)}`,
    );
  }
  await page.evaluate((name) => window.__semloRequireFixture("mountNestedSnapshotFixture")(name), framework);
  await settle(page);
}

// Read the live ProseMirror node, not a second API snapshot, so an accidentally
// shared event object cannot be hidden by serializing or rebuilding the view.
async function liveEvents(page: Page): Promise<CalendarEvent[]> {
  return page.evaluate(() => {
    let events: unknown;
    window.__semloRequireFixture("nestedSnapshotFixture").controller.editor.state.doc.descendants((node) => {
      if (node.type.name === "semloEditorCalendar") events = node.attrs.events;
    });
    if (!events) throw new Error("Missing calendar node");
    return JSON.parse(JSON.stringify(events)) as CalendarEvent[];
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: calendar snapshots are isolated and controlled writes/echoes update once`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await mount(page, framework, pageErrors);
    const host = page.locator("#nested-snapshot-fixture");
    const originalEvent = host.getByRole("button", { name: "日程：原始日程" }).first();
    const secondEvent = host.getByRole("button", { name: "日程：第二日程" }).first();
    await expect(originalEvent).toBeVisible();
    await expect(secondEvent).toBeVisible();
    expect(await liveEvents(page)).toEqual(initialEvents);

    // Mutate both objects and the containing array returned by getSnapshot.
    await page.evaluate(() => {
      const snapshot = window.__semloRequireFixture("nestedSnapshotFixture").controller.getSnapshot();
      const events = snapshot.json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
      events[0].title = "快照篡改";
      events[1].description = "快照篡改说明";
      events.splice(1, 1);
      events.push({
        id: "ghost",
        title: "快照新增",
        start: "2026-11-07",
        end: "2026-11-07",
        description: "",
        color: 0,
      });
    });
    await settle(page);
    expect(await liveEvents(page)).toEqual(initialEvents);
    await expect(originalEvent).toBeVisible();
    await expect(secondEvent).toBeVisible();
    await expect(host.getByRole("button", { name: "日程：快照新增" })).toHaveCount(0);

    // Trigger a real editor event, then mutate its onChange snapshot without
    // placing it in controlled state.
    await originalEvent.click();
    const dialog = page.getByRole("dialog", { name: "编辑日程" });
    await dialog.getByLabel("日程标题").fill("用户编辑");
    await dialog.getByRole("button", { name: "关闭日程" }).click();
    await settle(page);
    await expect(host.getByRole("button", { name: "日程：用户编辑" }).first()).toBeVisible();
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(1);
    const userEvents = [{ ...initialEvents[0], title: "用户编辑" }, initialEvents[1]];
    expect(await liveEvents(page)).toEqual(userEvents);
    await page.evaluate(() => {
      const snapshot = window.__semloRequireFixture("nestedSnapshotFixture").changes.at(-1);
      if (!snapshot) throw new Error("Missing onChange snapshot");
      const events = snapshot.json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
      events[0].title = "回调篡改";
      events[1].description = "回调篡改说明";
      events.splice(1, 1);
      events.push({
        id: "ghost",
        title: "回调新增",
        start: "2026-11-07",
        end: "2026-11-07",
        description: "",
        color: 0,
      });
    });
    await settle(page);
    expect(await liveEvents(page)).toEqual(userEvents);
    await expect(host.getByRole("button", { name: "日程：用户编辑" }).first()).toBeVisible();
    await expect(secondEvent).toBeVisible();
    await expect(host.getByRole("button", { name: "日程：回调新增" })).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(1);

    // Only this explicit setContent / controlled-prop write commits changes.
    const beforeWrite = await page.evaluate(
      () => window.__semloRequireFixture("nestedSnapshotFixture").documentChanges,
    );
    await page.evaluate((newEvent) => {
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      const json = fixture.controller.getSnapshot().json;
      const events = json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
      events[0].title = "宿主回写";
      events[1].description = "宿主更新说明";
      events.push(newEvent);
      fixture.setContent(json);
    }, hostEvent);
    await expect(host.getByRole("button", { name: "日程：宿主回写" }).first()).toBeVisible();
    await expect(host.getByRole("button", { name: "日程：宿主新增" }).first()).toBeVisible();
    await settle(page);
    const writtenEvents = [
      { ...initialEvents[0], title: "宿主回写" },
      { ...initialEvents[1], description: "宿主更新说明" },
      hostEvent,
    ];
    expect(await liveEvents(page)).toEqual(writtenEvents);
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").documentChanges)).toBe(
      beforeWrite + 1,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(1);

    // A normal onChange echo must not rebuild the node view or duplicate the
    // event; the event editor remains open and its input retains focus.
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").setEcho(true));
    await host.getByRole("button", { name: "日程：宿主回写" }).first().click();
    const echoedDialog = page.getByRole("dialog", { name: "编辑日程" });
    const title = echoedDialog.getByLabel("日程标题");
    await title.fill("受控回写");
    await settle(page);
    await expect(echoedDialog).toBeVisible();
    await expect(title).toBeFocused();
    await expect(title).toHaveValue("受控回写");
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(2);
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").documentChanges)).toBe(
      beforeWrite + 2,
    );
    expect(await liveEvents(page)).toEqual([{ ...writtenEvents[0], title: "受控回写" }, ...writtenEvents.slice(1)]);
    await echoedDialog.getByRole("button", { name: "关闭日程" }).click();

    // Exercise the same public controlled entry for JSON and HTML restoration.
    const saved = await page.evaluate(() =>
      window.__semloRequireFixture("nestedSnapshotFixture").controller.getSnapshot(),
    );
    expect(saved.html).toContain("data-semlo-editor-calendar");
    for (const content of [saved.json, saved.html]) {
      await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").setContent("<p>临时替换</p>"));
      await settle(page);
      await expect(host.locator(".semlo-editor-prose")).toContainText("临时替换");
      await page.evaluate((value) => window.__semloRequireFixture("nestedSnapshotFixture").setContent(value), content);
      await expect(host.getByRole("button", { name: "日程：受控回写" }).first()).toBeVisible();
      await settle(page);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").controller.getSnapshot().json),
      ).toEqual(saved.json);
    }
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(2);
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").errors)).toEqual([]);
    expect(pageErrors).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
  });
}

// Keep Vue's reactive-input failure modes independent: if getSnapshot fails,
// the main integration test cannot reach onChange or a controlled replacement.
test("vue reactive calendar can produce an onChange snapshot after a real event edit", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await mount(page, "vue", pageErrors);
  const host = page.locator("#nested-snapshot-fixture");
  await host.getByRole("button", { name: "日程：原始日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("日程标题").fill("响应式编辑");
  await settle(page);
  expect((await liveEvents(page))[0].title).toBe("响应式编辑");
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(1);
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireFixture("nestedSnapshotFixture")
          .changes[0].json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0].title,
    ),
  ).toBe("响应式编辑");
  await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
});

test("vue reactive calendar allows onChange while editing a neighboring paragraph", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await mount(page, "vue", pageErrors);
  const paragraph = page.locator("#nested-snapshot-fixture .semlo-editor-prose > p").first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("输入");
  await settle(page);
  await expect(paragraph).toContainText("日历之前输入");
  expect(await liveEvents(page)).toEqual(initialEvents);
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
});

test("vue reactive controlled replacement updates the calendar and remains snapshotable", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await mount(page, "vue", pageErrors);
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
    // Diagnostic only: if getSnapshot itself throws, still independently
    // exercise a real Vue-controlled content replacement.
    const json = JSON.parse(JSON.stringify(fixture.controller.editor.getJSON()));
    json.content.find((node: { type: string }) => node.type === "semloEditorCalendar").attrs.events[0].title =
      "响应式回写";
    fixture.setContent(json);
  });
  const host = page.locator("#nested-snapshot-fixture");
  await expect(host.getByRole("button", { name: "日程：响应式回写" }).first()).toBeVisible();
  await settle(page);
  expect((await liveEvents(page))[0].title).toBe("响应式回写");
  expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").documentChanges)).toBe(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(0);
  const snapshot = await page.evaluate(() =>
    window.__semloRequireFixture("nestedSnapshotFixture").controller.getSnapshot(),
  );
  expect(snapshot.json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0].title).toBe(
    "响应式回写",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").errors)).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
});

test("vue reactive calendar allows paragraph onChange after a controlled replacement", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await mount(page, "vue", pageErrors);
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
    // A plain host value enters the deeply reactive Vue content state.
    const json = JSON.parse(JSON.stringify(fixture.controller.editor.getJSON()));
    json.content.find((node: { type: string }) => node.type === "semloEditorCalendar").attrs.events[0].title =
      "响应式回写";
    fixture.setContent(json);
  });
  const host = page.locator("#nested-snapshot-fixture");
  await expect(host.getByRole("button", { name: "日程：响应式回写" }).first()).toBeVisible();
  await settle(page);
  const paragraph = host.locator(".semlo-editor-prose > p").first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("输入");
  await settle(page);
  await expect(paragraph).toContainText("日历之前输入");
  expect((await liveEvents(page))[0].title).toBe("响应式回写");
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
});
