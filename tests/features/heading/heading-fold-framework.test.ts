import path from "node:path";

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
        tsconfigPath: "./tsconfig.browser-fixtures.json",
        entry: { index: "./tests/fixtures/heading/heading-fold-framework-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": path.resolve("packages/core/dist/index.js") } },
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
      const values = new Map<string, unknown>();
      const adapter = {
        documentId: "doc",
        revision: "r1",
        load: (_id: string, revision: string) => values.get(revision),
        save: (_id: string, revision: string, state: unknown) => {
          values.set(revision, structuredClone(state));
        },
      };
      const first = await window.__semloRequireFixture("mountFoldFramework")(name, adapter);
      (window as unknown as { remountFold: () => Promise<void> }).remountFold = async () => {
        const editor = first.controller.editor;
        editor.view.dispatch(editor.state.tr.insertText("新", 1));
        const capture = window.__semloRequireFixture("captureFoldFramework")();
        if (!capture) throw new Error("无法捕获折叠状态");
        if (!capture.commit("r2")) throw new Error("折叠状态迁移失败");
        first.destroy();
        adapter.revision = "r2";
        await window.__semloRequireFixture("mountFoldFramework")(name, adapter, capture.snapshot.json);
      };
    }, framework);
    const host = page.locator("#fold-framework");
    await host.getByRole("button", { name: "折叠标题：标题" }).click();
    await expect(host.locator(".semlo-editor-prose p")).toBeHidden();
    await page.evaluate(() => (window as unknown as { remountFold: () => Promise<void> }).remountFold());
    await expect(host.locator(".semlo-editor-prose p")).toBeHidden();
    await expect(host.getByRole("button", { name: "展开标题：新标题" })).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("foldFramework").destroy());
  });
}
