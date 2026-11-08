import { expect, test, type Page } from "@rstest/playwright";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    calendarLayoutEditors?: EditorController[];
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
          { id: "long", title: "跨周日程", start: "2026-11-05", end: "2026-11-14", description: "行程说明", color: 0 },
          { id: "short", title: "重叠日程", start: "2026-11-09", end: "2026-11-09", description: "", color: 3 },
          { id: "other", title: "同日事项", start: "2026-11-09", end: "2026-11-09", description: "", color: 2 },
          { id: "later", title: "后续事项", start: "2026-11-13", end: "2026-11-15", description: "", color: 1 },
          { id: "month", title: "跨月事项", start: "2026-11-29", end: "2026-12-02", description: "", color: 0 },
        ],
      },
    },
    { type: "paragraph" },
  ],
};

async function mount(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.calendarLayoutEditors = []
      const container = document.createElement('div')
      container.style.display = 'flex'
      container.style.alignItems = 'flex-start'
      document.body.prepend(container)
      for (let index = 0; index < 2; index++) {
        const host = document.createElement('div')
        host.id = 'calendar-layout-' + index
        host.style.width = '50%'
        container.append(host)
        window.calendarLayoutEditors.push(createEditor({
          element: host,
          outline: false,
          content: ${JSON.stringify(content)},
        }))
      }
    `,
  });
  await page.waitForFunction(() => window.calendarLayoutEditors?.length === 2);
  const calendar = page.locator("#calendar-layout-0 .semlo-editor-calendar-node");
  await expect(calendar).toBeVisible();
  return { calendar, other: page.locator("#calendar-layout-1 .semlo-editor-calendar-node") };
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("calendar draws one continuous segment per week and separates overlapping events", async ({ page }) => {
  const { calendar } = await mount(page);
  const segment = calendar.getByRole("button", { name: "日程：跨周日程" });
  await expect(segment).toHaveCount(2);
  await expect(segment.nth(0)).toHaveAttribute("data-date", "2026-11-05");
  await expect(segment.nth(0)).toHaveAttribute("data-end-date", "2026-11-07");
  await expect(segment.nth(0)).toHaveClass(/continues-after/);
  await expect(segment.nth(1)).toHaveAttribute("data-date", "2026-11-08");
  await expect(segment.nth(1)).toHaveAttribute("data-end-date", "2026-11-14");
  await expect(segment.nth(1)).toHaveClass(/continues-before/);
  await expect(segment.nth(0).locator('[data-calendar-edge="end"]')).toHaveCount(0);
  await expect(segment.nth(1).locator('[data-calendar-edge="end"]')).toHaveCount(1);
  await expect(calendar.getByRole("button", { name: "日程：重叠日程" })).toHaveAttribute("data-lane", "1");
  await expect(calendar.getByRole("button", { name: "日程：同日事项" })).toHaveAttribute("data-lane", "2");
  await expect(calendar.getByRole("button", { name: "日程：后续事项" }).first()).toHaveAttribute("data-lane", "1");

  const box = async (locator: ReturnType<Page["locator"]>) => {
    const rect = await locator.boundingBox();
    if (!rect) throw new Error("Missing calendar geometry");
    return rect;
  };
  const first = await box(segment.nth(0));
  const firstDay = await box(calendar.locator('.semlo-editor-calendar-cell[data-date="2026-11-05"]'));
  const lastDay = await box(calendar.locator('.semlo-editor-calendar-cell[data-date="2026-11-07"]'));
  expect(first.x).toBeCloseTo(firstDay.x + 4, 0);
  expect(first.x + first.width).toBeCloseTo(lastDay.x + lastDay.width, 0);
  expect(first.height).toBe(24);
  const long = await box(segment.nth(1));
  const short = await box(calendar.getByRole("button", { name: "日程：重叠日程" }));
  const other = await box(calendar.getByRole("button", { name: "日程：同日事项" }));
  expect(short.y - long.y).toBe(27);
  expect(other.y - short.y).toBe(27);
  const cell = await box(calendar.locator('.semlo-editor-calendar-cell[data-date="2026-11-09"]'));
  expect(cell.y + cell.height).toBeGreaterThan(other.y + other.height);
  await expect(segment.nth(0)).toHaveCSS("background-color", "color(srgb 0.850667 0.917804 0.989333)");
});

test("week segments retain editing, readonly, undo, month navigation and isolated data", async ({ page }) => {
  const { calendar, other } = await mount(page);
  const segment = calendar.getByRole("button", { name: "日程：跨周日程" });
  await segment.nth(1).click();
  let dialog = page.getByRole("dialog", { name: "编辑日程" });
  await expect(dialog.getByLabel("日程说明")).toHaveValue("行程说明");
  await expect(segment.nth(0)).toHaveClass(/is-active/);
  await expect(segment.nth(1)).toHaveClass(/is-active/);
  await dialog.getByLabel("日程标题").fill("更新的行程");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  await expect(calendar.getByRole("button", { name: "日程：更新的行程" })).toHaveCount(2);
  await expect(other.getByRole("button", { name: "日程：跨周日程" })).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(calendar.getByRole("button", { name: "日程：跨周日程" })).toHaveCount(2);

  await calendar.getByRole("button", { name: "日历下个月" }).click();
  const month = calendar.getByRole("button", { name: "日程：跨月事项" });
  await expect(month).toHaveCount(1);
  await expect(month).toHaveAttribute("data-date", "2026-11-29");
  await expect(month).toHaveAttribute("data-end-date", "2026-12-02");
  await calendar.locator('.semlo-editor-calendar-cell[data-date="2026-12-10"]').click({ position: { x: 15, y: 40 } });
  dialog = page.getByRole("dialog", { name: "添加日程" });
  await expect(dialog.getByLabel("开始日期")).toHaveValue("2026-12-10");
  await dialog.getByLabel("日程标题").fill("新日程");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  await expect(calendar.getByRole("button", { name: "日程：新日程" })).toBeVisible();

  await page.evaluate(() => window.__semloRequireFixture("calendarLayoutEditors")[0].setEditable(false));
  await expect(calendar.locator(".semlo-editor-calendar-add")).toHaveCount(0);
  await expect(calendar.locator('[data-calendar-edge="end"]')).toHaveCount(0);
  await month.click();
  dialog = page.getByRole("dialog", { name: "编辑日程" });
  await expect(dialog.getByLabel("日程标题")).toBeDisabled();
});
