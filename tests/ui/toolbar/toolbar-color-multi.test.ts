import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

test("remembered toolbar colors stay independent across editors", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-color-multi-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-color-fixture-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const first = page.locator("#first");
    const second = page.locator("#second");
    await first.locator(".semlo-editor-prose").click();
    await first.getByRole("button", { name: "文字颜色", exact: true }).click();
    await page.getByRole("dialog", { name: "选择颜色" }).getByRole("button", { name: "浅蓝 #117cee" }).click();
    await expect(first.locator(".semlo-editor-toolbar-color-swatch").first()).toHaveCSS(
      "background-color",
      "rgb(17, 124, 238)",
    );
    await expect(second.locator(".semlo-editor-toolbar-color-swatch").first()).toHaveCSS(
      "background-color",
      "rgb(223, 42, 63)",
    );
    await second.locator(".semlo-editor-prose").click();
    await second.getByRole("button", { name: "应用文字颜色" }).click();
    await page.keyboard.type("x");
    await expect(second.locator(".semlo-editor-prose span").first()).toHaveCSS("color", "rgb(223, 42, 63)");
    await expect(first.locator(".semlo-editor-toolbar-color-swatch").first()).toHaveCSS(
      "background-color",
      "rgb(17, 124, 238)",
    );
  } finally {
    await server.close();
  }
});
