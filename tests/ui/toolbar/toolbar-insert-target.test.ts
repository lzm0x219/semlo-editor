import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    targetFixture?: { replaceTarget(): void; snapshot(): unknown; close(): void };
  }
}

test("an internal target uses its position and a replaced target cannot insert", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-insert-target-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-target-fixture-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByRole("button", { name: "打开目标菜单" }).click();
    const panel = page.getByRole("dialog", { name: "插入内容" });
    for (const id of ["table", "database", "details", "columns"]) {
      await expect(panel.locator(`[data-command="${id}"]`)).toHaveCount(0);
    }
    await expect(panel.locator('[data-command="status"]')).toHaveCount(1);
    await page.evaluate(() => window.__semloRequireFixture("targetFixture").replaceTarget());
    const before = await page.evaluate(() => window.__semloRequireFixture("targetFixture").snapshot());
    await panel.locator('[data-command="status"]').click();
    expect(await page.evaluate(() => window.__semloRequireFixture("targetFixture").snapshot())).toEqual(before);
    await page.evaluate(() => window.__semloRequireFixture("targetFixture").close());
  } finally {
    await server.close();
  }
});
