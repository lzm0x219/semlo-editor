import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
test(`core replacing document while unmounted cancels queued attachments`, async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
  await page.waitForFunction(() => Boolean(window.bookmarkFramework));
  await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").mount("core"));
  await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
  const host = page.locator("#framework-bookmark");
  await host.locator('input[type="file"][multiple]').setInputFiles([
    { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") },
    { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second") },
  ]);
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length === 1);
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("bookmarkFramework");
    const api = window.__semloRequireValue(fixture.controller, "controller");
    api.editor.unmount();
    api.setContent("<p>卸载时的新文档</p>");
    fixture.pendingUploads[0].resolve("/files/first.txt");
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length)).toBe(1);
  await page.evaluate(() => {
    const editor = window.__semloRequireValue(
      window.__semloRequireFixture("bookmarkFramework").controller,
      "controller",
    ).editor;
    editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
  });
  await page.waitForTimeout(200);
  await expect(host.locator(".semlo-editor-prose")).toContainText("卸载时的新文档");
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length)).toBe(1);
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveCount(0);
});
