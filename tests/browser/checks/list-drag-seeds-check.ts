import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { chromium } from "playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime.ts";

const outputDir = await mkdtemp(join(tmpdir(), "semlo-editor-list-drag-seeds-"));
const rsbuild = await createRsbuild({
  cwd: process.cwd(),
  rsbuildConfig: {
    source: { entry: { index: "./tests/fixtures/list/list-drag-seeds-fixture.ts" } },
    server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
    dev: { hmr: false, liveReload: false },
    output: { distPath: { root: outputDir } },
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
  for (const direction of ["source", "target"]) {
    const seeded = {
      type: "orderedList",
      attrs: { start: 2, semloEditorListLevelStarts: { 0: 7 } },
      content: [item("二级", 1), item("一级", 0)],
    };
    const plain = { type: "orderedList", attrs: { start: 1 }, content: [item("外项", 0)] };
    const content = {
      type: "doc",
      content: direction === "source" ? [seeded, { type: "paragraph" }, plain] : [plain, { type: "paragraph" }, seeded],
    };
    await page.evaluate((content) => {
      document.body.replaceChildren();
      const host = document.createElement("div");
      document.body.append(host);
      window.listSeedsEditor = window.__semloRequireFixture("createListDragSeedsEditor")({
        element: host,
        outline: false,
        content,
      });
    }, content);
    const before = await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json);
    const prose = page.locator(".semlo-editor-prose");
    const source = prose.getByText(direction === "source" ? "二级" : "外项", { exact: true });
    const target = prose.getByText(direction === "source" ? "外项" : "二级", { exact: true });
    await source.hover();
    const handle = page.locator(".semlo-editor-block-handle:visible");
    const from = await handle.boundingBox(),
      to = await target.boundingBox();
    assert.ok(from && to);
    await page.mouse.move(from.x + 12, from.y + 12);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
    await page.mouse.move(to.x + 5, direction === "source" ? to.y + to.height - 2 : to.y + 2, { steps: 10 });
    await page.mouse.up();
    const after = await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot());
    assert.notDeepEqual(after.json, before);
    const lists = after.json.content?.filter((node) => node.type === "orderedList");
    assert.ok(lists);
    const affected = lists[direction === "source" ? 0 : lists.length - 1];
    assert.ok(affected?.attrs);
    assert.equal(affected.attrs.start, 7);
    assert.equal(affected.attrs.semloEditorListLevelStarts["1"], 2);
    assert.equal(
      await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").editor.commands.undo()),
      true,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json),
      before,
    );
    assert.equal(
      await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").editor.commands.redo()),
      true,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json),
      after.json,
    );
    for (const key of ["json", "html"] as const) {
      const result = await page.evaluate(
        ({ value }) => {
          window.__semloRequireFixture("listSeedsEditor").setContent(value);
          return window.__semloRequireFixture("listSeedsEditor").getSnapshot().json;
        },
        { key, value: after[key] },
      );
      assert.deepEqual(result, after.json, `${direction} ${key} round trip`);
    }
    await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").destroy());
    console.log(`${direction}: drag, undo, redo and JSON/HTML round trips passed`);
  }
  await page.evaluate(
    (content) => {
      document.body.replaceChildren();
      const host = document.createElement("div");
      document.body.append(host);
      window.listSeedsEditor = window.__semloRequireFixture("createListDragSeedsEditor")({
        element: host,
        outline: false,
        content,
      });
    },
    {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "插入段落" }] },
        {
          type: "orderedList",
          attrs: { start: 7 },
          content: [item("甲", 0), item("乙", 1), item("丙", 0), item("丁", 1), item("戊", 0)],
        },
      ],
    },
  );
  const beforeSplit = await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json);
  const prose = page.locator(".semlo-editor-prose");
  await prose.getByText("插入段落", { exact: true }).hover();
  const from = await page.locator(".semlo-editor-block-handle:visible").boundingBox();
  const to = await prose.getByText("丁", { exact: true }).boundingBox();
  assert.ok(from && to);
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x + 5, to.y + 2, { steps: 10 });
  await page.mouse.up();
  const split = await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot());
  assert.ok(split.json.content?.[2]?.attrs);
  assert.deepEqual(
    split.json.content.map((node) => node.type),
    ["orderedList", "paragraph", "orderedList"],
  );
  assert.equal(split.json.content[2].attrs.start, 1);
  assert.equal(split.json.content[2].attrs.semloEditorListLevelStarts["0"], 9);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").editor.commands.undo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json),
    beforeSplit,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").editor.commands.redo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("listSeedsEditor").getSnapshot().json),
    split.json,
  );
  for (const key of ["json", "html"] as const) {
    const result = await page.evaluate((value) => {
      window.__semloRequireFixture("listSeedsEditor").setContent(value);
      return window.__semloRequireFixture("listSeedsEditor").getSnapshot().json;
    }, split[key]);
    assert.deepEqual(result, split.json);
  }
  console.log("split mixed-level ordered list: seeds, undo, redo and JSON/HTML round trips passed");
} finally {
  await browser.close();
  await server.close();
  await rm(outputDir, { recursive: true, force: true });
}
