import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import type {} from "../../fixtures/toolbar/bold-command-fixture";

type Entry = "main" | "bubble" | "keyboard" | "custom-main" | "custom-floating" | "api";
let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/bold-command-fixture.ts" } },
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
  await page.waitForFunction(() => Boolean(window.boldCommandFixture));
});

async function mount(page: Page, entry: Entry, content: string) {
  const mode: "default" | "custom-main" | "custom-floating" =
    entry === "custom-main" || entry === "custom-floating" ? entry : "default";
  await page.evaluate(({ mode, content }) => window.boldCommandFixture.mount(mode, content), { mode, content });
}

function button(page: Page, entry: Entry) {
  const host = page.locator("#bold-command-host");
  if (entry === "main") return host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "加粗" });
  if (entry === "bubble")
    return host.getByRole("toolbar", { name: "选中文字格式" }).getByRole("button", { name: "加粗" });
  if (entry === "custom-main") return host.getByRole("button", { name: "自定义主加粗" });
  if (entry === "custom-floating") return host.getByRole("button", { name: "自定义浮动加粗" });
  throw new Error("此入口没有按钮");
}

async function invoke(page: Page, entry: Entry) {
  if (entry === "api") return page.evaluate(() => window.boldCommandFixture.execute());
  if (entry === "keyboard") {
    const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control"));
    await page.keyboard.press(`${modifier}+b`);
    return;
  }
  await button(page, entry).click();
}

for (const entry of ["main", "bubble", "keyboard", "custom-main", "custom-floating", "api"] as const) {
  test(`${entry} 的段落、标题和混合选区使用同一加粗规则`, async ({ page }) => {
    await mount(page, entry, "<h2>title</h2><p>plain</p>");
    const editor = page.locator("#bold-command-host .semlo-editor-prose");
    await page.evaluate(() => window.boldCommandFixture.select(1, 13));
    if (entry === "keyboard") await expect(editor).toBeFocused();
    expect(await page.evaluate(() => window.boldCommandFixture.state())).toEqual({ active: false, enabled: true });
    const before = await page.evaluate(() => window.boldCommandFixture.snapshot());
    await invoke(page, entry);
    await expect(editor.locator("h2 strong")).toHaveCount(0);
    await expect(editor.locator("p strong")).toHaveText("plain");
    expect(await page.evaluate(() => window.boldCommandFixture.range())).toEqual({ from: 1, to: 13 });
    const after = await page.evaluate(() => window.boldCommandFixture.snapshot());
    expect(await page.evaluate(() => window.boldCommandFixture.undo())).toBe(true);
    expect(await page.evaluate(() => window.boldCommandFixture.snapshot())).toEqual(before);
    expect(await page.evaluate(() => window.boldCommandFixture.redo())).toBe(true);
    expect(await page.evaluate(() => window.boldCommandFixture.snapshot())).toEqual(after);

    await page.evaluate(() => window.boldCommandFixture.setContent("<h2><strong>title</strong></h2><p>plain</p>"));
    await page.evaluate(() => window.boldCommandFixture.select(1, 6));
    if (entry === "keyboard") await expect(editor).toBeFocused();
    expect(await page.evaluate(() => window.boldCommandFixture.state())).toEqual({ active: true, enabled: false });
    const heading = await page.evaluate(() => window.boldCommandFixture.snapshot());
    if (entry === "keyboard") await invoke(page, entry);
    else if (entry === "api") expect(await invoke(page, entry)).toBe(false);
    else await expect(button(page, entry)).toBeDisabled();
    expect(await page.evaluate(() => window.boldCommandFixture.snapshot())).toEqual(heading);

    await page.evaluate(() => window.boldCommandFixture.select(8, 13));
    if (entry === "keyboard") await expect(editor).toBeFocused();
    expect(await page.evaluate(() => window.boldCommandFixture.state())).toEqual({ active: false, enabled: true });
    await invoke(page, entry);
    await expect(editor.locator("p strong")).toHaveText("plain");
    expect(await page.evaluate(() => window.boldCommandFixture.state())).toEqual({ active: true, enabled: true });
    await page.evaluate(() => window.boldCommandFixture.editable(false));
    expect(await page.evaluate(() => window.boldCommandFixture.state())).toEqual({ active: true, enabled: false });
    expect(await page.evaluate(() => window.boldCommandFixture.execute())).toBe(false);
    await page.evaluate(() => window.boldCommandFixture.destroy());
  });

  test(`${entry} 混合格式切换和撤销保留标题及其他文字格式`, async ({ page }) => {
    await mount(page, entry, "<h2><strong>title</strong></h2><p><strong>pl</strong><em>ain</em></p>");
    await page.evaluate(() => window.boldCommandFixture.select(1, 13));
    const editor = page.locator("#bold-command-host .semlo-editor-prose");
    if (entry === "keyboard") await expect(editor).toBeFocused();
    const before = await page.evaluate(() => window.boldCommandFixture.snapshot());
    await invoke(page, entry);
    await expect(editor.locator("h2 strong")).toHaveText("title");
    expect((await editor.locator("p strong").allTextContents()).join("")).toBe("plain");
    await expect(editor.locator("p em")).toHaveText("ain");
    expect(await page.evaluate(() => window.boldCommandFixture.undo())).toBe(true);
    expect(await page.evaluate(() => window.boldCommandFixture.snapshot())).toEqual(before);
    expect(await page.evaluate(() => window.boldCommandFixture.redo())).toBe(true);
    await invoke(page, entry);
    await expect(editor.locator("h2 strong")).toHaveText("title");
    await expect(editor.locator("p strong")).toHaveCount(0);
    await expect(editor.locator("p em")).toHaveText("ain");
    await page.evaluate(() => window.boldCommandFixture.destroy());
  });
}

for (const entry of ["main", "keyboard", "custom-main", "api"] as const) {
  for (const selection of ["all", "cells", "node"] as const) {
    test(`${entry} 在 ${selection} 选区保留标题及选区类型`, async ({ page }) => {
      const content =
        selection === "all"
          ? "<h2>title</h2><p>plain</p>"
          : selection === "node"
            ? "<blockquote><h2>title</h2><p>plain</p></blockquote>"
            : "<table><tbody><tr><td><h2>title</h2></td><td><p>plain</p></td></tr></tbody></table>";
      await mount(page, entry, content);
      await page.evaluate((selection) => {
        if (selection === "all") window.boldCommandFixture.selectAll();
        else if (selection === "cells") window.boldCommandFixture.selectCells();
        else window.boldCommandFixture.selectNode();
      }, selection);
      const editor = page.locator("#bold-command-host .semlo-editor-prose");
      if (entry === "keyboard") await expect(editor).toBeFocused();
      const expectedSelection =
        selection === "all" ? "AllSelection" : selection === "cells" ? "CellSelection" : "NodeSelection";
      expect(await page.evaluate(() => window.boldCommandFixture.selection())).toBe(expectedSelection);
      const before = await page.evaluate(() => window.boldCommandFixture.snapshot());
      await invoke(page, entry);
      await expect(editor.locator("h2 strong")).toHaveCount(0);
      await expect(editor.locator("p strong")).toHaveText("plain");
      expect(await page.evaluate(() => window.boldCommandFixture.selection())).toBe(expectedSelection);
      expect(await page.evaluate(() => window.boldCommandFixture.undo())).toBe(true);
      expect(await page.evaluate(() => window.boldCommandFixture.snapshot())).toEqual(before);
      await page.evaluate(() => window.boldCommandFixture.destroy());
    });
  }
}

test("加粗快捷键同步尚未提交的浏览器文字选区", async ({ page }) => {
  await mount(page, "keyboard", "<h2>title</h2><p>plain</p>");
  await page.evaluate(() => window.boldCommandFixture.select(8, 13));
  const editor = page.locator("#bold-command-host .semlo-editor-prose");
  await expect(editor).toBeFocused();
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#bold-command-host .semlo-editor-prose")!;
    const title = Array.from(root.querySelector("h2")!.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)!;
    const text = root.querySelector("p")!.firstChild!;
    document.getSelection()!.setBaseAndExtent(title, 0, text, 5);
    const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        keyCode: 66,
        metaKey: mac,
        ctrlKey: !mac,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor.locator("h2 strong")).toHaveCount(0);
  await expect(editor.locator("p strong")).toHaveText("plain");
  expect(await page.evaluate(() => window.boldCommandFixture.range())).toEqual({ from: 1, to: 13 });
  await page.evaluate(() => window.boldCommandFixture.destroy());
});

for (const selection of ["text", "all", "cells"] as const) {
  test(`输入法组合期间不对 ${selection} 选区执行加粗快捷键`, async ({ page }) => {
    const content =
      selection === "cells"
        ? "<table><tbody><tr><td><h2>title</h2></td><td><p>plain</p></td></tr></tbody></table>"
        : "<h2>title</h2><p>plain</p>";
    await mount(page, "keyboard", content);
    await page.evaluate((selection) => {
      if (selection === "all") window.boldCommandFixture.selectAll();
      else if (selection === "cells") window.boldCommandFixture.selectCells();
      else window.boldCommandFixture.select(1, 13);
    }, selection);
    const before = await page.evaluate(() => window.boldCommandFixture.snapshot());
    const initialSelection = await page.evaluate(() => window.boldCommandFixture.selection());
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("#bold-command-host .semlo-editor-prose")!;
      const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      for (const options of [{ isComposing: true, keyCode: 66 }, { keyCode: 229 }])
        root.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "b",
            code: "KeyB",
            metaKey: mac,
            ctrlKey: !mac,
            bubbles: true,
            cancelable: true,
            ...options,
          }),
        );
    });
    expect(await page.evaluate(() => window.boldCommandFixture.snapshot())).toEqual(before);
    expect(await page.evaluate(() => window.boldCommandFixture.selection())).toBe(initialSelection);
    await page.evaluate(() => window.boldCommandFixture.destroy());
  });
}

for (const entry of ["main", "bubble", "custom-main", "custom-floating"] as const) {
  test(`${entry} 窄屏下可用键盘对混合选区执行加粗`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mount(page, entry, "<h2>title</h2><p>plain</p>");
    await page.evaluate(() => window.boldCommandFixture.select(1, 13));
    let bold = button(page, entry);
    if (entry === "main" && !(await bold.isVisible())) {
      const more = page.locator("#bold-command-host").getByRole("button", { name: "更多" });
      await more.focus();
      await page.keyboard.press("Enter");
      bold = page.getByRole("toolbar", { name: "更多工具" }).getByRole("button", { name: "加粗" });
    }
    await expect(bold).toBeVisible();
    await bold.focus();
    await page.keyboard.press("Enter");
    const editor = page.locator("#bold-command-host .semlo-editor-prose");
    await expect(editor.locator("h2 strong")).toHaveCount(0);
    await expect(editor.locator("p strong")).toHaveText("plain");
    expect(await page.evaluate(() => window.boldCommandFixture.range())).toEqual({ from: 1, to: 13 });
    await page.evaluate(() => window.boldCommandFixture.destroy());
  });
}

test("模拟触屏下自定义浮动工具栏按混合选区规则加粗", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.boldCommandFixture));
    await mount(page, "custom-floating", "<h2>title</h2><p>plain</p>");
    const editor = page.locator("#bold-command-host .semlo-editor-prose");
    await editor.tap();
    await page.evaluate(() => window.boldCommandFixture.select(1, 13));
    await button(page, "custom-floating").tap();
    await expect(editor.locator("h2 strong")).toHaveCount(0);
    await expect(editor.locator("p strong")).toHaveText("plain");
    await page.evaluate(() => window.boldCommandFixture.destroy());
  } finally {
    await context.close();
  }
});

for (const mixed of [false, true]) {
  test(`公开加粗命令可保留焦点（${mixed ? "混合选区" : "正文选区"}）`, async ({ page }) => {
    await mount(page, "api", mixed ? "<h2>title</h2><p>plain</p>" : "<p>plain</p>");
    await page.evaluate((mixed) => {
      window.boldCommandFixture.select(1, mixed ? 13 : 6);
      const external = document.createElement("button");
      external.id = "external-focus";
      external.textContent = "外部按钮";
      document.body.append(external);
    }, mixed);
    const external = page.getByRole("button", { name: "外部按钮" });
    await external.focus();
    expect(await page.evaluate(() => window.boldCommandFixture.execute(false))).toBe(true);
    await expect(external).toBeFocused();
    await expect(page.locator("#bold-command-host .semlo-editor-prose p strong")).toHaveText("plain");
    await page.evaluate(() => window.boldCommandFixture.destroy());
  });
}

test("卸载、重挂载和销毁时公开加粗接口安全且按实例状态恢复", async ({ page }) => {
  await mount(page, "api", "<p>plain</p>");
  await page.evaluate(() => window.boldCommandFixture.select(1, 6));
  await page.evaluate(() => window.boldCommandFixture.unmount());
  expect(await page.evaluate(() => window.boldCommandFixture.state())).toEqual({ active: false, enabled: false });
  expect(await page.evaluate(() => window.boldCommandFixture.execute())).toBe(false);
  await page.evaluate(() => window.boldCommandFixture.remount());
  expect(await page.evaluate(() => window.boldCommandFixture.state())).toEqual({ active: false, enabled: true });
  expect(await page.evaluate(() => window.boldCommandFixture.execute(false))).toBe(true);
  await expect(page.locator("#bold-command-host .semlo-editor-prose strong")).toHaveText("plain");
  await page.evaluate(() => window.boldCommandFixture.destroy());
  expect(await page.evaluate(() => window.boldCommandFixture.state())).toEqual({ active: false, enabled: false });
  expect(await page.evaluate(() => window.boldCommandFixture.execute())).toBe(false);
});
