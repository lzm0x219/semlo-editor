import { expect, test } from "@rstest/playwright";

test("toolbar list-style choice updates the document and survives moving into overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const host = page.locator("#editor-host");
  const prose = host.locator(".semlo-editor-prose");
  await prose.click();
  const arrow = page.getByRole("button", { name: "有序列表样式" });
  await arrow.click();
  const menu = page.getByRole("menu", { name: "有序列表样式" });
  await menu.getByRole("menuitemradio", { name: "中文数字" }).click();
  await expect(prose.locator('ol[data-semlo-editor-ordered-style="chinese"]')).toHaveCount(1);
  const toolbar = host.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => ((element as HTMLElement).style.width = "200px"));
  await toolbar.getByRole("button", { name: "更多" }).click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  const overflowArrow = overflow.getByRole("button", { name: "有序列表样式" });
  await overflowArrow.scrollIntoViewIfNeeded();
  await overflowArrow.click();
  await expect(menu.getByRole("menuitemradio", { name: "中文数字" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: "多级数字" }).click();
  await expect(prose.locator('ol[data-semlo-editor-ordered-style="decimal"]')).toHaveCount(1);
  await expect(overflow).toBeVisible();
  await overflowArrow.click();
  await menu.getByRole("menuitemradio", { name: "数字、字母和罗马数字" }).click();
  await expect(prose.locator('ol[data-semlo-editor-ordered-style="mixed"]')).toHaveCount(1);
  await prose.press("ControlOrMeta+z");
  await expect(prose.locator('ol[data-semlo-editor-ordered-style="decimal"]')).toHaveCount(1);
  await prose.press("ControlOrMeta+Shift+z");
  await expect(prose.locator('ol[data-semlo-editor-ordered-style="mixed"]')).toHaveCount(1);
});

test("choosing a list style retains a selected paragraph's text and selection", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const host = page.locator("#editor-host");
  const paragraph = host.locator(".semlo-editor-prose p").first();
  await paragraph.click();
  const text = await paragraph.innerText();
  expect(text.length).toBeGreaterThan(0);
  await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.getByRole("button", { name: "有序列表样式" }).click();
  await page.getByRole("menuitemradio", { name: "中文数字" }).click();
  await expect(host.locator('ol[data-semlo-editor-ordered-style="chinese"]')).toContainText(text);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
});
