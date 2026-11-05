import assert from "node:assert/strict";

import { createRsbuild } from "@rsbuild/core";
import { chromium } from "playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime.ts";

const rsbuild = await createRsbuild({
  cwd: process.cwd(),
  rsbuildConfig: {
    source: { entry: { index: "./tests/fixtures/list/list-drag-seeds-fixture.ts" } },
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
  await page.waitForFunction(() => window.createListDragSeedsEditor);
  const item = (text: string, indent: number) => ({
    type: "listItem",
    attrs: { semloEditorListIndent: indent },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const content = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "段落" }] },
      {
        type: "orderedList",
        attrs: { start: 7, semloEditorOrderedStyle: "decimal" },
        content: [item("甲", 0), item("乙", 1), item("丙", 0), item("丁", 1), item("戊", 0)],
      },
    ],
  };
  await page.evaluate((content) => {
    document.body.replaceChildren();
    const host = document.createElement("div");
    document.body.append(host);
    window.dragPathEditor = window.__semloRequireFixture("createListDragSeedsEditor")({
      element: host,
      outline: false,
      content,
    });
  }, content);
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("dragPathEditor").getSnapshot());
  const markers = () =>
    page
      .locator(".semlo-editor-prose li")
      .evaluateAll((items) => items.map((item) => getComputedStyle(item).listStyleType));
  const before = await snapshot();
  await page.getByText("段落", { exact: true }).hover();
  const from = await page.locator(".semlo-editor-block-handle:visible").boundingBox();
  const to = await page.getByText("丁", { exact: true }).boundingBox();
  assert.ok(from && to);
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x + 5, to.y + 2, { steps: 10 });
  await page.mouse.up();
  const after = await snapshot();
  assert.ok(after.json.content?.[2]?.attrs);
  assert.deepEqual(
    after.json.content.map((node) => node.type),
    ["orderedList", "paragraph", "orderedList"],
  );
  assert.deepEqual(after.json.content[2].attrs.semloEditorOrderedAncestorPath, [8]);
  assert.deepEqual(await markers(), ['"7. "', '"7.1. "', '"8. "', '"8.1. "', '"9. "']);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("dragPathEditor").editor.commands.undo()), true);
  assert.deepEqual((await snapshot()).json, before.json);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("dragPathEditor").editor.commands.redo()), true);
  assert.deepEqual((await snapshot()).json, after.json);
  for (const value of [after.json, after.html]) {
    assert.deepEqual(
      await page.evaluate((value) => {
        window.__semloRequireFixture("dragPathEditor").setContent(value);
        return window.__semloRequireFixture("dragPathEditor").getSnapshot().json;
      }, value),
      after.json,
    );
    assert.deepEqual(await markers(), ['"7. "', '"7.1. "', '"8. "', '"8.1. "', '"9. "']);
  }
  console.log("decimal list drag split preserves explicit ancestor, undo/redo and HTML/JSON");
} finally {
  await browser.close();
  await server.close();
}
