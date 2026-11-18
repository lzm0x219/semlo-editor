import { expect, test } from "@rstest/playwright";

import { appendText, chooseExample, useDocsHome } from "../fixtures/docs/docs-home-helpers";

const openHome = useDocsHome();

test("窄屏编辑器底部的信息和使用说明不相互遮挡", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openHome(page);
  await chooseExample(page, "数据表");
  await page.locator(".semlo-editor-editor-host .semlo-editor-database-body").scrollIntoViewIfNeeded();
  await page.locator(".semlo-editor-editor-host").evaluate((element) => {
    element.scrollTop = Math.max(0, element.scrollTop - 100);
  });
  const caption = page.locator(".semlo-editor-editor-caption");
  const hint = page.locator(".semlo-editor-editor-scroll-hint");
  await expect(hint).toContainText("向下查看更多");
  await expect(hint).toContainText("内容可横向滚动");
  const geometry = await caption.evaluate((element) => {
    const rect = (selector: string) => element.querySelector(selector)!.getBoundingClientRect();
    const caption = element.getBoundingClientRect();
    const status = rect(".semlo-editor-editor-caption-primary");
    const lifetime = rect(".semlo-editor-editor-lifetime");
    const hint = rect(".semlo-editor-editor-scroll-hint");
    const guide = rect(".semlo-editor-editor-guide summary");
    return {
      height: caption.height,
      statusRight: status.right,
      lifetimeLeft: lifetime.left,
      lifetimeRight: lifetime.right,
      guideLeft: guide.left,
      guideHeight: guide.height,
      hintTop: hint.top,
      hintRight: hint.right,
      guideBottom: guide.bottom,
    };
  });
  expect(geometry.height).toBeLessThanOrEqual(72);
  expect(geometry.statusRight).toBeLessThanOrEqual(geometry.lifetimeLeft);
  expect(geometry.lifetimeRight).toBeLessThanOrEqual(geometry.guideLeft);
  expect(geometry.guideHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.hintRight <= geometry.guideLeft || geometry.hintTop >= geometry.guideBottom - 2).toBe(true);
  await page.locator(".semlo-editor-editor-guide summary").click();
  await expect(page.locator(".semlo-editor-editor-guide p")).toBeVisible();
});

test("导航在平板宽度切换为菜单并在桌面宽度恢复", async ({ page }) => {
  await page.setViewportSize({ width: 840, height: 720 });
  await openHome(page);
  await page.getByRole("button", { name: "打开站点导航" }).click();
  await expect(page.getByRole("dialog", { name: "站点导航" })).toBeVisible();
  await page.setViewportSize({ width: 861, height: 720 });
  await expect(page.getByRole("dialog", { name: "站点导航" })).not.toBeVisible();
  const navigation = page.getByRole("navigation", { name: "主导航" });
  await expect(navigation).toBeVisible();
  const [primary, search] = await Promise.all([
    navigation.boundingBox(),
    page.locator(".semlo-editor-nav__search").boundingBox(),
  ]);
  expect(primary && search && primary.x + primary.width < search.x).toBeTruthy();
});

test("深色模式保留分区层次和纸张上的可见焦点", async ({ page }) => {
  await openHome(page);
  await page.getByRole("button", { name: "深色模式" }).click();
  await chooseExample(page, "公式与绘图");
  await page.keyboard.press("Tab");
  const restore = page.getByRole("button", { name: "恢复示例" });
  await restore.focus();
  const result = await restore.evaluate((button) => {
    function luminance(color: string) {
      const channels = color.match(/\d+/g)!.slice(0, 3).map(Number);
      return channels.reduce((sum, channel, index) => {
        const value = channel / 255;
        return (
          sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]
        );
      }, 0);
    }
    function contrast(a: string, b: string) {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    }
    const paper = getComputedStyle(document.querySelector(".semlo-editor-editor-frame")!).backgroundColor;
    const data = getComputedStyle(document.querySelector(".semlo-editor-data")!).backgroundColor;
    const paths = getComputedStyle(document.querySelector(".semlo-editor-paths")!).backgroundColor;
    const pathText = getComputedStyle(document.querySelector(".semlo-editor-paths-intro > span")!).color;
    const showcase = getComputedStyle(document.querySelector(".semlo-editor-showcase-paper")!).backgroundColor;
    const showcaseText = getComputedStyle(document.querySelector(".semlo-editor-showcase-paper-top")!).color;
    const drawing = getComputedStyle(document.querySelector(".semlo-editor-diagram-header")!);
    const drawingText = getComputedStyle(document.querySelector(".semlo-editor-diagram-language")!).color;
    const hero = getComputedStyle(document.querySelector(".semlo-editor-hero")!).backgroundColor;
    const status = getComputedStyle(document.querySelector(".semlo-editor-project-status")!).color;
    return {
      focusVisible: button.matches(":focus-visible"),
      focusContrast: contrast(getComputedStyle(button).outlineColor, paper),
      textContrast: contrast(pathText, paths),
      showcaseContrast: contrast(showcaseText, showcase),
      drawingContrast: contrast(drawingText, drawing.backgroundColor),
      statusContrast: contrast(status, hero),
      distinctSections: data !== paths,
    };
  });
  expect(result.focusVisible).toBe(true);
  expect(result.focusContrast).toBeGreaterThanOrEqual(3);
  expect(result.textContrast).toBeGreaterThanOrEqual(4.5);
  expect(result.showcaseContrast).toBeGreaterThanOrEqual(4.5);
  expect(result.drawingContrast).toBeGreaterThanOrEqual(4.5);
  expect(result.statusContrast).toBeGreaterThanOrEqual(4.5);
  expect(result.distinctSections).toBe(true);
});

for (const { width, height } of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 720 },
]) {
  test(`能力入口在 ${width}px 可返回原位置和原按钮`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openHome(page);
    for (const name of ["试试表格", "试试公式", "试试分栏"]) {
      const originButton = page.getByRole("button", { name });
      await originButton.scrollIntoViewIfNeeded();
      const scrollY = await page.evaluate(() => window.scrollY);
      await originButton.click();
      const returnButton = page.getByRole("button", { name: "返回能力介绍" });
      await expect(returnButton).toBeVisible();
      await returnButton.click();
      await expect(originButton).toBeFocused();
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollY)).toBeLessThanOrEqual(1);
      await expect(returnButton).not.toBeVisible();
    }
  });
}

for (const { width, height } of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 720 },
]) {
  test(`首页在 ${width}px 显示 JavaScript 接入示例`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    if (process.env.SEMLO_HOME_SCREENSHOTS) {
      await page.screenshot({ path: `/tmp/semlo-editor-home-${width}-hero.png` });
    }
    if (width === 320) {
      await appendText(page, "窄屏修改");
      await page.getByRole("button", { name: "恢复示例" }).click();
      const confirmation = page.getByRole("group", { name: "确认恢复示例" });
      await expect(confirmation).toBeVisible();
      const confirmButton = confirmation.getByRole("button", { name: "确认恢复" });
      const bounds = await confirmButton.boundingBox();
      expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBeTruthy();
      if (process.env.SEMLO_HOME_SCREENSHOTS) {
        await page.screenshot({ path: "/tmp/semlo-editor-home-320-confirm.png" });
      }
      await page.keyboard.press("Escape");
    }
    const javascript = page.getByRole("button", { name: "JavaScript", exact: true });
    await javascript.click();
    await expect(javascript).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "JavaScript 代码示例" })).toContainText("createEditor");
    await expect(page.getByText("editor.js", { exact: true })).toBeVisible();
    const code = page.getByRole("region", { name: "JavaScript 代码示例" });
    const source = await code.textContent();
    const wrap = page.getByRole("button", { name: "自动换行" });
    await expect(wrap).toHaveAttribute("aria-pressed", "false");
    await wrap.click();
    await expect(wrap).toHaveAttribute("aria-pressed", "true");
    expect(await code.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await code.textContent()).toBe(source);
    await wrap.click();
    await expect(wrap).toHaveAttribute("aria-pressed", "false");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
    if (process.env.SEMLO_HOME_SCREENSHOTS) {
      await page.locator(".semlo-editor-framework-preview").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/semlo-editor-home-${width}-code.png` });
      if (width === 1280) {
        await page.getByRole("button", { name: "深色模式" }).click();
        await page.locator(".semlo-editor-capabilities").scrollIntoViewIfNeeded();
        await page.screenshot({ path: "/tmp/semlo-editor-home-dark-features.png" });
      }
    }
  });
}
