import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import type { EditorContent } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-multistep-controlled-fixture";
import type { RestartFramework } from "../../fixtures/list/ordered-restart-controlled-fixture";

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/heading/heading-multistep-controlled-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": "./packages/core/src/index.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

const cases = [
  { name: "root H3", html: "<p></p>", quote: false, numbered: false, level: 3, steps: 3 },
  { name: "quote H6", html: "<blockquote><p></p></blockquote>", quote: true, numbered: false, level: 6, steps: 3 },
  {
    name: "numbered H3",
    html: '<h3 data-semlo-editor-heading-numbering="mixed"></h3>',
    quote: false,
    numbered: true,
    level: 3,
    steps: 2,
  },
] as const;

async function mount(page: Page, framework: RestartFramework, html: string) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
  await page.evaluate(
    (name) => window.__semloRequireFixture("mountRestartControlledFixture")(name, "legacy"),
    framework,
  );
  await page.evaluate((value) => window.__semloRequireFixture("restartControlledFixture").setContent(value), html);
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  await page.evaluate(() => window.__semloRequireFixture("controlledHistoryProbe").closeInitialHistory());
}

async function settle(page: Page) {
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
}

async function read(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("restartControlledFixture");
    const editor = fixture.controller.editor;
    const selection = editor.state.selection;
    return {
      snapshot: fixture.controller.getSnapshot(),
      selection: {
        empty: selection.empty,
        anchor: selection.anchor,
        head: selection.head,
        text: editor.state.doc.textBetween(selection.from, selection.to, "|"),
      },
      focused: editor.view.hasFocus(),
      changes: fixture.changes,
      documentChanges: fixture.documentChanges,
      errors: fixture.errors,
      depth: window.__semloRequireFixture("controlledHistoryProbe").depths(),
    };
  });
}

async function pressHistory(page: Page, command: "undo" | "redo") {
  await page.keyboard.press(command === "undo" ? "ControlOrMeta+z" : "ControlOrMeta+Shift+z");
  await settle(page);
}

async function assertRoundTrips(page: Page, json: EditorContent, html: string, changes: number) {
  for (const saved of [json, html]) {
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").setContent("<p>temporary</p>"));
    await settle(page);
    await page.evaluate((value) => window.__semloRequireFixture("restartControlledFixture").setContent(value), saved);
    await settle(page);
    const restored = await read(page);
    expect(restored.snapshot.json).toEqual(json);
    expect(restored.changes).toHaveLength(changes);
  }
}

for (const framework of ["react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  for (const item of cases) {
    test(`${framework}: ${item.name} multi-step redo survives controlled host echo`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await mount(page, framework, item.html);
      const host = page.locator("#restart-controlled-fixture .semlo-editor-prose");
      await host.locator(item.numbered ? "h3" : "p").click();
      await page.keyboard.type("test");
      if (!item.numbered) await page.keyboard.press(`ControlOrMeta+Alt+${item.level}`);
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Backspace");
      await settle(page);
      const deleted = await read(page);
      const root = deleted.snapshot.json.content?.[0];
      const heading = item.quote ? root?.content?.[0] : root;
      expect(heading).toMatchObject({
        type: "heading",
        attrs: { level: item.level, semloEditorHeadingNumbering: item.numbered ? "mixed" : null },
      });
      expect(heading?.content ?? []).toEqual([]);
      expect(deleted.focused).toBe(true);
      expect(deleted.changes.at(-1)?.json).toEqual(deleted.snapshot.json);
      for (let i = 0; i < item.steps; i += 1) await pressHistory(page, "undo");
      const undone = await read(page);
      expect(undone.focused).toBe(true);
      expect(undone.changes.length).toBe(deleted.changes.length + item.steps);
      for (let i = 0; i < item.steps; i += 1) await pressHistory(page, "redo");
      const redone = await read(page);
      expect(redone.snapshot.json).toEqual(deleted.snapshot.json);
      expect(redone.snapshot.html).toEqual(deleted.snapshot.html);
      expect(redone.selection.empty).toBe(true);
      expect(redone.focused).toBe(true);
      expect(redone.changes.length).toBe(undone.changes.length + item.steps);
      expect(redone.changes.at(-1)?.json).toEqual(redone.snapshot.json);
      expect(redone.documentChanges - deleted.documentChanges).toBe(item.steps * 2);
      await assertRoundTrips(page, redone.snapshot.json, redone.snapshot.html, redone.changes.length);
      expect((await read(page)).errors).toEqual([]);
      expect(pageErrors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
    });
  }

  for (const mode of ["deletion", "history"] as const) {
    test(`${framework}: rejecting one ${mode} transaction preserves controlled state and redo`, async ({ page }) => {
      await mount(page, framework, "<p></p>");
      const host = page.locator("#restart-controlled-fixture .semlo-editor-prose");
      await host.locator("p").click();
      await page.keyboard.type("test");
      await page.keyboard.press("ControlOrMeta+Alt+3");
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      if (mode === "deletion") {
        await page.waitForFunction(() => {
          const editor = window.__semloRequireFixture("restartControlledFixture").controller.editor;
          return editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to) === "test";
        });
        await page.evaluate(() => window.__semloRequireFixture("controlledHistoryProbe").rejectNext("deletion"));
        const before = await read(page);
        await page.keyboard.press("Backspace");
        await settle(page);
        const rejected = await read(page);
        expect(rejected.snapshot.json).toEqual(before.snapshot.json);
        expect(rejected.selection).toEqual(before.selection);
        expect(rejected.changes).toHaveLength(before.changes.length);
        expect(rejected.documentChanges).toBe(before.documentChanges);
        expect(rejected.depth).toEqual(before.depth);
      }
      await page.keyboard.press("Backspace");
      await settle(page);
      const deleted = await read(page);
      for (let i = 0; i < 3; i += 1) await pressHistory(page, "undo");
      for (let i = 0; i < 2; i += 1) await pressHistory(page, "redo");
      if (mode === "history") {
        await page.evaluate(() => window.__semloRequireFixture("controlledHistoryProbe").rejectNext("history"));
        const before = await read(page);
        await pressHistory(page, "redo");
        const rejected = await read(page);
        expect(rejected.snapshot.json).toEqual(before.snapshot.json);
        expect(rejected.selection).toEqual(before.selection);
        expect(rejected.changes).toHaveLength(before.changes.length);
        expect(rejected.documentChanges).toBe(before.documentChanges);
        expect(rejected.depth).toEqual(before.depth);
      }
      await pressHistory(page, "redo");
      const final = await read(page);
      expect(final.snapshot.json).toEqual(deleted.snapshot.json);
      expect(final.focused).toBe(true);
      expect(await page.evaluate(() => window.__semloRequireFixture("controlledHistoryProbe").rejections())).toBe(1);
      expect(final.errors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
    });
  }

  test(`${framework}: nonhistorical host write uses the current undo/redo fallback`, async ({ page }) => {
    await mount(page, framework, "<h3>test</h3>");
    const host = page.locator("#restart-controlled-fixture .semlo-editor-prose");
    await host.locator("h3").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    await settle(page);
    const deleted = await read(page);
    await page.evaluate(() => window.__semloRequireFixture("controlledHistoryProbe").changeHeadingOutsideHistory());
    await settle(page);
    const hostWritten = await read(page);
    expect(hostWritten.snapshot.json.content?.[0]?.attrs?.textAlign).toBe("center");
    expect(hostWritten.changes).toHaveLength(deleted.changes.length + 1);
    await pressHistory(page, "undo");
    const undone = await read(page);
    expect(undone.selection.text).toBe("test");
    expect(undone.changes).toHaveLength(hostWritten.changes.length + 1);
    await pressHistory(page, "redo");
    const redone = await read(page);
    // This records the existing conservative fallback, not a desired result.
    expect(redone.snapshot.json.content?.[0]?.type).toBe("paragraph");
    expect(redone.changes).toHaveLength(undone.changes.length + 1);
    expect(redone.focused).toBe(true);
    expect(redone.errors).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
  });
}
