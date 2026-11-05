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
  const markerMismatches = [];
  const item = (text: string, indent: number) => ({
    type: "listItem",
    attrs: { semloEditorListIndent: indent },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  for (const style of ["chinese", "decimal"]) {
    for (const type of [null, "A"]) {
      const content = {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 7, type, semloEditorOrderedStyle: style, semloEditorListLevelStarts: { 1: 3 } },
            content: [item("甲", 0), item("乙", 1), item("丙", 0), item("丁", 1), item("戊", 0)],
          },
        ],
      };
      await page.evaluate((content) => {
        window.integrationEditor?.destroy();
        document.body.replaceChildren();
        const host = document.createElement("div");
        document.body.append(host);
        window.integrationEditor = window.__semloRequireFixture("createListDragSeedsEditor")({
          element: host,
          outline: false,
          content,
        });
      }, content);
      const snapshot = () => page.evaluate(() => window.__semloRequireFixture("integrationEditor").getSnapshot());
      const before = await snapshot();
      const beforeMarkers = await page.locator(".semlo-editor-prose li").evaluateAll((items) =>
        items.map((el) => ({
          text: el.textContent,
          marker: getComputedStyle(el).listStyleType,
          value: el.getAttribute("value"),
        })),
      );
      assert.deepEqual(
        beforeMarkers.map((entry) => entry.value),
        ["7", "3", "8", "1", "9"],
      );
      await page.locator(".semlo-editor-prose").getByText("丙", { exact: true }).click();
      await page.getByRole("button", { name: "段落样式" }).click();
      await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
      const after = await snapshot();
      assert.ok(after.json.content);
      assert.equal(
        after.json.content.filter((node) => node.type === "heading").length,
        1,
        `${style} type=${type}: conversion`,
      );
      const lists = after.json.content.filter((node) => node.type === "orderedList");
      assert.equal(lists.length, 2);
      assert.ok(lists.every((list) => list.attrs?.semloEditorOrderedStyle === style && list.attrs?.type === type));
      const afterMarkers = await page.locator(".semlo-editor-prose li").evaluateAll((items) =>
        items.map((el) => ({
          text: el.textContent,
          marker: getComputedStyle(el).listStyleType,
          value: el.getAttribute("value"),
        })),
      );
      assert.deepEqual(
        afterMarkers.map((entry) => entry.text),
        ["甲", "乙", "丁", "戊"],
      );
      const expectedMarkers =
        style === "decimal" ? ['"7. "', '"7.3. "', '"7.4. "', '"8. "'] : ['"七、 "', '"(三) "', '"(四) "', '"八、 "'];
      if (JSON.stringify(afterMarkers.map((entry) => entry.marker)) !== JSON.stringify(expectedMarkers))
        markerMismatches.push({
          style,
          type,
          expected: expectedMarkers,
          actual: afterMarkers.map((entry) => entry.marker),
        });
      assert.equal(
        await page.evaluate(() => window.__semloRequireFixture("integrationEditor").editor.commands.undo()),
        true,
      );
      assert.deepEqual((await snapshot()).json, before.json);
      assert.equal(
        await page.evaluate(() => window.__semloRequireFixture("integrationEditor").editor.commands.redo()),
        true,
      );
      assert.deepEqual((await snapshot()).json, after.json);
      for (const saved of [before, after])
        for (const source of ["json", "html"] as const) {
          const roundtrip = await page.evaluate((value) => {
            window.__semloRequireFixture("integrationEditor").setContent(value);
            return window.__semloRequireFixture("integrationEditor").getSnapshot();
          }, saved[source]);
          assert.deepEqual(roundtrip.json, saved.json, `${style} type=${type} ${source}`);
          const restoredMarkers = await page
            .locator(".semlo-editor-prose li")
            .evaluateAll((items) => items.map((el) => getComputedStyle(el).listStyleType));
          assert.deepEqual(
            restoredMarkers,
            (saved === before ? beforeMarkers : afterMarkers).map((entry) => entry.marker),
          );
        }
      console.log(`${style} type=${type}: custom start, conversion, undo/redo, HTML/JSON passed`);
    }
  }
  for (const [gap, seed] of [
    ["heading", 9],
    ["paragraph", 8],
  ] as const) {
    const content = {
      type: "doc",
      content: [
        { type: "orderedList", attrs: { start: 7, semloEditorOrderedStyle: "decimal" }, content: [item("前项", 0)] },
        { type: gap, ...(gap === "heading" ? { attrs: { level: 3 } } : {}), content: [{ type: "text", text: "隔断" }] },
        {
          type: "orderedList",
          attrs: { start: 4, semloEditorOrderedStyle: "decimal", semloEditorListLevelStarts: { 0: seed } },
          content: [item("后项", 1)],
        },
      ],
    };
    await page.evaluate((content) => window.__semloRequireFixture("integrationEditor").setContent(content), content);
    assert.equal(
      await page
        .locator(".semlo-editor-prose li")
        .last()
        .evaluate((el) => getComputedStyle(el).listStyleType),
      '"1.4. "',
    );
  }
  console.log("ambiguous seeds and paragraph-separated lists do not inherit");
  assert.deepEqual(markerMismatches, [], "converted list retains the appropriate decimal ancestor");
} finally {
  await browser.close();
  await server.close();
}
