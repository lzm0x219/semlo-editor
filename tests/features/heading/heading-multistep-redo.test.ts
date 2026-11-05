import { mkdir, writeFile } from "node:fs/promises";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-quick-history-fixture";

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-quick-history-fixture.ts" } },
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

type Options = {
  append?: "metadata" | "history" | "nohistory" | "paragraph" | "number";
  dispatch?: "metadata" | "nohistory";
  replaceHistoryInAppend?: boolean;
  rootNoHistoryAppend?: boolean;
  normalizeNoHistory?: boolean;
  appendOnRedo?: boolean;
  appendSelectionThenDocument?: boolean;
  priority?: number;
};
async function mount(page: Page, html: string, options: Options = {}) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountQuickHistoryFixture === "function");
  await page.evaluate(
    ({ content, options }) => window.__semloRequireFixture("mountQuickHistoryFixture")(content, options),
    { content: html, options },
  );
  return page.locator(".semlo-editor-prose");
}
async function state(page: Page) {
  return page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("quickHistoryFixture");
    const selection = editor.editor.state.selection;
    return {
      json: editor.getSnapshot().json,
      html: editor.getSnapshot().html,
      selection: {
        anchor: selection.anchor,
        head: selection.head,
        text: editor.editor.state.doc.textBetween(selection.from, selection.to, "|"),
      },
      focused: editor.editor.view.hasFocus(),
    };
  });
}
async function typeAndClear(page: Page, prose: ReturnType<Page["locator"]>, level: number, convert: boolean) {
  await prose.locator("p, h1, h2, h3, h4, h5, h6").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("test");
  if (convert) await page.keyboard.press(`ControlOrMeta+Alt+${level}`);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
}
async function undo(page: Page, count: number) {
  for (let i = 0; i < count; i += 1) await page.keyboard.press("ControlOrMeta+z");
}
async function redo(page: Page, count: number) {
  for (let i = 0; i < count; i += 1) await page.keyboard.press("ControlOrMeta+Shift+z");
}

for (const container of ["root", "quote"] as const) {
  for (const level of [1, 3, 6]) {
    test(`multi-step undo/redo preserves ${container} H${level}`, async ({ page }) => {
      const prose = await mount(page, container === "root" ? "<p></p>" : "<blockquote><p></p></blockquote>");
      await typeAndClear(page, prose, level, true);
      const deleted = await state(page);
      const root = deleted.json.content?.[0];
      const heading = container === "root" ? root : root?.content?.[0];
      expect(heading).toMatchObject({ type: "heading", attrs: { level } });
      expect(heading?.content ?? []).toEqual([]);
      await undo(page, 1);
      const restored = await state(page);
      expect(restored.selection.text).toBe("test");
      await undo(page, 2);
      const initial = await state(page);
      expect(initial.json.content?.[0]?.type).toBe(container === "root" ? "paragraph" : "blockquote");
      await redo(page, 3);
      const redone = await state(page);
      expect(redone.json).toEqual(deleted.json);
      expect(redone.focused).toBe(true);
      expect(redone.selection.text).toBe("");
      await undo(page, 1);
      expect((await state(page)).json).toEqual(restored.json);
      await redo(page, 1);
      expect((await state(page)).json).toEqual(deleted.json);
    });
  }
}

for (const numbering of ["mixed", "decimal", "chinese"] as const) {
  test(`multi-step redo keeps the ${numbering} heading marker`, async ({ page }) => {
    const prose = await mount(page, `<h3 data-semlo-editor-heading-numbering="${numbering}"></h3>`);
    await typeAndClear(page, prose, 3, false);
    const deleted = await state(page);
    expect(deleted.json.content?.[0]).toMatchObject({
      type: "heading",
      attrs: { level: 3, semloEditorHeadingNumbering: numbering },
    });
    await undo(page, 2);
    await redo(page, 2);
    const redone = await state(page);
    expect(redone.json).toEqual(deleted.json);
    expect(redone.focused).toBe(true);
    await expect(prose.locator("h3 .semlo-editor-heading-number")).toBeVisible();
  });
}

for (const priority of [2000, 1]) {
  for (const append of ["metadata", "history", "nohistory"] as const) {
    test(`${priority === 1 ? "late" : "early"} host ${append} append survives multi-step redo`, async ({ page }) => {
      const prose = await mount(page, "<p></p>", { append, priority });
      await typeAndClear(page, prose, 3, true);
      const deleted = await state(page);
      if (append !== "metadata") expect(deleted.json.content?.[0]?.attrs?.textAlign).toBe("center");
      await undo(page, 3);
      await redo(page, 3);
      const redone = await state(page);
      if (append === "nohistory") {
        // Provenance is discarded after an unhistorical document mutation.
        // This is the existing fallback, not a claim that its result is ideal.
        expect(redone.json.content?.[0]?.type).toBe("paragraph");
      } else expect(redone.json).toEqual(deleted.json);
      expect((await state(page)).focused).toBe(true);
    });
  }
}

for (const priority of [2000, 1]) {
  test(`${priority === 1 ? "late" : "early"} host rejects a redo without losing it`, async ({ page }) => {
    const prose = await mount(page, "<p></p>", { priority });
    await typeAndClear(page, prose, 3, true);
    const deleted = await state(page);
    await undo(page, 3);
    await redo(page, 2);
    const before = await state(page);
    await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").rejectNextHistory());
    await redo(page, 1);
    expect(await state(page)).toEqual(before);
    await redo(page, 1);
    expect((await state(page)).json).toEqual(deleted.json);
  });
}

test("Meta+A full-document deletion still redoes to a root paragraph", async ({ page }) => {
  const prose = await mount(page, "<h3>test</h3>");
  await prose.locator("h3").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  const deleted = await state(page);
  expect(deleted.json.content?.[0]?.type).toBe("paragraph");
  await undo(page, 1);
  expect((await state(page)).json.content?.[0]?.type).toBe("heading");
  await redo(page, 1);
  expect((await state(page)).json).toEqual(deleted.json);
});

test("undoing typed text from a selected root heading retains the local baseline", async ({ page }) => {
  const prose = await mount(page, "<h3></h3>");
  await prose.locator("h3").click();
  await page.keyboard.type("test");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await undo(page, 1);
  const result = await state(page);
  // This is the existing local behavior, not a claim about Yuque.
  expect(result.json.content?.[0]).toMatchObject({ type: "paragraph" });
  expect(result.json.content?.[0]?.content ?? []).toEqual([]);
});

test("undoing typing after an owned deletion retains the existing empty heading behavior", async ({ page }) => {
  const prose = await mount(page, "<h3></h3>");
  await prose.locator("h3").click();
  await page.keyboard.type("test");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await undo(page, 2);
  const result = await state(page);
  // Existing local behavior, not a directly observed Yuque result.
  expect(result.json.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 3 } });
  expect(result.json.content?.[0]?.content ?? []).toEqual([]);
});

for (const texts of [
  ["same", "same"],
  ["first", "second"],
] as const) {
  test(`two historical full-heading deletions can both be redone: ${texts.join("/")}`, async ({ page }) => {
    const prose = await mount(page, `<h3>${texts[0]}</h3>`);
    await prose.locator("h3").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(texts[1]);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    const deleted = await state(page);
    await undo(page, 3);
    await redo(page, 1);
    expect((await state(page)).json).toEqual(deleted.json);
    await redo(page, 2);
    expect((await state(page)).json).toEqual(deleted.json);
  });
}

test("two deletions survive the baseline paragraph normalization when undoing initial typing", async ({ page }) => {
  const prose = await mount(page, "<h3></h3>");
  await prose.locator("h3").click();
  for (const text of ["first", "second"]) {
    await page.keyboard.type(text);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
  }
  await undo(page, 4);
  const initial = await state(page);
  // This local undo behavior has not been compared directly with Yuque.
  expect(initial.json.content?.[0]?.type).toBe("paragraph");
  expect(initial.selection).toMatchObject({ anchor: 1, head: 1, text: "" });
  await redo(page, 1);
  const first = await state(page);
  expect(first.json.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 3 } });
  expect(first.selection.text).toBe("first");
  await redo(page, 1);
  expect((await state(page)).json.content?.[0]?.type).toBe("heading");
  await redo(page, 1);
  expect((await state(page)).selection.text).toBe("second");
  await redo(page, 1);
  const redone = await state(page);
  expect(redone.json.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 3 } });
  expect(redone.json.content?.[0]?.content ?? []).toEqual([]);
});

test("a host can append a conversion to paragraph after deleting a heading", async ({ page }) => {
  const prose = await mount(page, "<p></p>", { append: "paragraph" });
  await typeAndClear(page, prose, 3, true);
  const deleted = await state(page);
  expect(deleted.json.content?.[0]?.type).toBe("paragraph");
  await undo(page, 3);
  await redo(page, 3);
  expect((await state(page)).json).toEqual(deleted.json);
});

test("a host can append a heading-level and numbering change after deletion", async ({ page }) => {
  const prose = await mount(page, "<p></p>", { append: "number" });
  await typeAndClear(page, prose, 3, true);
  const deleted = await state(page);
  expect(deleted.json.content?.[0]).toMatchObject({
    type: "heading",
    attrs: { level: 4, semloEditorHeadingNumbering: "mixed" },
  });
  await undo(page, 3);
  await redo(page, 3);
  expect((await state(page)).json).toEqual(deleted.json);
});

for (const dispatch of ["metadata", "nohistory"] as const) {
  test(`separate host ${dispatch} dispatch survives multi-step redo`, async ({ page }) => {
    const prose = await mount(page, "<p></p>", { dispatch });
    await typeAndClear(page, prose, 3, true);
    const deleted = await state(page);
    if (dispatch === "nohistory") expect(deleted.json.content?.[0]?.attrs?.textAlign).toBe("center");
    await undo(page, 3);
    await redo(page, 3);
    const redone = await state(page);
    if (dispatch === "nohistory") expect(redone.json.content?.[0]?.type).toBe("paragraph");
    else expect(redone.json).toEqual(deleted.json);
  });
}

for (const priority of [2000, 1]) {
  test(`${priority === 1 ? "late" : "early"} host filter sees the expected redo metadata`, async ({ page }) => {
    const prose = await mount(page, "<p></p>", { priority });
    await typeAndClear(page, prose, 3, true);
    await undo(page, 3);
    await redo(page, 3);
    const calls = await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").records);
    const last = calls.filter((entry) => entry.phase === "filter" && entry.isHistory).at(-1);
    expect(last?.prevented).toBe(priority === 1);
  });
}

test("redo remains correct after the history depth has been truncated", async ({ page }) => {
  const prose = await mount(page, "<p></p>");
  await prose.locator("p").click();
  await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").fillHistory(130));
  expect(
    await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").historyDepth()),
  ).toBeGreaterThanOrEqual(100);
  await typeAndClear(page, prose, 3, true);
  const deleted = await state(page);
  await undo(page, 3);
  await redo(page, 3);
  expect((await state(page)).json).toEqual(deleted.json);
});

test("reversed heading selection survives the multi-step undo/redo cycle", async ({ page }) => {
  const prose = await mount(page, "<p></p>");
  await prose.locator("p").click();
  await page.keyboard.type("test");
  await page.keyboard.press("ControlOrMeta+Alt+3");
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Backspace");
  const deleted = await state(page);
  await undo(page, 1);
  const restored = await state(page);
  expect(restored.selection.text).toBe("test");
  expect(restored.selection.anchor).toBeGreaterThan(restored.selection.head);
  const calls = await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").records);
  expect(calls.find((entry) => entry.phase === "keydown" && entry.key === "Backspace")?.dom.text).toBe("test");
  await undo(page, 2);
  await redo(page, 3);
  expect((await state(page)).json).toEqual(deleted.json);
});

test("a new host deletion reusing a discarded redo slot is not mistaken for an owned deletion", async ({ page }) => {
  const prose = await mount(page, "<h3>test</h3>");
  await prose.locator("h3").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await undo(page, 1);
  expect((await state(page)).selection.text).toBe("test");
  await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").hostDelete());
  expect((await state(page)).json.content?.[0]?.type).toBe("heading");
  await undo(page, 1);
  expect((await state(page)).selection.text).toBe("test");
  await redo(page, 1);
  expect((await state(page)).json.content?.[0]?.type).toBe("paragraph");
});

test("an older host deletion keeps its existing visible result after an identical owned deletion", async ({ page }) => {
  const prose = await mount(page, "<h3>test</h3>", { priority: 1 });
  await prose.locator("h3").click();
  await page.keyboard.press("End");
  await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").hostDeleteRange());
  const hostOriginal = await state(page);
  await page.keyboard.type("test");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await undo(page, 3);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.waitForFunction(() => {
    const editor = window.__semloRequireFixture("quickHistoryFixture").editor.editor;
    const selection = editor.state.selection;
    return editor.state.doc.textBetween(selection.from, selection.to) === "test";
  });
  const beforeRedo = await state(page);
  await redo(page, 1);
  const result = await state(page);
  const calls = await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").records);
  if (process.env.SEMLO_HISTORY_TRACE_DIR) {
    await mkdir(process.env.SEMLO_HISTORY_TRACE_DIR, { recursive: true });
    await writeFile(
      `${process.env.SEMLO_HISTORY_TRACE_DIR}/older-host-delete.json`,
      JSON.stringify({ hostOriginal, beforeRedo, result, calls }, null, 2),
    );
  }
  expect(hostOriginal.json.content?.[0]?.type).toBe("heading");
  expect(beforeRedo.selection.text).toBe("test");
  // The old recent marker also applies here; its ownership is still unresolved.
  expect(result.json).toEqual(hostOriginal.json);
});

test("a host append that replaces the owned event cannot inherit its redo marker", async ({ page }) => {
  const prose = await mount(page, "<h3>test</h3>", { replaceHistoryInAppend: true });
  await prose.locator("h3").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  expect((await state(page)).json.content?.[0]?.type).toBe("heading");
  await undo(page, 1);
  expect((await state(page)).selection.text).toBe("test");
  await redo(page, 1);
  expect((await state(page)).json.content?.[0]?.type).toBe("paragraph");
});

test("a host document append during a redo preserves later pending deletion events", async ({ page }) => {
  const prose = await mount(page, "<h3>first</h3>", { appendOnRedo: true });
  await prose.locator("h3").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("second");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await undo(page, 3);
  await redo(page, 1);
  const first = await state(page);
  expect(first.json.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 3, textAlign: "center" } });
  await redo(page, 2);
  expect((await state(page)).json.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 3 } });
});

test("a selection-only append followed by a document append retains the owned redo event", async ({ page }) => {
  const prose = await mount(page, "<h3>test</h3>", { appendSelectionThenDocument: true });
  await prose.locator("h3").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  const deleted = await state(page);
  await undo(page, 1);
  expect((await state(page)).json.content?.[0]?.attrs?.textAlign).toBe("center");
  await redo(page, 1);
  expect((await state(page)).json).toEqual(deleted.json);
});

test("a nonhistorical root with an appended document change invalidates owned history provenance", async ({ page }) => {
  const prose = await mount(page, "<h3>test</h3>", { rootNoHistoryAppend: true });
  await prose.locator("h3").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").hostNoHistoryRoot());
  expect((await state(page)).json.content?.[0]?.attrs?.textAlign).toBe("center");
  await undo(page, 1);
  await redo(page, 1);
  expect((await state(page)).json.content?.[0]?.type).toBe("paragraph");
});

test("a host deletion plus nonhistorical normalization cannot acquire a heading deletion marker", async ({ page }) => {
  const prose = await mount(page, "<h3>test</h3>", { normalizeNoHistory: true });
  await prose.locator("h3").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").hostDelete(false));
  expect((await state(page)).json.content?.[0]?.type).toBe("paragraph");
  await undo(page, 1);
  await page.evaluate(() => window.__semloRequireFixture("quickHistoryFixture").hostRestoreHeading());
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await redo(page, 1);
  expect((await state(page)).json.content?.[0]?.type).toBe("paragraph");
});
