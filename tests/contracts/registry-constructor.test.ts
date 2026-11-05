import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";
test("failed constructor releases document listeners and shell", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/contracts/registry-constructor-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
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
