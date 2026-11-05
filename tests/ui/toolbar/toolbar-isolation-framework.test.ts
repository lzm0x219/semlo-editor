import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
declare global {
  interface Window {
    toolbarIsolationFramework?: {
      mount(name: string): Promise<void>;
      select(): void;
      appendRebuild(): void;
      snapshot(): string;
      destroy(): void;
    };
  }
}
test("all entries discard a pending slash after appended equal-node rebuild", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-framework-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-framework-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await installFixtureGuards(page);
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => Boolean(window.toolbarIsolationFramework));
    for (const name of ["core", "react", "vue", "solid"]) {
      await page.evaluate((n) => window.__semloRequireFixture("toolbarIsolationFramework").mount(n), name);
      const editor = page.locator("#translation-framework-host .semlo-editor-prose");
      await editor.focus();
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolationFramework").select());
      await page.keyboard.press("Backspace");
      await page.keyboard.type("/p");
      const menu = page.getByRole("listbox", { name: "插入内容" });
      await expect(menu, name).toBeVisible();
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolationFramework").appendRebuild());
      await expect(menu, name).toBeHidden();
      expect(
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolationFramework").snapshot()),
        name,
      ).toBe("/p");
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolationFramework").destroy());
    }
  } finally {
    await server.close();
  }
});
