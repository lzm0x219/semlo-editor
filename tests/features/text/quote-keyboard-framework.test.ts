import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { expect, test, type Page } from "@rstest/playwright";

import type { PasteFramework } from "../../fixtures/list/sequences/numbering-sequence-paste-framework-fixture";

let origin: string;
let stop: (() => Promise<void>) | undefined;
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    const fixture = window.sequencePasteFramework;
    if (fixture && !fixture.controller.editor.isDestroyed) fixture.destroy();
  });
  expect(browserErrors.get(page)).toEqual([]);
});
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
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
test.afterAll(async () => stop?.());

for (const framework of ["react", "vue", "solid"] as const satisfies readonly PasteFramework[]) {
  for (const echo of ["json", "html"] as const) {
    test(`${framework} ${echo} groups quick quote heading deletion`, async ({ page }) => {
      await page.goto(origin);
      await page.waitForFunction(() => Boolean(window.mountSequencePasteFramework));
      await page.evaluate(({ framework, echo }) => window.mountSequencePasteFramework(framework, echo, "<p></p>"), {
        framework,
        echo,
      });
      await page.evaluate(() => window.sequencePasteFramework.settle());
      const baseline = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
      const prose = page.locator("#paste-framework .semlo-editor-prose");
      await prose.locator(":scope > p").click();
      await page.keyboard.type("> test");
      await page.keyboard.press("ControlOrMeta+Alt+Digit3");
      await expect(prose.locator(":scope > blockquote > h3")).toHaveText("test");
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Delete");
      await page.evaluate(() => window.sequencePasteFramework.settle());
      const deleted = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
      expect(deleted.html).toBe("<blockquote><h3></h3></blockquote>");
      expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.undo())).toBe(true);
      await page.evaluate(() => window.sequencePasteFramework.settle());
      expect(await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).toEqual(baseline);
      expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.redo())).toBe(true);
      await page.evaluate(() => window.sequencePasteFramework.settle());
      expect(await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).toEqual(deleted);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

    test(`${framework} ${echo} allows a host to undo the grouped deletion during onChange`, async ({ page }) => {
      await page.goto(origin);
      await page.waitForFunction(() => Boolean(window.mountSequencePasteFramework));
      await page.evaluate(({ framework, echo }) => window.mountSequencePasteFramework(framework, echo, "<p></p>"), {
        framework,
        echo,
      });
      await page.evaluate(() => window.sequencePasteFramework.settle());
      const baseline = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
      const prose = page.locator("#paste-framework .semlo-editor-prose");
      await prose.locator(":scope > p").click();
      await page.keyboard.type("> test");
      await page.keyboard.press("ControlOrMeta+Alt+Digit3");
      await expect(prose.locator(":scope > blockquote > h3")).toHaveText("test");
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.sequencePasteFramework.armUndo());
      await page.keyboard.press("Delete");
      await page.evaluate(() => window.sequencePasteFramework.settle());
      expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
      expect(await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).toEqual(baseline);
      expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.redo())).toBe(true);
      await page.evaluate(() => window.sequencePasteFramework.settle());
      expect((await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).html).toBe(
        "<blockquote><h3></h3></blockquote>",
      );
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

    for (const sample of [
      { name: "blank document", content: "<p></p>", index: 0 },
      { name: "between paragraphs", content: "<p>BEFORE</p><p></p><p>AFTER</p>", index: 1 },
    ]) {
      test(`${framework} ${echo} controlled quote shortcut preserves ${sample.name} and history`, async ({ page }) => {
        await page.goto(origin);
        await page.waitForFunction(() => Boolean(window.mountSequencePasteFramework));
        await page.evaluate(
          ({ framework, echo, content }) => window.mountSequencePasteFramework(framework, echo, content),
          {
            framework,
            echo,
            content: sample.content,
          },
        );
        await page.evaluate(() => window.sequencePasteFramework.settle());
        const baseline = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
        expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.can().undo())).toBe(false);
        const prose = page.locator("#paste-framework .semlo-editor-prose");
        await prose.locator(":scope > p").nth(sample.index).click();
        await page.keyboard.type(">");
        await page.keyboard.press("Space");
        await expect(prose.locator(":scope > blockquote")).toHaveCount(1);
        await page.keyboard.press("Backspace");
        await page.evaluate(() => window.sequencePasteFramework.settle());
        expect(await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).toEqual(baseline);
        expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.undo())).toBe(true);
        await page.evaluate(() => window.sequencePasteFramework.settle());
        expect(await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).toEqual(baseline);
        expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.redo())).toBe(true);
        await page.evaluate(() => window.sequencePasteFramework.settle());
        expect(await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).toEqual(baseline);
        expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
      });
    }
  }
}
