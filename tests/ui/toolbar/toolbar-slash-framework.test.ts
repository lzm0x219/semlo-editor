import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

test("all editor entries support quick slash search and preserve read-only state", async ({ page }) => {
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
      output: { distPath: { root: "/tmp/semlo-editor-slash-framework-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => Boolean(window.translationFramework));
    for (const framework of ["core", "react", "vue", "solid"]) {
      await page.evaluate((name) => window.translationFramework!.mount(name), framework);
      const editor = page.locator("#translation-framework-host .semlo-editor-prose");
      await editor.focus();
      await page.evaluate(() => window.translationFramework!.select());
      await page.keyboard.press("Backspace");
      await page.keyboard.type("/p");
      const menu = page.getByRole("listbox", { name: "插入内容" });
      await expect(menu.locator('[aria-selected="true"]'), framework).toHaveAttribute("data-command", "paragraph");
      await page.keyboard.press("Enter");
      await expect(editor.locator("p"), framework).toHaveText("");
      await expect(editor, framework).toBeFocused();
      await page.keyboard.type("/hndm");
      await page.keyboard.press("Enter");
      await page.keyboard.type("abc");
      await expect(editor.locator("code"), framework).toHaveText("abc");
      await page.evaluate(() => window.translationFramework!.setEditable(false));
      await editor.click();
      await page.keyboard.type("x");
      await expect(editor.locator("code"), framework).toHaveText("abc");
      await page.evaluate(() => window.translationFramework!.destroy());
    }
  } finally {
    await server.close();
  }
});
