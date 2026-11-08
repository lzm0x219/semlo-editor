import { fork, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

declare global {
  interface Window {
    __docsScrollSamples?: number[];
  }
}

let origin = "";
let server: ChildProcess | undefined;

beforeAll(async () => {
  // Run Rspress outside the Rstest worker so its compiler does not share the worker's module environment.
  server = fork(resolve("tests/fixtures/docs/docs-test-server.ts"), [], {
    env: { ...process.env, NODE_ENV: "development" },
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  server.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  server.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const port = await new Promise<number>((resolvePort, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Documentation server did not start: ${output}`)), 30_000);
    server?.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server?.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Documentation server exited (${code}): ${output}`));
    });
    server?.on("message", (message) => {
      if (message && typeof message === "object" && "port" in message && typeof message.port === "number") {
        clearTimeout(timeout);
        resolvePort(message.port);
      }
    });
  });
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  await new Promise<void>((resolveExit) => {
    const timeout = setTimeout(() => server?.kill("SIGKILL"), 5000);
    server?.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
    server?.send("stop");
  });
});

test("mobile home links to the live editor and keeps its controls usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${origin}/`);
  const entry = page.getByRole("link", { name: "试用编辑器" });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("href", "#semlo-editor-demo");
  const bounds = await entry.boundingBox();
  expect(bounds && bounds.y + bounds.height <= 568).toBe(true);
  await entry.focus();
  await page.keyboard.press("Enter");
  expect(await page.locator(".semlo-editor-hero").evaluate((element) => element.scrollTop)).toBe(0);
  const editor = page.locator("#semlo-editor-demo .semlo-editor-prose");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await expect
    .poll(async () => {
      const box = await editor.boundingBox();
      return Boolean(box && box.y < 568 && box.y + box.height > 64);
    })
    .toBe(true);
  const insert = page.getByRole("button", { name: "插入内容" });
  await expect(insert).toBeVisible();
  const insertBounds = await insert.boundingBox();
  expect(insertBounds && insertBounds.width >= 44 && insertBounds.height >= 44).toBe(true);
  await page.getByRole("button", { name: "更多", exact: true }).click();
  const overflow = page.locator(".semlo-editor-toolbar-overflow-panel:not([hidden])");
  await expect(overflow).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("home editor explains actual overflow and updates hints as content is scrolled", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${origin}/`);
  const chooser = page.locator(".semlo-editor-example-trigger");
  await expect(chooser).toContainText("示例：开始写作");
  await expect(chooser).toBeEnabled();
  const hint = page.locator(".semlo-editor-editor-scroll-hint");
  await expect(hint).toHaveCount(0);

  await chooser.click();
  await page.getByRole("menuitem", { name: "数据表" }).click();
  await expect(chooser).toContainText("示例：数据表");
  await expect(page.locator(".semlo-editor-editor-caption-primary")).toContainText("已切换至数据表");
  await expect(hint).toContainText("向下查看更多");
  await expect(hint).toContainText("内容可横向滚动");

  const table = page.locator(".semlo-editor-editor-host .semlo-editor-database-body");
  await table.evaluate((element) => (element.scrollLeft = element.scrollWidth));
  await expect(hint).not.toContainText("内容可横向滚动");
  const host = page.locator(".semlo-editor-editor-host");
  await host.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await expect(hint).toHaveCount(0);

  await chooser.click();
  await page.getByRole("menuitem", { name: "开始写作" }).click();
  await expect(hint).toHaveCount(0);
});

test("home editor keeps the example selector and scroll hints usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/`);
  const chooser = page.locator(".semlo-editor-example-trigger");
  await expect(chooser).toBeEnabled();
  await chooser.click();
  await page.getByRole("menuitem", { name: "数据表" }).click();
  await expect(chooser).toContainText("示例：数据表");
  const hint = page.locator(".semlo-editor-editor-scroll-hint");
  await expect(hint).toContainText("向下查看更多");
  await page.locator(".semlo-editor-editor-host .semlo-editor-database-body").scrollIntoViewIfNeeded();
  await expect(hint).toContainText("内容可横向滚动");
  const guide = page.locator(".semlo-editor-editor-guide summary");
  const [hintBounds, guideBounds] = await Promise.all([hint.boundingBox(), guide.boundingBox()]);
  expect(
    hintBounds &&
      guideBounds &&
      (hintBounds.x + hintBounds.width <= guideBounds.x || hintBounds.y >= guideBounds.y + guideBounds.height - 2),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("home code examples disclose overflow, scroll by keyboard, and keep readable labels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/`);
  const code = page.getByRole("region", { name: "Vue 代码示例" });
  await expect(page.getByText("可横向滚动")).toBeVisible();
  await expect(code).toHaveAttribute("tabindex", "0");
  await code.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => code.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const react = page.getByRole("button", { name: "React", exact: true });
  const reactBounds = await react.boundingBox();
  expect(reactBounds && reactBounds.width >= 44 && reactBounds.height >= 44).toBe(true);
  await react.click();
  await expect(react).toHaveAttribute("aria-pressed", "true");
  const reactCode = page.getByRole("region", { name: "React 代码示例" });
  await expect(reactCode).toContainText("@semlo-editor/react");
  await expect.poll(() => reactCode.evaluate((element) => element.scrollLeft)).toBe(0);

  const ratios = await page.evaluate(() => {
    function rgb(color: string) {
      return color.match(/\d+/g)!.slice(0, 3).map(Number);
    }
    function luminance(color: number[]) {
      return color.reduce((total, channel, index) => {
        const value = channel / 255;
        const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        return total + linear * [0.2126, 0.7152, 0.0722][index];
      }, 0);
    }
    function contrast(selector: string, background: string) {
      const text = luminance(rgb(getComputedStyle(document.querySelector(selector)!).color));
      const base = luminance(rgb(getComputedStyle(document.querySelector(background)!).backgroundColor));
      return (Math.max(text, base) + 0.05) / (Math.min(text, base) + 0.05);
    }
    return [
      contrast(".semlo-editor-editor-caption", ".semlo-editor-editor-frame"),
      contrast(".semlo-editor-framework-filename", ".semlo-editor-framework-preview"),
    ];
  });
  expect(ratios[0]).toBeGreaterThanOrEqual(4.5);
  expect(ratios[1]).toBeGreaterThanOrEqual(4.5);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByText("可横向滚动")).toHaveCount(0);
  await expect(reactCode).not.toHaveAttribute("tabindex");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("可横向滚动")).toBeVisible();
  await page.getByRole("button", { name: "打开站点导航" }).click();
  const nav = page.getByRole("dialog", { name: "站点导航" });
  await expect(nav.getByText("项目链接暂未开放")).toBeVisible();
  await expect(nav.getByRole("img", { name: "GitHub：暂未开通" })).toBeVisible();
});

for (const width of [1440, 900, 390]) {
  test(`scrolling the documentation does not bounce back at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`${origin}/getting-started`);
    await page
      .locator(
        ".semlo-editor-manual .rspress-doc > .semlo-editor-doc-title > h1, .semlo-editor-manual .rspress-doc > h1",
      )
      .waitFor();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const samples: number[] = [];
      Object.assign(window, { __docsScrollSamples: samples });
      window.addEventListener("scroll", () => samples.push(window.scrollY), { passive: true });
    });

    await page.mouse.move(Math.floor(width / 2), 400);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(900);

    const result = await page.evaluate(() => {
      if (!window.__docsScrollSamples) throw new Error("Scroll samples are not initialized");
      return { samples: window.__docsScrollSamples, final: window.scrollY };
    });
    const maximum = Math.max(0, ...result.samples);
    expect(maximum).toBeGreaterThan(400);
    expect(result.final).toBeGreaterThanOrEqual(maximum - 10);
  });
}

test("the desktop sidebar can be collapsed and restored without affecting mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 850 });
  await page.goto(`${origin}/getting-started`);
  await page.evaluate(() => {
    sessionStorage.removeItem("semlo-editor:docs:sidebar-collapsed");
    sessionStorage.removeItem("semlo-editor:docs:sidebar-groups");
  });
  await page.reload();

  const sidebar = page.locator("#manual-navigation");
  const toggle = sidebar.locator(".semlo-editor-sidebar__collapse");
  const navigation = sidebar.locator("#manual-navigation-sections");
  const main = page.locator(".semlo-editor-manual__main");
  const expandedWidth = (await main.boundingBox())!.width;
  await expect(toggle).toHaveAttribute("aria-label", "收起文档导航");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-label", "展开文档导航");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).toBeHidden();
  expect((await main.boundingBox())!.width).toBeGreaterThan(expandedWidth + 100);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(250);
  await page.waitForFunction(() => sessionStorage.getItem("semlo-editor:docs:sidebar-collapsed") === "true");

  await page.goto(`${origin}/api`);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "文档导航" }).click();
  const dialog = page.getByRole("dialog", { name: "文档导航" });
  await expect(dialog.getByRole("link", { name: "API 参考" })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭文档导航" }).click();

  await page.setViewportSize({ width: 900, height: 850 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(navigation).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "API 参考" })).toHaveAttribute("aria-current", "page");

  await page.goto(`${origin}/`);
  await expect(page.getByRole("button", { name: "收起文档导航" })).toHaveCount(0);
});

test("reopening the sidebar reveals the current page in a long directory", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto(`${origin}/introduction`);
  await page.evaluate(() => {
    sessionStorage.setItem("semlo-editor:docs:sidebar-collapsed", "true");
    sessionStorage.setItem(
      "semlo-editor:docs:sidebar-groups",
      JSON.stringify({ 开始使用: true, 理解编辑器: true, 编辑功能: true, 接入与集成: true, 参考与支持: true }),
    );
  });
  await page.reload();
  const sidebar = page.locator("#manual-navigation");
  const toggle = sidebar.locator(".semlo-editor-sidebar__collapse");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.locator(".rspress-doc").getByRole("link", { name: "API 参考", exact: true }).click();
  await page.waitForURL("**/api");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await page.waitForFunction(() => {
    const scroller = document.querySelector("#manual-navigation-sections");
    const current = scroller?.querySelector('[aria-current="page"]');
    if (!scroller || !current) return false;
    const bounds = scroller.getBoundingClientRect();
    const target = current.getBoundingClientRect();
    return target.top >= bounds.top && target.bottom <= bounds.bottom;
  });
  await expect(sidebar.getByRole("link", { name: "API 参考" })).toHaveAttribute("aria-current", "page");
});

test("the sidebar keeps its group choices and reveals the current page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto(`${origin}/introduction`);
  await page.evaluate(() => sessionStorage.removeItem("semlo-editor:docs:sidebar-groups"));
  await page.reload();
  const sidebar = page.locator("#manual-navigation");
  const groups = sidebar.locator(".semlo-editor-sidebar-group__toggle");
  await expect(groups).toHaveCount(5);
  await expect(sidebar.locator(".semlo-editor-sidebar-group__number")).toHaveText(["01", "02", "03", "04", "05"]);
  await expect(sidebar.getByRole("button", { name: "开始使用", exact: true })).toBeVisible();
  await expect(sidebar.locator('.semlo-editor-sidebar-group__toggle[aria-expanded="true"]')).toHaveCount(1);
  await expect(sidebar.getByRole("link", { name: "认识 semlo-editor" })).toHaveAttribute("aria-current", "page");

  await expect(sidebar.getByRole("button", { name: "展开全部分组" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "收起全部分组" })).toHaveCount(0);
  const currentGroup = groups.nth(0);
  await currentGroup.focus();
  await page.keyboard.press("Enter");
  await expect(currentGroup).toBeFocused();
  await expect(currentGroup).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar.locator('.semlo-editor-sidebar-group__toggle[aria-expanded="true"]')).toHaveCount(0);
  await expect(sidebar.locator(".semlo-editor-sidebar-group--active .semlo-editor-sidebar-group__current")).toHaveText(
    "当前",
  );

  await sidebar.getByRole("button", { name: "理解编辑器" }).focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => {
    const saved = sessionStorage.getItem("semlo-editor:docs:sidebar-groups");
    return saved && JSON.parse(saved)["理解编辑器"] === true;
  });
  await page.reload();
  await expect(sidebar.getByRole("button", { name: "理解编辑器" })).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("button", { name: "开始使用" })).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar.locator(".semlo-editor-sidebar-group--active .semlo-editor-sidebar-group__current")).toHaveText(
    "当前",
  );
  await page.locator(".rspress-doc").getByRole("link", { name: "API 参考", exact: true }).click();
  await page.waitForURL("**/api");
  await expect(sidebar.getByRole("button", { name: "参考与支持" })).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("button", { name: "理解编辑器" })).toHaveAttribute("aria-expanded", "true");
});

test("the mobile sidebar focuses the current group when its page is collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/api`);
  await page.evaluate(() => sessionStorage.removeItem("semlo-editor:docs:sidebar-groups"));
  await page.reload();
  const trigger = page.getByRole("button", { name: "文档导航" });
  await trigger.click();
  const sidebar = page.getByRole("dialog", { name: "文档导航" });
  const group = sidebar.getByRole("button", { name: "参考与支持" });
  await expect(sidebar.getByRole("link", { name: "API 参考" })).toBeFocused();
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "关闭文档导航" }).click();
  await trigger.click();
  await expect(group).toBeFocused();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar.locator(".semlo-editor-sidebar-group--active .semlo-editor-sidebar-group__current")).toHaveText(
    "当前",
  );

  await page.getByRole("button", { name: "关闭文档导航" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(group).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("the reading title and code tools preserve document behavior", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.goto(`${origin}/getting-started`);
  const title = page.locator(".semlo-editor-doc-title > h1");
  await expect(title).toContainText("安装与接入");
  await expect(page.getByRole("button", { name: "复制 Markdown" })).toBeVisible();
  const more = page.getByRole("button", { name: "更多文档操作" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const copyLink = page.getByRole("button", { name: "复制 Markdown 链接" });
  await page.keyboard.press("Tab");
  await expect(copyLink).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toBeFocused();
  await more.click();
  await copyLink.click();
  await page.waitForFunction(
    async (url) => (await navigator.clipboard.readText()) === url,
    `${origin}/getting-started.md`,
  );

  const example = page.locator(".rp-codeblock").first();
  const expected = (await example.locator("pre").innerText()).trim();
  await expect(example.getByTitle("复制代码")).toBeVisible();
  await example.getByTitle("复制代码").click();
  await page.waitForFunction(async (text) => (await navigator.clipboard.readText()).trim() === text, expected);

  // 用明确的窄屏条件制造横向溢出，避免依赖 API 示例是否按单行排版。
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${origin}/api`);
  const overflowing = page.locator(".rp-codeblock").first();
  await expect(overflowing).toBeVisible();
  await expect(overflowing).toHaveAttribute("data-horizontal-scroll", "");
  await overflowing.getByRole("button", { name: "切换代码换行" }).click();
  await expect(overflowing.locator(".rp-codeblock__content")).toHaveClass(/rp-codeblock__content--wrap-code/);
  await expect(overflowing).not.toHaveAttribute("data-horizontal-scroll", "");

  await page.getByRole("button", { name: "更多文档操作" }).click();
  const menu = page.getByRole("group", { name: "更多文档操作" });
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
});

test("search supports quick links, result navigation and clearing with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${origin}/`);
  const trigger = page.locator(".rp-nav .rp-search-button");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  const input = dialog.getByRole("textbox", { name: "搜索文档" });
  await expect(input).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("link", { name: /编辑与组织内容/ })).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/editing");
  await expect(dialog).toHaveCount(0);

  await trigger.click();
  await input.fill("API");
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("");
  await expect(dialog.getByText("快速访问", { exact: true })).toBeVisible();
  await input.fill("zzzxxyy");
  await expect(dialog.locator(".rp-no-search-result")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await input.fill("API");
  const results = dialog.locator(".rp-suggest-item");
  await results.first().waitFor();
  await page.keyboard.press("ArrowDown");
  await expect(results.nth(1)).toHaveClass(/rp-suggest-item--current/);
  const selectedHref = await results.nth(1).locator("a").getAttribute("href");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => `${url.pathname}${decodeURIComponent(url.hash)}` === selectedHref);
  await expect(dialog).toHaveCount(0);

  await trigger.click();
  await input.fill("API");
  await results.first().waitFor();
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("");
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(dialog.getByRole("link", { name: /快速开始/ })).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/getting-started");
  await expect(dialog).toHaveCount(0);

  await trigger.click();
  await input.fill("API");
  const focusedResult = dialog.locator('.rp-suggest-item a[href*="#"]').first();
  await focusedResult.waitFor();
  const focusedHref = await focusedResult.getAttribute("href");
  await focusedResult.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => `${url.pathname}${decodeURIComponent(url.hash)}` === focusedHref);
  await expect(dialog).toHaveCount(0);
});

test("mobile search fits the viewport and clears without closing", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${origin}/`);
  await page.getByRole("button", { name: "搜索文档" }).click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  const input = dialog.getByRole("textbox", { name: "搜索文档" });
  await input.fill("编辑");
  const clear = dialog.getByRole("button", { name: "清空搜索" });
  await expect(clear).toHaveCSS("width", "44px");
  await expect(clear).toHaveCSS("height", "44px");
  await clear.click();
  await expect(input).toHaveValue("");
  await expect(dialog.getByText("快速访问", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await dialog.getByRole("button", { name: "关闭搜索" }).click();
  await expect(dialog).toHaveCount(0);
});

test("search groups results and actions follow the selected section", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.goto(`${origin}/`);
  await page.locator(".rp-nav .rp-search-button").click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  const input = dialog.getByRole("textbox", { name: "搜索文档" });
  await input.fill("表格");
  const firstGroup = dialog.locator(".rp-search-panel__group").first();
  await expect(firstGroup).toHaveAttribute("data-semlo-editor-group", "表格与数据表");
  await expect(firstGroup.locator('[data-semlo-editor-heading="数据表视图"]')).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.locator(".semlo-editor-search__footer-brand")).toContainText("正文表格");

  await page.keyboard.press("ControlOrMeta+K");
  const menu = dialog.getByRole("dialog", { name: "当前结果操作" });
  const actionInput = menu.getByRole("combobox", { name: "搜索操作" });
  const open = menu.getByRole("option", { name: "打开文档" });
  const newTab = menu.getByRole("option", { name: "在新标签页中打开" });
  const copy = menu.getByRole("option", { name: "复制链接" });
  await expect(actionInput).toBeFocused();
  await expect(open).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(newTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Tab");
  await expect(copy).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(input).toHaveValue("表格");
  await expect(input).toBeFocused();
  await expect(dialog.locator(".rp-suggest-item--current a")).toHaveAttribute("href", "/tables-and-databases#正文表格");

  await page.keyboard.press("ControlOrMeta+K");
  await copy.click();
  const expectedLink = `${origin}/tables-and-databases#${encodeURIComponent("正文表格")}`;
  await page.waitForFunction(async (expected) => (await navigator.clipboard.readText()) === expected, expectedLink);
  await expect(dialog.locator(".semlo-editor-search__footer-brand")).toHaveText("链接已复制");
  await expect(dialog.locator(".rp-suggest-item--current a")).toHaveAttribute("href", "/tables-and-databases#正文表格");

  await page.keyboard.press("ControlOrMeta+K");
  const popupPromise = page.waitForEvent("popup");
  await newTab.click();
  const popup = await popupPromise;
  await popup.waitForURL(
    (url) => url.pathname === "/tables-and-databases" && decodeURIComponent(url.hash) === "#正文表格",
  );
  await popup.close();
  await expect(dialog).toHaveCount(0);

  await page.locator(".rp-nav .rp-search-button").click();
  await input.fill("表格");
  await firstGroup.locator(".rp-suggest-item").first().waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ControlOrMeta+K");
  await expect(menu.locator(".semlo-editor-search__actions-label")).toContainText("正文表格");
  await expect(actionInput).toBeFocused();
  await expect(open).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await page.waitForURL(
    (url) => url.pathname === "/tables-and-databases" && decodeURIComponent(url.hash) === "#正文表格",
    { timeout: 5000 },
  );
  await expect(dialog).toHaveCount(0);
});

test("keyboard navigation keeps long search results in view", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${origin}/`);
  await page.getByRole("button", { name: "搜索文档" }).click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  await dialog.getByRole("textbox", { name: "搜索文档" }).fill("编辑");
  const results = dialog.locator(".rp-search-panel__results");
  await results.locator(".rp-suggest-item").first().waitFor();
  for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowDown");
  await expect
    .poll(async () => {
      const viewport = await results.boundingBox();
      const current = await results.locator(".rp-suggest-item--current a").boundingBox();
      return Boolean(
        viewport && current && current.y >= viewport.y && current.y + current.height <= viewport.y + viewport.height,
      );
    })
    .toBe(true);
  const actions = dialog.getByRole("button", { name: "操作" });
  expect((await actions.boundingBox())?.width).toBeGreaterThanOrEqual(44);
  await actions.click();
  const menu = dialog.getByRole("dialog", { name: "当前结果操作" });
  await expect(menu.getByRole("combobox", { name: "搜索操作" })).toHaveCSS("font-size", "16px");
  await expect(menu.getByRole("option", { name: "打开文档" })).toHaveAttribute("aria-selected", "true");
  expect((await menu.getByRole("option", { name: "打开文档" }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const menuBounds = await menu.boundingBox();
  expect(menuBounds?.x).toBeGreaterThanOrEqual(0);
  expect((menuBounds?.x ?? 0) + (menuBounds?.width ?? 0)).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("search supports section shortcuts, action filtering and protects against stale results", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.goto(`${origin}/`);
  const trigger = page.locator(".rp-nav .rp-search-button");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  const input = dialog.getByRole("textbox", { name: "搜索文档" });
  await input.fill("表格");
  const groups = dialog.locator(".rp-search-panel__group");
  await expect(groups.first()).toHaveAttribute("data-semlo-editor-count", "4");
  const current = dialog.locator(".rp-suggest-item--current a");
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(current).toHaveAttribute("href", "/editing#表格和数据表");
  await page.keyboard.press("ControlOrMeta+ArrowUp");
  await expect(current).toHaveAttribute("href", "/tables-and-databases");
  await page.keyboard.press("Alt+ArrowDown");
  await expect(current).not.toHaveAttribute("href", "/tables-and-databases");
  const target = await current.getAttribute("href");

  await page.keyboard.press("ControlOrMeta+K");
  const menu = dialog.getByRole("dialog", { name: "当前结果操作" });
  const actionInput = menu.getByRole("combobox", { name: "搜索操作" });
  await expect(actionInput).toBeFocused();
  await actionInput.fill("不存在的操作");
  await expect(menu.getByText("没有匹配的操作")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await actionInput.fill("复制");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await expect(actionInput).toHaveAttribute("aria-activedescendant", "semlo-editor-action-copy");
  await actionInput.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await actionInput.dispatchEvent("keydown", { key: "Escape", code: "Escape", isComposing: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Enter");
  const expectedLink = new URL(target!, origin).href;
  await page.waitForFunction(async (expected) => (await navigator.clipboard.readText()) === expected, expectedLink);
  await expect(menu).toHaveCount(0);
  await expect(input).toBeFocused();

  const popupPromise = page.waitForEvent("popup");
  await page.keyboard.press("ControlOrMeta+Enter");
  const popup = await popupPromise;
  await popup.waitForURL(expectedLink);
  await popup.close();
  await expect(dialog).toHaveCount(0);

  await trigger.click();
  await input.fill("API");
  await dialog.locator(".rp-suggest-item").first().waitFor();
  await input.fill("zzzxxyy");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(input).toHaveValue("zzzxxyy");
  await expect(dialog.locator(".rp-no-search-result")).toBeVisible();
});

test("search favorites and recent documents persist and can be removed", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${origin}/`);
  const trigger = page.locator(".rp-nav .rp-search-button");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  const input = dialog.getByRole("textbox", { name: "搜索文档" });
  await input.fill("表格");
  await dialog.locator(".rp-search-panel__group").first().waitFor();
  await page.keyboard.press("ArrowDown");
  const current = dialog.locator(".rp-suggest-item--current");
  await expect(current.locator("a")).toHaveAttribute("href", "/tables-and-databases#正文表格");

  await page.keyboard.press("ControlOrMeta+K");
  const menu = dialog.getByRole("dialog", { name: "当前结果操作" });
  const actionInput = menu.getByRole("combobox", { name: "搜索操作" });
  await actionInput.fill("cp");
  await expect(menu.getByRole("option", { name: "复制链接" })).toHaveAttribute("aria-selected", "true");
  await actionInput.fill("收藏");
  await page.keyboard.press("Enter");
  await expect(current).toHaveAttribute("data-semlo-editor-favorite", "");
  await expect(dialog.locator(".semlo-editor-search__footer-brand")).toHaveText("已收藏");

  await page.keyboard.press("Escape");
  await expect(dialog.getByText("已收藏", { exact: true })).toBeVisible();
  const favorite = dialog.getByRole("link", { name: /正文表格/ });
  await expect(favorite).toHaveAttribute("data-selected", "true");
  await page.reload();
  await trigger.click();
  await expect(dialog.getByText("已收藏", { exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(dialog.getByRole("link", { name: /快速开始/ })).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ControlOrMeta+ArrowUp");
  await expect(favorite).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Enter");
  await page.waitForURL(
    (url) => url.pathname === "/tables-and-databases" && decodeURIComponent(url.hash) === "#正文表格",
  );

  await trigger.click();
  await expect(dialog.getByText("已收藏", { exact: true })).toBeVisible();
  await expect(dialog.getByText("最近访问", { exact: true })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+K");
  await actionInput.fill("取消收藏");
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("已收藏", { exact: true })).toHaveCount(0);
  await expect(dialog.locator("p").getByText("最近访问", { exact: true })).toBeVisible();
  await expect(favorite).toHaveAttribute("data-selected", "true");

  await page.keyboard.press("ControlOrMeta+K");
  await actionInput.fill("移除");
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("最近访问", { exact: true })).toHaveCount(0);
  await page.reload();
  await trigger.click();
  await expect(dialog.getByText("已收藏", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("最近访问", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("快速访问", { exact: true })).toBeVisible();
});

test("opening a search result records the actual section as a recent document", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${origin}/`);
  const trigger = page.locator(".rp-nav .rp-search-button");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  const input = dialog.getByRole("textbox", { name: "搜索文档" });
  await input.fill("表格");
  await dialog.locator(".rp-search-panel__group").first().waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForURL(
    (url) => url.pathname === "/tables-and-databases" && decodeURIComponent(url.hash) === "#正文表格",
  );
  await trigger.click();
  await expect(dialog.getByText("最近访问", { exact: true })).toBeVisible();
  const recent = dialog.getByRole("link", { name: /正文表格/ });
  await expect(recent).toHaveAttribute("href", "/tables-and-databases#正文表格");
  await expect(recent).toHaveAttribute("data-selected", "true");
});

test("search favorites can be reordered from the action menu and persist", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("search-fixture")) return;
    sessionStorage.setItem("search-fixture", "1");
    localStorage.setItem(
      "semlo-editor:docs:search:collections:v1",
      JSON.stringify({
        favorites: [
          { href: "/getting-started", title: "收藏文档 甲" },
          { href: "/editing", title: "收藏文档 乙" },
          { href: "/api", title: "收藏文档 丙" },
        ],
        recent: [],
      }),
    );
  });
  await page.goto(`${origin}/`);
  const trigger = page.locator(".rp-nav .rp-search-button");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  const titles = () =>
    dialog
      .locator(".semlo-editor-search__quick-title")
      .evaluateAll((elements) => elements.slice(0, 3).map((el) => el.textContent));
  await expect.poll(titles).toEqual(["收藏文档 甲", "收藏文档 乙", "收藏文档 丙"]);
  await page.keyboard.press("ArrowDown");
  const selected = dialog.getByRole("link", { name: /收藏文档 乙/ });
  await expect(selected).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ControlOrMeta+K");
  const menu = dialog.getByRole("dialog", { name: "当前结果操作" });
  const actionInput = menu.getByRole("combobox", { name: "搜索操作" });
  const up = menu.getByRole("option", { name: "向上移动收藏" });
  const down = menu.getByRole("option", { name: "向下移动收藏" });
  await expect(up).toHaveAttribute("aria-keyshortcuts", /^(Meta|Control)\+ArrowUp$/);
  await expect(up).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+ArrowUp");
  await expect.poll(titles).toEqual(["收藏文档 乙", "收藏文档 甲", "收藏文档 丙"]);
  await expect(selected).toHaveAttribute("data-selected", "true");
  await expect(menu).toBeVisible();
  await expect(up).toBeDisabled();
  await actionInput.fill("上移");
  await expect(actionInput).not.toHaveAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(titles).toEqual(["收藏文档 乙", "收藏文档 甲", "收藏文档 丙"]);
  await actionInput.fill("");
  await down.click();
  await down.click();
  await expect.poll(titles).toEqual(["收藏文档 甲", "收藏文档 丙", "收藏文档 乙"]);
  await expect(down).toBeDisabled();
  await expect(selected).toHaveAttribute("data-selected", "true");
  await page.reload();
  await trigger.click();
  await expect.poll(titles).toEqual(["收藏文档 甲", "收藏文档 丙", "收藏文档 乙"]);
});

test("search can clear recent visits without affecting favorites", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("search-fixture")) return;
    sessionStorage.setItem("search-fixture", "1");
    localStorage.setItem(
      "semlo-editor:docs:search:collections:v1",
      JSON.stringify({
        favorites: [{ href: "/api", title: "收藏文档" }],
        recent: [
          { href: "/editing", title: "最近文档 甲" },
          { href: "/getting-started", title: "最近文档 乙" },
          { href: "/api", title: "收藏文档" },
        ],
      }),
    );
  });
  await page.goto(`${origin}/`);
  const trigger = page.getByRole("button", { name: "搜索文档" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  await expect(
    dialog.locator(".semlo-editor-search__section-label").getByText("最近访问", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(dialog.getByRole("link", { name: /最近文档 甲/ })).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ControlOrMeta+K");
  const menu = dialog.getByRole("dialog", { name: "当前结果操作" });
  await expect(menu.getByRole("option", { name: "从最近访问中移除" })).toBeVisible();
  await expect(menu.locator(".semlo-editor-search__actions-more")).toBeVisible();
  const actionInput = menu.getByRole("combobox", { name: "搜索操作" });
  await actionInput.fill("clear");
  await expect(menu.locator(".semlo-editor-search__actions-more")).toHaveCount(0);
  await expect(menu.getByRole("option", { name: "清空最近访问" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(dialog.getByText("最近访问", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: /收藏文档/ })).toBeVisible();
  await expect(dialog.locator(".semlo-editor-search__footer-brand")).toHaveText("已清空最近访问");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.reload();
  await trigger.click();
  await expect(dialog.getByText("最近访问", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: /收藏文档/ })).toBeVisible();
});

test("search records a document opened with a middle click", async ({ page }) => {
  await page.goto(`${origin}/`);
  await page.locator(".rp-nav .rp-search-button").click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  const newPage = page.context().waitForEvent("page");
  await dialog.getByRole("link", { name: /编辑与组织内容/ }).click({ button: "middle" });
  const opened = await newPage;
  await opened.close();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("semlo-editor:docs:search:collections:v1") || "{}").recent?.[0]?.href,
      ),
    )
    .toBe("/editing");
});

test("long favorite lists remain keyboard navigable in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.addInitScript(() => {
    const favorites = Array.from({ length: 20 }, (_, index) => ({
      href: `/tables-and-databases#section-${index}`,
      title: `收藏章节 ${index + 1}`,
      source: "表格与数据表",
    }));
    localStorage.setItem("semlo-editor:docs:search:collections:v1", JSON.stringify({ favorites, recent: [] }));
  });
  await page.goto(`${origin}/`);
  await page.getByRole("button", { name: "搜索文档" }).click();
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  const list = dialog.locator(".semlo-editor-search__quick");
  for (let index = 0; index < 18; index++) await page.keyboard.press("ArrowDown");
  const selected = dialog.getByRole("link", { name: /收藏章节 19/ });
  await expect(selected).toHaveAttribute("data-selected", "true");
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const bounds = await list.boundingBox();
      const item = await selected.boundingBox();
      return Boolean(bounds && item && item.y >= bounds.y && item.y + item.height <= bounds.y + bounds.height);
    })
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(dialog.getByRole("link", { name: /快速开始/ })).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ControlOrMeta+ArrowUp");
  await expect(dialog.getByRole("link", { name: /收藏章节 1/ }).first()).toHaveAttribute("data-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
