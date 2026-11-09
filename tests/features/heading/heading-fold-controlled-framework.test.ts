import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import type { PasteFramework } from "../../fixtures/list/sequences/numbering-sequence-paste-framework-fixture";

let origin: string;
let stop: () => Promise<void>;
test.beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/list/sequences/numbering-sequence-paste-framework-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: {
        alias: {
          "@semlo-editor/core$": resolve("packages/core/dist/index.js"),
          "@semlo-editor/core/style.css": resolve("packages/core/dist/style.css"),
          "@semlo-editor/react$": resolve("packages/react/dist/index.js"),
          "@semlo-editor/vue$": resolve("packages/vue/dist/index.js"),
          "@semlo-editor/solid$": resolve("packages/solid/dist/index.js"),
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const server = await build.startDevServer();
  origin = `http://127.0.0.1:${server.port}`;
  stop = () => server.server.close();
});
test.afterAll(() => stop());

for (const framework of ["react", "vue", "solid"] as PasteFramework[]) {
  test(`${framework} 默认标题折叠在受控回写、撤销和重载后保持`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.mountSequencePasteFramework));
    await page.evaluate(
      (name) =>
        window.mountSequencePasteFramework(name, name === "react" ? "json" : "html", "<h1>标题</h1><p>正文</p>"),
      framework,
    );
    await page.evaluate(() => window.sequencePasteFramework.settle());
    const host = page.locator("#paste-framework");
    await page.evaluate(() => {
      const editor = window.sequencePasteFramework.controller.editor;
      editor.commands.insertContentAt(1, "新");
    });
    await page.evaluate(() => window.sequencePasteFramework.settle());
    await host.getByRole("button", { name: "折叠标题：新标题" }).click();
    await page.evaluate(() => window.sequencePasteFramework.settle());
    await expect(host.locator(".semlo-editor-prose p")).toBeHidden();
    let snapshot = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
    expect(snapshot.json.content![0].attrs!.semloEditorHeadingFolded).toBe(true);
    expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.undo())).toBe(true);
    await page.evaluate(() => window.sequencePasteFramework.settle());
    await expect(host.getByRole("button", { name: "折叠标题：新标题" })).toBeVisible();
    await expect(host.locator(".semlo-editor-prose p")).toBeVisible();
    expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.undo())).toBe(true);
    await page.evaluate(() => window.sequencePasteFramework.settle());
    await expect(host.getByRole("button", { name: "折叠标题：标题" })).toBeVisible();
    expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.redo())).toBe(true);
    await page.evaluate(() => window.sequencePasteFramework.settle());
    expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.redo())).toBe(true);
    await page.evaluate(() => window.sequencePasteFramework.settle());
    snapshot = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
    await page.reload();
    await page.waitForFunction(() => Boolean(window.mountSequencePasteFramework));
    await page.evaluate(({ name, content }) => window.mountSequencePasteFramework(name, "html", content), {
      name: framework,
      content: snapshot.html,
    });
    await page.evaluate(() => window.sequencePasteFramework.settle());
    await expect(host.getByRole("button", { name: "展开标题：新标题" })).toBeVisible();
    await expect(host.locator(".semlo-editor-prose p")).toBeHidden();
    await page.evaluate(() => window.sequencePasteFramework.destroy());
  });
}
