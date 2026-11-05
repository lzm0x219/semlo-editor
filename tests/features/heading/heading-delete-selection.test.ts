import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

type HostEvent = { phase: string; before: string; after: string; prevented: boolean };
type KeyEvent = { key: string; prevented: boolean };

declare global {
  interface Window {
    headingDeleteEditor?: EditorController;
    headingDeleteHostEvents?: HostEvent[];
    headingDeleteKeys?: KeyEvent[];
  }
}

type HostMode =
  | "none"
  | "early"
  | "late"
  | "early-reject"
  | "late-reject"
  | "early-reject-first"
  | "late-reject-first"
  | "early-append"
  | "late-append";

async function mount(page: Page, content = "<ol><li><p>原文</p></li></ol>", hostMode: HostMode = "none") {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'heading-delete-test'
      document.body.append(host)
      window.headingDeleteHostEvents = []
      window.headingDeleteKeys = []
      const mode = ${JSON.stringify(hostMode)}
      let clearAttempts = 0
      const observer = Extension.create({
        name: 'headingDeleteHostObserver', priority: mode.startsWith('early') ? 2000 : 1,
        addProseMirrorPlugins() {
          return [new Plugin({
            filterTransaction(tr, state) {
              if (!tr.docChanged) return true
              const before = state.doc.firstChild?.textContent ?? ''
              const after = tr.doc.firstChild?.textContent ?? ''
              const prevented = !!tr.getMeta('preventClearDocument')
              window.headingDeleteHostEvents.push({ phase: 'filter', before, after, prevented })
              if (before.startsWith('/原文') && after === '') clearAttempts++
              return !mode.includes('reject') || clearAttempts < (mode.endsWith('first') ? 1 : 2) || !before.startsWith('/原文') || after !== ''
            },
            appendTransaction(transactions, oldState, newState) {
              if (transactions.some(tr => tr.docChanged)) window.headingDeleteHostEvents.push({
                phase: 'append', before: oldState.doc.firstChild?.textContent ?? '',
                after: newState.doc.firstChild?.textContent ?? '',
                prevented: transactions.some(tr => !!tr.getMeta('preventClearDocument')),
              })
              if (mode.endsWith('append') && transactions.some(tr => tr.docChanged) && !transactions.some(tr => tr.getMeta('headingDeleteHostAppend')))
                return newState.tr.setMeta('headingDeleteHostAppend', true).setMeta('addToHistory', false)
              return null
            },
          })]
        },
      })
      window.headingDeleteEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        extensions: mode === 'none' ? [] : [observer],
      })
      window.headingDeleteEditor.editor.view.dom.addEventListener('keydown', event => {
        window.headingDeleteKeys.push({ key: event.key, prevented: event.defaultPrevented })
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.headingDeleteEditor));
  return page.locator("#heading-delete-test .semlo-editor-prose");
}

async function state(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingDeleteEditor").editor;
    const selection = editor.state.selection;
    const dom = window.getSelection();
    return {
      json: editor.getJSON() as JSONContent,
      selection: {
        type: selection.toJSON().type,
        empty: selection.empty,
        anchor: selection.anchor,
        head: selection.head,
        text: editor.state.doc.textBetween(selection.from, selection.to, "|"),
      },
      dom: { text: dom?.toString() ?? "", collapsed: dom?.isCollapsed ?? true },
      focused: editor.view.hasFocus(),
    };
  });
}

async function prepareUserSelection(page: Page, hostMode: HostMode = "none") {
  const prose = await mount(page, undefined, hostMode);
  await prose.locator("li > p").click();
  await page.keyboard.press("ControlOrMeta+Alt+2");
  await expect(prose.locator(":scope > h2")).toContainText("原文");
  await page.keyboard.press("Home");
  await page.keyboard.type("/");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  const before = await state(page);
  expect(before.dom.collapsed).toBe(false);
  expect(before.dom.text).toContain("/原文");
  await page.evaluate(() => {
    window.headingDeleteHostEvents = [];
    window.headingDeleteKeys = [];
  });
  return { prose, before };
}

test("selecting all typed heading text with Home and Shift+End retains an empty numbered H2", async ({ page }) => {
  const { prose, before } = await prepareUserSelection(page);
  await page.keyboard.press("Backspace");
  const after = await state(page);
  expect(after.json.content?.[0]).toMatchObject({
    type: "heading",
    attrs: { level: 2, semloEditorHeadingNumbering: "mixed" },
  });
  expect(after.json.content?.[0]?.content ?? []).toEqual([]);
  expect(after.focused).toBe(true);
  await expect(prose.locator(":scope > h2 .semlo-editor-heading-number")).toHaveText("1. ");
  expect(
    (await page.evaluate(() => window.headingDeleteKeys!)).find((event) => event.key === "Backspace")?.prevented,
  ).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  const undo = await state(page);
  expect(undo.json).toEqual(before.json);
  expect(undo.selection.text).toBe("/原文");
  expect(undo.focused).toBe(true);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  const redo = await state(page);
  expect(redo.json).toEqual(after.json);
  expect(redo.focused).toBe(true);
});

for (const mode of ["early", "late"] as const) {
  test(`${mode} host filter and append handlers run once per deletion, undo and redo`, async ({ page }) => {
    const { before } = await prepareUserSelection(page, mode);
    await page.keyboard.press("Backspace");
    const deleted = await state(page);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).json).toEqual(before.json);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await state(page)).json).toEqual(deleted.json);
    const events = await page.evaluate(() => window.headingDeleteHostEvents!);
    expect(events.filter((entry) => entry.phase === "filter")).toEqual([
      { phase: "filter", before: "/原文", after: "", prevented: true },
      { phase: "filter", before: "", after: "/原文", prevented: false },
      { phase: "filter", before: "/原文", after: "", prevented: mode === "late" },
    ]);
    expect(events.filter((entry) => entry.phase === "append")).toEqual([
      { phase: "append", before: "/原文", after: "", prevented: true },
      { phase: "append", before: "", after: "/原文", prevented: false },
      { phase: "append", before: "/原文", after: "", prevented: true },
    ]);
  });
}

for (const mode of ["early-append", "late-append"] as const) {
  test(`${mode} host may append a metadata transaction without breaking deletion history`, async ({ page }) => {
    const { before } = await prepareUserSelection(page, mode);
    await page.keyboard.press("Backspace");
    const deleted = await state(page);
    expect(deleted.json.content?.[0].type).toBe("heading");
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).json).toEqual(before.json);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await state(page)).json).toEqual(deleted.json);
    const events = await page.evaluate(() => window.headingDeleteHostEvents!);
    expect(events.filter((entry) => entry.phase === "filter")).toHaveLength(3);
    expect(events.filter((entry) => entry.phase === "append")).toHaveLength(3);
  });
}

for (const mode of ["early-reject", "late-reject"] as const) {
  test(`${mode} host rejection leaves the original heading and redo available`, async ({ page }) => {
    const { before } = await prepareUserSelection(page, mode);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await state(page);
    expect(undone.json).toEqual(before.json);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    const after = await state(page);
    expect(after.json).toEqual(undone.json);
    expect(after.selection).toEqual(undone.selection);
    expect(after.focused).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("headingDeleteEditor").editor.can().redo())).toBe(
      true,
    );
    const events = await page.evaluate(() => window.headingDeleteHostEvents!);
    expect(events.filter((entry) => entry.phase === "filter")).toHaveLength(3);
    expect(events.filter((entry) => entry.phase === "append")).toHaveLength(2);
  });
}

for (const [name, html] of [["paragraph", "<p>原文</p>"]] as const) {
  test(`ordinary full selection deletion retains existing ${name} behavior`, async ({ page }) => {
    const prose = await mount(page, html);
    await prose.locator(":scope > *").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    expect((await state(page)).json.content?.[0].type).toBe("paragraph");
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).json.content?.[0].type).toBe(name === "paragraph" ? "paragraph" : "heading");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await state(page)).json.content?.[0].type).toBe("paragraph");
  });
}

test("a non-text node selection is left to the normal delete behavior", async ({ page }) => {
  await mount(page, '<h2 data-semlo-editor-heading-numbering="mixed">原文</h2>');
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingDeleteEditor").editor;
    editor.view.focus();
    editor.commands.setNodeSelection(0);
  });
  expect((await state(page)).selection.type).toBe("node");
  await page.keyboard.press("Backspace");
  expect((await state(page)).json.content?.[0].type).toBe("paragraph");
});

test("a composing Backspace does not delete a full heading selection", async ({ page }) => {
  await mount(page, '<h2 data-semlo-editor-heading-numbering="mixed">原文</h2>');
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingDeleteEditor").editor;
    editor.view.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
    const before = editor.getJSON();
    const event = new KeyboardEvent("keydown", {
      key: "Backspace",
      keyCode: 8,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);
    return { before, after: editor.getJSON(), prevented: event.defaultPrevented };
  });
  expect(result.after).toEqual(result.before);
  expect(result.prevented).toBe(false);
});

test("after undoing the deletion, undoing identical prior typing still retains the empty numbered heading", async ({
  page,
}) => {
  const prose = await mount(page, '<h2 data-semlo-editor-heading-numbering="mixed"></h2>');
  await prose.locator(":scope > h2").click();
  await page.keyboard.type("/原文");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await state(page)).selection.text).toBe("/原文");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await state(page)).json.content?.[0]).toMatchObject({
    type: "heading",
    attrs: { level: 2, semloEditorHeadingNumbering: "mixed" },
  });
});

for (const mode of ["early-reject-first", "late-reject-first"] as const) {
  test(`${mode} host rejection leaves the initial text and selection untouched`, async ({ page }) => {
    const { before } = await prepareUserSelection(page, mode);
    await page.keyboard.press("Backspace");
    const after = await state(page);
    expect(after.json).toEqual(before.json);
    expect(after.selection.text).toBe("/原文");
    expect(after.focused).toBe(true);
    const events = await page.evaluate(() => window.headingDeleteHostEvents!);
    expect(events.filter((entry) => entry.phase === "filter")).toHaveLength(1);
    expect(events.filter((entry) => entry.phase === "append")).toHaveLength(0);
  });
}

test("whole-table cell selection preserves the existing deletion and undo behavior", async ({ page }) => {
  await mount(page, "<table><tbody><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></tbody></table>");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingDeleteEditor").editor;
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
    });
    if (cells.length !== 4) throw new Error("Missing table cells");
    editor.view.focus();
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[3] });
  });
  const before = await state(page);
  expect(before.selection.type).toBe("cell");
  await page.keyboard.press("Backspace");
  const after = await state(page);
  expect(after.json.content?.[0].type).toBe("table");
  await expect(page.locator("#heading-delete-test .semlo-editor-prose td")).toHaveText(["", "", "", ""]);
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await state(page);
  expect(undone.json).toEqual(before.json);
  expect(undone.selection.type).toBe("cell");
});

test("after clearing selected text, Backspace removes numbering before changing the empty heading to a paragraph", async ({
  page,
}) => {
  const { prose } = await prepareUserSelection(page);
  await page.keyboard.press("Backspace");
  await expect(prose.locator(":scope > h2 .semlo-editor-heading-number")).toHaveText("1. ");
  await page.keyboard.press("Backspace");
  await expect(prose.locator(":scope > h2")).toHaveCount(1);
  await expect(prose.locator(":scope > h2 .semlo-editor-heading-number")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(prose.locator(":scope > p")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(prose.locator(":scope > h2")).toHaveCount(1);
  await expect(prose.locator(":scope > h2 .semlo-editor-heading-number")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(prose.locator(":scope > h2 .semlo-editor-heading-number")).toHaveText("1. ");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await state(page)).selection.text).toBe("/原文");
});

for (const level of [1, 2, 3, 4, 5, 6] as const) {
  test(`numbered H${level} whole-text deletion and history are stable`, async ({ page }) => {
    const prose = await mount(page, `<h${level} data-semlo-editor-heading-numbering="mixed">甲乙</h${level}>`);
    await prose.locator(`:scope > h${level}`).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const before = await state(page);
    expect(before.dom.text).toContain("甲乙");
    await page.keyboard.press("Backspace");
    const deleted = await state(page);
    expect(deleted.json.content?.[0]).toMatchObject({
      type: "heading",
      attrs: { level, semloEditorHeadingNumbering: "mixed" },
    });
    expect(deleted.json.content?.[0].content ?? []).toEqual([]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).json).toEqual(before.json);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await state(page)).json).toEqual(deleted.json);
  });
}

for (const level of [1, 2, 3, 4, 5, 6] as const) {
  test(`unnumbered H${level} whole-text Backspace retains the heading through undo and redo`, async ({ page }) => {
    const prose = await mount(page, `<h${level}>甲乙</h${level}>`);
    await prose.locator(`:scope > h${level}`).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const before = await state(page);
    expect(before.dom.text).toBe("甲乙");
    await page.keyboard.press("Backspace");
    const deleted = await state(page);
    expect(deleted.json.content?.[0]).toMatchObject({
      type: "heading",
      attrs: { level, semloEditorHeadingNumbering: null },
    });
    expect(deleted.json.content?.[0].content ?? []).toEqual([]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).json).toEqual(before.json);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await state(page)).json).toEqual(deleted.json);
  });
}

for (const [name, html, level] of [
  ["unnumbered H5", "<h5>甲乙</h5>", 5],
  ["numbered H2", '<h2 data-semlo-editor-heading-numbering="mixed">甲乙</h2>', 2],
] as const) {
  test(`${name} whole-text Delete retains the heading through undo and redo`, async ({ page }) => {
    const prose = await mount(page, html);
    await prose.locator(`:scope > h${level}`).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const before = await state(page);
    await page.keyboard.press("Delete");
    const deleted = await state(page);
    expect(deleted.json.content?.[0]).toMatchObject({ type: "heading", attrs: { level } });
    expect(deleted.json.content?.[0].content ?? []).toEqual([]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).json).toEqual(before.json);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await state(page)).json).toEqual(deleted.json);
  });
}

for (const [name, html] of [
  ["unnumbered H5", "<h5>甲乙</h5>"],
  ["numbered H2", '<h2 data-semlo-editor-heading-numbering="mixed">甲乙</h2>'],
] as const) {
  test(`${name} Meta+A selects the document and Backspace still resets it to a paragraph`, async ({ page }) => {
    const prose = await mount(page, html);
    await prose.locator(":scope > *").click();
    await page.keyboard.press("ControlOrMeta+a");
    const before = await state(page);
    expect(before.selection.type).toBe("all");
    await page.keyboard.press("Backspace");
    const deleted = await state(page);
    expect(deleted.json.content?.[0].type).toBe("paragraph");
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).json).toEqual(before.json);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await state(page)).json).toEqual(deleted.json);
  });
}

test("a host may reject the initial Delete without losing the selected heading text", async ({ page }) => {
  const { before } = await prepareUserSelection(page, "late-reject-first");
  await page.keyboard.press("Delete");
  const after = await state(page);
  expect(after.json).toEqual(before.json);
  expect(after.selection.text).toBe("/原文");
  expect(after.focused).toBe(true);
});

test("a composing Delete does not delete a full heading selection", async ({ page }) => {
  await mount(page, "<h5>甲乙</h5>");
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingDeleteEditor").editor;
    editor.view.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
    const before = editor.getJSON();
    const events = [
      new KeyboardEvent("keydown", { key: "Delete", keyCode: 46, isComposing: true, bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "Delete", keyCode: 229, bubbles: true, cancelable: true }),
    ];
    for (const event of events) editor.view.dom.dispatchEvent(event);
    return { before, after: editor.getJSON(), prevented: events.map((event) => event.defaultPrevented) };
  });
  expect(result.after).toEqual(result.before);
  expect(result.prevented).toEqual([false, false]);
});

for (const level of [1, 2, 3, 4, 5, 6] as const) {
  for (const key of ["Backspace", "Delete"] as const) {
    test(`whole-text ${key} in a sole root quote keeps its unnumbered H${level} and quote through history`, async ({
      page,
    }) => {
      const prose = await mount(page, `<blockquote><h${level}>test</h${level}></blockquote>`);
      await prose.locator(`blockquote > h${level}`).click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      const before = await state(page);
      expect(before.dom.text).toBe("test");
      await page.keyboard.press(key);
      const deleted = await state(page);
      expect(deleted.json.content?.[0].type).toBe("blockquote");
      expect(deleted.json.content?.[0].content?.[0]).toMatchObject({
        type: "heading",
        attrs: { level, semloEditorHeadingNumbering: null },
      });
      expect(deleted.json.content?.[0].content?.[0].content ?? []).toEqual([]);
      expect(deleted.focused).toBe(true);
      await page.keyboard.press("ControlOrMeta+z");
      const undone = await state(page);
      expect(undone.json).toEqual(before.json);
      expect(undone.selection.text).toBe("test");
      await page.keyboard.press("ControlOrMeta+Shift+z");
      expect((await state(page)).json).toEqual(deleted.json);
    });
  }
}

test("Meta+A in a sole root quote still removes the entire quote", async ({ page }) => {
  const prose = await mount(page, "<blockquote><h3>test</h3></blockquote>");
  await prose.locator("blockquote > h3").click();
  await page.keyboard.press("ControlOrMeta+a");
  const before = await state(page);
  expect(before.selection.type).toBe("all");
  await page.keyboard.press("Backspace");
  const deleted = await state(page);
  expect(deleted.json.content?.[0].type).toBe("paragraph");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await state(page)).json).toEqual(before.json);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect((await state(page)).json).toEqual(deleted.json);
});

for (const mode of ["early-reject-first", "late-reject-first", "early-reject", "late-reject"] as const) {
  test(`${mode} host rejection keeps the sole quoted H3 intact`, async ({ page }) => {
    const prose = await mount(page, "<blockquote><h3>/原文</h3></blockquote>", mode);
    await prose.locator("blockquote > h3").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const before = await state(page);
    expect(before.dom.text).toBe("/原文");
    await page.evaluate(() => {
      window.headingDeleteHostEvents = [];
    });
    await page.keyboard.press("Backspace");
    if (!mode.endsWith("first")) {
      expect((await state(page)).json.content?.[0].content?.[0].type).toBe("heading");
      await page.keyboard.press("ControlOrMeta+z");
      expect((await state(page)).json).toEqual(before.json);
      await page.keyboard.press("ControlOrMeta+Shift+z");
    }
    const after = await state(page);
    expect(after.json).toEqual(before.json);
    expect(after.selection.text).toBe("/原文");
    expect(after.focused).toBe(true);
    if (!mode.endsWith("first"))
      expect(await page.evaluate(() => window.__semloRequireFixture("headingDeleteEditor").editor.can().redo())).toBe(
        true,
      );
  });
}

test("an unobserved sole quoted numbered heading continues through the existing deletion path", async ({ page }) => {
  const prose = await mount(page, '<blockquote><h2 data-semlo-editor-heading-numbering="mixed">test</h2></blockquote>');
  await prose.locator("blockquote > h2").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  expect((await state(page)).json.content?.[0].type).toBe("paragraph");
});

for (const mode of ["early-reject-first", "late-reject-first"] as const) {
  test(`${mode} rejected deletion does not change grouping of subsequent typing`, async ({ page }) => {
    const run = async (attemptDelete: boolean) => {
      const prose = await mount(page, "<h2>/原文</h2>", mode);
      await prose.locator(":scope > h2").click();
      await page.keyboard.press("End");
      await page.keyboard.type("x");
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      if (attemptDelete) await page.keyboard.press("Backspace");
      await page.keyboard.press("End");
      await page.keyboard.type("y");
      const typed = await state(page);
      await page.keyboard.press("ControlOrMeta+z");
      const undone = await state(page);
      return { typed, undone };
    };
    const baseline = await run(false);
    const rejected = await run(true);
    expect(rejected.typed.json).toEqual(baseline.typed.json);
    expect(rejected.undone.json).toEqual(baseline.undone.json);
    expect(rejected.undone.selection).toEqual(baseline.undone.selection);
  });
}
