import assert from "node:assert/strict";

import { createRsbuild } from "@rsbuild/core";
import { chromium } from "playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime.ts";
import type {} from "../../fixtures/list/task-item-conversion-fixture.ts";

const rsbuild = await createRsbuild({
  cwd: process.cwd(),
  rsbuildConfig: {
    source: { entry: { index: "./tests/fixtures/list/task-item-conversion-fixture.ts" } },
    server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
    dev: { hmr: false, liveReload: false },
  },
});
const { port, server } = await rsbuild.startDevServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await installFixtureGuards(page);
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.taskConversionCreate);
  for (const action of ["delete", "drag"] as const) {
    await page.evaluate(() => {
      window.taskConversionEditor?.destroy();
      document.body.replaceChildren();
      const host = document.createElement("div");
      document.body.append(host);
      const item = (text: string, indent: number) => ({
        type: "listItem",
        attrs: { semloEditorListIndent: indent },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: {
                start: 2,
                semloEditorOrderedStyle: "decimal",
                semloEditorOrderedAncestorPath: [1],
                semloEditorListLevelStarts: { 0: 2 },
              },
              content: [item("丁", 1), item("戊", 0)],
            },
          ],
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const markers = () =>
      page
        .locator(".semlo-editor-prose li")
        .evaluateAll((items) => items.map((item) => getComputedStyle(item).listStyleType));
    const before = await snapshot();
    assert.deepEqual(await markers(), ['"1.2. "', '"2. "']);
    await page.getByText("丁", { exact: true }).hover();
    const handle = page.locator(".semlo-editor-block-handle:visible");
    if (action === "delete") {
      await handle.click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
    } else {
      const from = await handle.boundingBox(),
        to = await page.getByText("戊", { exact: true }).boundingBox();
      assert.ok(from && to);
      await page.mouse.move(from.x + 12, from.y + 12);
      await page.mouse.down();
      await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
      await page.mouse.move(to.x + 5, to.y + to.height - 2, { steps: 10 });
      await page.mouse.up();
    }
    const after = await snapshot();
    assert.deepEqual(await markers(), action === "delete" ? ['"2. "'] : ['"2. "', '"3. "']);
    assert.equal(after.json.content?.[0].attrs?.semloEditorOrderedAncestorPath ?? null, null);
    assert.equal(
      await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo()),
      true,
    );
    assert.deepEqual((await snapshot()).json, before.json);
    assert.equal(
      await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo()),
      true,
    );
    assert.deepEqual((await snapshot()).json, after.json);
    for (const key of ["json", "html"] as const) {
      const restored = await page.evaluate((value) => {
        window.__semloRequireFixture("taskConversionEditor").setContent(value);
        return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
      }, after[key]);
      assert.deepEqual(restored, after.json);
    }
    console.log(`${action}: marker, path, undo/redo and JSON/HTML passed`);
  }
} finally {
  await browser.close();
  await server.close();
}
