import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    translationFramework?: {
      mount(framework: string): Promise<void>;
      setService(mode: string): void;
      select(): void;
      setEditable(value: boolean): void;
      requests(): { aborted: boolean }[];
      resolve(index: number, text: string): void;
      snapshot(): string | undefined;
      destroy(): void;
    };
  }
}

test("all editor entries update translation services, abort stale work, and protect read-only documents", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/toolbar/toolbar-translation-framework-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": "./packages/core/src/index.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-translation-framework-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => Boolean(window.translationFramework));
    for (const framework of ["core", "react", "vue", "solid"]) {
      await page.evaluate((name) => window.__semloRequireFixture("translationFramework").mount(name), framework);
      const host = page.locator("#translation-framework-host");
      const button = host.getByRole("button", { name: "翻译", exact: true });
      await expect(button, framework).toBeDisabled();
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").setService("pending"));
      await expect(button, framework).toBeEnabled();
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").select());
      await button.click();
      const panel = host.getByRole("complementary", { name: "翻译" });
      await expect
        .poll(() => page.evaluate(() => window.__semloRequireFixture("translationFramework").requests().length))
        .toBe(1);
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").setService("fast"));
      await expect(panel).toBeHidden();
      expect(
        await page.evaluate(() => window.__semloRequireFixture("translationFramework").requests()[0].aborted),
      ).toBe(true);
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").resolve(0, "stale"));
      await button.click();
      await expect(panel.locator(".semlo-editor-translation-result")).toHaveText("translated");
      await panel.getByRole("button", { name: "插入文档" }).click();
      expect(await page.evaluate(() => window.__semloRequireFixture("translationFramework").snapshot())).toBe(
        "translated",
      );
      await host.locator(".semlo-editor-prose").press("ControlOrMeta+z");
      expect(await page.evaluate(() => window.__semloRequireFixture("translationFramework").snapshot())).toBe(
        "测试文字",
      );
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").select());
      await expect(panel.locator(".semlo-editor-translation-result")).toHaveText("translated");
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").setEditable(false));
      await expect(panel).toBeHidden();
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").setEditable(true));
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").setService("fail"));
      await expect(panel).toBeHidden();
      await button.click();
      await expect(panel.getByRole("status")).toHaveText("翻译失败");
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").setService("pending"));
      await expect(panel).toBeHidden();
      await button.click();
      await expect
        .poll(() => page.evaluate(() => window.__semloRequireFixture("translationFramework").requests().length))
        .toBeGreaterThan(1);
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").setEditable(false));
      await expect(panel).toBeHidden();
      expect(
        await page.evaluate(() => window.__semloRequireFixture("translationFramework").requests().at(-1)?.aborted),
      ).toBe(true);
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").setEditable(true));
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").setService("none"));
      await expect(panel).toBeHidden();
      await expect(button).toBeDisabled();
      await page.evaluate(() => window.__semloRequireFixture("translationFramework").destroy());
    }
    await page.evaluate(() => window.__semloRequireFixture("translationFramework").mount("core"));
    await page.evaluate(() => window.__semloRequireFixture("translationFramework").setService("fast"));
    await page.evaluate(() => window.__semloRequireFixture("translationFramework").select());
    const host = page.locator("#translation-framework-host");
    const toolbar = host.getByRole("toolbar", { name: "文本格式" });
    await toolbar.evaluate((element) => ((element as HTMLElement).style.width = "200px"));
    await toolbar.getByRole("button", { name: "更多" }).click();
    const overflow = page.getByRole("toolbar", { name: "更多工具" });
    const translation = overflow.getByRole("button", { name: "翻译", exact: true });
    await translation.scrollIntoViewIfNeeded();
    await translation.click();
    const panel = host.getByRole("complementary", { name: "翻译" });
    await expect(panel.locator(".semlo-editor-translation-result")).toHaveText("translated");
    await expect(overflow).toBeVisible();
    await panel.getByRole("button", { name: "插入文档" }).click();
    expect(await page.evaluate(() => window.__semloRequireFixture("translationFramework").snapshot())).toBe(
      "translated",
    );
    await expect(overflow).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("translationFramework").destroy());
  } finally {
    await server.close();
  }
});
