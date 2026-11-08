import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type {} from "../../fixtures/toolbar/custom-toolbar-fixture";

declare global {
  interface Window {
    savedBubbleButton?: HTMLButtonElement;
    savedHiddenEditor?: HTMLElement;
  }
}

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/toolbar/custom-toolbar-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.customToolbarFixture));
});

for (const kind of ["core", "react", "vue", "solid"]) {
  test(`${kind} 自定义工具栏响应状态并在销毁及重挂载时清理`, async ({ page }) => {
    await page.evaluate((kind) => window.customToolbarFixture.mount(kind, "A"), kind);
    const host = page.locator("#custom-host-A");
    const button = host.getByRole("button", { name: "加粗 A" });
    await expect(button).toBeVisible();
    await expect(host.getByRole("toolbar", { name: "文本格式" })).toHaveCount(1);
    await expect(host.getByRole("button", { name: "加粗", exact: true })).toHaveCount(0);
    await page.evaluate(() => window.customToolbarFixture.select("A"));
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(host.locator(".semlo-editor-prose strong")).toHaveText("hello world");
    await page.evaluate(() => window.customToolbarFixture.undo("A"));
    await expect(host.locator(".semlo-editor-prose strong")).toHaveCount(0);
    await page.evaluate(() => window.customToolbarFixture.redo("A"));
    await expect(host.locator(".semlo-editor-prose strong")).toHaveText("hello world");
    await page.evaluate(() => window.customToolbarFixture.editable("A", false));
    await expect(button).toBeDisabled();
    await expect(host.locator(".semlo-editor-prose")).toHaveAttribute("aria-readonly", "true");
    await expect(host.locator(".semlo-editor")).toHaveClass(/semlo-editor-readonly/);
    await page.evaluate(() => window.customToolbarFixture.editable("A", true));
    await expect(button).toBeEnabled();
    await expect(host.locator(".semlo-editor-prose")).toHaveAttribute("aria-readonly", "false");
    await page.evaluate(() => window.customToolbarFixture.destroy("A"));
    expect(await page.evaluate(() => window.customToolbarFixture.cleanupCount("A"))).toBe(1);
    await page.evaluate((kind) => window.customToolbarFixture.mount(kind, "A"), kind);
    await expect(page.getByRole("button", { name: "加粗 A" })).toBeVisible();
    await page.evaluate(() => window.customToolbarFixture.destroy("A"));
    expect(await page.evaluate(() => window.customToolbarFixture.cleanupCount("A"))).toBe(2);
  });

  test(`${kind} 的自定义格式浮层保持选区、格式、链接及只读状态`, async ({ page }) => {
    await page.evaluate((kind) => window.customToolbarFixture.mount(kind, "A", "format-floating"), kind);
    const host = page.locator("#custom-host-A");
    const editor = host.locator(".semlo-editor-prose");
    await expect(editor).toBeVisible();
    await page.evaluate(() => window.customToolbarFixture.selectText("A"));
    const bubble = host.getByRole("toolbar", { name: "选中文字工具" });
    const italic = bubble.getByRole("button", { name: "斜体" });
    await expect(bubble).toBeVisible();
    await italic.click();
    await expect(editor.locator("em")).toHaveText("hello world");
    await expect(italic).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.customToolbarFixture.editable("A", false));
    await expect(italic).toBeDisabled();
    await expect(host.locator(".semlo-editor-prose")).toHaveAttribute("aria-readonly", "true");
    await page.evaluate(() => window.customToolbarFixture.editable("A", true));
    await page.evaluate(() => window.customToolbarFixture.selectText("A"));
    await expect(bubble).toBeVisible();
    await bubble.getByRole("button", { name: "链接" }).click();
    const link = page.getByRole("dialog", { name: "插入链接" });
    await expect(link.getByLabel("文本")).toHaveValue("hello world");
    await link.getByLabel("链接", { exact: true }).fill("https://example.com");
    await link.getByRole("button", { name: "确定" }).click();
    await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com");
    await expect(editor.locator("a em")).toHaveText("hello world");
    await page.evaluate(() => window.customToolbarFixture.destroy("A"));
  });

  test(`${kind} 自定义主工具栏遵守标题与正文的加粗规则`, async ({ page }) => {
    await page.evaluate((kind) => window.customToolbarFixture.mount(kind, "A"), kind);
    const host = page.locator("#custom-host-A");
    const editor = host.locator(".semlo-editor-prose");
    const bold = host.getByRole("button", { name: "加粗 A" });
    await expect(bold).toBeVisible();
    await page.evaluate(() => window.customToolbarFixture.setContent("A", "<h2>title</h2><p>plain</p>"));
    await editor.focus();
    await page.evaluate(() => window.customToolbarFixture.selectRange("A", 1, 13));
    await bold.click();
    await expect(editor.locator("h2 strong")).toHaveCount(0);
    await expect(editor.locator("p strong")).toHaveText("plain");
    await page.evaluate(() => window.customToolbarFixture.undo("A"));
    await expect(editor.locator("p strong")).toHaveCount(0);
    await page.evaluate(() => window.customToolbarFixture.redo("A"));
    await expect(editor.locator("p strong")).toHaveText("plain");
    await page.evaluate(() => window.customToolbarFixture.selectRange("A", 1, 6));
    await expect(bold).toBeDisabled();
    await page.evaluate(() => window.customToolbarFixture.destroy("A"));
  });
}

test("默认及关闭主工具栏时保留浮动工具栏开关", async ({ page }) => {
  await page.evaluate(() => {
    window.customToolbarFixture.mount("core", "A", "default");
    window.customToolbarFixture.mount("core", "B", "hidden");
  });
  const first = page.locator("#custom-host-A");
  const second = page.locator("#custom-host-B");
  await page.evaluate(() => window.customToolbarFixture.selectText("A"));
  const bubble = first.getByRole("toolbar", { name: "选中文字工具" });
  await expect(bubble).toBeVisible();
  await expect(bubble.getByRole("button")).toHaveCount(1);
  await expect(bubble.getByRole("button", { name: "AI 写作" })).toBeDisabled();
  await expect(first.locator(".semlo-editor-prose")).toHaveText("hello world");
  await first.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "加粗", exact: true }).click();
  await expect(first.locator(".semlo-editor-prose strong")).toHaveText("hello world");
  await second.locator(".semlo-editor-prose").focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("B"));
  await expect(second.locator(".semlo-editor-prose")).toBeFocused();
  await expect(second.locator(".semlo-editor-bubble")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+b");
  await expect(second.locator(".semlo-editor-prose strong")).toHaveText("hello world");
  await page.evaluate(() => {
    window.customToolbarFixture.destroy("A");
    window.customToolbarFixture.destroy("B");
  });
});

test("窄屏下可用键盘操作自定义格式浮层", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.customToolbarFixture.mount("core", "A", "format-floating"));
  const editor = page.locator("#custom-host-A .semlo-editor-prose");
  await editor.focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("A"));
  const italic = page.getByRole("toolbar", { name: "选中文字工具" }).getByRole("button", { name: "斜体" });
  await expect(italic).toBeVisible();
  await italic.focus();
  await page.keyboard.press("Enter");
  await expect(editor.locator("em")).toHaveText("hello world");
  await page.evaluate(() => window.customToolbarFixture.destroy("A"));
});

test("触屏下可操作已选中文本的自定义格式浮层", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.customToolbarFixture));
    await page.evaluate(() => window.customToolbarFixture.mount("core", "A", "format-floating"));
    const editor = page.locator("#custom-host-A .semlo-editor-prose");
    await editor.tap();
    await page.evaluate(() => window.customToolbarFixture.selectText("A"));
    const bold = page.getByRole("toolbar", { name: "选中文字工具" }).getByRole("button", { name: "加粗" });
    await expect(bold).toBeVisible();
    await bold.tap();
    await expect(editor.locator("strong")).toHaveText("hello world");
    await page.evaluate(() => window.customToolbarFixture.destroy("A"));
  } finally {
    await context.close();
  }
});

test("自定义格式浮层在实例销毁和编辑器重挂载后保持隔离", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    window.customToolbarFixture.mount("core", "A", "format-floating");
    window.customToolbarFixture.mount("core", "B", "format-floating");
    window.customToolbarFixture.selectText("A");
  });
  const first = page.locator("#custom-host-A");
  const second = page.locator("#custom-host-B");
  const bubble = first.getByRole("toolbar", { name: "选中文字工具" });
  await expect(bubble).toBeVisible();
  await bubble.getByRole("button", { name: "斜体" }).evaluate((button) => {
    window.savedBubbleButton = button as HTMLButtonElement;
  });
  await page.evaluate(() => window.customToolbarFixture.destroy("A"));
  expect(
    await page.evaluate(() => {
      const button = window.savedBubbleButton!;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return button.disabled;
    }),
  ).toBe(true);
  await expect(second.locator(".semlo-editor-prose")).toHaveText("hello world");
  await page.evaluate(() => window.customToolbarFixture.remount("B"));
  await page.evaluate(() => window.customToolbarFixture.selectText("B"));
  const otherBubble = second.getByRole("toolbar", { name: "选中文字工具" });
  await expect(otherBubble).toBeVisible();
  await otherBubble.getByRole("button", { name: "斜体" }).click();
  await expect(second.locator(".semlo-editor-prose em")).toHaveText("hello world");
  await page.evaluate(() => window.customToolbarFixture.destroy("B"));
  expect(errors).toEqual([]);
});

test("自定义工具栏订阅及清理按实例隔离", async ({ page }) => {
  await page.evaluate(() => {
    window.customToolbarFixture.mount("core", "A");
    window.customToolbarFixture.mount("core", "B");
  });
  const before = await page.evaluate(() => window.customToolbarFixture.updateCount("B"));
  await page.evaluate(() => {
    window.customToolbarFixture.select("A");
    window.customToolbarFixture.editable("A", false);
  });
  expect(await page.evaluate(() => window.customToolbarFixture.updateCount("B"))).toBe(before);
  await expect(page.getByRole("button", { name: "加粗 B" })).toBeEnabled();
  await page.evaluate(() => window.customToolbarFixture.destroy("A"));
  expect(await page.evaluate(() => window.customToolbarFixture.cleanupCount("B"))).toBe(0);
  await page.evaluate(() => window.customToolbarFixture.destroy("B"));
  expect(await page.evaluate(() => window.customToolbarFixture.cleanupCount("B"))).toBe(1);
});

test("工具栏工厂失败或重入销毁时清理编辑器", async ({ page }) => {
  const thrown = await page.evaluate(() => window.customToolbarFixture.failure("throw"));
  expect(thrown).toEqual({ message: "工具栏装配失败", empty: true, destroyed: true, cleanups: 0 });
  const reentrant = await page.evaluate(() => window.customToolbarFixture.failure("destroy"));
  expect(reentrant).toEqual({
    message: "自定义工具栏装配期间编辑器已销毁或卸载",
    empty: true,
    destroyed: true,
    cleanups: 1,
  });
  const unmounted = await page.evaluate(() => window.customToolbarFixture.failure("unmount"));
  expect(unmounted).toEqual({
    message: "自定义工具栏装配期间编辑器已销毁或卸载",
    empty: true,
    destroyed: true,
    cleanups: 1,
  });
  const cleanup = await page.evaluate(() => window.customToolbarFixture.failure("cleanup"));
  expect(cleanup).toEqual({ message: "工具栏清理失败", empty: true, destroyed: true, cleanups: 1 });
});

test("退订后不再接收状态变化", async ({ page }) => {
  await page.evaluate(() => window.customToolbarFixture.mount("core", "A"));
  await expect(page.getByRole("button", { name: "加粗 A" })).toBeVisible();
  await page.evaluate(() => window.customToolbarFixture.unsubscribe("A"));
  const before = await page.evaluate(() => window.customToolbarFixture.updateCount("A"));
  await page.evaluate(() => window.customToolbarFixture.editable("A", false));
  expect(await page.evaluate(() => window.customToolbarFixture.updateCount("A"))).toBe(before);
  await page.evaluate(() => window.customToolbarFixture.destroy("A"));
});

test("窄屏下可用键盘操作自定义工具栏", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.customToolbarFixture.mount("core", "A"));
  const button = page.getByRole("button", { name: "加粗 A" });
  await expect(button).toBeVisible();
  await page.locator("#custom-host-A .semlo-editor-prose").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#custom-host-A .semlo-editor-prose strong")).toHaveText("hello world");
  await page.evaluate(() => window.customToolbarFixture.destroy("A"));
});

test("直接销毁底层编辑器时仍释放工具栏，重复销毁不重复清理", async ({ page }) => {
  await page.evaluate(() => window.customToolbarFixture.mount("core", "A"));
  await expect(page.getByRole("button", { name: "加粗 A" })).toBeVisible();
  await page.evaluate(() => window.customToolbarFixture.destroyUnderlying("A"));
  expect(await page.evaluate(() => window.customToolbarFixture.cleanupCount("A"))).toBe(1);
  await expect(page.locator("#custom-host-A")).toBeEmpty();
  await page.evaluate(() => window.customToolbarFixture.destroy("A"));
  expect(await page.evaluate(() => window.customToolbarFixture.cleanupCount("A"))).toBe(1);
});

test("自定义工具栏不创建默认主工具栏控件", async ({ page }) => {
  const defaults = await page.evaluate(() => window.customToolbarFixture.probeDefaultControls(false));
  expect(defaults).toContain("段落样式");
  expect(defaults).toContain("格式刷");
  const custom = await page.evaluate(() => window.customToolbarFixture.probeDefaultControls(true));
  expect(custom).toEqual([]);
});

for (const floating of ["inherit", "default", "hidden", "custom"] as const) {
  test(`关闭主工具栏且浮动工具栏为 ${floating} 时不创建默认主工具栏`, async ({ page }) => {
    const created = await page.evaluate(
      (floating) => window.customToolbarFixture.probeHiddenToolbar(floating),
      floating,
    );
    expect(created).toEqual({
      roots: 0,
      floatingRoots: floating === "default" || floating === "custom" ? 1 : 0,
      labels: [],
    });
  });
}

for (const kind of ["core", "react", "vue", "solid"] as const) {
  test(`${kind} 关闭主工具栏时保留加粗、高亮、查找和格式刷快捷键`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluate((kind) => window.customToolbarFixture.mount(kind, "A", "hidden"), kind);
    await page.waitForFunction(() => window.customToolbarFixture.ready("A"));
    const host = page.locator("#custom-host-A");
    const editor = host.locator(".semlo-editor-prose");
    await expect(editor).toBeVisible();
    await expect(host.locator(".semlo-editor-toolbar, .semlo-editor-bubble")).toHaveCount(0);
    await page.evaluate(() => window.customToolbarFixture.selectText("A"));
    await expect(editor).toBeFocused();
    await page.keyboard.press("ControlOrMeta+b");
    await expect(editor.locator("strong")).toHaveText("hello world");
    await page.evaluate(() => window.customToolbarFixture.undo("A"));
    await expect(editor.locator("strong")).toHaveCount(0);
    await page.evaluate(() => window.customToolbarFixture.redo("A"));
    await expect(editor.locator("strong")).toHaveText("hello world");
    await page.evaluate(() => window.customToolbarFixture.selectText("A"));
    await expect(editor).toBeFocused();
    await page.keyboard.press("Alt+ControlOrMeta+h");
    await expect(editor.locator("mark")).toHaveCSS("background-color", "rgb(251, 222, 40)");
    await page.keyboard.press("ControlOrMeta+f");
    const panel = page.getByRole("dialog", { name: "查找替换" });
    await expect(panel).toBeVisible();
    await panel.getByRole("tab", { name: "替换" }).click();
    await panel.getByRole("textbox", { name: "查找内容" }).fill("hello");
    await panel.getByRole("textbox", { name: "替换为" }).fill("new");
    await panel.getByRole("button", { name: "替换", exact: true }).click();
    await expect(editor).toHaveText("new world");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.customToolbarFixture.undo("A"));
    await expect(editor).toHaveText("hello world");
    await page.evaluate(() => window.customToolbarFixture.setContent("A", "<p><strong>bold</strong> plain</p>"));
    await editor.focus();
    await page.evaluate(() => window.customToolbarFixture.selectRange("A", 1, 5));
    await page.keyboard.press("ControlOrMeta+Shift+s");
    await expect(editor).toHaveClass(/semlo-editor-format-painter-active/);
    await page.evaluate(() => window.customToolbarFixture.selectRange("A", 6, 11));
    await page.keyboard.press("Enter");
    await expect(editor.locator("strong")).toHaveCount(2);
    await expect(editor.locator("strong").nth(1)).toHaveText("plain");
    await page.evaluate(() => window.customToolbarFixture.undo("A"));
    await expect(editor.locator("strong")).toHaveText("bold");
    await page.evaluate(() => window.customToolbarFixture.destroy("A"));
    expect(errors).toEqual([]);
  });
}

test("关闭主工具栏时链接快捷键保留选区和撤销重做", async ({ page }) => {
  await page.evaluate(() => window.customToolbarFixture.mount("core", "A", "hidden"));
  const editor = page.locator("#custom-host-A .semlo-editor-prose");
  await editor.focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("A"));
  await page.keyboard.press("ControlOrMeta+k");
  const link = page.getByRole("dialog", { name: "插入链接" });
  await expect(link.getByLabel("文本")).toHaveValue("hello world");
  await link.getByLabel("链接", { exact: true }).fill("https://example.com");
  await link.getByRole("button", { name: "确定" }).click();
  await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com");
  await expect(editor.locator("a")).toHaveText("hello world");
  await page.evaluate(() => window.customToolbarFixture.undo("A"));
  await expect(editor.locator("a")).not.toHaveAttribute("href", "https://example.com");
  await page.evaluate(() => window.customToolbarFixture.undo("A"));
  await expect(editor.locator("a")).toHaveCount(0);
  await page.evaluate(() => window.customToolbarFixture.redo("A"));
  await page.evaluate(() => window.customToolbarFixture.redo("A"));
  await expect(editor.locator("a")).toHaveText("hello world");
  await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com");
  await page.evaluate(() => window.customToolbarFixture.destroy("A"));
});

test("关闭主工具栏时高亮快捷键保持实例隔离并随编辑器重挂载清理", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.evaluate(() => {
    window.customToolbarFixture.mount("core", "A", "hidden");
    window.customToolbarFixture.mount("core", "B", "default");
  });
  const hidden = page.locator("#custom-host-A .semlo-editor-prose");
  const visibleHost = page.locator("#custom-host-B");
  const visible = visibleHost.locator(".semlo-editor-prose");
  await visible.focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("B"));
  await visibleHost.getByRole("button", { name: "高亮颜色", exact: true }).click();
  await page.getByRole("dialog", { name: "选择颜色" }).getByRole("button", { name: "浅蓝 #117cee" }).click();
  await expect(visible.locator("mark")).toHaveCSS("background-color", "rgb(17, 124, 238)");

  await hidden.focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("A"));
  const before = await hidden.innerHTML();
  const composingPrevented = await hidden.evaluate((element) => {
    const event = new KeyboardEvent("keydown", {
      key: "h",
      altKey: true,
      metaKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(composingPrevented).toBe(false);
  expect(await hidden.innerHTML()).toBe(before);
  await page.evaluate(() => window.customToolbarFixture.editable("A", false));
  await expect(hidden).toHaveAttribute("aria-readonly", "true");
  await expect(page.locator("#custom-host-A .semlo-editor")).toHaveClass(/semlo-editor-readonly/);
  const readonlyPrevented = await hidden.evaluate((element) => {
    const event = new KeyboardEvent("keydown", {
      key: "h",
      altKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(readonlyPrevented).toBe(false);
  expect(await hidden.innerHTML()).toBe(before);
  await page.evaluate(() => window.customToolbarFixture.editable("A", true));
  await hidden.focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("A"));
  await page.keyboard.press("Alt+ControlOrMeta+h");
  await expect(hidden.locator("mark")).toHaveCSS("background-color", "rgb(251, 222, 40)");
  await expect(visible.locator("mark")).toHaveCSS("background-color", "rgb(17, 124, 238)");

  await hidden.evaluate((element) => (window.savedHiddenEditor = element as HTMLElement));
  await page.evaluate(() => window.customToolbarFixture.remount("A"));
  const pressOld = () => {
    const event = new KeyboardEvent("keydown", {
      key: "h",
      altKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.savedHiddenEditor!.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(await page.evaluate(pressOld)).toBe(false);
  await page.evaluate(() => window.customToolbarFixture.setContent("A", "<p>again</p>"));
  await hidden.focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("A"));
  await page.keyboard.press("Alt+ControlOrMeta+h");
  await expect(hidden.locator("mark")).toHaveText("again");
  await expect(hidden.locator("mark")).toHaveCSS("background-color", "rgb(251, 222, 40)");
  await hidden.evaluate((element) => (window.savedHiddenEditor = element as HTMLElement));
  await page.evaluate(() => window.customToolbarFixture.destroy("A"));
  expect(await page.evaluate(pressOld)).toBe(false);
  await page.evaluate(() => window.customToolbarFixture.setContent("B", "<p>still independent</p>"));
  await visible.focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("B"));
  await page.keyboard.press("Alt+ControlOrMeta+h");
  await expect(visible.locator("mark")).toHaveCSS("background-color", "rgb(17, 124, 238)");
  await page.evaluate(() => window.customToolbarFixture.destroy("B"));
});

test("自定义工具栏保留查找、高亮、格式刷快捷键及自定义格式浮层", async ({ page }) => {
  await page.evaluate(() => window.customToolbarFixture.mount("core", "A", "format-floating"));
  const host = page.locator("#custom-host-A");
  const editor = host.locator(".semlo-editor-prose");
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("A"));
  const bubble = host.getByRole("toolbar", { name: "选中文字工具" });
  await expect(bubble).toBeVisible();
  const italic = bubble.getByRole("button", { name: "斜体" });
  await italic.click();
  await expect(editor.locator("em")).toHaveText("hello world");
  await expect(italic).toHaveAttribute("aria-pressed", "true");
  await editor.focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("A"));
  await page.keyboard.press("Alt+ControlOrMeta+h");
  await expect(editor.locator("mark")).toHaveCSS("background-color", "rgb(251, 222, 40)");
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByRole("dialog", { name: "查找替换" })).toBeVisible();
  await page.keyboard.press("Escape");
  await editor.focus();
  await page.evaluate(() => window.customToolbarFixture.selectText("A"));
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect(editor).toHaveClass(/semlo-editor-format-painter-active/);
  await page.keyboard.press("Escape");
  await expect(editor).not.toHaveClass(/semlo-editor-format-painter-active/);
  await page.evaluate(() => window.customToolbarFixture.destroy("A"));
});

test("自定义工具栏的查找替换按编辑器实例隔离", async ({ page }) => {
  await page.evaluate(() => {
    window.customToolbarFixture.mount("core", "A");
    window.customToolbarFixture.mount("core", "B");
  });
  const first = page.locator("#custom-host-A .semlo-editor-prose");
  const second = page.locator("#custom-host-B .semlo-editor-prose");
  await first.focus();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await expect(panel).toBeVisible();
  const panelId = await panel.getAttribute("id");
  expect(panelId).toBeTruthy();
  await expect(page.locator("#custom-host-A .semlo-editor")).toHaveAttribute("aria-controls", panelId!);
  await expect(page.locator("#custom-host-B .semlo-editor")).not.toHaveAttribute("aria-controls", panelId!);
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "查找内容" }).fill("hello");
  await panel.getByRole("textbox", { name: "替换为" }).fill("new");
  await panel.getByRole("button", { name: "替换", exact: true }).click();
  await expect(first).toHaveText("new world");
  await expect(second).toHaveText("hello world");
  await page.keyboard.press("Escape");
  await expect(page.locator("#custom-host-A .semlo-editor")).not.toHaveAttribute("aria-controls", panelId!);
  await page.evaluate(() => {
    window.customToolbarFixture.destroy("A");
    window.customToolbarFixture.destroy("B");
  });
});

test("自定义工具栏可用格式刷快捷键复制格式并撤销", async ({ page }) => {
  await page.evaluate(() => {
    window.customToolbarFixture.mount("core", "A");
    window.customToolbarFixture.setContent("A", "<p><strong>bold</strong> plain</p>");
  });
  const editor = page.locator("#custom-host-A .semlo-editor-prose");
  await editor.focus();
  await page.evaluate(() => window.customToolbarFixture.selectRange("A", 1, 5));
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect(editor).toHaveClass(/semlo-editor-format-painter-active/);
  await page.evaluate(() => window.customToolbarFixture.selectRange("A", 6, 11));
  await page.keyboard.press("Enter");
  await expect(editor.locator("strong")).toHaveCount(2);
  await expect(editor.locator("strong").nth(1)).toHaveText("plain");
  await page.evaluate(() => window.customToolbarFixture.undo("A"));
  await expect(editor.locator("strong")).toHaveText("bold");
  await page.evaluate(() => window.customToolbarFixture.destroy("A"));
});
