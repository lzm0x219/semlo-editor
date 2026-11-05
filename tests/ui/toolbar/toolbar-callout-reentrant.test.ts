import { createRsbuild } from "@rsbuild/core";
import { test, expect } from "@rstest/playwright";
declare global {
  interface Window {
    calloutReentrant(mode: string): { result?: string; error?: string; destroyed: boolean; externalFocused: boolean };
  }
}
test("callout respects synchronous host destroy, unmount and focus", async ({ page }) => {
  const r = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-callout-reentrant-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await r.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    expect(await page.evaluate(() => window.calloutReentrant("destroy"))).toEqual({
      result: "inserted",
      destroyed: true,
      externalFocused: false,
    });
    expect(await page.evaluate(() => window.calloutReentrant("unmount"))).toEqual({
      result: "inserted",
      destroyed: true,
      externalFocused: false,
    });
    expect(await page.evaluate(() => window.calloutReentrant("remount"))).toEqual({
      result: "inserted",
      destroyed: false,
      externalFocused: true,
    });
    expect(await page.evaluate(() => window.calloutReentrant("focus"))).toEqual({
      result: "inserted",
      destroyed: false,
      externalFocused: true,
    });
  } finally {
    await server.close();
  }
});
