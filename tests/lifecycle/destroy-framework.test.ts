import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type {} from "../fixtures/lifecycle/destroy-framework-fixture";
let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/lifecycle/destroy-framework-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core": resolve(process.cwd(), "packages/core/src/index.ts") } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  const entryErrors: string[] = [];
  page.on("pageerror", (error) => entryErrors.push(error.message));
  await installFixtureGuards(page);
  await page.goto(origin);
  try {
    await page.waitForFunction(() => typeof window.mountDestroyFramework === "function", undefined, { timeout: 5000 });
  } catch (error) {
    throw new Error(`Framework fixture failed to load: ${entryErrors.join("; ") || String(error)}`);
  }
});
for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} handles direct editor destruction, later props and adapter unmount`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.evaluate((framework) => window.__semloRequireFixture("mountDestroyFramework")(framework), framework);
    const result = await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("destroyFrameworkFixture");
      const before = fixture.controller.editor.getJSON();
      fixture.controller.editor.destroy();
      fixture.update();
      await fixture.settle();
      fixture.unmount();
      fixture.controller.destroy();
      fixture.controller.destroy();
      await fixture.settle();
      return {
        before,
        after: fixture.controller.editor.getJSON(),
        errors: fixture.errors,
        changes: fixture.changes,
        shells: document.querySelectorAll(".semlo-editor").length,
        toolbars: document.querySelectorAll(".semlo-editor-table-toolbar").length,
      };
    });
    expect(result.after).toEqual(result.before);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([]);
    expect(result.shells).toBe(0);
    expect(result.toolbars).toBe(0);
    expect(pageErrors).toEqual([]);
  });
}
