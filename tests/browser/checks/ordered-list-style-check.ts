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
  await page.waitForFunction(() => window.Editor);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.append(host);
    const Editor = window.__semloRequireFixture("Editor");
    window.styleEditor = new Editor({
      element: host,
      extensions: [
        window.__semloRequireFixture("StarterKit"),
        window.__semloRequireFixture("ParagraphLayout"),
        window.__semloRequireFixture("OrderedListStyles"),
      ],
      content: "<p>甲</p>",
    });
  });
  const editor = () => page.evaluate(() => window.__semloRequireFixture("styleEditor").getJSON());
  const change = (style: import("../../../packages/core/src/features/list/ordered-style").OrderedListStyle) =>
    page.evaluate(
      (style) =>
        window.__semloRequireFixture("setOrderedListStyle")(window.__semloRequireFixture("styleEditor"), style),
      style,
    );
  assert.equal(await change("chinese"), true);
  assert.equal(await page.locator("li").evaluate((item) => getComputedStyle(item).listStyleType), '"一、 "');
  assert.equal((await editor()).content?.[0]?.attrs?.semloEditorOrderedStyle, "chinese");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("styleEditor").commands.undo()), true);
  assert.equal((await editor()).content?.[0]?.type, "paragraph");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("styleEditor").commands.redo()), true);

  await page.evaluate(() =>
    window.__semloRequireFixture("styleEditor").commands.setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 1, semloEditorOrderedStyle: "chinese" },
          content: [
            {
              type: "listItem",
              attrs: { semloEditorListIndent: 0 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }],
            },
            {
              type: "listItem",
              attrs: { semloEditorListIndent: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }],
            },
            {
              type: "listItem",
              attrs: { semloEditorListIndent: 2 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "丙" }] }],
            },
            {
              type: "listItem",
              attrs: { semloEditorListIndent: 0 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "丁" }] }],
            },
          ],
        },
      ],
    }),
  );
  const markerStyles = () =>
    page.locator("li").evaluateAll((items) => items.map((item) => getComputedStyle(item).listStyleType));
  assert.deepEqual(await markerStyles(), ['"一、 "', '"(一) "', '"1. "', '"二、 "']);
  assert.equal(await change("decimal"), true);
  assert.deepEqual(await markerStyles(), ['"1. "', '"1.1. "', '"1.1.1. "', '"2. "']);
  const json = await editor();
  const html = await page.evaluate(() =>
    window.__semloRequireFixture("serializeOrderedListStyles")(
      window.__semloRequireFixture("serializeOrderedListOrdinals")(
        window.__semloRequireFixture("styleEditor").getHTML(),
        document,
        window.__semloRequireFixture("styleEditor").state.doc,
      ),
      document,
      window.__semloRequireFixture("styleEditor").state.doc,
    ),
  );
  assert.ok(html.includes('data-semlo-editor-ordered-style="decimal"'));
  assert.equal(
    await page.evaluate((html) => {
      const template = document.createElement("template");
      template.innerHTML = html;
      return template.content.querySelectorAll("li")[2].style.listStyleType;
    }, html),
    '"1.1.1. "',
  );
  await page.evaluate((html) => window.__semloRequireFixture("styleEditor").commands.setContent(html), html);
  assert.deepEqual(await editor(), json);
  assert.deepEqual(await markerStyles(), ['"1. "', '"1.1. "', '"1.1.1. "', '"2. "']);
  console.log("ordered styles: insertion, three levels, undo/redo, and HTML/JSON passed");

  await page.evaluate(() =>
    window.__semloRequireFixture("styleEditor").commands.setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "父" }] },
                {
                  type: "orderedList",
                  content: [
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子甲" }] }] },
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子乙" }] }] },
                  ],
                },
              ],
            },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "父二" }] }] },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(await markerStyles(), ['"1. "', '"1.1. "', '"1.2. "', '"2. "']);
  const nested = await editor();
  const nestedHtml = await page.evaluate(() =>
    window.__semloRequireFixture("serializeOrderedListStyles")(
      window.__semloRequireFixture("serializeOrderedListOrdinals")(
        window.__semloRequireFixture("styleEditor").getHTML(),
        document,
        window.__semloRequireFixture("styleEditor").state.doc,
      ),
      document,
      window.__semloRequireFixture("styleEditor").state.doc,
    ),
  );
  await page.evaluate((html) => window.__semloRequireFixture("styleEditor").commands.setContent(html), nestedHtml);
  assert.deepEqual(await editor(), nested);
  assert.deepEqual(await markerStyles(), ['"1. "', '"1.1. "', '"1.2. "', '"2. "']);
  console.log("nested ordered list inherits style and survives HTML round trip");
} finally {
  await browser.close();
  await server.close();
}
