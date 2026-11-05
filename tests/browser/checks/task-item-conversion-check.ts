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
  for (const [kind, direction] of [
    ["bullet", "caret"],
    ["ordered", "caret"],
    ["chinese", "caret"],
    ["bullet", "forward"],
    ["bullet", "backward"],
    ["bullet", "multi"],
    ["bullet", "multi-backward"],
  ] as const) {
    await page.evaluate(() => {
      window.taskConversionEditor?.destroy();
      document.body.replaceChildren();
      const host = document.createElement("div");
      document.body.append(host);
      const item = (text: string, checked: boolean, indent: number) => ({
        type: "taskItem",
        attrs: { checked, semloEditorListIndent: indent },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [{ type: "taskList", content: [item("甲", true, 0), item("乙", false, 1), item("丙", true, 0)] }],
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.getByText("乙", { exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "乙",
    );
    if (direction === "forward" || direction === "backward")
      await page.evaluate((direction) => {
        const editor = window.__semloRequireFixture("taskConversionEditor").editor;
        const start = editor.state.selection.$from.start();
        editor.commands.setTextSelection({
          from: start + (direction === "backward" ? 1 : 0),
          to: start + (direction === "backward" ? 0 : 1),
        });
      }, direction);
    if (direction === "multi" || direction === "multi-backward")
      await page.evaluate((direction) => {
        const editor = window.__semloRequireFixture("taskConversionEditor").editor;
        let from = 0,
          to = 0;
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.textContent === "甲") from = pos + 1;
          if (node.isTextblock && node.textContent === "乙") to = pos + node.nodeSize - 1;
        });
        editor.commands.setTextSelection({
          from: direction === "multi-backward" ? to : from,
          to: direction === "multi-backward" ? from : to,
        });
      }, direction);
    if (kind === "bullet") await page.getByRole("button", { name: "无序列表", exact: true }).click();
    else if (kind === "ordered") await page.getByRole("button", { name: "有序列表", exact: true }).click();
    else {
      await page.getByRole("button", { name: "有序列表样式", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "中文数字" }).click();
    }
    const after = await snapshot();
    const multi = direction === "multi" || direction === "multi-backward";
    assert.deepEqual(
      after.json.content?.map((node) => node.type),
      multi ? ["bulletList", "taskList"] : ["taskList", kind === "bullet" ? "bulletList" : "orderedList", "taskList"],
    );
    const nodes = after.json.content!;
    if (multi) {
      assert.deepEqual(
        nodes[0].content?.map((node) => node.attrs?.semloEditorListIndent),
        [0, 1],
      );
      assert.equal(nodes[1].content?.[0].attrs?.checked, true);
    } else {
      assert.equal(nodes[0].content?.[0].attrs?.checked, true);
      assert.equal(nodes[1].content?.[0].attrs?.semloEditorListIndent, 1);
      assert.equal(nodes[2].content?.[0].attrs?.checked, true);
    }
    if (kind === "chinese") {
      assert.equal(nodes[1].attrs?.semloEditorOrderedStyle, "chinese");
      assert.equal(
        await page.locator(".semlo-editor-prose ol > li").evaluate((item) => getComputedStyle(item).listStyleType),
        '"(一) "',
      );
    }
    const selected = await page.evaluate(() => ({
      text: window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent,
      offset: window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parentOffset,
    }));
    assert.equal(selected.text, multi ? "甲" : "乙");
    if (direction !== "caret") {
      const selectedRange = await page.evaluate(() => {
        const { selection, doc } = window.__semloRequireFixture("taskConversionEditor").editor.state;
        return {
          text: doc.textBetween(selection.from, selection.to, "\n"),
          backwards: selection.anchor > selection.head,
        };
      });
      assert.deepEqual(selectedRange, {
        text: multi ? "甲\n乙" : "乙",
        backwards: direction === "backward" || direction === "multi-backward",
      });
    }
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
      const json = await page.evaluate((value) => {
        window.__semloRequireFixture("taskConversionEditor").setContent(value);
        return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
      }, after[key]);
      assert.deepEqual(json, after.json);
    }
    console.log(`${kind} ${direction}: current task only, neighbours, selection, undo/redo and HTML/JSON passed`);
  }
} finally {
  await browser.close();
  await server.close();
}
