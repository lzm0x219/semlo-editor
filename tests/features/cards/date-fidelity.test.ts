import { resolve } from "node:path";

import { expect, test, type Page } from "@rstest/playwright";

async function insertDate(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-03T11:24:00"));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addStyleTag({ path: resolve("packages/core/src/features/cards/date-picker.css") });
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("/rq");
  await page.keyboard.press("Enter");
  const date = page.locator(".semlo-editor-date-node button");
  await expect(date).toBeVisible();
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03");
  await expect(page.getByRole("dialog", { name: "选择日期" })).toHaveCount(0);
  return date;
}

test("date picker browses months without changing the date until a day is selected", async ({ page }) => {
  const date = await insertDate(page);
  await date.click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  const initial = await picker.boundingBox();
  expect(initial?.width).toBe(300);
  expect(initial?.height).toBeCloseTo(406, 0);

  await picker.getByRole("button", { name: "选择月份" }).click();
  await expect(picker.locator(".semlo-editor-date-period-grid button")).toHaveCount(12);
  await expect(picker.getByRole("button", { name: "选择11月", exact: true })).toHaveAttribute("aria-current", "date");
  await picker.getByRole("button", { name: "选择2月", exact: true }).click();
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03");
  await expect(picker.getByRole("button", { name: "选择月份" })).toHaveText("2月");
  await picker.getByRole("button", { name: "2026-02-12", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole("button", { name: "日期：2026-02-12", exact: true })).toBeVisible();
});

test("year and decade selectors navigate separately from the committed date", async ({ page }) => {
  const date = await insertDate(page);
  await date.click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("button", { name: "选择年份" }).click();
  await expect(picker.locator(".semlo-editor-date-period-grid button")).toHaveCount(12);
  await expect(picker.getByRole("button", { name: "选择2026年", exact: true })).toHaveAttribute("aria-current", "date");
  await picker.getByRole("button", { name: "上一十年" }).click();
  await expect(picker.getByRole("button", { name: "选择十年范围" })).toHaveText("2010-2019");
  await picker.getByRole("button", { name: "选择2015年", exact: true }).click();
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03");
  await expect(picker.getByRole("button", { name: "选择年份" })).toHaveText("2015年");

  await picker.getByRole("button", { name: "选择年份" }).click();
  await picker.getByRole("button", { name: "选择十年范围" }).click();
  await expect(picker.locator(".semlo-editor-date-period-grid button")).toHaveCount(12);
  await picker.getByRole("button", { name: "上一百年" }).click();
  await picker.getByRole("button", { name: "选择1970-1979年", exact: true }).click();
  await expect(picker.getByRole("button", { name: "选择十年范围" })).toHaveText("1970-1979");
  await picker.getByRole("button", { name: "选择1976年", exact: true }).click();
  await picker.getByRole("button", { name: "选择月份" }).click();
  await picker.getByRole("button", { name: "选择2月", exact: true }).click();
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03");
  await picker.getByRole("button", { name: "1976-02-29", exact: true }).click();
  await expect(page.getByRole("button", { name: "日期：1976-02-29", exact: true })).toBeVisible();
});

test("Escape keeps the time selection open and a chosen time survives a date change", async ({ page }) => {
  const date = await insertDate(page);
  await date.click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("checkbox", { name: "时刻" }).check();
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03 11:30");
  const trigger = picker.getByRole("button", { name: "选择时刻" });
  await trigger.click();
  const list = picker.getByRole("listbox", { name: "选择时刻" });
  await expect(list).toBeVisible();
  await trigger.press("Escape");
  await expect(list).toBeVisible();
  await expect(picker).toBeVisible();
  await picker.getByRole("option", { name: "12:30", exact: true }).click();
  await expect(list).toBeHidden();
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03 12:30");
  await picker.getByRole("button", { name: "2026-11-04", exact: true }).click();
  await expect(page.getByRole("button", { name: "日期：2026-11-04 12:30", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "日期：2026-11-04 12:30", exact: true }).click();
  await page.getByRole("button", { name: "只读预览" }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole("button", { name: "日期：2026-11-04 12:30", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await page.getByRole("button", { name: "日期：2026-11-04 12:30", exact: true }).click();
  await page.getByRole("button", { name: "React", exact: true }).click();
  await expect(picker).toHaveCount(0);
});

test("date picker follows its anchor on scroll and stays in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 720 });
  const date = await insertDate(page);
  await page.locator("#editor-host").evaluate((host) => {
    host.style.marginTop = "500px";
    host.style.marginBottom = "700px";
  });
  await date.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const anchor = document.querySelector(".semlo-editor-date-node button")!;
    window.scrollBy(0, anchor.getBoundingClientRect().top - 540);
  });
  await date.click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await expect(picker).toBeVisible();
  const before = await date.boundingBox();
  if (!before) throw new Error("Missing date anchor geometry");
  await page.evaluate(() => window.scrollBy(0, 40));
  await expect.poll(async () => (await date.boundingBox())?.y).not.toBe(before.y);
  await expect
    .poll(async () => {
      const [anchor, popup] = await Promise.all([date.boundingBox(), picker.boundingBox()]);
      if (!anchor || !popup) return false;
      const aligned =
        Math.abs(popup.y - anchor.y - anchor.height - 8) < 1 || Math.abs(popup.y + popup.height + 8 - anchor.y) < 1;
      return aligned && popup.x >= 8 && popup.x + popup.width <= 422 && popup.y >= 8 && popup.y + popup.height <= 712;
    })
    .toBe(true);

  await page.evaluate(() => {
    const anchor = document.querySelector(".semlo-editor-date-node button")!;
    window.scrollBy(0, anchor.getBoundingClientRect().top - 140);
  });
  await expect.poll(async () => (await date.boundingBox())?.y).toBeLessThan(320);
  await page.setViewportSize({ width: 230, height: 320 });
  await expect
    .poll(async () => {
      const anchor = await date.boundingBox();
      const popup = (await picker.count()) ? await picker.boundingBox() : null;
      if (!anchor) return false;
      const visible = anchor.y + anchor.height > 0 && anchor.y < 320 && anchor.x + anchor.width > 0 && anchor.x < 230;
      return visible ? !!popup : !popup;
    })
    .toBe(true);
  if (!(await picker.count())) {
    await date.scrollIntoViewIfNeeded();
    await date.click();
  }
  await expect
    .poll(async () => {
      const popup = await picker.boundingBox();
      return !!popup && popup.x >= 0 && popup.x + popup.width <= 230 && popup.y >= 0 && popup.y + popup.height <= 320;
    })
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(picker).toHaveCount(0);
});
