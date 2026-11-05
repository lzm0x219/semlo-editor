import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    headingContainerCompat?: EditorController;
    headingContainerCompatChanges?: number;
  }
}

async function mount(page: Page, html: string) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      document.body.append(host)
      window.headingContainerCompatChanges = 0
      window.headingContainerCompat = createEditor({
        element: host, outline: false, content: ${JSON.stringify(html)},
        onChange: () => { window.headingContainerCompatChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.headingContainerCompat));
}

async function inspect(page: Page, selected: string[]) {
  return page.evaluate((selectedTexts) => {
    const editor = window.__semloRequireFixture("headingContainerCompat").editor;
    const wrappers: unknown[] = [];
    const retained: unknown[] = [];
    const headings: string[] = [];
    editor.state.doc.descendants((node) => {
      if (["blockquote", "callout"].includes(node.type.name))
        wrappers.push({ type: node.type.name, attrs: node.attrs });
      if (node.isTextblock && selectedTexts.includes(node.textContent) && node.type.name === "heading")
        headings.push(node.textContent);
      if (node.isTextblock && !selectedTexts.includes(node.textContent)) retained.push(node.toJSON());
    });
    const { $anchor, $head } = editor.state.selection;
    return {
      json: window.__semloRequireFixture("headingContainerCompat").getSnapshot().json,
      wrappers,
      retained,
      headings,
      selection: {
        anchor: $anchor.parent.textContent,
        anchorOffset: $anchor.parentOffset,
        head: $head.parent.textContent,
        headOffset: $head.parentOffset,
      },
      changes: window.__semloRequireFixture("headingContainerCompatChanges"),
    };
  }, selected);
}

async function select(page: Page, first: string, last = first) {
  await page.evaluate(
    ({ first, last }) => {
      const editor = window.__semloRequireFixture("headingContainerCompat").editor;
      let from = -1;
      let to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === first) from = pos + 1;
        if (node.isTextblock && node.textContent === last) to = pos + node.nodeSize - 1;
      });
      if (from < 0 || to < 0) throw new Error("Selected block missing");
      editor.view.focus();
      editor.commands.setTextSelection(first === last ? from + 1 : { from, to });
    },
    { first, last },
  );
}

for (const [name, html] of [
  [
    "shallow blockquote",
    "<ul><li><p>父</p><blockquote><p>选中</p><p><em>兄弟</em></p></blockquote><p>尾段</p></li><li><p>同级</p></li></ul>",
  ],
  [
    "shallow callout",
    '<ul><li><p>父</p><aside data-semlo-editor-callout data-tone="pink"><p>选中</p><p><em>兄弟</em></p></aside><p>尾段</p></li><li><p>同级</p></li></ul>',
  ],
  [
    "shallow blockquote in a parent with a child list",
    "<ul><li><p>父</p><blockquote><p>选中</p><p><em>兄弟</em></p></blockquote><ul><li><p>子</p></li></ul></li><li><p>同级</p></li></ul>",
  ],
  [
    "deep blockquote in an item without a child list",
    "<ul><li><p>祖</p><ul><li><p>父</p><blockquote><p>选中</p><p><em>兄弟</em></p></blockquote></li><li><p>同级</p></li></ul></li></ul>",
  ],
] as const) {
  test(`existing single-block conversion: ${name}`, async ({ page }) => {
    await mount(page, html);
    await select(page, "选中");
    const before = await inspect(page, ["选中"]);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await inspect(page, ["选中"]);
    expect(after.json).not.toEqual(before.json);
    expect(after.headings).toEqual(["选中"]);
    expect(after.wrappers).toEqual(before.wrappers);
    expect(after.retained).toEqual(before.retained);
    expect(after.selection).toEqual(before.selection);
    expect(after.changes - before.changes).toBe(1);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingContainerCompat").editor.commands.undo()),
    ).toBe(true);
    expect((await inspect(page, ["选中"])).json).toEqual(before.json);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingContainerCompat").editor.commands.redo()),
    ).toBe(true);
    expect((await inspect(page, ["选中"])).json).toEqual(after.json);
  });
}

for (const [name, html, shouldConvert] of [
  [
    "two blocks in one blockquote",
    "<ul><li><p>父</p><blockquote><p>选一</p><p>选二</p><p><em>保留</em></p></blockquote><p>尾段</p></li><li><p>同级</p></li></ul>",
    true,
  ],
  [
    "blockquote to outside paragraph",
    "<ul><li><p>父</p><blockquote><p>选一</p></blockquote><p>选二</p><p><em>保留</em></p></li><li><p>同级</p></li></ul>",
    true,
  ],
  [
    "blockquote to callout",
    '<ul><li><p>父</p><blockquote><p>选一</p></blockquote><aside data-semlo-editor-callout data-tone="pink"><p>选二</p><p><em>保留</em></p></aside></li><li><p>同级</p></li></ul>',
    true,
  ],
  [
    "item paragraph to blockquote",
    "<ul><li><p>选一</p><blockquote><p>选二</p><p><em>保留</em></p></blockquote></li><li><p>同级</p></li></ul>",
    false,
  ],
] as const) {
  test(`existing multi-block conversion: ${name}`, async ({ page }) => {
    await mount(page, html);
    await select(page, "选一", "选二");
    const before = await inspect(page, ["选一", "选二"]);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await inspect(page, ["选一", "选二"]);
    expect(after.wrappers).toEqual(before.wrappers);
    expect(after.retained).toEqual(before.retained);
    expect(after.selection).toEqual(before.selection);
    if (!shouldConvert) {
      expect(after.json).toEqual(before.json);
      expect(after.changes).toBe(before.changes);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("headingContainerCompat").editor.commands.undo()),
      ).toBe(false);
      return;
    }
    expect(after.json).not.toEqual(before.json);
    expect(after.headings).toEqual(["选一", "选二"]);
    expect(after.changes - before.changes).toBe(1);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingContainerCompat").editor.commands.undo()),
    ).toBe(true);
    expect((await inspect(page, ["选一", "选二"])).json).toEqual(before.json);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingContainerCompat").editor.commands.redo()),
    ).toBe(true);
    expect((await inspect(page, ["选一", "选二"])).json).toEqual(after.json);
  });
}
