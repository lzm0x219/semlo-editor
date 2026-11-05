import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
test.beforeEach(async ({ page }) => installFixtureGuards(page));
for (const kind of ["core", "react", "vue", "solid"] as const) {
  test(`${kind} audio completion while unmounted survives remount`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await host
      .locator('input[data-semlo-editor-media-input="audio"]')
      .setInputFiles({ name: "pending.wav", mimeType: "audio/wav", buffer: Buffer.from("audio") });
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length === 1);
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("bookmarkFramework");
      window.__semloRequireValue(fixture.controller, "controller").editor.unmount();
      fixture.pendingUploads[0].resolve("/files/pending.wav");
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const editor = window.__semloRequireValue(
        window.__semloRequireFixture("bookmarkFramework").controller,
        "controller",
      ).editor;
      editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
    });
    await expect(host.locator("audio")).toHaveAttribute("src", "/files/pending.wav");
    await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });
}
