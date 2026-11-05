import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    rootQuoteKeysEditor?: EditorController;
    rootQuoteKeysChanges?: number;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'root-quote-keys-test'
      document.body.append(host)
      window.rootQuoteKeysChanges = 0
      window.rootQuoteKeysEditor = createEditor({
        element: host, outline: false,
        content: '<blockquote><p><em>保留前段</em></p><h3>标题前后</h3><p><strong>保留后段</strong></p></blockquote><p>尾段</p>',
        onChange: () => { window.rootQuoteKeysChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.rootQuoteKeysEditor));
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("rootQuoteKeysEditor").editor;
    const { $anchor, $head } = editor.state.selection;
    const native = window.getSelection();
    const anchor = native?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    const block = element?.closest("p,h1,h2,h3,h4,h5,h6");
    const copy = block?.cloneNode(true) as HTMLElement | undefined;
    copy?.querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number').forEach((node) => node.remove());
    let textOffset: number | null = null;
    let caretHeight = 0;
    if (native?.rangeCount && anchor && block && block.contains(anchor)) {
      const range = native.getRangeAt(0);
      caretHeight = range.getBoundingClientRect().height;
      const prefix = document.createRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(anchor, native.anchorOffset);
      const fragment = prefix.cloneContents();
      fragment
        .querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
        .forEach((node) => node.remove());
      textOffset = fragment.textContent?.length ?? null;
    }
    return {
      raw: editor.getJSON() as JSONContent,
      changes: window.rootQuoteKeysChanges ?? 0,
      pm: {
        empty: editor.state.selection.empty,
        anchor: $anchor.parent.textContent,
        anchorOffset: $anchor.parentOffset,
        head: $head.parent.textContent,
        headOffset: $head.parentOffset,
      },
      dom: {
        focused: document.activeElement === editor.view.dom,
        collapsed: native?.isCollapsed ?? false,
        blockTag: block?.tagName ?? null,
        blockText: copy?.textContent ?? null,
        textOffset,
        caretHeight,
        blockHeight: block?.getBoundingClientRect().height ?? 0,
      },
    };
  });
}

function expectCaret(actual: Awaited<ReturnType<typeof inspect>>, text: string, offset: number, tag: string) {
  expect(actual.pm).toEqual({ empty: true, anchor: text, anchorOffset: offset, head: text, headOffset: offset });
  expect(actual.dom).toMatchObject({
    focused: true,
    collapsed: true,
    blockTag: tag,
    blockText: text,
    textOffset: offset,
  });
  expect(actual.dom.blockHeight).toBeGreaterThan(0);
  if (text) expect(actual.dom.caretHeight).toBeGreaterThan(0);
}

function rows(actual: Awaited<ReturnType<typeof inspect>>) {
  return actual.raw.content?.[0]?.content?.map((node) => ({
    type: node.type,
    text: node.content?.map((child) => child.text).join("") ?? "",
    level: node.type === "heading" ? node.attrs?.level : null,
    numbering: node.type === "heading" ? node.attrs?.semloEditorHeadingNumbering : null,
  }));
}

async function clickMiddle(page: Page) {
  await page.locator("#root-quote-keys-test .semlo-editor-prose > blockquote > h3").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const before = await inspect(page);
  // Browser selection can briefly precede PM selection after movement.
  expect(before.dom).toMatchObject({
    focused: true,
    collapsed: true,
    blockTag: "H3",
    blockText: "标题前后",
    textOffset: 2,
  });
  return before;
}

test("inside a root quote, split H3, insert an empty paragraph, then convert the second H3 with Backspace", async ({
  page,
}) => {
  await mount(page);
  const initial = await clickMiddle(page);
  await page.keyboard.press("Enter");
  const split = await inspect(page);
  expect(split.changes - initial.changes).toBe(1);
  expect(rows(split)).toEqual([
    { type: "paragraph", text: "保留前段", level: null, numbering: null },
    { type: "heading", text: "标题", level: 3, numbering: null },
    { type: "heading", text: "前后", level: 3, numbering: null },
    { type: "paragraph", text: "保留后段", level: null, numbering: null },
  ]);
  expect(split.raw.content?.[0].attrs).toEqual(initial.raw.content?.[0].attrs);
  expect(split.raw.content?.[0].content?.[0]).toEqual(initial.raw.content?.[0].content?.[0]);
  expect(split.raw.content?.[0].content?.[3]).toEqual(initial.raw.content?.[0].content?.[2]);
  expect(split.raw.content?.[1]).toEqual(initial.raw.content?.[1]);
  expectCaret(split, "前后", 0, "H3");
  await expect(page.locator("#root-quote-keys-test .semlo-editor-prose > blockquote > h3")).toHaveCount(2);
  await expect(
    page.locator("#root-quote-keys-test .semlo-editor-prose > blockquote .semlo-editor-heading-number"),
  ).toHaveCount(0);

  await page.keyboard.press("End");
  const beforeEnd = await inspect(page);
  expect(beforeEnd.dom).toMatchObject({ focused: true, blockTag: "H3", blockText: "前后", textOffset: 2 });
  await page.keyboard.press("Enter");
  const withEmpty = await inspect(page);
  expect(withEmpty.changes - beforeEnd.changes).toBe(1);
  expect(rows(withEmpty)).toEqual([
    { type: "paragraph", text: "保留前段", level: null, numbering: null },
    { type: "heading", text: "标题", level: 3, numbering: null },
    { type: "heading", text: "前后", level: 3, numbering: null },
    { type: "paragraph", text: "", level: null, numbering: null },
    { type: "paragraph", text: "保留后段", level: null, numbering: null },
  ]);
  expectCaret(withEmpty, "", 0, "P");
  await page.keyboard.press("ControlOrMeta+z");
  const undoEmpty = await inspect(page);
  expect(undoEmpty.raw).toEqual(split.raw);
  expectCaret(undoEmpty, "前后", 2, "H3");

  await page.keyboard.press("Home");
  const beforeBackspace = await inspect(page);
  expect(beforeBackspace.dom).toMatchObject({ focused: true, blockTag: "H3", blockText: "前后", textOffset: 0 });
  await page.keyboard.press("Backspace");
  const converted = await inspect(page);
  expect(converted.changes - beforeBackspace.changes).toBe(1);
  expect(rows(converted)).toEqual([
    { type: "paragraph", text: "保留前段", level: null, numbering: null },
    { type: "heading", text: "标题", level: 3, numbering: null },
    { type: "paragraph", text: "前后", level: null, numbering: null },
    { type: "paragraph", text: "保留后段", level: null, numbering: null },
  ]);
  expectCaret(converted, "前后", 0, "P");
  await page.keyboard.press("ControlOrMeta+z");
  const undoBackspace = await inspect(page);
  expect(undoBackspace.raw).toEqual(split.raw);
  expectCaret(undoBackspace, "前后", 0, "H3");
});

test("splitting a quote heading is undone in one step with the original caret", async ({ page }) => {
  await mount(page);
  const before = await clickMiddle(page);
  await page.keyboard.press("Enter");
  const split = await inspect(page);
  expectCaret(split, "前后", 0, "H3");
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await inspect(page);
  expect(undone.raw).toEqual(before.raw);
  expectCaret(undone, "标题前后", 2, "H3");
});
