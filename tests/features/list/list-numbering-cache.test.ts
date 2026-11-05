import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/list/list-fold-fixture";

let origin = "";
let stop = async () => {};
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
test.beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/list/list-fold-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = async () => server.close();
});
test.afterAll(async () => stop());

test("numbering controls update when list structure changes and after undo", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() =>
    window.__semloRequireFixture("createListFoldEditor")(
      "<ol><li><p>甲</p></li><li><p>乙</p></li></ol><p>分隔</p><ol><li><p>丙</p></li></ol>",
    ),
  );
  const controls = page.getByRole("button", { name: /设置列表编号/ });
  await expect(controls).toHaveCount(3);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("listFoldEditor");
    editor.commands.setTextSelection(3);
    editor.commands.updateAttributes("listItem", { semloEditorListIndent: 1 });
  });
  await expect(controls).toHaveCount(1);
  await expect(page.getByRole("button", { name: "设置列表编号：丙" })).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
  await expect(controls).toHaveCount(3);
});
