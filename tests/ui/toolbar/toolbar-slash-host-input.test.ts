import { expect, test } from "@rstest/playwright";

import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";

for (const mode of ["observe", "transform"] as const) {
  test(`host input extension can ${mode} a slash`, async ({ page }) => {
    const rsbuild = await createFixtureRsbuild("./tests/fixtures/toolbar/toolbar-slash-host-input-fixture.ts", {
      publicDir: false,
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
