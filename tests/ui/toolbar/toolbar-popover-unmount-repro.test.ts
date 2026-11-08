import { test, expect } from "@rstest/playwright";

import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
declare global {
  interface Window {
    iframeInsert: { editor: { unmount(): void; mount(element: HTMLElement): void; view: { dom: HTMLElement } } };
  }
}
for (const item of [
  { trigger: "字号", popup: ".semlo-editor-dropdown" },
  { trigger: "文字颜色", popup: '[role="dialog"][aria-label="选择颜色"]' },
])
  test(`${item.trigger} popup closes on editor unmount`, async ({ page }) => {
    const r = await createFixtureRsbuild("./tests/fixtures/insertion/insert-iframe-candidate-fixture.ts", {
      publicDir: false,
    });
    const { port, server } = await r.startDevServer();
    try {
      await page.setViewportSize({ width: 1400, height: 1000 });
      await page.goto(`http://127.0.0.1:${port}`);
      const f = page.frameLocator("iframe");
      await f.locator(".semlo-editor-prose p").click();
      await f.getByRole("button", { name: item.trigger, exact: true }).click();
      const popup = f.locator(item.popup);
      await expect(popup).toBeVisible();
      await page.evaluate(() => window.iframeInsert.editor.unmount());
      await expect(popup).toHaveCount(0);
    } finally {
      await server.close();
    }
  });
test("dropdown works after remount and closes on the next unmount", async ({ page }) => {
  const r = await createFixtureRsbuild("./tests/fixtures/insertion/insert-iframe-candidate-fixture.ts", {
    publicDir: false,
  });
  const { port, server } = await r.startDevServer();
  try {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator("iframe");
    await f.locator(".semlo-editor-prose p").click();
    await f.getByRole("button", { name: "字号", exact: true }).click();
    await page.evaluate(() => {
      const editor = window.iframeInsert.editor;
      const parent = editor.view.dom.parentElement!;
      editor.unmount();
      editor.mount(parent);
    });
    await expect(f.locator(".semlo-editor-dropdown")).toHaveCount(0);
    await f.locator(".semlo-editor-prose p").click();
    await f.getByRole("button", { name: "字号", exact: true }).click();
    await expect(f.locator(".semlo-editor-dropdown")).toBeVisible();
    await page.evaluate(() => window.iframeInsert.editor.unmount());
    await expect(f.locator(".semlo-editor-dropdown")).toHaveCount(0);
  } finally {
    await server.close();
  }
});
