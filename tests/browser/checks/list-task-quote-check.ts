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
    window.listSeedsEditor = window.__semloRequireFixture("createListDragSeedsEditor")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: false, semloEditorListIndent: 1 },
                content: [{ type: "paragraph", content: [{ type: "text", text: "缩进待办" }] }],
              },
            ],
          },
        ],
      },
    });
  });
  await page.getByText("缩进待办", { exact: true }).click();
  const before = await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json);
  await page.getByRole("button", { name: "无序列表", exact: true }).click();
  const result = await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot());
  console.log(JSON.stringify(result.json));
  const bullet = page.locator('.semlo-editor-prose ul:not([data-type="taskList"]) li');
  assert.equal(await bullet.count(), 1, "indented task converts to a bullet item");
  assert.equal(await bullet.evaluate((node) => getComputedStyle(node).listStyleType), "circle");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").editor.commands.undo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json),
    before,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").editor.commands.redo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json),
    result.json,
  );
  for (const key of ["json", "html"] as const) {
    const json = await page.evaluate((value) => {
      window.__semloRequireFixture("listSeedsEditor").setContent(value);
      return window.__semloRequireFixture("listSeedsEditor").getSnapshot().json;
    }, result[key]);
    assert.deepEqual(json, result.json);
  }
  console.log("indented task conversion, undo, redo and JSON/HTML round trips passed");

  await page.evaluate(() =>
    window.__semloRequireFixture("listSeedsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false, semloEditorListIndent: 0 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: true, semloEditorListIndent: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false, semloEditorListIndent: 2 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "丙" }] }],
            },
          ],
        },
      ],
    }),
  );
  await page.getByText("乙", { exact: true }).click();
  const multiBefore = await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json);
  await page.getByRole("button", { name: "无序列表", exact: true }).click();
  const multiAfter = await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json);
  assert.deepEqual(
    multiAfter.content?.map((list) => list.type),
    ["taskList", "bulletList", "taskList"],
  );
  assert.deepEqual(
    multiAfter.content?.flatMap((list) => list.content?.map((item) => item.attrs?.semloEditorListIndent) ?? []),
    [0, 1, 2],
  );
  assert.equal(multiAfter.content?.[0]?.content?.[0]?.attrs?.checked, false);
  assert.equal(multiAfter.content?.[2]?.content?.[0]?.attrs?.checked, false);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").editor.commands.undo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json),
    multiBefore,
  );
  console.log("mixed-depth task list conversion and undo passed");

  await page.evaluate(() =>
    window.__semloRequireFixture("listSeedsEditor").setContent("<blockquote><p>引用甲</p></blockquote>"),
  );
  await page.locator("blockquote p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("引用乙");
  assert.deepEqual(await page.locator("blockquote p").allTextContents(), ["引用甲", "引用乙"]);
  const quote = await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot());
  for (const key of ["json", "html"] as const) {
    const json = await page.evaluate((value) => {
      window.__semloRequireFixture("listSeedsEditor").setContent(value);
      return window.__semloRequireFixture("listSeedsEditor").getSnapshot().json;
    }, quote[key]);
    assert.deepEqual(json, quote.json);
  }
  console.log("quote editing and JSON/HTML round trips passed");
} finally {
  await browser.close();
  await server.close();
}
