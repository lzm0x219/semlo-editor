import { expect, test } from "@rstest/playwright";

import { createDatabaseData, createDatabaseView } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

for (const kind of ["filter", "chart"] as const) {
  test(`${kind}: Escape does not affect another editor calendar popup`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.setViewportSize({ width: 1500, height: 1000 });
    const data = createDatabaseData();
    if (kind === "chart") {
      const chart = createDatabaseView("图表", "chart");
      data.views.push(chart);
      data.activeViewId = chart.id;
    }
    const database = {
      type: "doc",
      content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }],
    };
    const calendar = {
      type: "doc",
      content: [
        {
          type: "semloEditorCalendar",
          attrs: {
            events: [
              { id: "event-a", title: "跨周日程", start: "2026-11-05", end: "2026-11-06", description: "", color: 1 },
            ],
          },
        },
        { type: "paragraph" },
      ],
    };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "crossPopupFixture", value), { database, calendar });
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      for (const name of ['calendar', 'database']) {
        const host = document.createElement('div'); host.id = 'cross-' + name; document.body.prepend(host)
        createEditor({ element: host, outline: false, content: window.crossPopupFixture[name] })
      }
    `,
    });
    const db = page.locator("#cross-database .semlo-editor-database");
    const cal = page.locator("#cross-calendar .semlo-editor-calendar-node");
    await expect(db).toBeVisible();
    await expect(cal).toBeVisible();
    await cal.locator('.semlo-editor-calendar-event[data-event-id="event-a"]').first().click();
    const calendarPanel = page.locator(".semlo-editor-calendar-event-editor");
    await expect(calendarPanel).toBeVisible();
    const trigger = db.getByRole("button", { name: kind === "chart" ? "添加组件" : "筛选", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: kind === "chart" ? "添加图表组件" : "筛选" });
    await expect(panel).toBeVisible();
    const input = kind === "chart" ? panel.getByRole("button", { name: "柱状图" }) : panel.getByLabel("筛选值");
    await input.focus();
    await page.keyboard.press("Escape");
    await expect(calendarPanel).toBeVisible();
    await expect(panel).toHaveCount(0);
  });
}
