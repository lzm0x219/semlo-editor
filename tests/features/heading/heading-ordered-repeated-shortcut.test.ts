import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    repeatedHeadingEditor?: EditorController;
    repeatedHeadingChanges?: number;
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
      host.id = 'repeated-heading-test'
      document.body.append(host)
      const item = (text, indent) => ({
        type: 'listItem', attrs: { semloEditorListIndent: indent },
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      })
      window.repeatedHeadingChanges = 0
      window.repeatedHeadingEditor = createEditor({
        element: host,
        outline: false,
        content: {
          type: 'doc',
          content: [{
            type: 'orderedList',
            attrs: { semloEditorOrderedStyle: 'decimal' },
            content: [item('甲', 0), item('乙', 1), item('丙', 0), item('丁', 1), item('戊', 0)],
          }],
        },
        onChange: () => { window.repeatedHeadingChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.repeatedHeadingEditor));
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("repeatedHeadingEditor").editor;
    const { $anchor, $head } = editor.state.selection;
    const native = window.getSelection();
    const anchor = native?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    const block = element?.closest("p,h1,h2,h3,h4,h5,h6");
    const blockCopy = block?.cloneNode(true) as HTMLElement | undefined;
    blockCopy
      ?.querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
      .forEach((node) => node.remove());
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
      snapshot: window.__semloRequireFixture("repeatedHeadingEditor").getSnapshot(),
      changes: window.__semloRequireFixture("repeatedHeadingChanges"),
      pm: {
        empty: editor.state.selection.empty,
        anchorText: $anchor.parent.textContent,
        anchorOffset: $anchor.parentOffset,
        headText: $head.parent.textContent,
        headOffset: $head.parentOffset,
      },
      dom: {
        focused: document.activeElement === editor.view.dom,
        collapsed: native?.isCollapsed ?? false,
        blockTag: block?.tagName ?? null,
        blockText: blockCopy?.textContent ?? null,
        textOffset,
        caretHeight,
      },
    };
  });
}

async function markerRows(page: Page) {
  return page
    .locator("#repeated-heading-test .semlo-editor-prose li")
    .evaluateAll((items) =>
      items.map((item) => ({ text: item.textContent, marker: getComputedStyle(item).listStyleType })),
    );
}

async function headingRows(page: Page) {
  return page.locator("#repeated-heading-test .semlo-editor-prose h3").evaluateAll((headings) =>
    headings.map((heading) => {
      const number = heading.querySelector(".semlo-editor-heading-number");
      return {
        number: number?.textContent?.trim(),
        text: heading.textContent?.replace(number?.textContent ?? "", "").trim(),
      };
    }),
  );
}

function expectDomCaret(actual: Awaited<ReturnType<typeof inspect>>, text: string, tag: string) {
  expect(actual.dom).toMatchObject({ focused: true, collapsed: true, blockTag: tag, blockText: text, textOffset: 0 });
  expect(actual.dom.caretHeight).toBeGreaterThan(0);
}

function expectCaret(actual: Awaited<ReturnType<typeof inspect>>, text: string, tag: string) {
  expectDomCaret(actual, text, tag);
  expect(actual.pm).toEqual({ empty: true, anchorText: text, anchorOffset: 0, headText: text, headOffset: 0 });
}

test("repeated H3 shortcuts retain focus, line-start caret and one-step undo", async ({ page }) => {
  await mount(page);
  const host = page.locator("#repeated-heading-test");
  expect(await markerRows(page)).toEqual([
    { text: "甲", marker: '"1. "' },
    { text: "乙", marker: '"1.1. "' },
    { text: "丙", marker: '"2. "' },
    { text: "丁", marker: '"2.1. "' },
    { text: "戊", marker: '"3. "' },
  ]);
  await host.getByText("丙", { exact: true }).click();
  await page.keyboard.press("Home");
  expectDomCaret(await inspect(page), "丙", "P");
  await page.keyboard.press("ControlOrMeta+Alt+3");
  expect(await headingRows(page)).toEqual([{ number: "1.", text: "丙" }]);
  expect(await markerRows(page)).toEqual([
    { text: "甲", marker: '"1. "' },
    { text: "乙", marker: '"1.1. "' },
    { text: "丁", marker: '"1.2. "' },
    { text: "戊", marker: '"2. "' },
  ]);

  await host.getByText("丁", { exact: true }).click();
  await page.keyboard.press("Home");
  const before = await inspect(page);
  expectDomCaret(before, "丁", "P");
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(after.changes - before.changes).toBe(1);
  expect(after.snapshot.json).not.toEqual(before.snapshot.json);
  expect(await headingRows(page)).toEqual([
    { number: "1.", text: "丙" },
    { number: "2.", text: "丁" },
  ]);
  expect(await markerRows(page)).toEqual([
    { text: "甲", marker: '"1. "' },
    { text: "乙", marker: '"1.1. "' },
    { text: "戊", marker: '"2. "' },
  ]);
  expectCaret(after, "丁", "H3");

  await page.keyboard.press("ControlOrMeta+z");
  const undone = await inspect(page);
  expect(undone.snapshot.json).toEqual(before.snapshot.json);
  expect(await headingRows(page)).toEqual([{ number: "1.", text: "丙" }]);
  expect(await markerRows(page)).toEqual([
    { text: "甲", marker: '"1. "' },
    { text: "乙", marker: '"1.1. "' },
    { text: "丁", marker: '"1.2. "' },
    { text: "戊", marker: '"2. "' },
  ]);
  expectCaret(undone, "丁", "P");
});
