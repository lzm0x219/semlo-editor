import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../fixtures/browser/fixture-rsbuild";
import type {} from "../fixtures/lifecycle/upload-abort-framework-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/lifecycle/upload-abort-framework-fixture.ts", {
    framework: true,
  }));
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
