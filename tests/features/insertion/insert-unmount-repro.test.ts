import { createRsbuild } from "@rsbuild/core";
import { test, expect } from "@rstest/playwright";
declare global {
  interface Window {
    iframeInsert: { editor: { unmount(): void; mount(element: HTMLElement): void; view: { dom: HTMLElement } } };
  }
}
test("open insert menu cleans up when the host unmounts its editor", async ({ page }) => {
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
    await f.getByRole("button", { name: "插入内容", exact: true }).click();
    const panel = f.getByRole("dialog", { name: "插入内容" });
    await expect(panel).toBeVisible();
    await page.evaluate(() => window.iframeInsert.editor.unmount());
    await expect(panel).toHaveCount(0);
  } finally {
    await server.close();
  }
});
test("remount does not revive the old insert panel", async ({ page }) => {
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
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator("iframe");
    await f.locator(".semlo-editor-prose p").click();
    await f.getByRole("button", { name: "插入内容", exact: true }).click();
    const panel = f.getByRole("dialog", { name: "插入内容" });
    await expect(panel).toBeVisible();
    await page.evaluate(() => {
      const e = window.iframeInsert.editor;
      const parent = e.view.dom.parentElement!;
      e.unmount();
      e.mount(parent);
    });
    await expect(panel).toHaveCount(0);
    await f.locator(".semlo-editor-prose").press("Escape");
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
