import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

test("empty card paragraphs show slash menu, while slash before existing text stays literal", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-card-paragraph-slash-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-card-paragraph-slash-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    for (const kind of ["callout", "details", "foldCallout"]) {
      await page.goto(`http://127.0.0.1:${port}`);
      const paragraph = page.locator(`#paragraph-slash-${kind} .semlo-editor-prose p`);
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
    }
  } finally {
    await server.close();
  }
});
