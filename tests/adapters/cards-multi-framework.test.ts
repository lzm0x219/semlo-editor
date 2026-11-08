import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../fixtures/browser/fixture-rsbuild";
import type {} from "../fixtures/cards/cards-multi-framework-fixture";

let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/cards/cards-multi-framework-fixture.ts", {
    framework: true,
  }));
});
afterAll(async () => closeServer?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework}: replacing one controlled editor leaves the other editor's date draft intact`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountMultiCardFramework === "function");
    await page.evaluate((name) => window.mountMultiCardFramework!(name), framework);
    const first = page.locator('[data-editor-name="甲"]');
    const second = page.locator('[data-editor-name="乙"]');
    await first.getByRole("button", { name: "日程：甲日程" }).first().click();
    const dialog = page.getByRole("dialog", { name: "编辑日程" });
    const start = dialog.getByLabel("开始日期");
    await start.click();
    await start.fill("2026-11-12");
    await page.evaluate(async () => {
      const instance = window.__semloRequireFixture("multiCardFrameworks")[1];
      const json = instance.controller.getSnapshot().json;
      json.content![0].content![0].text = "乙的新正文";
      json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0].title = "乙的新日程";
      instance.setContent(json);
      await window.settleMultiCardFramework!();
    });
    await expect(second.getByRole("button", { name: "日程：乙的新日程" }).first()).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(start).toBeFocused();
    await expect(start).toHaveValue("2026-11-12");
    await start.press("Enter");
    const end = dialog.getByLabel("结束日期");
    await end.fill("2026-11-13");
    await end.press("Enter");
    const snapshots = await page.evaluate(() =>
      window.__semloRequireFixture("multiCardFrameworks").map((instance) => instance.controller.getSnapshot().json),
    );
    const events = snapshots.map(
      (json) => json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0],
    );
    expect(events[0].title).toBe("甲日程");
    expect(events[0].start).toBe("2026-11-12");
    expect(events[0].end).toBe("2026-11-13");
    expect(events[1].title).toBe("乙的新日程");
    expect(events[1].start).toBe("2026-11-05");
    expect(events[1].end).toBe("2026-11-05");
    await page.evaluate(() => window.__semloRequireFixture("multiCardFrameworks").forEach((item) => item.destroy()));
  });
}

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework}: another editor's replacement cannot retarget an open date picker`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountMultiCardFramework === "function");
    await page.evaluate((name) => window.mountMultiCardFramework!(name), framework);
    const first = page.locator('[data-editor-name="甲"]');
    const second = page.locator('[data-editor-name="乙"]');
    await first.getByRole("button", { name: "日期：2026-11-03" }).click();
    const picker = page.getByRole("dialog", { name: "选择日期" });
    await page.evaluate(async () => {
      const instance = window.__semloRequireFixture("multiCardFrameworks")[1];
      const json = instance.controller.getSnapshot().json;
      json.content![0].content![0].text = "乙的新正文";
      json.content![1].content![0].attrs!.date = "2027-02-04";
      instance.setContent(json);
      await window.settleMultiCardFramework!();
    });
    await expect(picker).toBeVisible();
    await expect(second.getByRole("button", { name: "日期：2027-02-04" })).toBeVisible();
    await picker.getByRole("button", { name: "2026-11-05", exact: true }).click();
    await expect(first.getByRole("button", { name: "日期：2026-11-05" })).toBeVisible();
    await expect(second.getByRole("button", { name: "日期：2027-02-04" })).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("multiCardFrameworks").forEach((item) => item.destroy()));
  });
}
