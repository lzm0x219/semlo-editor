import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

test("format painter and find shortcuts respect composition through all editor entries", async ({ page }) => {
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
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await installFixtureGuards(page);
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => Boolean(window.toolbarIsolationFramework));
    for (const framework of ["core", "react", "vue", "solid"]) {
      await page.evaluate((name) => window.__semloRequireFixture("toolbarIsolationFramework").mount(name), framework);
      const host = page.locator("#translation-framework-host");
      const prose = host.locator(".semlo-editor-prose");
      const painter = host.getByRole("button", { name: "格式刷", exact: true });
      await prose.focus();
      await prose.evaluate((element) =>
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: "f", ctrlKey: true, keyCode: 229, bubbles: true, cancelable: true }),
        ),
      );
      await expect(page.getByRole("dialog", { name: "查找替换" }), framework).toHaveCount(0);
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolationFramework").select());
      await painter.click();
      await expect(painter, framework).toHaveAttribute("aria-pressed", "true");
      await prose.evaluate((element) =>
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }),
        ),
      );
      await expect(painter, framework).toHaveAttribute("aria-pressed", "true");
      await prose.evaluate((element) =>
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
      );
      await expect(painter, framework).toHaveAttribute("aria-pressed", "false");
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolationFramework").destroy());
    }
  } finally {
    await server.close();
  }
});
