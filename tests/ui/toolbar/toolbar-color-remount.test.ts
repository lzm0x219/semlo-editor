import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

declare global {
  interface Window {
    toolbarColorRemount: {
      select(index: number): void;
      remount(index: number): void;
      remountInFrame(): void;
      currentDocumentIsFrame(): boolean;
      press(index: number): { prevented: boolean; marks: number };
      pressOld(): boolean | null;
      clear(index: number): void;
      setEditable(index: number, editable: boolean): void;
      destroy(index: number): void;
      pressDestroyed(): boolean | null;
      lifecycle(): string[];
    };
  }
}

async function start() {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-color-remount-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  return rsbuild.startDevServer();
}

test("highlight shortcut follows a remounted editor", async ({ page }) => {
  const { port, server } = await start();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.toolbarColorRemount.remount(0));
    await page.evaluate(() => window.toolbarColorRemount.select(0));
    const prose = page.locator("#editor-0 .semlo-editor-prose");
    await prose.focus();
    await page.keyboard.press("Alt+Meta+h");
    await expect(prose.locator("mark")).toHaveCount(1);
  } finally {
    await server.close();
  }
});

test("highlight shortcut follows cross-document remounts and cleans up", async ({ page }) => {
  const { port, server } = await start();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.toolbarColorRemount.remountInFrame());
    expect(await page.evaluate(() => window.toolbarColorRemount.currentDocumentIsFrame())).toBe(true);
    await page.evaluate(() => window.toolbarColorRemount.select(0));
    await page.keyboard.press("Alt+Meta+h");
    await expect(page.frameLocator("#remount-frame").locator(".semlo-editor-prose mark")).toHaveCount(1);
    await page.evaluate(() => window.toolbarColorRemount.clear(0));
    for (let cycle = 0; cycle < 3; cycle++) {
      if (cycle) await page.evaluate(() => window.toolbarColorRemount.remount(0));
      await page.evaluate(() => window.toolbarColorRemount.select(0));
      expect(await page.evaluate(() => window.toolbarColorRemount.press(0))).toEqual({ prevented: true, marks: 1 });
      await page.evaluate(() => window.toolbarColorRemount.clear(0));
    }
    expect(await page.evaluate(() => window.toolbarColorRemount.lifecycle())).toEqual([
      "unmount",
      "mount",
      "unmount",
      "mount",
      "unmount",
      "mount",
    ]);
    expect(await page.evaluate(() => window.toolbarColorRemount.pressOld())).toBe(false);
    await page.evaluate(() => window.toolbarColorRemount.setEditable(0, false));
    expect((await page.evaluate(() => window.toolbarColorRemount.press(0))).prevented).toBe(false);
    await page.evaluate(() => window.toolbarColorRemount.destroy(0));
    expect(await page.evaluate(() => window.toolbarColorRemount.pressDestroyed())).toBe(false);
    await page.evaluate(() => window.toolbarColorRemount.select(1));
    expect(await page.evaluate(() => window.toolbarColorRemount.press(1))).toEqual({ prevented: true, marks: 1 });
  } finally {
    await server.close();
  }
});

test("toolbar formatting stays isolated after cross-document remount", async ({ page }) => {
  const { port, server } = await start();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.toolbarColorRemount.remountInFrame());
    await page.evaluate(() => window.toolbarColorRemount.select(0));
    await page
      .locator("#editor-0")
      .getByRole("toolbar", { name: "文本格式" })
      .getByRole("button", { name: "加粗", exact: true })
      .click();
    await expect(page.frameLocator("#remount-frame").locator(".semlo-editor-prose strong")).toHaveCount(1);
    await expect(page.locator("#editor-1 .semlo-editor-prose strong")).toHaveCount(0);
    await page.evaluate(() => window.toolbarColorRemount.select(1));
    await page
      .locator("#editor-1")
      .getByRole("toolbar", { name: "文本格式" })
      .getByRole("button", { name: "加粗", exact: true })
      .click();
    await expect(page.locator("#editor-1 .semlo-editor-prose strong")).toHaveCount(1);
    await expect(page.frameLocator("#remount-frame").locator(".semlo-editor-prose strong")).toHaveCount(1);
  } finally {
    await server.close();
  }
});
