import { expect, test, type Locator, type Page } from "@rstest/playwright";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    standaloneCalendarDragEditor?: EditorController;
  }
}

const content: EditorContent = {
  type: "doc",
  content: [
    { type: "paragraph" },
    {
      type: "semloEditorCalendar",
      attrs: {
        events: [
          {
            id: "event-a",
            title: "跨周日程",
            start: "2026-11-05",
            end: "2026-11-14",
            description: "行程安排",
            color: 1,
          },
        ],
      },
    },
    { type: "paragraph" },
  ],
};

async function mount(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'standalone-calendar-drag-test'
      document.body.prepend(host)
      window.standaloneCalendarDragEditor = createEditor({ element: host, outline: false, content: ${JSON.stringify(content)} })
    `,
  });
  await page.waitForFunction(() => !!window.standaloneCalendarDragEditor);
  const root = page.locator("#standalone-calendar-drag-test .semlo-editor-calendar-node");
  await expect(root).toBeVisible();
  return root;
}

async function eventDates(page: Page) {
  return page.evaluate(() => {
    const event = window
      .__semloRequireFixture("standaloneCalendarDragEditor")
      .getSnapshot()
      .json.content?.find((node) => node.type === "semloEditorCalendar")?.attrs?.events?.[0];
    if (!event) throw new Error("Missing calendar event");
    return { start: event.start as string, end: event.end as string, title: event.title as string };
  });
}

function cell(root: Locator, date: string) {
  return root.locator(`.semlo-editor-calendar-cell[data-date="${date}"]`);
}

function segment(root: Locator, start: string) {
  return root.locator(`.semlo-editor-calendar-event[data-event-id="event-a"][data-date="${start}"]`);
}

async function dragBetween(page: Page, source: Locator, anchor: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  const [from, to] = await Promise.all([anchor.boundingBox(), target.boundingBox()]);
  const event = await source.boundingBox();
  if (!from || !to || !event) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + from.width / 2, event.y + event.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function resizeTo(page: Page, source: Locator, target: Locator) {
  const [from, to] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  if (!from || !to) throw new Error("Missing resize geometry");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("moving a cross-week event preserves its span and resize changes only its end, with undo", async ({ page }) => {
  const root = await mount(page);
  const first = segment(root, "2026-11-05");
  const last = segment(root, "2026-11-08");
  await expect(first.locator("[data-calendar-edge]")).toHaveCount(0);
  await expect(last.locator('[data-calendar-edge="end"]')).toHaveCount(1);

  // Start in the middle of the first segment: the drag follows the grabbed date, not the event start.
  await dragBetween(page, first, cell(root, "2026-11-06"), cell(root, "2026-11-10"));
  expect(await eventDates(page)).toEqual({ start: "2026-11-09", end: "2026-11-18", title: "跨周日程" });
  await expect(page.getByRole("dialog", { name: "编辑日程" })).toHaveCount(0);

  await resizeTo(page, segment(root, "2026-11-15").locator('[data-calendar-edge="end"]'), cell(root, "2026-11-21"));
  expect(await eventDates(page)).toEqual({ start: "2026-11-09", end: "2026-11-21", title: "跨周日程" });
  expect(
    await page.evaluate(() => window.__semloRequireFixture("standaloneCalendarDragEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await eventDates(page)).toEqual({ start: "2026-11-09", end: "2026-11-18", title: "跨周日程" });
  expect(
    await page.evaluate(() => window.__semloRequireFixture("standaloneCalendarDragEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await eventDates(page)).toEqual({ start: "2026-11-05", end: "2026-11-14", title: "跨周日程" });
  expect(
    await page.evaluate(() => window.__semloRequireFixture("standaloneCalendarDragEditor").editor.commands.redo()),
  ).toBe(true);
  expect(await eventDates(page)).toEqual({ start: "2026-11-09", end: "2026-11-18", title: "跨周日程" });
});

test("dragging a later segment across a month uses that segment’s grabbed date", async ({ page }) => {
  const root = await mount(page);
  await dragBetween(page, segment(root, "2026-11-08"), cell(root, "2026-11-10"), cell(root, "2026-11-30"));
  expect(await eventDates(page)).toEqual({ start: "2026-11-25", end: "2026-12-04", title: "跨周日程" });
  await expect(segment(root, "2026-11-25")).toBeVisible();
  await expect(segment(root, "2026-11-29")).toBeVisible();
});

test("editing the title immediately after a move remains a separate undo step", async ({ page }) => {
  const root = await mount(page);
  await dragBetween(page, segment(root, "2026-11-05"), cell(root, "2026-11-06"), cell(root, "2026-11-10"));
  await segment(root, "2026-11-09").click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("日程标题").fill("更新后的日程");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  expect(await eventDates(page)).toEqual({ start: "2026-11-09", end: "2026-11-18", title: "更新后的日程" });
  expect(
    await page.evaluate(() => window.__semloRequireFixture("standaloneCalendarDragEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await eventDates(page)).toEqual({ start: "2026-11-09", end: "2026-11-18", title: "跨周日程" });
  expect(
    await page.evaluate(() => window.__semloRequireFixture("standaloneCalendarDragEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await eventDates(page)).toEqual({ start: "2026-11-05", end: "2026-11-14", title: "跨周日程" });
});

test("end resize clamps to the start date and a pointer cancellation discards the preview", async ({ page }) => {
  const root = await mount(page);
  const [from, event, to] = await Promise.all([
    cell(root, "2026-11-06").boundingBox(),
    segment(root, "2026-11-05").boundingBox(),
    cell(root, "2026-11-10").boundingBox(),
  ]);
  if (!from || !event || !to) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + from.width / 2, event.y + event.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, isPrimary: true })));
  await page.mouse.up();
  expect(await eventDates(page)).toEqual({ start: "2026-11-05", end: "2026-11-14", title: "跨周日程" });
  await expect(root.locator(".is-calendar-drop-target")).toHaveCount(0);

  await resizeTo(page, segment(root, "2026-11-08").locator('[data-calendar-edge="end"]'), cell(root, "2026-11-03"));
  expect(await eventDates(page)).toEqual({ start: "2026-11-05", end: "2026-11-05", title: "跨周日程" });
});

test("normal clicks open details; cancelled, external and read-only drags do not change dates", async ({ page }) => {
  const root = await mount(page);
  const original = { start: "2026-11-05", end: "2026-11-14", title: "跨周日程" };
  const first = segment(root, "2026-11-05");
  await first.click();
  await expect(page.getByRole("dialog", { name: "编辑日程" })).toBeVisible();
  await page.getByRole("button", { name: "关闭日程" }).click();

  let from = await cell(root, "2026-11-06").boundingBox();
  let event = await first.boundingBox();
  let to = await cell(root, "2026-11-10").boundingBox();
  if (!from || !to || !event) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + from.width / 2, event.y + event.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await eventDates(page)).toEqual(original);
  await expect(root.locator(".is-calendar-drop-target")).toHaveCount(0);

  from = await cell(root, "2026-11-06").boundingBox();
  event = await first.boundingBox();
  to = await cell(root, "2026-11-10").boundingBox();
  if (!from || !to || !event) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + from.width / 2, event.y + event.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.move(5, 5, { steps: 12 });
  await page.mouse.up();
  expect(await eventDates(page)).toEqual(original);

  from = await cell(root, "2026-11-06").boundingBox();
  event = await first.boundingBox();
  to = await cell(root, "2026-11-10").boundingBox();
  if (!from || !to || !event) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + from.width / 2, event.y + event.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.evaluate(() => window.__semloRequireFixture("standaloneCalendarDragEditor").setEditable(false));
  await page.mouse.up();
  expect(await eventDates(page)).toEqual(original);
  await expect(root.locator("[data-calendar-edge]")).toHaveCount(0);
});

test("replacing a calendar during a drag cannot write to the replacement", async ({ page }) => {
  const root = await mount(page);
  const original = { start: "2026-11-05", end: "2026-11-14", title: "跨周日程" };
  const [from, event, to] = await Promise.all([
    cell(root, "2026-11-06").boundingBox(),
    segment(root, "2026-11-05").boundingBox(),
    cell(root, "2026-11-10").boundingBox(),
  ]);
  if (!from || !event || !to) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + from.width / 2, event.y + event.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("standaloneCalendarDragEditor");
    const replacement = editor.getSnapshot().json;
    replacement.content![0] = { type: "paragraph", content: [{ type: "text", text: "替换后的正文" }] };
    editor.setContent(replacement);
  });
  await page.mouse.up();
  expect(await eventDates(page)).toEqual(original);
  await expect(root.locator(".is-calendar-drop-target")).toHaveCount(0);
});
