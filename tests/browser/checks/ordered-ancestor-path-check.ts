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
  await page.evaluate(() => {
    document.body.replaceChildren();
    const host = document.createElement("div");
    document.body.append(host);
    window.pathEditor = window.__semloRequireFixture("createListDragSeedsEditor")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: {
              start: 4,
              semloEditorOrderedStyle: "decimal",
              semloEditorOrderedAncestorPath: [7],
              semloEditorListLevelStarts: { 0: 8 },
            },
            content: [
              {
                type: "listItem",
                attrs: { semloEditorListIndent: 1 },
                content: [{ type: "paragraph", content: [{ type: "text", text: "丁" }] }],
              },
              {
                type: "listItem",
                attrs: { semloEditorListIndent: 0 },
                content: [{ type: "paragraph", content: [{ type: "text", text: "戊" }] }],
              },
            ],
          },
        ],
      },
    });
  });
  const markers = () =>
    page
      .locator(".semlo-editor-prose li")
      .evaluateAll((items) => items.map((item) => getComputedStyle(item).listStyleType));
  assert.deepEqual(await markers(), ['"7.4. "', '"8. "']);
  const saved = await page.evaluate(() => window.__semloRequireFixture("pathEditor").getSnapshot());
  assert.ok(saved.html.includes("data-semlo-editor-ordered-ancestor-path"));
  for (const value of [saved.html, saved.json]) {
    const restored = await page.evaluate((value) => {
      window.__semloRequireFixture("pathEditor").setContent(value);
      return window.__semloRequireFixture("pathEditor").getSnapshot();
    }, value);
    assert.deepEqual(restored.json, saved.json);
    assert.deepEqual(await markers(), ['"7.4. "', '"8. "']);
  }
  for (const path of [null, [7, 8], ["7"]]) {
    const content = structuredClone(saved.json);
    assert.ok(content.content?.[0]?.attrs);
    content.content[0].attrs.semloEditorOrderedAncestorPath = path;
    await page.evaluate((value) => window.__semloRequireFixture("pathEditor").setContent(value), content);
    assert.deepEqual(await markers(), ['"1.4. "', '"8. "']);
  }
  console.log(
    "explicit ancestor path renders and survives JSON/HTML; absent, malformed or wrong-depth paths are ignored",
  );
} finally {
  await browser.close();
  await server.close();
}
