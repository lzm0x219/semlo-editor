import { createRsbuild } from "@rsbuild/core";
import { test, expect } from "@rstest/playwright";
declare global {
  interface Window {
    iframeInsert: { editor: { unmount(): void; mount(element: HTMLElement): void; view: { dom: HTMLElement } } };
  }
}
for (const kind of ["font", "emoji"])
  test(`${kind} panel closes after editor unmount`, async ({ page }) => {
    const r = await createRsbuild({
      cwd: process.cwd(),
      rsbuildConfig: {
        source: { entry: { index: "./tests/fixtures/insertion/insert-iframe-candidate-fixture.ts" } },
        server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
        dev: { hmr: false, liveReload: false },
      },
    });
    const { port, server } = await r.startDevServer();
    try {
      await page.setViewportSize({ width: 1400, height: 1000 });
      await page.goto(`http://127.0.0.1:${port}`);
      const f = page.frameLocator("iframe");
      await f.locator(".semlo-editor-prose p").click();
      if (kind === "font") {
        await f.getByRole("button", { name: "字体", exact: true }).click();
      } else {
        await f.getByRole("button", { name: "插入内容", exact: true }).click();
        const panel = f.getByRole("dialog", { name: "插入内容" });
        await panel.getByRole("textbox", { name: "搜索插入内容" }).fill("表情");
        await panel.locator('[data-command="emoji"]').click();
      }
      const popup = f.getByRole("dialog", { name: kind === "font" ? "选择字体" : "选择表情" });
      await expect(popup).toBeVisible();
      await page.evaluate(() => window.iframeInsert.editor.unmount());
      await expect(popup).toHaveCount(0);
    } finally {
      await server.close();
    }
  });
