import assert from "node:assert/strict";
import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { firefox, webkit, type Browser, type BrowserType } from "playwright";

const source = process.argv.includes("--source");
const build = await createRsbuild({
  cwd: process.cwd(),
  rsbuildConfig: {
    source: { entry: { index: "./tests/fixtures/browser/cross-browser-fixture.ts" } },
    resolve: source
      ? {
          alias: {
            "@semlo-editor/core$": "./packages/core/src/index.ts",
            "@semlo-editor/core/style.css$": "./packages/core/src/styles/bundle.css",
          },
        }
      : undefined,
    tools: {
      rspack(config) {
        config.resolve ??= {};
        config.resolve.modules = [resolve("demo/node_modules"), ...(config.resolve.modules ?? ["node_modules"])];
      },
    },
    server: { host: "127.0.0.1", port: 0, strictPort: true },
    dev: { hmr: false, liveReload: false },
  },
});
const { port, server } = await build.startDevServer();
const failures: string[] = [];

async function check(name: string, engine: BrowserType) {
  const errors: string[] = [];
  let browser: Browser | undefined;
  try {
    browser = await engine.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (error) => errors.push(`页面错误: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`控制台错误: ${message.text()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.semloCrossBrowser?.editors.length === 2);
    const first = page.locator("#cross-browser-0 .semlo-editor-prose");
    const second = page.locator("#cross-browser-1 .semlo-editor-prose");
    assert.equal(await first.count(), 1);
    assert.equal(await second.count(), 1);
    await first.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("X");
    await page.waitForFunction(() => window.semloCrossBrowser!.editors[0].getSnapshot().text.includes("X"));
    const before = await page.evaluate(() => {
      const selection = window.getSelection();
      const editor = window.semloCrossBrowser!.editors[0];
      const result = { text: editor.getSnapshot().text, anchor: selection?.anchorOffset };
      editor.setContent(structuredClone(editor.getSnapshot().json));
      return result;
    });
    assert.equal(await page.evaluate(() => window.semloCrossBrowser!.editors[0].getSnapshot().text), before.text);
    assert.equal(await page.evaluate(() => window.getSelection()?.anchorOffset), before.anchor);
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+z`);
    await page.waitForFunction(() => !window.semloCrossBrowser!.editors[0].getSnapshot().text.includes("X"));
    assert.equal(await page.evaluate(() => window.semloCrossBrowser!.editors[1].getSnapshot().text.trim()), "乙");
    await page.evaluate(() => window.semloCrossBrowser!.editors[0].destroy());
    await second.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("Y");
    await page.waitForFunction(() => window.semloCrossBrowser!.editors[1].getSnapshot().text.includes("Y"));
    const status = await page.evaluate(() => {
      const fixture = window.semloCrossBrowser!;
      return { errors: fixture.errors, changes: fixture.changes, destroyed: fixture.editors[0].editor.isDestroyed };
    });
    assert.equal(status.destroyed, true);
    assert.ok(status.changes[0] > 0 && status.changes[1] > 0);
    assert.deepEqual(status.errors, []);
    await page.evaluate(() => window.semloCrossBrowser!.editors[1].destroy());
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    assert.deepEqual(errors, []);
    console.log(`${name}: 通过；页面/控制台错误 0`);
  } catch (error) {
    failures.push(
      `${name}: ${error instanceof Error ? error.message : String(error)}；页面/控制台错误: ${JSON.stringify(errors)}`,
    );
  } finally {
    await browser?.close();
  }
}

try {
  console.log(`跨浏览器烟雾检查：${source ? "隔离源码入口" : "公开包入口"}`);
  await check("Firefox", firefox);
  await check("WebKit", webkit);
  if (failures.length) throw new Error(failures.join("\n"));
} finally {
  await server.close();
}
