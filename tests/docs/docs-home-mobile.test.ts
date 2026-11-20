import { expect, test } from "@rstest/playwright";

import { appendText, chooseExample, useDocsHome } from "../fixtures/docs/docs-home-helpers";

const openHome = useDocsHome("reduce");

for (const { width, height } of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`手机更多工具在 ${width}×${height} 不遮挡编辑正文`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const editor = await openHome(page);
    await page.getByRole("link", { name: "试用编辑器" }).click();
    const more = page.locator(".semlo-editor-editor-host").getByRole("button", { name: "更多", exact: true });
    await more.click();
    const panel = page.getByRole("toolbar", { name: "更多工具" });
    await expect(panel).toBeVisible();
    try {
      await expect
        .poll(async () => {
          const panelBox = await panel.boundingBox();
          const editorBox = await editor.boundingBox();
          return Boolean(panelBox && editorBox && panelBox.y + panelBox.height <= editorBox.y);
        })
        .toBe(true);
    } catch (error) {
      console.log("mobile-overflow-diagnostic", {
        panel: await panel.boundingBox(),
        editor: await editor.boundingBox(),
        geometry: await panel.evaluate((element) => ({
          css: element.getAttribute("style"),
          scrollHeight: element.scrollHeight,
          offsetHeight: (element as HTMLElement).offsetHeight,
        })),
      });
      await page.screenshot({ path: "test-results/docs/mobile-overflow-failure.png" });
      throw error;
    }
    await panel.getByRole("button", { name: "段落样式" }).click();
    await expect(page.getByRole("menu", { name: "段落样式" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "段落样式" })).toHaveCount(0);
  });
}

for (const { width, height } of [
  { width: 320, height: 568 },
  { width: 320, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`示例菜单在 ${width}×${height} 避开导航并支持键盘操作`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const editor = await openHome(page);
    await page.getByRole("link", { name: "试用编辑器" }).click();
    const trigger = page.getByRole("button", { name: /选择演示内容，当前/ });
    await trigger.click();
    const menu = page.locator(".semlo-editor-home-example-menu");
    await expect(menu).toBeVisible();
    const placement = await menu.evaluate((element) => {
      const menu = element.getBoundingClientRect();
      const nav = document.querySelector(".semlo-editor-nav")!.getBoundingClientRect();
      const trigger = document.querySelector(".semlo-editor-example-trigger")!.getBoundingClientRect();
      return {
        top: menu.top,
        bottom: menu.bottom,
        navBottom: nav.bottom,
        triggerTop: trigger.top,
        triggerBottom: trigger.bottom,
        itemHeights: Array.from(
          element.querySelectorAll('[role="menuitem"]'),
          (item) => item.getBoundingClientRect().height,
        ),
      };
    });
    expect(placement.top).toBeGreaterThanOrEqual(placement.navBottom);
    expect(placement.bottom).toBeLessThanOrEqual(height);
    expect(placement.bottom <= placement.triggerTop || placement.top >= placement.triggerBottom).toBe(true);
    expect(placement.itemHeights).toHaveLength(7);
    expect(Math.min(...placement.itemHeights)).toBeGreaterThanOrEqual(44);
    const hasOverflow = await menu.evaluate((element) => element.scrollHeight > element.clientHeight + 2);
    if (hasOverflow) await expect(menu.locator(".semlo-editor-example-scroll-cue")).toBeVisible();

    await page.keyboard.press("ArrowUp");
    const last = menu.getByRole("menuitem").last();
    await expect(last).toBeFocused();
    const focusOutline = await last
      .locator("span")
      .first()
      .evaluate((label) => {
        const style = getComputedStyle(label);
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor };
      });
    expect(focusOutline.style).toBe("solid");
    expect(focusOutline.width).toBeGreaterThanOrEqual(2);
    expect(focusOutline.color).not.toBe("rgba(0, 0, 0, 0)");
    const visible = await last.evaluate((item) => {
      const row = item.getBoundingClientRect();
      const parent = item.parentElement!.getBoundingClientRect();
      return row.top >= parent.top && row.bottom <= parent.bottom;
    });
    expect(visible).toBe(true);
    await expect(menu.locator(".semlo-editor-example-scroll-cue")).not.toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(menu).toHaveCount(0);
    await trigger.click();
    await menu.getByRole("menuitem", { name: "公式与绘图" }).click();
    await expect(trigger).toHaveAttribute("aria-label", "选择演示内容，当前：公式与绘图");
    await expect(editor).toContainText("公式与绘图");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test("短屏示例菜单可触摸滚动并选择末项", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 568,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await openHome(page);
    await page.getByRole("link", { name: "试用编辑器" }).click();
    const trigger = page.getByRole("button", { name: /选择演示内容，当前/ });
    async function tap(x: number, y: number) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    // 坐标触摸不执行 Playwright 的可操作性检查，先等待滚动后的入口稳定并可接收事件。
    await trigger.click({ trial: true });
    const triggerBounds = await trigger.boundingBox();
    if (!triggerBounds) throw new Error("找不到示例菜单入口");
    await tap(triggerBounds.x + triggerBounds.width / 2, triggerBounds.y + triggerBounds.height / 2);
    const menu = page.locator(".semlo-editor-home-example-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".semlo-editor-example-scroll-cue")).toBeVisible();
    const bounds = await menu.boundingBox();
    if (!bounds) throw new Error("找不到示例菜单");
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height - 30;
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 5; i++) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 25 }] });
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const last = menu.getByRole("menuitem").last();
    await last.click({ trial: true });
    const lastBounds = await last.boundingBox();
    if (!lastBounds) throw new Error("找不到最后一个示例");
    await tap(lastBounds.x + lastBounds.width / 2, lastBounds.y + lastBounds.height / 2);
    await expect(trigger).toHaveAttribute("aria-label", "选择演示内容，当前：日期日历与提及");
    await expect(menu).toHaveCount(0);
  } finally {
    await touch.detach();
  }
});

test("页面缩放时示例菜单仍可打开并选择", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const editor = await openHome(page);
  await page.evaluate(() => {
    document.body.style.zoom = "0.9";
  });
  await appendText(page, "缩放后的草稿");
  await chooseExample(page, "公式与绘图");
  await expect(editor).toContainText("公式与绘图");
  await chooseExample(page, "开始写作");
  await expect(editor).toContainText("缩放后的草稿");
});

for (const height of [568, 720]) {
  test(`首次试用在 320×${height} 可看到标题和输入位置，并保留后续光标`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height });
    const editor = await openHome(page);
    await page.getByRole("link", { name: "试用编辑器" }).click();
    await expect(editor).toBeFocused();
    await expect
      .poll(() => page.locator("#semlo-editor-demo").evaluate((element) => element.getBoundingClientRect().top))
      .toBeLessThanOrEqual(115);
    const placement = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>(".semlo-editor-editor-host")!;
      const title = host.querySelector("h1")!.getBoundingClientRect();
      const toolbar = host.querySelector(".semlo-editor-toolbar")!.getBoundingClientRect();
      const anchor = window.getSelection()!.anchorNode!;
      const element = anchor instanceof Element ? anchor : anchor.parentElement;
      const paragraph = element?.closest("p");
      const bounds = paragraph?.getBoundingClientRect();
      return {
        titleTop: title.top,
        toolbarBottom: toolbar.bottom,
        paragraphText: paragraph?.textContent,
        paragraphTop: bounds?.top,
        paragraphBottom: bounds?.bottom,
        hostBottom: host.getBoundingClientRect().bottom,
      };
    });
    expect(placement.titleTop).toBeGreaterThanOrEqual(placement.toolbarBottom - 1);
    expect(placement.paragraphText).toBe("");
    expect(placement.paragraphTop).toBeGreaterThanOrEqual(placement.toolbarBottom);
    expect(placement.paragraphBottom).toBeLessThanOrEqual(Math.min(placement.hostBottom, height));
    await page.keyboard.insertText("试写A");
    await page.keyboard.press("ArrowLeft");
    await page.getByRole("link", { name: "继续浏览", exact: true }).click();
    await page.getByRole("link", { name: "试用编辑器" }).click();
    await page.keyboard.insertText("中");
    await expect(editor).toContainText("试写中A");
  });
}

test("继续浏览的焦点使用纸签描边，并兼容强制颜色", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openHome(page);
  const heading = page.getByRole("heading", { name: /想法不必一次成形/ });
  const next = page.getByRole("link", { name: "继续浏览", exact: true });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(heading).toBeFocused();
  const focus = await heading.evaluate((element) => {
    const label = element.querySelector(".semlo-editor-overview-label")!;
    const style = getComputedStyle(label);
    return {
      keyboard: element.matches(":focus-visible"),
      outline: style.outlineStyle,
      color: style.outlineColor,
      labelWidth: label.getBoundingClientRect().width,
      headingWidth: element.getBoundingClientRect().width,
    };
  });
  expect(focus.keyboard).toBe(true);
  expect(focus.outline).toBe("solid");
  expect(focus.color).not.toBe("rgba(0, 0, 0, 0)");
  expect(focus.labelWidth).toBeLessThan(focus.headingWidth);
  await page.emulateMedia({ forcedColors: "active" });
  const forced = await heading.locator(".semlo-editor-overview-label").evaluate((label) => {
    const style = getComputedStyle(label);
    return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
  });
  expect(forced.style).toBe("solid");
  expect(parseFloat(forced.width)).toBeGreaterThan(0);
  expect(forced.color).not.toBe("rgba(0, 0, 0, 0)");
});

for (const { width, height } of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`绘图工具在 ${width}×${height} 有完整触控区域和可见菜单`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openHome(page);
    await chooseExample(page, "公式与绘图");
    const card = page.locator(".semlo-editor-editor-host .semlo-editor-diagram").first();
    const controls = await page.locator(".semlo-editor-editor-host .semlo-editor-diagram").evaluateAll((cards) =>
      cards.flatMap((element) => {
        const card = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll<HTMLElement>(".semlo-editor-diagram-actions > button")).map(
          (button) => {
            const rect = button.getBoundingClientRect();
            return {
              width: rect.width,
              height: rect.height,
              left: rect.left - card.left,
              right: card.right - rect.right,
              textFits: button.scrollWidth <= button.clientWidth + 1,
            };
          },
        );
      }),
    );
    expect(controls).toHaveLength(16);
    for (const control of controls) {
      expect(control.width).toBeGreaterThanOrEqual(43);
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.left).toBeGreaterThanOrEqual(0);
      expect(control.right).toBeGreaterThanOrEqual(0);
      expect(control.textFits).toBe(true);
    }

    await card.getByRole("button", { name: "绘图语言" }).click();
    const menu = card.getByRole("menu", { name: "绘图语言" });
    await expect(menu).toBeVisible();
    await expect
      .poll(() =>
        menu.evaluate((element) => {
          const host = element.closest(".semlo-editor-editor-host")!.getBoundingClientRect();
          const panel = element.getBoundingClientRect();
          return (
            panel.left >= host.left && panel.right <= host.right && panel.bottom <= Math.min(host.bottom, innerHeight)
          );
        }),
      )
      .toBe(true);
    const menuItems = menu.getByRole("menuitem");
    await expect(menuItems).toHaveCount(4);
    expect((await menuItems.last().boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await menu.getByRole("menuitem", { name: "Graphviz" }).click();
    await expect(card.getByRole("button", { name: "绘图语言" })).toHaveText("Graphviz");
    await card.getByRole("button", { name: "最大化文本绘图" }).click();
    await expect(card).toHaveClass(/semlo-editor-diagram-fullscreen-active/);
    const returnButton = card.getByRole("button", { name: "返回文档" });
    const fullScreen = await returnButton.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const atCenter = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return {
        buttonReachable: atCenter === button || button.contains(atCenter),
        layout: getComputedStyle(button.closest(".semlo-editor-diagram")!.querySelector(".semlo-editor-diagram-body")!)
          .flexDirection,
      };
    });
    expect(fullScreen.buttonReachable).toBe(true);
    expect(fullScreen.layout).toBe("column");
    await returnButton.click();
    await expect(card).not.toHaveClass(/semlo-editor-diagram-fullscreen-active/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test("手机编辑器保留内外滚动，并可直接继续浏览", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await openHome(page);
  await appendText(page, "手机上的临时内容");
  const host = page.locator(".semlo-editor-editor-host");
  await host.scrollIntoViewIfNeeded();
  await host.evaluate((element) => {
    element.scrollTop = 0;
  });
  const bounds = await host.boundingBox();
  if (!bounds) throw new Error("找不到编辑器滚动区域");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 160);
  await expect.poll(() => host.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await host.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const previousY = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(previousY);

  const next = page.getByRole("link", { name: "继续浏览", exact: true });
  await expect(next).toBeVisible();
  await next.focus();
  await page.keyboard.press("Enter");
  const heading = page.getByRole("heading", { name: /想法不必一次成形/ });
  await expect(heading).toBeFocused();
  await page.getByRole("link", { name: "试用编辑器" }).click();
  await expect(editor).toContainText("手机上的临时内容");
});

test("模拟触摸可在编辑器和页面间滚动并继续浏览", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    const touch = await context.newCDPSession(page);
    await openHome(page);
    const host = page.locator(".semlo-editor-editor-host");
    await host.scrollIntoViewIfNeeded();
    await host.evaluate((element) => {
      element.scrollTop = 0;
    });
    async function swipeUp(distance: number) {
      const bounds = await host.boundingBox();
      if (!bounds) throw new Error("找不到编辑器滚动区域");
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      const steps = Math.ceil(distance / 35);
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= steps; i++) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - (i * distance) / steps }],
        });
      }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    const innerScrollRange = await host.evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(innerScrollRange).toBeGreaterThan(0);
    // 手势把内层滚到边界，后续手势才能检验浏览器实际的滚动交接。
    await swipeUp(innerScrollRange + 40);
    await expect
      .poll(() => host.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeLessThanOrEqual(1);
    const previousY = await page.evaluate(() => window.scrollY);
    await swipeUp(175);
    try {
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(previousY);
    } catch (error) {
      console.log("touch-scroll-diagnostic", {
        previousY,
        currentY: await page.evaluate(() => window.scrollY),
        host: await host.evaluate((element) => ({
          rect: element.getBoundingClientRect().toJSON(),
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          overscroll: getComputedStyle(element).overscrollBehaviorY,
        })),
      });
      await page.screenshot({ path: "test-results/docs/touch-scroll-failure.png" });
      throw error;
    }
    const next = page.getByRole("link", { name: "继续浏览", exact: true });
    await next.tap();
    await expect(page.getByRole("heading", { name: /想法不必一次成形/ })).toBeFocused();
  } finally {
    await context.close();
  }
});
