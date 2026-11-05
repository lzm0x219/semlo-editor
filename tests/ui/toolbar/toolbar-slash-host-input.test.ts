import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

for (const mode of ["observe", "transform"] as const) {
  test(`host input extension can ${mode} a slash`, async ({ page }) => {
    const rsbuild = await createRsbuild({
      cwd: process.cwd(),
      rsbuildConfig: {
        source: { entry: { index: "./tests/fixtures/toolbar/toolbar-slash-host-input-fixture.ts" } },
        server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
        dev: { hmr: false, liveReload: false },
      },
    });
    const { port, server } = await rsbuild.startDevServer();
    try {
      await page.goto(`http://127.0.0.1:${port}?mode=${mode}`);
      const paragraph = page.locator("#slash-host-input .semlo-editor-prose p");
      await paragraph.click();
      await page.keyboard.type("/");
      const seen = await page.evaluate(() => Reflect.get(window, "slashHostInput").seen as string[]);
      expect(seen).toContain("/");
      await expect(paragraph).toHaveText(mode === "transform" ? "X" : "/");
    } finally {
      await server.close();
    }
  });
}
