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
    for (const sample of [
      { name: "default", content: "<p>FIRST</p><h3>MIDDLE</h3><p>LAST</p>", height: "1.5" },
      {
        name: "mixed initial heights",
        content: '<p style="line-height:1.5">FIRST</p><h3>MIDDLE</h3><p style="line-height:2">LAST</p>',
        height: "1.15",
      },
      {
        name: "mixed paragraph heights",
        content: '<p style="line-height:1.5">FIRST</p><p>MIDDLE</p><p style="line-height:2">LAST</p>',
        height: "1.15",
      },
    ]) {
      test(`${framework} ${echo} keeps ${sample.name} line-height, selection and history`, async ({ page }) => {
        await page.goto(origin);
        await page.waitForFunction(() => Boolean(window.mountSequencePasteFramework));
        await page.evaluate(
          ({ framework, echo, content }) => window.mountSequencePasteFramework(framework, echo, content),
          { framework, echo, content: sample.content },
        );
        await page.evaluate(() => window.sequencePasteFramework.settle());
        const baseline = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
        const prose = page.locator("#paste-framework .semlo-editor-prose");
        await prose.locator(":scope > p").first().click();
        await page.keyboard.press("ControlOrMeta+a");
        const selection = await page.evaluate(() =>
          window.sequencePasteFramework.controller.editor.state.selection.toJSON(),
        );
        await page.keyboard.press("ControlOrMeta+Alt+BracketLeft");
        await page.evaluate(() => window.sequencePasteFramework.settle());
        const changed = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
        expect(changed.json.content?.map((node) => node.attrs?.semloEditorLineHeight)).toEqual([
          sample.height,
          sample.height,
          sample.height,
        ]);
        expect(
          await page.evaluate(() => window.sequencePasteFramework.controller.editor.state.selection.toJSON()),
        ).toEqual(selection);
        await page.keyboard.press("ControlOrMeta+z");
        await page.evaluate(() => window.sequencePasteFramework.settle());
        expect(await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).toEqual(baseline);
        await page.keyboard.press("ControlOrMeta+Shift+z");
        await page.evaluate(() => window.sequencePasteFramework.settle());
        expect(await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).toEqual(changed);
        expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
      });
    }
    for (const reentrant of [false, true]) {
      test(`${framework} ${echo} preserves real pasted heights and grouped history with reentrant undo=${reentrant}`, async ({
        page,
      }) => {
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.goto(origin);
        await page.waitForFunction(() => Boolean(window.mountSequencePasteFramework));
        await page.evaluate(({ framework, echo }) => window.mountSequencePasteFramework(framework, echo, "<p></p>"), {
          framework,
          echo,
        });
        await page.evaluate(async () => {
          await window.sequencePasteFramework.settle();
          const html = '<p style="line-height:1.5">FIRST</p><p>MIDDLE</p><p style="line-height:2">LAST</p>';
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([html], { type: "text/html" }),
              "text/plain": new Blob(["FIRST\nMIDDLE\nLAST"], { type: "text/plain" }),
            }),
          ]);
        });
        const baseline = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
        const prose = page.locator("#paste-framework .semlo-editor-prose");
        await prose.locator(":scope > p").click();
        await page.keyboard.press("ControlOrMeta+v");
        await page.evaluate(() => window.sequencePasteFramework.settle());
        const pasted = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
        expect(pasted.json.content?.map((node) => node.attrs?.semloEditorLineHeight)).toEqual(["1.5", null, "2"]);
        expect(await page.evaluate(() => window.sequencePasteFramework.events.at(-1))).toEqual({
          type: "paste",
          trusted: true,
        });
        await page.keyboard.press("ControlOrMeta+a");
        if (reentrant) await page.evaluate(() => window.sequencePasteFramework.armUndo());
        await page.keyboard.press("ControlOrMeta+Alt+BracketLeft");
        await page.evaluate(() => window.sequencePasteFramework.settle());
        if (reentrant) {
          expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
        } else {
          const changed = await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
          expect(changed.json.content?.map((node) => node.attrs?.semloEditorLineHeight)).toEqual([
            "1.15",
            "1.15",
            "1.15",
          ]);
          expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.undo())).toBe(true);
          await page.evaluate(() => window.sequencePasteFramework.settle());
        }
        expect(await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).toEqual(baseline);
        expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.commands.redo())).toBe(true);
        await page.evaluate(() => window.sequencePasteFramework.settle());
        expect(
          (await page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot())).json.content?.map(
            (node) => node.attrs?.semloEditorLineHeight,
          ),
        ).toEqual(["1.15", "1.15", "1.15"]);
        expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
      });
    }
  }
}
