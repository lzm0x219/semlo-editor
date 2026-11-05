import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Home then ArrowRight stays inside a fold-body heading for typing", async ({ page }) => {
  await installFixtureGuards(page);
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-slash-list-context-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-details-heading-navigation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const results = [];
    for (const level of [1, 2, 3, 4, 5, 6]) {
      await page.evaluate(
        (level) => window.__semloRequireFixture("listSlashFixture").mountNestedHeading("details", level, "甲乙丙"),
        level,
      );
      const heading = page.locator(`#slash-list-fixture .semlo-editor-prose [data-type="detailsContent"] h${level}`);
      await heading.click();
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.type("a");
      results.push({ level, text: await heading.innerText() });
    }
    await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").mountDetailsParagraph("甲乙丙"));
    const paragraph = page.locator('#slash-list-fixture .semlo-editor-prose [data-type="detailsContent"] p');
    await paragraph.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("a");
    results.push({ level: 0, text: await paragraph.innerText() });
    await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").mountDetailsParagraph("甲乙丙"));
    await paragraph.click();
    await page.keyboard.press("Home");
    await page.keyboard.type("a");
    results.push({ level: -1, text: await paragraph.innerText() });
    expect(results).toEqual([
      ...[1, 2, 3, 4, 5, 6, 0].map((level) => ({ level, text: "甲a乙丙" })),
      { level: -1, text: "a甲乙丙" },
    ]);
  } finally {
    await server.close();
  }
});
