import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type {} from "../fixtures/lifecycle/upload-abort-framework-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/lifecycle/upload-abort-framework-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": "./packages/core/src/index.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.uploadAbortFramework));
});

for (const framework of ["core", "react", "vue", "solid"] as const) {
  test(`${framework} passes signals to image and attachment uploads`, async ({ page }) => {
    await page.evaluate(
      (framework) => window.__semloRequireFixture("uploadAbortFramework").mount(framework),
      framework,
    );
    const host = page.locator("#upload-abort-framework");
    await host
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from("image") });
    await host
      .locator('input[type="file"][multiple]')
      .setInputFiles({ name: "file.pdf", mimeType: "application/pdf", buffer: Buffer.from("file") });
    await page.waitForFunction(() => window.uploadAbortFramework?.requests().length === 2);
    const before = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("uploadAbortFramework");
      fixture
        .controller()
        .setIntegrations({ uploadImage: async () => "/new.png", uploadAttachment: async () => "/new.pdf" });
      return fixture.requests().map((request) => ({ name: request.name, aborted: request.signal.aborted }));
    });
    expect(before).toEqual([
      { name: "image.png", aborted: false },
      { name: "file.pdf", aborted: false },
    ]);
    await page.evaluate(() =>
      window.__semloRequireFixture("uploadAbortFramework").controller().setContent("<p>replacement</p>"),
    );
    expect(
      await page.evaluate(() =>
        window
          .__semloRequireFixture("uploadAbortFramework")
          .requests()
          .map((request) => request.signal.aborted),
      ),
    ).toEqual([true, true]);
    await page.evaluate(() => window.__semloRequireFixture("uploadAbortFramework").destroy());
  });
}
