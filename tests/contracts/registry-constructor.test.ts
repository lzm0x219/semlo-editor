import { expect, test } from "@rstest/playwright";

import { createFixtureRsbuild } from "../fixtures/browser/fixture-rsbuild";
test("failed constructor releases document listeners and shell", async ({ page }) => {
  const rsbuild = await createFixtureRsbuild("./tests/fixtures/contracts/registry-constructor-fixture.ts", {
    publicDir: false,
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const result = await page.evaluate(() => {
      const p = (window as any).constructorProbe;
      return {
        failure: p.failure,
        shellCount: p.shellCount,
        active: p.tracked.filter((x: any) => !x.removed).map((x: any) => `${x.type}:${x.callback.name}`),
      };
    });
    expect(result.failure).toBe("host constructor failure");
    expect(result.shellCount).toBe(0);
    expect(result.active).toEqual([]);
  } finally {
    await server.close();
  }
});
