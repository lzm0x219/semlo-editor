import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    rootQuoteMultiEditor?: EditorController;
    rootQuoteMultiChanges?: number;
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
      host.id = 'root-quote-multi-test'
      document.body.append(host)
      window.rootQuoteMultiChanges = 0
      window.rootQuoteMultiEditor = createEditor({
        element: host, outline: false,
        content: '<blockquote><p>引用甲</p><p>引用乙</p><p><em>引用丙</em></p></blockquote><p><strong>尾段</strong></p>',
        onChange: () => { window.rootQuoteMultiChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.rootQuoteMultiEditor));
}

async function selectFirstTwo(page: Page, reverse: boolean) {
  await page.evaluate((backward) => {
    const editor = window.__semloRequireFixture("rootQuoteMultiEditor").editor;
    let first = -1;
    let last = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "引用甲") first = pos + 1;
      if (node.isTextblock && node.textContent === "引用乙") last = pos + node.nodeSize - 1;
    });
    if (first < 0 || last < 0) throw new Error("Missing quote paragraphs");
    editor.view.focus();
    editor.commands.setTextSelection({ from: backward ? last : first, to: backward ? first : last });
  }, reverse);
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("rootQuoteMultiEditor").editor;
    const { $anchor, $head } = editor.state.selection;
    const native = window.getSelection();
    const endpoint = (node: Node | null | undefined, offset: number) => {
      const element = node instanceof Element ? node : node?.parentElement;
      const block = element?.closest("p,h1,h2,h3,h4,h5,h6");
      if (!node || !block || !block.contains(node)) return null;
      const prefix = document.createRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(node, offset);
      const fragment = prefix.cloneContents();
      fragment
        .querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
        .forEach((child) => child.remove());
      const copy = block.cloneNode(true) as HTMLElement;
      copy
        .querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
        .forEach((child) => child.remove());
      return { text: copy.textContent, offset: fragment.textContent?.length ?? -1 };
    };
    return {
      raw: editor.getJSON(),
      changes: window.rootQuoteMultiChanges ?? 0,
      pm: {
        anchor: $anchor.parent.textContent,
        anchorOffset: $anchor.parentOffset,
        head: $head.parent.textContent,
        headOffset: $head.parentOffset,
      },
      dom: {
        focused: document.activeElement === editor.view.dom,
        selected: (native?.toString() ?? "").replace(/\n+/g, "\n"),
        anchor: endpoint(native?.anchorNode, native?.anchorOffset ?? 0),
        head: endpoint(native?.focusNode, native?.focusOffset ?? 0),
      },
    };
  });
}

function expectSelected(actual: Awaited<ReturnType<typeof inspect>>, reverse: boolean) {
  expect(actual.pm).toEqual({
    anchor: reverse ? "引用乙" : "引用甲",
    anchorOffset: reverse ? 3 : 0,
    head: reverse ? "引用甲" : "引用乙",
    headOffset: reverse ? 0 : 3,
  });
  expect(actual.dom).toEqual({
    focused: true,
    selected: "引用甲\n引用乙",
    anchor: { text: reverse ? "引用乙" : "引用甲", offset: reverse ? 3 : 0 },
    head: { text: reverse ? "引用甲" : "引用乙", offset: reverse ? 0 : 3 },
  });
}

for (const reverse of [false, true]) {
  test(`two paragraphs in a root quote toggle H3 together (${reverse ? "backward" : "forward"} selection)`, async ({
    page,
  }) => {
    await mount(page);
    await selectFirstTwo(page, reverse);
    const before = await inspect(page);
    expectSelected(before, reverse);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const headings = await inspect(page);
    expect(headings.changes - before.changes).toBe(1);
    expectSelected(headings, reverse);
    expect(headings.raw.content?.map((node) => node.type)).toEqual(["blockquote", "paragraph"]);
    const quote = headings.raw.content?.[0];
    const originalQuote = before.raw.content?.[0];
    expect(quote?.attrs).toEqual(originalQuote?.attrs);
    expect(quote?.content?.map((node) => node.type)).toEqual(["heading", "heading", "paragraph"]);
    for (const [index, text] of ["引用甲", "引用乙"].entries())
      expect(quote?.content?.[index]).toMatchObject({
        type: "heading",
        attrs: { level: 3, semloEditorHeadingNumbering: null },
        content: [{ type: "text", text }],
      });
    expect(quote?.content?.[2]).toEqual(originalQuote?.content?.[2]);
    expect(headings.raw.content?.[1]).toEqual(before.raw.content?.[1]);
    await expect(page.locator("#root-quote-multi-test .semlo-editor-prose > blockquote > h3")).toHaveCount(2);
    await expect(
      page.locator("#root-quote-multi-test .semlo-editor-prose > blockquote .semlo-editor-heading-number"),
    ).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.raw).toEqual(before.raw);
    expectSelected(undone, reverse);
    expect(await page.evaluate(() => window.__semloRequireFixture("rootQuoteMultiEditor").editor.commands.redo())).toBe(
      true,
    );
    const redone = await inspect(page);
    expect(redone.raw).toEqual(headings.raw);
    expectSelected(redone, reverse);

    await page.keyboard.press("ControlOrMeta+Alt+3");
    const paragraphs = await inspect(page);
    expect(paragraphs.changes - redone.changes).toBe(1);
    expect(paragraphs.raw).toEqual(before.raw);
    expectSelected(paragraphs, reverse);
    await page.keyboard.press("ControlOrMeta+z");
    const undoToggle = await inspect(page);
    expect(undoToggle.raw).toEqual(headings.raw);
    expectSelected(undoToggle, reverse);
  });
}
