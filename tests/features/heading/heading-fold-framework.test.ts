import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-fold-framework-fixture";
let origin = "",
  stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/heading/heading-fold-framework-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const server = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${server.port}`;
  stop = () => server.server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));
for (const framework of ["core", "react", "vue", "solid"]) {
  test(`${framework} forwards the fold adapter and restores state on remount`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    try {
      await page.waitForFunction(() => Boolean(window.mountFoldFramework), undefined, { timeout: 3000 });
    } catch {
      throw new Error(`Fixture did not initialize: ${errors.join("; ") || "no browser error"}`);
    }
    await page.evaluate(async (name) => {
      let value: unknown = null;
      const adapter = {
        documentId: "doc",
        revision: "r1",
        load: () => value,
        save: (_id: string, _rev: string, state: unknown) => {
          value = structuredClone(state);
        },
      };
      const first = await window.__semloRequireFixture("mountFoldFramework")(name, adapter);
      (window as unknown as { remountFold: () => Promise<void> }).remountFold = async () => {
        first.destroy();
        await window.__semloRequireFixture("mountFoldFramework")(name, adapter);
      };
    }, framework);
    const host = page.locator("#fold-framework");
    await host.getByRole("button", { name: "折叠标题：标题" }).click();
    await expect(host.locator(".semlo-editor-prose p")).toBeHidden();
    await page.evaluate(() => (window as unknown as { remountFold: () => Promise<void> }).remountFold());
    await expect(host.locator(".semlo-editor-prose p")).toBeHidden();
    await page.evaluate(() => window.__semloRequireFixture("foldFramework").destroy());
  });
}
