import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { expect, test, type Page } from "@rstest/playwright";

let server: ChildProcess | undefined;
let origin = "";

test.beforeAll(async () => {
  const port = await new Promise<number>((resolve, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") return reject(new Error("无法分配测试端口"));
      socket.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
  origin = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      "docs/node_modules/@rspress/core/bin/rspress.js",
      "dev",
      "--config",
      "docs/rspress.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      stdio: "ignore",
    },
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`文档测试服务器提前退出：${server.exitCode}`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("文档测试服务器启动超时");
});

test.afterAll(() => {
  server?.kill();
});

async function openHome(page: Page) {
  await page.goto(origin);
  const editor = page.getByRole("textbox", { name: "首页试用编辑器" });
  await expect(editor).toBeVisible();
  return editor;
}

async function chooseExample(page: Page, title: string) {
  await page.getByRole("button", { name: /选择演示内容，当前/ }).click();
  await page.getByRole("menuitem", { name: title }).click();
}

async function appendText(page: Page, text: string) {
  const paragraph = page.locator(".semlo-editor-editor-host .semlo-editor-prose p").first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(text);
}

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
    await expect
      .poll(async () => {
        const panelBox = await panel.boundingBox();
        const editorBox = await editor.boundingBox();
        return Boolean(panelBox && editorBox && panelBox.y + panelBox.height <= editorBox.y);
      })
      .toBe(true);
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

test("模拟触摸可在编辑器和页面间滚动并继续浏览", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await openHome(page);
    const host = page.locator(".semlo-editor-editor-host");
    await host.scrollIntoViewIfNeeded();
    await host.evaluate((element) => {
      element.scrollTop = 0;
    });
    async function swipeUp() {
      const bounds = await host.boundingBox();
      if (!bounds) throw new Error("找不到编辑器滚动区域");
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 5; i++) {
        await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 35 }] });
      }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await swipeUp();
    await expect.poll(() => host.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await host.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const previousY = await page.evaluate(() => window.scrollY);
    await swipeUp();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(previousY);
    const next = page.getByRole("link", { name: "继续浏览", exact: true });
    await next.scrollIntoViewIfNeeded();
    const nextBounds = await next.boundingBox();
    if (!nextBounds) throw new Error("找不到继续浏览入口");
    const point = { x: nextBounds.x + nextBounds.width / 2, y: nextBounds.y + nextBounds.height / 2 };
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByRole("heading", { name: /想法不必一次成形/ })).toBeFocused();
  } finally {
    await touch.detach();
  }
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

test("示例分别保留草稿，恢复前可以取消或确认", async ({ page }) => {
  const editor = await openHome(page);
  await appendText(page, "起始草稿");
  await chooseExample(page, "公式与绘图");
  await appendText(page, "公式草稿");
  await chooseExample(page, "数据表");
  await page.getByLabel("第 1 行 事项").fill("数据表草稿");
  await chooseExample(page, "开始写作");
  await expect(editor).toContainText("起始草稿");
  await chooseExample(page, "数据表");
  await expect(page.getByLabel("第 1 行 事项")).toHaveValue("数据表草稿");
  await chooseExample(page, "公式与绘图");
  await expect(editor).toContainText("公式草稿");

  await chooseExample(page, "公式与绘图");
  await expect(editor).toContainText("公式草稿");
  await page.getByRole("button", { name: "恢复示例" }).click();
  const confirmation = page.getByRole("group", { name: "确认恢复示例" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).not.toBeVisible();
  await expect(editor).toContainText("公式草稿");

  await page.getByRole("button", { name: "恢复示例" }).click();
  await confirmation.getByRole("button", { name: "确认恢复" }).click();
  await expect(editor).not.toContainText("公式草稿");
  await chooseExample(page, "开始写作");
  await expect(editor).toContainText("起始草稿");
  await page.getByRole("button", { name: "恢复示例" }).click();
  await confirmation.getByRole("button", { name: "确认恢复" }).click();
  await expect(editor).not.toContainText("起始草稿");
});

test("切换示例后的撤销不会带回其他示例", async ({ page }) => {
  const editor = await openHome(page);
  await appendText(page, "其他示例的草稿");
  await chooseExample(page, "公式与绘图");
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  await expect(undo).toBeDisabled();
  await appendText(page, "当前示例的新文字");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(editor).toContainText("公式与绘图");
  await expect(editor).not.toContainText("当前示例的新文字");
  await expect(editor).not.toContainText("其他示例的草稿");
  await chooseExample(page, "开始写作");
  await expect(editor).toContainText("其他示例的草稿");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(editor).not.toContainText("其他示例的草稿");
  const redo = page.getByRole("button", { name: "重做", exact: true });
  await redo.click();
  await expect(editor).toContainText("其他示例的草稿");
});

test("每个示例独立保留撤销和重做，恢复示例也可撤销", async ({ page }) => {
  const editor = await openHome(page);
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  const redo = page.getByRole("button", { name: "重做", exact: true });
  await appendText(page, "起始历史");
  await undo.click();
  await expect(redo).toBeEnabled();

  await chooseExample(page, "公式与绘图");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await appendText(page, "公式历史");
  await undo.click();
  await expect(redo).toBeEnabled();

  await chooseExample(page, "开始写作");
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(editor).toContainText("起始历史");
  await expect(editor).not.toContainText("公式历史");

  await chooseExample(page, "公式与绘图");
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(editor).toContainText("公式历史");
  await page.getByRole("button", { name: "恢复示例" }).click();
  await page.getByRole("group", { name: "确认恢复示例" }).getByRole("button", { name: "确认恢复" }).click();
  await expect(editor).not.toContainText("公式历史");
  await undo.click();
  await expect(editor).toContainText("公式历史");
  await redo.click();
  await expect(editor).not.toContainText("公式历史");
});

test("数据表编辑的撤销历史随示例保留", async ({ page }) => {
  await openHome(page);
  await chooseExample(page, "数据表");
  await page.getByLabel("第 1 行 事项").fill("表格历史");
  await chooseExample(page, "开始写作");
  await chooseExample(page, "数据表");
  const field = page.getByLabel("第 1 行 事项");
  await expect(field).toHaveValue("表格历史");
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(field).toHaveValue("收集灵感");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(field).toHaveValue("表格历史");
});

test("能力入口定位真实示例且保留试写", async ({ page }) => {
  const editor = await openHome(page);
  await appendText(page, "从能力入口返回后保留");
  await page.getByRole("button", { name: "试试表格" }).click();
  await expect(page.getByRole("button", { name: /当前：列表与表格/ })).toBeFocused();
  const host = page.locator(".semlo-editor-editor-host");
  const table = host.locator(".tableWrapper").first();
  await expect(table).toBeVisible();
  const hostBox = await host.boundingBox();
  const tableBox = await table.boundingBox();
  expect(hostBox && tableBox && tableBox.y >= hostBox.y && tableBox.y < hostBox.y + hostBox.height).toBeTruthy();
  await page.getByRole("button", { name: "试试分栏" }).click();
  await expect(page.getByRole("button", { name: /当前：内容块与分栏/ })).toBeFocused();
  await page.getByRole("button", { name: "试试公式" }).click();
  await expect(page.getByRole("button", { name: /当前：公式与绘图/ })).toBeFocused();
  await chooseExample(page, "开始写作");
  await expect(editor).toContainText("从能力入口返回后保留");
});

test("能力入口的悬停反馈遵循减少动态效果设置", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openHome(page);
  const action = page.getByRole("button", { name: "试试表格" });
  const arrow = action.locator("span");
  await action.hover();
  await expect(arrow).not.toHaveCSS("transform", "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(arrow).toHaveCSS("transform", "none");
  await expect(arrow).toHaveCSS("transition-duration", "0s");
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
