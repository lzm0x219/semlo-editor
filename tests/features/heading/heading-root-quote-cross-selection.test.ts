import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    rootQuoteCrossEditor?: EditorController;
    rootQuoteCrossChanges?: number;
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
      host.id = 'root-quote-cross-test'
      document.body.append(host)
      window.rootQuoteCrossChanges = 0
      window.rootQuoteCrossEditor = createEditor({
        element: host, outline: false,
        content: '<blockquote><p><em>保留引用</em></p><p>引内甲</p></blockquote><p>引用外乙</p><p><strong>保留末段</strong></p>',
        onChange: () => { window.rootQuoteCrossChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.rootQuoteCrossEditor));
}

async function selectAcrossQuote(page: Page, reverse: boolean) {
  await page.evaluate((backward) => {
    const editor = window.__semloRequireFixture("rootQuoteCrossEditor").editor;
    let first = -1;
    let last = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "引内甲") first = pos + 1;
      if (node.isTextblock && node.textContent === "引用外乙") last = pos + node.nodeSize - 1;
    });
    if (first < 0 || last < 0) throw new Error("Missing selected paragraphs");
    editor.view.focus();
    editor.commands.setTextSelection({ from: backward ? last : first, to: backward ? first : last });
  }, reverse);
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("rootQuoteCrossEditor").editor;
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
      changes: window.rootQuoteCrossChanges ?? 0,
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
    anchor: reverse ? "引用外乙" : "引内甲",
    anchorOffset: reverse ? 4 : 0,
    head: reverse ? "引内甲" : "引用外乙",
    headOffset: reverse ? 0 : 4,
  });
  expect(actual.dom).toEqual({
    focused: true,
    selected: "引内甲\n引用外乙",
    anchor: { text: reverse ? "引用外乙" : "引内甲", offset: reverse ? 4 : 0 },
    head: { text: reverse ? "引内甲" : "引用外乙", offset: reverse ? 0 : 4 },
  });
}

for (const reverse of [false, true]) {
  test(`a root quote and following paragraph become H3 (${reverse ? "backward" : "forward"} selection)`, async ({
    page,
  }) => {
    await mount(page);
    await selectAcrossQuote(page, reverse);
    const before = await inspect(page);
    expectSelected(before, reverse);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await inspect(page);
    expect(after.changes - before.changes).toBe(1);
    expectSelected(after, reverse);
    expect(after.raw.content?.map((node) => node.type)).toEqual(["blockquote", "heading", "paragraph"]);
    const quote = after.raw.content?.[0];
    const originalQuote = before.raw.content?.[0];
    expect(quote?.attrs).toEqual(originalQuote?.attrs);
    expect(quote?.content?.map((node) => node.type)).toEqual(["paragraph", "heading"]);
    expect(quote?.content?.[0]).toEqual(originalQuote?.content?.[0]);
    expect(quote?.content?.[1]).toMatchObject({
      type: "heading",
      attrs: { level: 3, semloEditorHeadingNumbering: null },
      content: [{ type: "text", text: "引内甲" }],
    });
    expect(after.raw.content?.[1]).toMatchObject({
      type: "heading",
      attrs: { level: 3, semloEditorHeadingNumbering: null },
      content: [{ type: "text", text: "引用外乙" }],
    });
    expect(after.raw.content?.[2]).toEqual(before.raw.content?.[2]);
    await expect(page.locator("#root-quote-cross-test .semlo-editor-prose > blockquote > h3")).toHaveText("引内甲");
    await expect(page.locator("#root-quote-cross-test .semlo-editor-prose > h3")).toHaveText("引用外乙");
    await expect(page.locator("#root-quote-cross-test .semlo-editor-prose .semlo-editor-heading-number")).toHaveCount(
      0,
    );
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.raw).toEqual(before.raw);
    expectSelected(undone, reverse);
    expect(await page.evaluate(() => window.__semloRequireFixture("rootQuoteCrossEditor").editor.commands.redo())).toBe(
      true,
    );
    const redone = await inspect(page);
    expect(redone.raw).toEqual(after.raw);
    expectSelected(redone, reverse);
  });
}
