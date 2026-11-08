import { test, expect } from "@rstest/playwright";

import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
declare global {
  interface Window {
    translationFocusProbe(mode: string): Promise<{
      externalFocused: boolean;
      editorFocused: boolean;
      oldDestroyed: boolean;
      destroyed: boolean;
      html: string;
    }>;
  }
}
for (const mode of ["normal", "focus", "remount", "destroy"])
  test(`translation respects host ${mode}`, async ({ page }) => {
    const r = await createFixtureRsbuild("./tests/fixtures/toolbar/toolbar-translation-focus-probe-fixture.ts", {
      publicDir: false,
    });
    const { port, server } = await r.startDevServer();
    try {
      await page.goto(`http://127.0.0.1:${port}`);
      const output = await page.evaluate((mode) => window.translationFocusProbe(mode), mode);
      expect(output).toEqual({
        externalFocused: mode !== "normal",
        editorFocused: mode === "normal",
        oldDestroyed: mode === "remount" || mode === "destroy",
        destroyed: mode === "destroy",
        html: mode === "destroy" ? "" : "<p>译文</p>",
      });
    } finally {
      await server.close();
    }
  });
