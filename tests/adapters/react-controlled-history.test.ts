import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import type {} from "../fixtures/adapters/react-controlled-history-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/adapters/react-controlled-history-fixture.ts" },
        define: { "process.env.NODE_ENV": JSON.stringify("development") },
      },
      resolve: {
        alias: {
          "@semlo-editor/core$": resolve("packages/core/dist/index.js"),
          "@semlo-editor/core/style.css": resolve("packages/core/dist/style.css"),
          "@semlo-editor/react$": resolve("packages/react/dist/index.js"),
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());

async function committed(page: Page) {
  await page.waitForFunction(() => {
    const state = window.reactHistory.state;
    return state.controller && state.committedVersion === state.requestedVersion;
  });
}
async function mount(page: Page, options: Parameters<Window["reactHistory"]["mount"]>[0] = {}) {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.reactHistory));
  await page.evaluate((options) => window.reactHistory.mount(options), options);
  await committed(page);
}
const snapshot = (page: Page) => page.evaluate(() => window.reactHistory.state.controller!.getSnapshot());
const editor = (page: Page) => page.locator("#react-history-editor .semlo-editor-prose");

async function bold(page: Page) {
  await page.evaluate(() => {
    window.reactHistory.state.controller!.editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
  });
  await page.locator("#react-history-editor").getByRole("button", { name: "加粗", exact: true }).click();
  await committed(page);
}

test("宿主提交期撤销不被旧受控快照覆盖，重做仍恢复格式", async ({ page }) => {
  await mount(page, { undoOnBold: true });
  const original = await snapshot(page);
  await bold(page);
  expect(await page.evaluate(() => window.reactHistory.state.undoResult)).toBe(true);
  expect(await page.evaluate(() => window.reactHistory.state.textAfterUndo)).toBe(original.text);
  expect((await snapshot(page)).json).toEqual(original.json);
  expect(await page.evaluate(() => window.reactHistory.state.controller!.editor.commands.redo())).toBe(true);
  await committed(page);
  await expect(editor(page).locator("strong")).toHaveText("alpha");
  await expect(editor(page).locator("p").last()).toHaveText("未选正文");
  await page.evaluate(() => window.reactHistory.patch({ content: "<p>真正的外部新文档</p>" }));
  await committed(page);
  await expect(editor(page)).toHaveText("真正的外部新文档");
});

for (const initial of ["<p>初始属性</p>", undefined]) {
  test(`首次 content 为 ${initial === undefined ? "undefined" : "已提供"} 时保留 onReady 写入，首次外部更新生效`, async ({
    page,
  }) => {
    await mount(page, { content: initial, readyContent: "<p>ready 主动写入</p>" });
    expect(await page.evaluate(() => window.reactHistory.state.readyText)).toEqual([
      initial === undefined ? "" : "初始属性",
    ]);
    await expect(editor(page)).toHaveText("ready 主动写入");
    await page.evaluate(() => window.reactHistory.patch({ content: "<p>第一次外部更新</p>" }));
    await committed(page);
    await expect(editor(page)).toHaveText("第一次外部更新");
    const updated = await snapshot(page);
    await page.evaluate(() => window.reactHistory.patch({ content: undefined }));
    await committed(page);
    expect((await snapshot(page)).json).toEqual(updated.json);
    await page.evaluate((content) => window.reactHistory.patch({ content }), initial ?? "<p>重新受控</p>");
    await committed(page);
    await expect(editor(page)).toHaveText(initial === undefined ? "重新受控" : "初始属性");
  });
}

test("StrictMode 重放及 key 重挂后继续同步外部内容并清理旧实例", async ({ page }) => {
  await mount(page, { strict: true, content: "<p>严格模式</p>", readyContent: "<p>ready 严格模式</p>" });
  await expect(editor(page)).toHaveCount(1);
  await expect(editor(page)).toHaveText("ready 严格模式");
  expect(await page.evaluate(() => window.reactHistory.state.controllers.length)).toBeGreaterThanOrEqual(2);
  expect(
    await page.evaluate(
      () => window.reactHistory.state.controllers.filter((value) => !value.editor.isDestroyed).length,
    ),
  ).toBe(1);
  await page.evaluate(() => window.reactHistory.patch({ content: "<p>第一次严格更新</p>" }));
  await committed(page);
  await expect(editor(page)).toHaveText("第一次严格更新");
  const previous = await page.evaluate(() => window.reactHistory.state.controllers.length);
  await page.evaluate(() => window.reactHistory.remount());
  await committed(page);
  expect(
    await page.evaluate(
      (count) => window.reactHistory.state.controllers.slice(0, count).every((value) => value.editor.isDestroyed),
      previous,
    ),
  ).toBe(true);
  await expect(editor(page)).toHaveText("ready 严格模式");
  await page.evaluate(() => window.reactHistory.patch({ content: "<p>重挂后外部更新</p>" }));
  await committed(page);
  await expect(editor(page)).toHaveText("重挂后外部更新");
  expect(
    await page.evaluate(
      () => window.reactHistory.state.controllers.filter((value) => !value.editor.isDestroyed).length,
    ),
  ).toBe(1);
  await page.evaluate(() => window.reactHistory.destroy());
  expect(
    await page.evaluate(() => window.reactHistory.state.controllers.every((value) => value.editor.isDestroyed)),
  ).toBe(true);
  await expect(editor(page)).toHaveCount(0);
});

test("只读时仍应用真实外部内容，恢复编辑后受控历史可撤销重做", async ({ page }) => {
  await mount(page, { editable: false });
  await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
  await page.evaluate(() => window.reactHistory.patch({ content: "<p>alpha 外部只读内容</p><p>未选正文</p>" }));
  await committed(page);
  await expect(editor(page)).toHaveText("alpha 外部只读内容未选正文");
  await page.evaluate(() => window.reactHistory.patch({ editable: true }));
  await committed(page);
  await expect(editor(page)).toHaveAttribute("aria-readonly", "false");
  const before = await snapshot(page);
  await bold(page);
  await expect(editor(page).locator("strong")).toHaveText("alpha");
  expect(await page.evaluate(() => window.reactHistory.state.controller!.editor.commands.undo())).toBe(true);
  await committed(page);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.reactHistory.state.controller!.editor.commands.redo())).toBe(true);
  await committed(page);
  await expect(editor(page).locator("strong")).toHaveText("alpha");
});

test("公开 React 入口可在没有 DOM 的进程导入并服务端渲染空宿主", async () => {
  const source = `
    import { createElement } from "react";
    import { renderToString } from "react-dom/server";
    const { SemloEditor } = await import(${JSON.stringify(pathToFileURL(resolve("packages/react/dist/index.js")).href)});
    if (typeof document !== "undefined" || typeof window !== "undefined") throw new Error("进程意外包含 DOM");
    const html = renderToString(createElement(SemloEditor, {
      id: "server-host", content: "<p>不在服务端装配编辑器</p>",
      onReady() { throw new Error("服务端不得创建编辑器"); }
    }));
    if (html !== '<div id="server-host"></div>') throw new Error(html);
    process.stdout.write("REACT_SSR_OK");
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", source], {
    cwd: resolve("tests"),
    timeout: 15_000,
  });
  expect(stdout).toBe("REACT_SSR_OK");
});
