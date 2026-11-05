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

test("snapshots and change callbacks isolate nested calendar events from the editor", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  const initial = await page.evaluate(() => {
    const snapshot = window.__semloRequireFixture("touchCalendarEditor").getSnapshot();
    const events = snapshot.json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
    events[0].title = "宿主修改快照";
    events.push({ id: "new", title: "额外日程", start: "2026-11-08", end: "2026-11-08", description: "", color: 0 });
    return window
      .__semloRequireFixture("touchCalendarEditor")
      .getSnapshot()
      .json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
  });
  expect(initial).toHaveLength(1);
  expect(initial[0].title).toBe("日程");
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("日程标题").fill("用户编辑");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  const unchanged = await page.evaluate(() => {
    const events = window
      .__semloRequireFixture("touchCalendarChange")
      .json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
    events[0].title = "回调里修改";
    events.splice(0, 1);
    return window
      .__semloRequireFixture("touchCalendarEditor")
      .getSnapshot()
      .json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events;
  });
  expect(unchanged).toHaveLength(1);
  expect(unchanged[0].title).toBe("用户编辑");
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("touchCalendarEditor");
    const next = controller.getSnapshot().json;
    next.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0].title = "宿主保存";
    controller.setContent(next);
  });
  await expect(page.getByRole("button", { name: "日程：宿主保存" }).first()).toBeVisible();
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
  for (const value of [snapshot.json, snapshot.html]) {
    const result = await page.evaluate((content) => {
      window.__semloRequireFixture("touchCalendarEditor").setContent(content);
      return window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json;
    }, value);
    expect(result).toEqual(snapshot.json);
  }
});
afterAll(async () => closeServer?.());

test("an external calendar update closes a stale event editor without overwriting it", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("touchCalendarEditor");
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorCalendar") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const events = node.attrs.events.map((event: { title: string }) => ({ ...event, title: "外部更新" }));
    editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, events }));
  });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "日程：外部更新" }).first()).toBeVisible();
});

test("Escape closes the date range and its event editor together", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const eventEditor = page.getByRole("dialog", { name: "编辑日程" });
  await eventEditor.getByLabel("开始日期").click();
  await expect(page.getByRole("dialog", { name: "选择日程日期范围" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(eventEditor).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "选择日程日期范围" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "日程：日程" }).first()).toBeVisible();
});

test("Escape closes the color menu and its event editor together", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const eventEditor = page.getByRole("dialog", { name: "编辑日程" });
  await eventEditor.getByRole("button", { name: "选择颜色" }).click();
  await expect(eventEditor.getByRole("listbox", { name: "颜色选项" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(eventEditor).toHaveCount(0);
  await expect(page.getByRole("button", { name: "日程：日程" }).first()).toBeVisible();
});

test("touch drag moves a cross-week event and can be undone, redone and saved", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1200, height: 900 } });
  const touchPage = await context.newPage();
  await installFixtureGuards(touchPage);
  try {
    await touchPage.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await touchPage.goto(origin);
    await touchPage.waitForFunction(() => Boolean(window.touchCalendarEditor));
    const root = touchPage.locator(".semlo-editor-calendar-node");
    const event = root.locator('.semlo-editor-calendar-event[data-date="2026-11-05"]');
    const fromCell = root.locator('.semlo-editor-calendar-cell[data-date="2026-11-06"]');
    const target = root.locator('.semlo-editor-calendar-cell[data-date="2026-11-10"]');
    const [eventBox, from, to] = await Promise.all([event.boundingBox(), fromCell.boundingBox(), target.boundingBox()]);
    if (!eventBox || !from || !to) throw new Error("Missing calendar geometry");
    const client = await context.newCDPSession(touchPage);
    const x = from.x + from.width / 2;
    const y = eventBox.y + eventBox.height / 2;
    const tx = to.x + to.width / 2;
    const ty = to.y + to.height / 2;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + ((tx - x) * i) / 8, y: y + ((ty - y) * i) / 8 }],
      });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const dates = () =>
      touchPage.evaluate(() => {
        const event = window
          .__semloRequireFixture("touchCalendarEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorCalendar")?.attrs?.events[0];
        return [event.start, event.end];
      });
    expect(await dates()).toEqual(["2026-11-09", "2026-11-18"]);
    await expect(touchPage.getByRole("dialog", { name: "编辑日程" })).toHaveCount(0);
    await touchPage.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.commands.undo());
    expect(await dates()).toEqual(["2026-11-05", "2026-11-14"]);
    await touchPage.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.commands.redo());
    expect(await dates()).toEqual(["2026-11-09", "2026-11-18"]);
    const edge = root.locator('.semlo-editor-calendar-event[data-date="2026-11-15"] [data-calendar-edge="end"]');
    const resizeTarget = root.locator('.semlo-editor-calendar-cell[data-date="2026-11-21"]');
    const [edgeBox, targetBox] = await Promise.all([edge.boundingBox(), resizeTarget.boundingBox()]);
    if (!edgeBox || !targetBox) throw new Error("Missing resize geometry");
    const sx = edgeBox.x + edgeBox.width / 2;
    const sy = edgeBox.y + edgeBox.height / 2;
    const ex = targetBox.x + targetBox.width / 2;
    const ey = targetBox.y + targetBox.height / 2;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy }] });
    for (let i = 1; i <= 8; i++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: sx + ((ex - sx) * i) / 8, y: sy + ((ey - sy) * i) / 8 }],
      });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await dates()).toEqual(["2026-11-09", "2026-11-21"]);
    await touchPage.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.commands.undo());
    expect(await dates()).toEqual(["2026-11-09", "2026-11-18"]);
    await touchPage.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.commands.redo());
    expect(await dates()).toEqual(["2026-11-09", "2026-11-21"]);
    const snapshot = await touchPage.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
    for (const value of [snapshot.json, snapshot.html]) {
      const restored = await touchPage.evaluate((content) => {
        window.__semloRequireFixture("touchCalendarEditor").setContent(content);
        return window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json;
      }, value);
      expect(restored).toEqual(snapshot.json);
    }
  } finally {
    await context.close();
  }
});

test("clearing an existing event title keeps the event; a replacement remains editable and undoable", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  const event = page.getByRole("button", { name: "日程：日程" }).first();
  await event.click();
  let dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("日程标题").fill("");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  const empty = page.getByRole("button", { name: "日程：添加日程标题" }).first();
  await expect(empty).toBeVisible();
  const blank = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
  for (const value of [blank.json, blank.html]) {
    const restored = await page.evaluate((content) => {
      window.__semloRequireFixture("touchCalendarEditor").setContent(content);
      return window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json;
    }, value);
    expect(restored).toEqual(blank.json);
  }
  await empty.click();
  dialog = page.getByRole("dialog", { name: "编辑日程" });
  await expect(dialog.getByLabel("日程标题")).toHaveValue("");
  await dialog.getByLabel("日程标题").fill("新日程");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  await expect(page.getByRole("button", { name: "日程：新日程" }).first()).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(empty).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.commands.redo())).toBe(
    true,
  );
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
  for (const value of [snapshot.json, snapshot.html]) {
    const restored = await page.evaluate((content) => {
      window.__semloRequireFixture("touchCalendarEditor").setContent(content);
      return window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json;
    }, value);
    expect(restored).toEqual(snapshot.json);
  }
});

test("a new untitled event is saved and can acquire a description", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  const cell = page.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]');
  await cell.click({ position: { x: 20, y: 45 } });
  let dialog = page.getByRole("dialog", { name: "添加日程" });
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  const event = page.getByRole("button", { name: "日程：添加日程标题" });
  await expect(event).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(event).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(event).toBeVisible();
  await event.click();
  dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("日程说明").fill("只有说明");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  await expect(event).toBeVisible();
  await expect(event).toHaveCSS("--semlo-editor-calendar-event-color", "#d22d8d");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
  for (const content of [snapshot.json, snapshot.html]) {
    const restored = await page.evaluate((value) => {
      window.__semloRequireFixture("touchCalendarEditor").setContent(value);
      return window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json;
    }, content);
    expect(restored).toEqual(snapshot.json);
  }
  await event.click();
  await expect(page.getByRole("dialog", { name: "编辑日程" }).getByLabel("日程说明")).toHaveValue("只有说明");
  await page.getByRole("dialog", { name: "编辑日程" }).getByRole("button", { name: "关闭日程" }).click();
  await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-03"]').click({ position: { x: 20, y: 45 } });
  const third = page.getByRole("dialog", { name: "添加日程" });
  await third.getByLabel("日程说明").fill("第三项");
  await third.getByRole("button", { name: "关闭日程" }).click();
  await expect(page.getByRole("button", { name: "日程：添加日程标题" }).last()).toHaveCSS(
    "--semlo-editor-calendar-event-color",
    "#74b602",
  );
});

test("calendar uses the observed six colors and preserves colors from older documents", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  let dialog = page.getByRole("dialog", { name: "编辑日程" });
  const color = dialog.getByLabel("日程颜色");
  await expect(color.locator("option:not([hidden])")).toHaveText(["蓝色", "玫红色", "绿色", "红色", "紫色", "黄色"]);
  await dialog.getByRole("button", { name: "选择颜色" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("option", { name: "蓝色" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("option", { name: "玫红色" })).toBeFocused();
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  await expect(page.getByRole("button", { name: "日程：日程" }).first()).toHaveCSS(
    "--semlo-editor-calendar-event-color",
    "#d22d8d",
  );
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
  for (const value of [snapshot.json, snapshot.html]) {
    const restored = await page.evaluate((content) => {
      window.__semloRequireFixture("touchCalendarEditor").setContent(content);
      return window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json;
    }, value);
    expect(restored).toEqual(snapshot.json);
  }
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("touchCalendarEditor");
    const content = structuredClone(controller.getSnapshot().json);
    const calendar = content.content!.find((node) => node.type === "semloEditorCalendar")!;
    calendar.attrs!.events[0].color = 2;
    controller.setContent(content);
  });
  const legacy = page.getByRole("button", { name: "日程：日程" }).first();
  await expect(legacy).toHaveCSS("--semlo-editor-calendar-event-color", "#e9a23b");
  await legacy.click();
  dialog = page.getByRole("dialog", { name: "编辑日程" });
  await expect(dialog.getByLabel("日程颜色")).toHaveValue("2");
  await expect(dialog.getByLabel("日程颜色").locator("option:not([hidden])").last()).toHaveText("橙色");
  await dialog.getByLabel("日程颜色").selectOption("1");
  await expect(dialog.getByLabel("日程颜色")).toHaveValue("1");
});

test("calendar color selection remains usable with a mouse and keyboard after selection", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  const event = page.getByRole("button", { name: "日程：日程" }).first();
  await event.click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  const color = dialog.getByRole("button", { name: "选择颜色" });
  await color.click();
  await dialog.getByRole("option", { name: "绿色" }).click();
  await expect(event).toHaveCSS("--semlo-editor-calendar-event-color", "#74b602");
  await expect(color).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("option", { name: "绿色" })).toBeFocused();
});

for (const key of ["Enter", "Shift+Enter"]) {
  test(`${key} closes the calendar title editor without inserting a newline`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
    await page.getByRole("button", { name: "日程：日程" }).first().click();
    const dialog = page.getByRole("dialog", { name: "编辑日程" });
    const title = dialog.getByLabel("日程标题");
    await title.fill("测试标题");
    await title.evaluate((element) =>
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })),
    );
    await expect(dialog).toBeVisible();
    await title.press(key);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "日程：测试标题" }).first()).toBeVisible();
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
    expect(snapshot.json.content?.find((node) => node.type === "semloEditorCalendar")?.attrs?.events[0].title).toBe(
      "测试标题",
    );
  });
}

for (const key of ["Enter", "Shift+Enter"]) {
  test(`${key} closes the calendar description editor without inserting a newline`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
    await page.getByRole("button", { name: "日程：日程" }).first().click();
    const dialog = page.getByRole("dialog", { name: "编辑日程" });
    const description = dialog.getByLabel("日程说明");
    await description.fill("第一行");
    await description.evaluate((element) =>
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })),
    );
    await expect(dialog).toBeVisible();
    await description.press(key);
    await expect(dialog).toHaveCount(0);
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
    expect(
      snapshot.json.content?.find((node) => node.type === "semloEditorCalendar")?.attrs?.events[0].description,
    ).toBe("第一行");
  });
}

test("Tab moves between the calendar title and start date", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("日程标题").focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("开始日期")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByLabel("日程标题")).toBeFocused();
});

test("Tab closes the calendar description while Shift+Tab moves to the end date", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  const description = dialog.getByLabel("日程说明");
  await description.fill("测试说明");
  await description.press("Shift+Tab");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("结束日期")).toBeFocused();
  await description.focus();
  await description.press("Tab");
  await expect(dialog).toHaveCount(0);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
  expect(snapshot.json.content?.find((node) => node.type === "semloEditorCalendar")?.attrs?.events[0].description).toBe(
    "测试说明",
  );
});

test("deleting an event does not rewind the default color sequence, including after HTML restore", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]').click({ position: { x: 20, y: 45 } });
  await page.getByRole("dialog", { name: "添加日程" }).getByRole("button", { name: "关闭日程" }).click();
  let event = page.getByRole("button", { name: "日程：添加日程标题" });
  await expect(event).toHaveCSS("--semlo-editor-calendar-event-color", "#d22d8d");
  await event.click();
  await page.getByRole("button", { name: "删除日程" }).click();
  await expect(event).toHaveCount(0);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
  await page.evaluate((html) => window.__semloRequireFixture("touchCalendarEditor").setContent(html), snapshot.html);
  expect((await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot())).json).toEqual(
    snapshot.json,
  );
  await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-03"]').click({ position: { x: 20, y: 45 } });
  await page.getByRole("dialog", { name: "添加日程" }).getByRole("button", { name: "关闭日程" }).click();
  event = page.getByRole("button", { name: "日程：添加日程标题" });
  await expect(event).toHaveCSS("--semlo-editor-calendar-event-color", "#74b602");
});

test("calendar date range uses two months and commits only after choosing both endpoints", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const event = page.getByRole("dialog", { name: "编辑日程" });
  await event.getByLabel("开始日期").click();
  let picker = page.getByRole("dialog", { name: "选择日程日期范围" });
  await expect(picker).toContainText("2026年 Nov");
  await expect(picker).toContainText("2026年 Dec");
  await picker.getByRole("button", { name: "2026-11-20", exact: true }).first().click();
  await expect(event.getByLabel("开始日期")).toHaveValue("2026-11-20");
  await expect(event.getByLabel("结束日期")).toHaveValue("");
  await expect(picker.getByRole("button", { name: "2026-11-10", exact: true }).first()).toBeDisabled();
  await expect(picker.getByRole("button", { name: "2026-11-20", exact: true }).first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(event).toHaveCount(0);
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  await expect(event.getByLabel("开始日期")).toHaveValue("2026-11-05");
  await expect(event.getByLabel("结束日期")).toHaveValue("2026-11-14");
  await event.getByLabel("开始日期").click();
  picker = page.getByRole("dialog", { name: "选择日程日期范围" });
  await picker.getByRole("button", { name: "2026-11-10", exact: true }).first().click();
  await picker.getByRole("button", { name: "2026-11-18", exact: true }).first().click();
  await expect(picker).toHaveCount(0);
  await expect(event.getByLabel("开始日期")).toHaveValue("2026-11-10");
  await expect(event.getByLabel("结束日期")).toHaveValue("2026-11-18");
  await event.getByRole("button", { name: "关闭日程" }).click();
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").getSnapshot());
  const saved = snapshot.json.content?.find((node) => node.type === "semloEditorCalendar")?.attrs?.events[0];
  expect([saved.start, saved.end]).toEqual(["2026-11-10", "2026-11-18"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.commands.undo())).toBe(
    true,
  );
  const previous = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("touchCalendarEditor")
        .getSnapshot()
        .json.content?.find((node) => node.type === "semloEditorCalendar")?.attrs?.events[0],
  );
  expect([previous.start, previous.end]).toEqual(["2026-11-05", "2026-11-14"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.commands.redo())).toBe(
    true,
  );
  for (const content of [snapshot.json, snapshot.html]) {
    const restored = await page.evaluate((value) => {
      window.__semloRequireFixture("touchCalendarEditor").setContent(value);
      return window.__semloRequireFixture("touchCalendarEditor").getSnapshot().json;
    }, content);
    expect(restored).toEqual(snapshot.json);
  }
});

test("typed range dates are validated and committed with Enter", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const event = page.getByRole("dialog", { name: "编辑日程" });
  const start = event.getByLabel("开始日期");
  const end = event.getByLabel("结束日期");
  await start.click();
  await start.fill("2026-11-12");
  await start.press("Enter");
  await expect(end).toBeFocused();
  await expect(end).toHaveValue("");
  await end.fill("2026-11-10");
  await end.press("Enter");
  await expect(page.getByRole("dialog", { name: "选择日程日期范围" })).toBeVisible();
  await end.fill("2026-11-19");
  await end.press("Enter");
  await expect(page.getByRole("dialog", { name: "选择日程日期范围" })).toHaveCount(0);
  await expect(start).toHaveValue("2026-11-12");
  await expect(end).toHaveValue("2026-11-19");
});

test("a composing Enter does not advance the calendar date range", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const event = page.getByRole("dialog", { name: "编辑日程" });
  const start = event.getByLabel("开始日期");
  const end = event.getByLabel("结束日期");
  await start.click();
  await start.fill("2026-11-12");
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    await start.evaluate(
      (element, init) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...init })),
      init,
    );
    await expect(start).toBeFocused();
    await expect(end).toHaveValue("2026-11-14");
  }
  await start.press("Enter");
  await expect(end).toBeFocused();
  await expect(end).toHaveValue("");
});

test("choosing an end date directly preserves the existing start date", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const event = page.getByRole("dialog", { name: "编辑日程" });
  await event.getByLabel("结束日期").click();
  const picker = page.getByRole("dialog", { name: "选择日程日期范围" });
  await expect(picker.getByRole("button", { name: "2026-11-04", exact: true }).first()).toBeDisabled();
  await picker.getByRole("button", { name: "2026-11-18", exact: true }).first().click();
  await expect(picker).toHaveCount(0);
  await expect(event.getByLabel("开始日期")).toHaveValue("2026-11-05");
  await expect(event.getByLabel("结束日期")).toHaveValue("2026-11-18");
});

test("month and year navigation do not commit the event range", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const event = page.getByRole("dialog", { name: "编辑日程" });
  await event.getByLabel("开始日期").click();
  const picker = page.getByRole("dialog", { name: "选择日程日期范围" });
  await picker.getByRole("button", { name: "选择11月", exact: true }).click();
  await picker.getByRole("button", { name: "选择年份", exact: true }).click();
  await picker.getByRole("button", { name: "选择2024年", exact: true }).click();
  await picker.getByRole("button", { name: "选择2月", exact: true }).click();
  await expect(picker).toContainText("2024年 Feb");
  await expect(picker).toContainText("2024年 Mar");
  await expect(event.getByLabel("开始日期")).toHaveValue("2026-11-05");
  await expect(event.getByLabel("结束日期")).toHaveValue("2026-11-14");
  await page.keyboard.press("Escape");
  const saved = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("touchCalendarEditor")
        .getSnapshot()
        .json.content?.find((node) => node.type === "semloEditorCalendar")?.attrs?.events[0],
  );
  expect([saved.start, saved.end]).toEqual(["2026-11-05", "2026-11-14"]);
});

test("date range stays within a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 230, height: 700 });
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.locator(".semlo-editor").evaluate((node) => {
    node.parentElement!.style.width = "100%";
  });
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const event = page.getByRole("dialog", { name: "编辑日程" });
  await event.getByLabel("开始日期").click();
  const picker = page.getByRole("dialog", { name: "选择日程日期范围" });
  const box = await picker.boundingBox();
  if (!box) throw new Error("Missing date range geometry");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(230);
  expect(box.y + box.height).toBeLessThanOrEqual(700);
  await picker.getByRole("button", { name: "2026-11-10", exact: true }).first().click();
  await picker.getByRole("button", { name: "2026-11-18", exact: true }).first().click();
  await expect(event.getByLabel("结束日期")).toHaveValue("2026-11-18");
});

for (const width of [1400, 600]) {
  test(`event editor chooses an observed horizontal placement at viewport width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
    if (width === 600) {
      await page.locator(".semlo-editor").evaluate((node) => {
        node.parentElement!.style.width = "100%";
      });
    }
    const event = page.getByRole("button", { name: "日程：日程" }).first();
    await event.click();
    const [anchor, popup] = await Promise.all([
      event.boundingBox(),
      page.getByRole("dialog", { name: "编辑日程" }).boundingBox(),
    ]);
    if (!anchor || !popup) throw new Error("Missing event or popup geometry");
    expect(popup.x).toBeGreaterThanOrEqual(8);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width - 8);
    if (width === 1400) expect(popup.x - (anchor.x + anchor.width)).toBeCloseTo(16, 0);
    else expect(anchor.x + anchor.width - (popup.x + popup.width)).toBeCloseTo(16, 0);
  });
}

test("event editor follows its re-rendered anchor while scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.locator(".semlo-editor").evaluate((node) => {
    node.parentElement!.style.marginTop = "600px";
    node.parentElement!.style.marginBottom = "800px";
  });
  let event = page.getByRole("button", { name: "日程：日程" }).first();
  await event.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const event = document.querySelector(".semlo-editor-calendar-event")!;
    window.scrollBy(0, event.getBoundingClientRect().top - 380);
  });
  await event.click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("日程标题").fill("滚动锚点");
  event = page.getByRole("button", { name: "日程：滚动锚点" }).first();
  await page.evaluate(() => window.scrollBy(0, 80));
  await expect
    .poll(async () => {
      const [anchor, popup] = await Promise.all([event.boundingBox(), dialog.boundingBox()]);
      if (!anchor || !popup) return false;
      const expected = Math.max(8, Math.min(anchor.y, 700 - popup.height - 8));
      return Math.abs(popup.y - expected) < 1;
    })
    .toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").setEditable(false));
  await expect(dialog).toHaveCount(0);
});

for (const action of ["title", "remove", "range", "new"] as const) {
  test(`synchronous host destruction during calendar ${action} is safe`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
    if (action === "new") {
      await page.evaluate(() => Reflect.set(window, "touchCalendarDestroyOnChange", true));
      await page.locator('.semlo-editor-calendar-cell[data-date="2026-11-03"]').click({ position: { x: 20, y: 45 } });
      await expect(page.getByRole("dialog", { name: "添加日程" })).toHaveCount(0);
      expect(await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.isDestroyed)).toBe(
        true,
      );
      await page.waitForTimeout(50);
      expect(errors).toEqual([]);
      return;
    }
    await page.getByRole("button", { name: "日程：日程" }).first().click();
    const dialog = page.getByRole("dialog", { name: "编辑日程" });
    if (action === "range") {
      const start = dialog.getByLabel("开始日期");
      await start.click();
      await start.fill("2026-11-12");
      await start.press("Enter");
      await dialog.getByLabel("结束日期").fill("2026-11-19");
    }
    await page.evaluate(() => Reflect.set(window, "touchCalendarDestroyOnChange", true));
    if (action === "title") await dialog.getByLabel("日程标题").fill("新标题");
    else if (action === "remove") await dialog.getByRole("button", { name: "删除日程" }).click();
    else await dialog.getByLabel("结束日期").press("Enter");
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("touchCalendarEditor").editor.isDestroyed)).toBe(
      true,
    );
    await page.waitForTimeout(50);
    expect(errors).toEqual([]);
  });
}

test("calendar panel background interaction keeps Escape usable", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const panel = page.getByRole("dialog", { name: "编辑日程" });
  await panel.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("probe same-reference replacement closes the old calendar event editor", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await expect(dialog).toBeVisible();
  const result = await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("touchCalendarEditor");
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorCalendar") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const tr = editor.state.tr.replaceWith(position, position + node.nodeSize, node);
    const stepCount = tr.steps.length;
    editor.view.dispatch(tr);
    return { stepCount, sameNode: editor.state.doc.nodeAt(position) === node };
  });
  expect(result).toEqual({ stepCount: 1, sameNode: true });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "日程：日程" }).first()).toBeVisible();
});

test("calendar event editor survives adjacent editing and an equal host echo", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("touchCalendarEditor");
    controller.setContent(controller.getSnapshot().json);
    const { editor } = controller;
    const text = editor.schema.nodes.paragraph.create(null, editor.schema.text("邻近段落"));
    editor.view.dispatch(editor.state.tr.insert(0, text));
  });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("日程标题").fill("继续编辑");
  await expect(page.getByRole("button", { name: "日程：继续编辑" }).first()).toBeVisible();
});

test("a rejected same-reference calendar replacement leaves the event editor open", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.touchCalendarEditor));
  await page.getByRole("button", { name: "日程：日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  const message = await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("touchCalendarEditor");
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorCalendar") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const reject = () => {
      throw new Error("host rejected transaction");
    };
    editor.on("beforeTransaction", reject);
    let message = "";
    try {
      editor.view.dispatch(editor.state.tr.replaceWith(position, position + node.nodeSize, node));
    } catch (error) {
      message = (error as Error).message;
    } finally {
      editor.off("beforeTransaction", reject);
    }
    return message;
  });
  expect(message).toBe("host rejected transaction");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("日程标题").fill("继续编辑");
  await expect(page.getByRole("button", { name: "日程：继续编辑" }).first()).toBeVisible();
});
