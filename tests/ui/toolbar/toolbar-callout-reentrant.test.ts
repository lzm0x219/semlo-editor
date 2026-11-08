import { test, expect } from "@rstest/playwright";

import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
declare global {
  interface Window {
    calloutReentrant(mode: string): { result?: string; error?: string; destroyed: boolean; externalFocused: boolean };
  }
}
test("callout respects synchronous host destroy, unmount and focus", async ({ page }) => {
  const r = await createFixtureRsbuild("./tests/fixtures/toolbar/toolbar-callout-reentrant-fixture.ts", {
    publicDir: false,
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
