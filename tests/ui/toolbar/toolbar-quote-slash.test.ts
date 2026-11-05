import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

test("root quote slash menu opens for an empty paragraph but not before existing text", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-quote-slash-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-quote-slash-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const paragraph = page.locator("#quote-slash-fixture blockquote p");
    const menu = page.getByRole("listbox", { name: "插入内容" });
    await paragraph.click();
    await page.keyboard.type("/");
    await expect(menu).toBeVisible();
    await page.reload();
    await paragraph.click();
    await page.keyboard.insertText("甲乙丙");
    await page.keyboard.press("Home");
    await page.keyboard.type("/");
    await expect(paragraph).toHaveText("/甲乙丙");
    await expect(menu).toHaveCount(0);
  } finally {
    await server.close();
  }
});
