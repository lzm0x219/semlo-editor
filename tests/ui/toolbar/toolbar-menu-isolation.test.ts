import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    wrongFocus?: number;
    pointerMoveHandlers?: () => number;
    watchPointerAdds?: () => void;
    latePointerHandlers?: () => number;
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

for (const label of ["有序列表样式", "对齐方式"])
  test(`keyboard Escape closes only focused editor ${label} menu`, async ({ page }) => {
    const rsbuild = await createRsbuild({
      cwd: process.cwd(),
      rsbuildConfig: {
        source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
        server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
        dev: { hmr: false, liveReload: false },
      },
    });
    const { port, server } = await rsbuild.startDevServer();
    try {
      await page.setViewportSize({ width: 1920, height: 900 });
      await page.goto(`http://127.0.0.1:${port}`);
      const buttonLabel = label === "对齐方式" ? "文本对齐" : label;
      const a = page.locator("#editor-a").getByRole("button", { name: buttonLabel }),
        b = page.locator("#editor-b").getByRole("button", { name: buttonLabel });
      await a.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu", { name: label })).toHaveCount(1);
      await b.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu", { name: label })).toHaveCount(2);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu", { name: label })).toHaveCount(1);
      await expect(a).toHaveAttribute("aria-expanded", "true");
      await expect(b).toHaveAttribute("aria-expanded", "false");
      await expect(b).toBeFocused();
    } finally {
      await server.close();
    }
  });

test("keyboard choices, mouse focus and overflow retain Escape behavior", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const host = page.locator("#editor-a");
    const anchor = host.getByRole("button", { name: "有序列表样式" });
    await anchor.focus();
    await page.keyboard.press("Enter");
    let menu = page.getByRole("menu", { name: "有序列表样式" });
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitemradio", { name: "多级数字" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(menu.getByRole("menuitemradio", { name: "数字、字母和罗马数字" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(anchor).toBeFocused();
    await host.locator(".semlo-editor-prose").click();
    await anchor.click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(anchor).toBeFocused();
    const toolbar = host.getByRole("toolbar", { name: "文本格式" });
    await toolbar.evaluate((el) => ((el as HTMLElement).style.width = "200px"));
    await toolbar.getByRole("button", { name: "更多" }).click();
    const overflow = page.getByRole("toolbar", { name: "更多工具" });
    const moved = overflow.getByRole("button", { name: "有序列表样式" });
    await moved.scrollIntoViewIfNeeded();
    await moved.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(moved).toBeFocused();
  } finally {
    await server.close();
  }
});

test("controlled replacement and read-only close only their own list menu", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>甲</p>");
      window.__semloRequireFixture("toolbarIsolation").setContent(1, "<p>乙</p>");
    });
    const a = page.locator("#editor-a .semlo-editor-ordered-style-arrow"),
      b = page.locator("#editor-b .semlo-editor-ordered-style-arrow");
    await a.focus();
    await page.keyboard.press("Enter");
    await b.focus();
    await page.keyboard.press("Enter");
    const states = [];
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>甲</p>"));
    states.push([await a.getAttribute("aria-expanded"), await b.getAttribute("aria-expanded")]);

    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>新甲</p>"));
    states.push([await a.getAttribute("aria-expanded"), await b.getAttribute("aria-expanded")]);
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setEditable(1, false));
    states.push([await a.getAttribute("aria-expanded"), await b.getAttribute("aria-expanded")]);
    expect(states).toEqual([
      ["true", "true"],
      ["false", "true"],
      ["false", "false"],
    ]);
  } finally {
    await server.close();
  }
});

test("Escape closes only the focused editor overflow", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    for (const id of ["a", "b"])
      await page
        .locator(`#editor-${id}`)
        .getByRole("toolbar", { name: "文本格式" })
        .evaluate((el) => ((el as HTMLElement).style.width = "200px"));
    const a = page.locator("#editor-a").getByRole("button", { name: "更多" }),
      b = page.locator("#editor-b").getByRole("button", { name: "更多" });
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await a.focus();
    await page.keyboard.press("Enter");
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await b.focus();
    await page.keyboard.press("Enter");
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await expect(b).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await expect(b).toHaveAttribute("aria-expanded", "false");
    await expect(b).toBeFocused();
  } finally {
    await server.close();
  }
});

test("font size dropdown routes ArrowDown and Escape to focused editor", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const a = page.locator("#editor-a").getByRole("button", { name: "字号" }),
      b = page.locator("#editor-b").getByRole("button", { name: "字号" });
    await a.focus();
    await page.keyboard.press("Enter");
    await b.focus();
    await page.keyboard.press("Enter");
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await expect(b).toHaveAttribute("aria-expanded", "true");
    const aControls = await a.getAttribute("aria-controls");
    await page.evaluate((id) => {
      window.wrongFocus = 0;
      document.addEventListener("focusin", (e) => {
        if (document.getElementById(id!)?.contains(e.target as Node)) window.__semloIncrementFixture("wrongFocus");
      });
    }, aControls);
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => window.__semloRequireFixture("wrongFocus"))).toBe(0);
    const activeControls = await b.getAttribute("aria-controls");
    expect(
      await page.evaluate((id) => document.getElementById(id!)?.contains(document.activeElement), activeControls),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await expect(b).toHaveAttribute("aria-expanded", "false");
    await expect(b).toBeFocused();
  } finally {
    await server.close();
  }
});

test("mouse-opened dropdown uses editor focus while heading menu retains its keyboard boundary", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const host = page.locator("#editor-a"),
      prose = host.locator(".semlo-editor-prose"),
      size = host.getByRole("button", { name: "字号" });
    await prose.click();
    await size.click();
    await expect(prose).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const id = await size.getAttribute("aria-controls");
    expect(await page.evaluate((x) => document.getElementById(x!)?.contains(document.activeElement), id)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(size).toBeFocused();
    await prose.click();
    const heading = host.getByRole("button", { name: "段落样式" });
    await heading.click();
    await expect(prose).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(prose).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(heading).toBeFocused();
  } finally {
    await server.close();
  }
});

test("Escape closes only focused editor color palette", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const a = page.locator("#editor-a").getByRole("button", { name: "文字颜色", exact: true }),
      b = page.locator("#editor-b").getByRole("button", { name: "文字颜色", exact: true });
    await a.focus();
    await page.keyboard.press("Enter");
    await b.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "选择颜色", exact: true })).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await expect(b).toHaveAttribute("aria-expanded", "false");
  } finally {
    await server.close();
  }
});

test("Escape closes only focused editor font picker", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "queryLocalFonts", { value: undefined, configurable: true }),
  );
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const a = page.locator("#editor-a").getByRole("button", { name: "字体", exact: true }),
      b = page.locator("#editor-b").getByRole("button", { name: "字体", exact: true });
    await a.focus();
    await page.keyboard.press("Enter");
    await b.focus();
    await page.keyboard.press("Enter");
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await expect(b).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await expect(b).toHaveAttribute("aria-expanded", "false");
  } finally {
    await server.close();
  }
});

test("Escape closes only focused editor emoji picker", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").openEmoji(0);
      window.__semloRequireFixture("toolbarIsolation").openEmoji(1);
    });
    const panels = page.getByRole("dialog", { name: "选择表情" });
    await expect(panels).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(panels).toHaveCount(1);
  } finally {
    await server.close();
  }
});

test("nested custom color Escape stays in its editor and restores focus", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const a = page.locator("#editor-a").getByRole("button", { name: "文字颜色", exact: true }),
      b = page.locator("#editor-b").getByRole("button", { name: "文字颜色", exact: true });
    await a.focus();
    await page.keyboard.press("Enter");
    await b.focus();
    await page.keyboard.press("Enter");
    const panels = page.getByRole("dialog", { name: "选择颜色", exact: true });
    await expect(panels).toHaveCount(2);
    const more = panels.nth(1).getByRole("button", { name: "更多颜色" });
    await more.focus();
    await page.keyboard.press("Enter");
    const custom = page.getByRole("dialog", { name: "自定义颜色" });
    await expect(custom).toBeVisible();
    await custom.getByLabel("HEX", { exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(custom).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(b).toBeFocused();
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await expect(b).toHaveAttribute("aria-expanded", "false");
  } finally {
    await server.close();
  }
});

test("Escape closes keyboard-opened overflow menus after returning focus to their editor", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const host = page.locator("#editor-a"),
      toolbar = host.getByRole("toolbar", { name: "文本格式" });
    await toolbar.evaluate((el) => ((el as HTMLElement).style.width = "50px"));
    const more = toolbar.getByRole("button", { name: "更多" });
    await more.click();
    const panel = page.getByRole("toolbar", { name: "更多工具" });
    for (const name of ["有序列表样式", "文本对齐", "字号", "文字颜色"]) {
      const trigger = panel.getByRole("button", { name, exact: true });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await host.locator(".semlo-editor-prose").focus();
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toBeFocused();
    }
  } finally {
    await server.close();
  }
});

test("block-below insertion menu ignores Escape in another editor", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").openBlockBelow(0));
    const b = page.locator("#editor-b");
    const panel = page.getByRole("dialog", { name: "插入内容" });
    await expect(panel).toBeVisible();
    await b.locator(".semlo-editor-prose").focus();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await expect(b.locator(".semlo-editor-prose")).toBeFocused();
  } finally {
    await server.close();
  }
});

test("block operation opens below menu and Escape from its editor closes it", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("blocks");
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js'; const host=document.createElement('div');host.id='second-editor';host.style.cssText='position:fixed;top:0;right:0;width:320px;z-index:50';document.body.append(host);window.secondEditor=createEditor({element:host,outline:false,content:'<p>乙</p>'})`,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "secondEditor")));
  const host = page.locator("#editor-host");
  await host.locator(".semlo-editor-prose > p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await expect(panel).toBeVisible();
  const secondProse = page.locator("#second-editor .semlo-editor-prose");
  await secondProse.focus();
  await expect(secondProse).toBeFocused();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await host.locator(".semlo-editor-prose").focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("block below table submenu Escape closes its owning panel", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("blocks");
  const host = page.locator("#editor-host");
  await host.locator(".semlo-editor-prose > p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.locator('[data-command="table"]').focus();
  const grid = page.locator(".semlo-editor-table-grid-popover");
  await expect(grid).toBeVisible();
  await grid.getByRole("button", { name: "1行1列" }).focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(grid).toHaveCount(0);
});

test("emoji search Escape during IME composition stays open", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").openEmoji(0));
    const panel = page.getByRole("dialog", { name: "选择表情" });
    await expect(panel.getByRole("searchbox")).toBeFocused();
    await page.evaluate(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }),
      ),
    );
    await expect(panel).toBeVisible();
    await page.evaluate(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true, cancelable: true }),
      ),
    );
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test("font search Escape during IME composition stays open", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      value: async () => [
        { family: "Test Sans", fullName: "Test Sans Regular", postscriptName: "TestSans-Regular", style: "Regular" },
      ],
    }),
  );
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator("#editor-a").getByRole("button", { name: "字体", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "选择字体" }),
      search = panel.getByRole("searchbox", { name: "搜索字体" });
    await expect(search).toBeEnabled();
    await search.focus();
    await page.evaluate(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }),
      ),
    );
    await expect(panel).toBeVisible();
    await page.evaluate(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true, cancelable: true }),
      ),
    );
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test("open overflow ignores composition Escape in editor text", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const host = page.locator("#editor-a"),
      prose = host.locator(".semlo-editor-prose"),
      toolbar = host.getByRole("toolbar", { name: "文本格式" });
    await toolbar.evaluate((el) => ((el as HTMLElement).style.width = "200px"));
    await prose.focus();
    const more = toolbar.getByRole("button", { name: "更多" });
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(prose).toBeFocused();
    await page.evaluate(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }),
      ),
    );
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await more.focus();
    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
  } finally {
    await server.close();
  }
});

test("mouse-opened formatting menus ignore composition Escape in editor text", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const host = page.locator("#editor-a"),
      prose = host.locator(".semlo-editor-prose");
    for (const name of ["有序列表样式", "文本对齐", "字号"]) {
      await prose.focus();
      const trigger = host.getByRole("button", { name, exact: true });
      await trigger.click();
      await expect(prose).toBeFocused();
      await page.evaluate(() =>
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }),
        ),
      );
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    }
  } finally {
    await server.close();
  }
});

test("insert search keeps composition keys separate from ordinary keyboard actions", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const button = page.locator("#editor-a").getByRole("button", { name: "插入内容" });
    await button.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "插入内容" }),
      search = panel.getByLabel("搜索插入内容");
    await search.fill("表格");
    const before = await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").snapshot(0));
    for (const key of ["Enter", "ArrowDown", "Escape"])
      for (const mode of ["isComposing", "keyCode"]) {
        const prevented = await page.evaluate(
          ({ key, mode }) =>
            !document.activeElement!.dispatchEvent(
              new KeyboardEvent("keydown", {
                key,
                isComposing: mode === "isComposing",
                keyCode: mode === "keyCode" ? 229 : 0,
                bubbles: true,
                cancelable: true,
              }),
            ),
          { key, mode },
        );
        expect(prevented).toBe(false);
        await expect(panel).toBeVisible();
        expect(await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").snapshot(0))).toEqual(before);
      }
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.locator("#editor-a .semlo-editor-prose")).toBeFocused();
    await button.focus();
    await page.keyboard.press("Enter");
    await search.fill("表格");
    await page.keyboard.press("Enter");
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").snapshot(0))).not.toEqual(before);
  } finally {
    await server.close();
  }
});

test("closing insert search does not steal focus from a later action", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const button = page.locator("#editor-a").getByRole("button", { name: "插入内容" });
    await button.focus();
    await page.keyboard.press("Enter");
    const search = page.getByRole("dialog", { name: "插入内容" }).getByLabel("搜索插入内容");
    await expect(search).toBeFocused();
    const focused = await button.evaluate((button) => {
      const callbacks: FrameRequestCallback[] = [];
      const request = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) => callbacks.push(callback);
      try {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
        button.focus();
        window.requestAnimationFrame = request;
        for (const callback of callbacks) callback(performance.now());
        return document.activeElement === button;
      } finally {
        window.requestAnimationFrame = request;
      }
    });
    expect(focused).toBe(true);
    await expect(search).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test("color drag onChange reentrant destroy cannot register late pointer handlers", async ({ page }) => {
  await page.addInitScript(() => {
    const handlers = new Set<EventListenerOrEventListenerObject>();
    const late: EventListenerOrEventListenerObject[] = [];
    let watch = false;
    const add = Document.prototype.addEventListener,
      remove = Document.prototype.removeEventListener;
    Document.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "pointermove" && listener) {
        handlers.add(listener);
        if (watch) late.push(listener);
      }
      return add.call(this, type, listener, options);
    };
    Document.prototype.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "pointermove" && listener) handlers.delete(listener);
      return remove.call(this, type, listener, options);
    };
    window.pointerMoveHandlers = () => handlers.size;
    window.watchPointerAdds = () => {
      watch = true;
    };
    window.latePointerHandlers = () => late.filter((fn) => handlers.has(fn)).length;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    const a = page.locator("#editor-a");
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>甲乙</p>"));
    await a.locator(".semlo-editor-prose").click();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").selectText(0, 1, 3));
    await a.getByRole("button", { name: "文字颜色", exact: true }).click();
    await page.getByRole("dialog", { name: "选择颜色" }).getByRole("button", { name: "更多颜色" }).click();
    const field = page.getByRole("dialog", { name: "自定义颜色" }).locator(".semlo-editor-color-field"),
      box = await field.boundingBox();
    if (!box) throw Error("missing color field");
    const before = await page.evaluate(() => window.__semloRequireFixture("pointerMoveHandlers")());
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").destroyNextChange(0);
      window.__semloRequireFixture("watchPointerAdds")();
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(a.locator(".semlo-editor")).toHaveCount(0);
    const after = await page.evaluate(() => window.__semloRequireFixture("pointerMoveHandlers")());
    expect(after).toBeLessThanOrEqual(before);
    expect(await page.evaluate(() => window.__semloRequireFixture("latePointerHandlers")())).toBe(0);
    expect(errors).toEqual([]);
    await page.mouse.move(10, 10);
    await page.mouse.up();
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
