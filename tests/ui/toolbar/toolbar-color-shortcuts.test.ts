import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    colorShortcutFixture?: {
      select(): void;
      setEditable(value: boolean): void;
      paint(): void;
      snapshot(): string;
      destroy(): void;
    };
  }
}

test("background shortcut applies the current color and respects composition and read-only", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-color-shortcut-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-color-shortcut-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.__semloRequireFixture("colorShortcutFixture").select());
    await page.locator(".semlo-editor-prose").focus();
    await page.keyboard.press("Alt+Meta+h");
    await expect(page.locator(".semlo-editor-prose mark")).toHaveCSS("background-color", "rgb(251, 222, 40)");
    await page.getByRole("button", { name: "高亮颜色", exact: true }).click();
    await page.getByRole("dialog", { name: "选择颜色" }).getByRole("button", { name: "无填充色" }).click();
    await expect(page.locator(".semlo-editor-prose mark")).toHaveCount(0);
    await page.evaluate(() => window.__semloRequireFixture("colorShortcutFixture").paint());
    await expect(page.locator(".semlo-editor-prose mark")).toHaveCount(1);
    await page.locator(".semlo-editor-prose").focus();
    await page.keyboard.press("Alt+Meta+h");
    await expect(page.locator(".semlo-editor-prose mark")).toHaveCount(0);
    await page.evaluate(() => window.__semloRequireFixture("colorShortcutFixture").paint());
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    await toolbar.evaluate((element) => ((element as HTMLElement).style.width = "200px"));
    await toolbar.getByRole("button", { name: "更多" }).click();
    const overflow = page.getByRole("toolbar", { name: "更多工具" });
    await page.locator(".semlo-editor-prose").focus();
    await page.keyboard.press("Alt+Meta+h");
    await expect(page.locator(".semlo-editor-prose mark")).toHaveCount(0);
    await expect(overflow).toBeVisible();
    const before = await page.evaluate(() => window.__semloRequireFixture("colorShortcutFixture").snapshot());
    await page.locator(".semlo-editor-prose").evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "h", altKey: true, metaKey: true, isComposing: true, bubbles: true }),
      );
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("colorShortcutFixture").snapshot())).toBe(before);
    await page.evaluate(() => window.__semloRequireFixture("colorShortcutFixture").setEditable(false));
    await page.locator(".semlo-editor-prose").evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "h", altKey: true, metaKey: true, bubbles: true }));
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("colorShortcutFixture").snapshot())).toBe(before);
    await page.evaluate(() => window.__semloRequireFixture("colorShortcutFixture").destroy());
  } finally {
    await server.close();
  }
});
