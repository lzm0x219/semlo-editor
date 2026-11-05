import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

for (const point of ["sync", "before"] as const) {
  test(`painter activation stops if ${point} hook remounts the editor`, async ({ page }) => {
    const rsbuild = await createRsbuild({
      cwd: process.cwd(),
      rsbuildConfig: {
        source: {
          entry: { index: "./tests/fixtures/format/painter-activation-reentry-fixture.ts" },
          define: { "process.env.NODE_ENV": JSON.stringify("development") },
        },
        server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
        dev: { hmr: false, liveReload: false },
      },
    });
    const { port, server } = await rsbuild.startDevServer();
    try {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate((point) => {
        const fixture = Reflect.get(window, "painterActivationReentry");
        fixture.api.editor.commands.setTextSelection({ from: 1, to: 3 });
        fixture.arm(point);
      }, point);
      const button = page.getByRole("button", { name: "自定义格式刷" });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "false");
      expect(
        await page.evaluate(() =>
          Reflect.get(window, "painterActivationReentry").api.editor.view.dom.classList.contains(
            "semlo-editor-format-painter-active",
          ),
        ),
      ).toBe(false);
    } finally {
      await page.evaluate(() => Reflect.get(window, "painterActivationReentry")?.dispose());
      await server.close();
    }
  });
}
