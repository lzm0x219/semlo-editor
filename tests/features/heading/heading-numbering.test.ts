import { expect, test, type Page } from "@rstest/playwright";
import type { PluginKey } from "@tiptap/pm/state";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    numberedHeadingEditor?: EditorController;
    numberedHeadingChanges?: number;
    numberedHeadingSecond?: EditorController;
    attachNumberedHeadingProbe?: (editor: EditorController, from: number, to: number) => void;
    headingHostKey?: PluginKey<{ version: number }>;
    headingHostTrace?: Array<{ version: number; prior: number | null; outer: string | null; cleared: boolean }>;
    headingHostMapped?: number;
    headingFilterCount?: number;
    headingAppendCount?: number;
  }
}

test("host heading commands receive committed plugin state and keep their transaction metadata", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin, PluginKey } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'numbered-heading-editor'
      document.body.append(host)
      const key = new PluginKey('heading-host-probe')
      window.headingHostKey = key
      window.headingHostTrace = []
      window.headingHostMapped = 0
      window.numberedHeadingChanges = 0
      const custom = Extension.create({
        name: 'heading-host-probe',
        priority: 1,
        addProseMirrorPlugins() {
          return [new Plugin({ key, state: {
            init: () => ({ version: 0 }),
            apply: (tr, previous) => tr.getMeta(key) ?? previous,
          } })]
        },
        addCommands() {
          return {
            focus: () => ({ tr, view }) => {
              tr.setMeta('heading-host-outer', 'seed')
              view.focus()
              return true
            },
            setHeading: attrs => ({ state, tr, commands }) => {
              const current = key.getState(state)
              if (!current || current.version < 41) return false
              const prior = tr.getMeta(key)
              const outer = tr.getMeta('heading-host-outer') ?? null
              tr.setMeta('heading-host-outer', undefined)
              const cleared = tr.getMeta('heading-host-outer') === undefined
              window.headingHostTrace.push({ version: current.version, prior: prior?.version ?? null, outer, cleared })
              tr.setMeta(key, { version: current.version + 1 })
              if (!commands.setNode('heading', attrs)) return false
              const Base = tr.selection.constructor
              class UnregisteredSelection extends Base {
                map(doc, mapping) {
                  window.headingHostMapped++
                  const mapped = super.map(doc, mapping)
                  return new UnregisteredSelection(mapped.$anchor, mapped.$head)
                }
                toJSON() { return { type: 'unregistered-heading-test', anchor: this.anchor, head: this.head } }
              }
              tr.setSelection(new UnregisteredSelection(tr.selection.$anchor, tr.selection.$head))
              return true
            },
          }
        },
      })
      window.numberedHeadingEditor = createEditor({
        element: host, outline: false,
        content: '<ul><li><p>祖父</p><ul><li><p>父列表</p><ul><li><p>孙列表</p></li></ul></li><li><p>同级</p></li></ul></li></ul>',
        extensions: [custom], onChange: () => { window.numberedHeadingChanges++ },
      })
      const editor = window.numberedHeadingEditor.editor
      editor.view.dispatch(editor.state.tr.setMeta(key, { version: 41 }))
    `,
  });
  await page.waitForFunction(() => Boolean(window.numberedHeadingEditor && window.headingHostKey));
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await select(page, "父列表", "孙列表");
  await shortcut(page, 3);
  const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  expect(after).not.toEqual(before);
  await expect(page.locator("#numbered-heading-editor .semlo-editor-prose > h3")).toHaveCount(2);
  expect(await page.evaluate(() => window.headingHostTrace)).toEqual([
    { version: 41, prior: null, outer: "seed", cleared: true },
    { version: 41, prior: 42, outer: null, cleared: true },
  ]);
  expect(await page.evaluate(() => window.headingHostMapped)).toBeGreaterThanOrEqual(2);
  expect(
    await page.evaluate(() =>
      window
        .__semloRequireFixture("headingHostKey")
        .getState(window.__semloRequireFixture("numberedHeadingEditor").editor.state),
    ),
  ).toEqual({
    version: 42,
  });
  expect(await page.evaluate(() => window.numberedHeadingChanges)).toBe(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("host filters and append hooks run only for the final atomic conversion", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'numbered-heading-editor'
      document.body.append(host)
      window.numberedHeadingChanges = 0
      window.headingFilterCount = 0
      window.headingAppendCount = 0
      const custom = Extension.create({
        name: 'heading-host-append-probe',
        addProseMirrorPlugins() {
          return [new Plugin({
            filterTransaction(tr) {
              if (!tr.docChanged) return true
              window.headingFilterCount++
              let headings = 0
              tr.doc.descendants(node => { if (node.type.name === 'heading') headings++ })
              return headings !== 1
            },
            appendTransaction(transactions, _oldState, state) {
              if (transactions.some(tr => tr.docChanged) && !transactions.some(tr => tr.getMeta('heading-host-appended'))) {
                window.headingAppendCount++
                return state.tr.setMeta('heading-host-appended', true)
              }
              return null
            },
          })]
        },
      })
      window.numberedHeadingEditor = createEditor({
        element: host, outline: false,
        content: '<ul><li><p>祖父</p><ul><li><p>父列表</p><ul><li><p>孙列表</p></li></ul></li><li><p>同级</p></li></ul></li></ul>',
        extensions: [custom], onChange: () => { window.numberedHeadingChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.numberedHeadingEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await select(page, "父列表", "孙列表");
  await page.evaluate(() => {
    window.headingFilterCount = 0;
    window.headingAppendCount = 0;
  });
  const selection = await page.evaluate(() =>
    window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection.toJSON(),
  );
  await shortcut(page, 3);
  const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  expect(after).not.toEqual(before);
  await expect(page.locator("#numbered-heading-editor .semlo-editor-prose > h3")).toHaveCount(2);
  expect(await page.evaluate(() => window.numberedHeadingChanges)).toBe(1);
  expect(
    await page.evaluate(() => ({
      filter: window.__semloRequireFixture("headingFilterCount"),
      append: window.__semloRequireFixture("headingAppendCount"),
    })),
  ).toEqual({ filter: 1, append: 1 });
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(
    await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection.toJSON()),
  ).toEqual(selection);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    after,
  );
});

async function mount(page: Page, content: string) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'numbered-heading-editor'
      document.body.append(host)
      window.numberedHeadingChanges = 0
      window.numberedHeadingEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        onChange: () => { window.numberedHeadingChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.numberedHeadingEditor));
  return page.locator("#numbered-heading-editor");
}

async function select(page: Page, text: string, endText = text, startOffset = 0, endOffset?: number, backward = false) {
  await page.evaluate(
    ({ text, endText, startOffset, endOffset, backward }) => {
      const editor = window.__semloRequireFixture("numberedHeadingEditor").editor;
      const matches: Array<{ text: string; from: number; to: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock) matches.push({ text: node.textContent, from: pos + 1, to: pos + node.nodeSize - 1 });
      });
      const first = matches.find((item) => item.text === text);
      const last = matches.find((item) => item.text === endText);
      if (!first || !last) throw new Error("Missing selected block");
      editor.view.focus();
      const from = first.from + startOffset;
      const to = endOffset === undefined ? last.to : last.from + endOffset;
      editor.commands.setTextSelection({ from: backward ? to : from, to: backward ? from : to });
    },
    { text, endText, startOffset, endOffset, backward },
  );
}

async function caret(page: Page, text: string, offset = 0) {
  await select(page, text, text, offset, offset);
}

async function shortcut(page: Page, level: number) {
  await page.keyboard.press(`ControlOrMeta+Alt+${level}`);
}

const threeItems = "<ul><li><p>第一项</p></li><li><p>第二项</p></li><li><p>第三项</p></li></ul>";

test("converting one list item preserves surrounding lists and undo/redo", async ({ page }) => {
  const host = await mount(page, threeItems);
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await caret(page, "第二项");
  await shortcut(page, 3);
  await expect(host.locator(".semlo-editor-prose > ul")).toHaveCount(2);
  await expect(host.locator(".semlo-editor-prose > ul").nth(0).locator("li")).toHaveText(["第一项"]);
  await expect(host.locator(".semlo-editor-prose > ul").nth(1).locator("li")).toHaveText(["第三项"]);
  const heading = host.locator(".semlo-editor-prose > h3");
  await expect(heading.locator(".semlo-editor-heading-number")).toHaveText("1. ");
  await expect(heading).toHaveAttribute("data-semlo-editor-heading-numbering", "mixed");
  const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    after,
  );
});

test("splitting an ordered list numbers remaining items consecutively", async ({ page }) => {
  const host = await mount(page, "<ol><li><p>第一项</p></li><li><p>第二项</p></li><li><p>第三项</p></li></ol>");
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await caret(page, "第二项");
  await shortcut(page, 3);
  const lists = host.locator(".semlo-editor-prose > ol");
  await expect(lists).toHaveCount(2);
  expect(await lists.nth(0).evaluate((list) => (list as HTMLOListElement).start)).toBe(1);
  await expect(lists.nth(1)).toHaveAttribute("start", "2");
  await expect(lists.nth(1).locator("li")).toHaveText("第三项");
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(lists.nth(1)).toHaveAttribute("start", "2");
});

test("a custom-start ordered list continues after converting its middle item", async ({ page }) => {
  const host = await mount(
    page,
    '<ol start="7"><li><p>第七项</p></li><li><p>第八项</p></li><li><p>第九项</p></li></ol>',
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await caret(page, "第八项", 1);
  await shortcut(page, 3);
  const lists = host.locator(".semlo-editor-prose > ol");
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0)).toHaveAttribute("start", "7");
  await expect(lists.nth(0).locator("li")).toHaveText("第七项");
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
  await expect(lists.nth(1)).toHaveAttribute("start", "8");
  await expect(lists.nth(1).locator("li")).toHaveText("第九项");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection.$from.parentOffset,
    ),
  ).toBe(1);
  const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    after,
  );
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection.$from.parentOffset,
    ),
  ).toBe(1);
});

for (const backward of [false, true]) {
  test(`multiple custom-start list items preserve the ${backward ? "backward" : "forward"} selection`, async ({
    page,
  }) => {
    const host = await mount(
      page,
      '<ol start="7"><li><p>甲甲</p></li><li><p>乙乙</p></li><li><p>丙丙</p></li><li><p>丁丁</p></li></ol>',
    );
    const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
    await select(page, "乙乙", "丙丙", 1, 1, backward);
    await shortcut(page, 3);
    const lists = host.locator(".semlo-editor-prose > ol");
    await expect(lists.nth(0)).toHaveAttribute("start", "7");
    await expect(lists.nth(0).locator("li")).toHaveText("甲甲");
    await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText(["1. ", "2. "]);
    await expect(lists.nth(1)).toHaveAttribute("start", "8");
    await expect(lists.nth(1).locator("li")).toHaveText("丁丁");
    const selection = async () =>
      page.evaluate(() => {
        const { state } = window.__semloRequireFixture("numberedHeadingEditor").editor;
        return {
          backward: state.selection.anchor > state.selection.head,
          text: state.doc.textBetween(state.selection.from, state.selection.to, "|"),
        };
      });
    expect(await selection()).toEqual({ backward, text: "乙|丙" });
    const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
      before,
    );
    expect(await selection()).toEqual({ backward, text: "乙|丙" });
    expect(
      await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
      after,
    );
    expect(await selection()).toEqual({ backward, text: "乙|丙" });
  });
}

test("converting the deepest child leaves its ancestors and parent's sibling at their original levels", async ({
  page,
}) => {
  const host = await mount(
    page,
    "<ul><li><p><strong>祖父</strong></p><ul><li><p><em>父列表</em></p><ul><li><p>孙列表</p></li></ul></li><li><p>同级</p></li></ul></li></ul>",
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await caret(page, "孙列表", 2);
  await shortcut(page, 3);
  const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  expect(after).not.toEqual(before);
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
  await expect(host.locator(".semlo-editor-prose li strong")).toHaveText("祖父");
  await expect(host.locator(".semlo-editor-prose li em")).toHaveText("父列表");
  const info = await host.getByText("同级", { exact: true }).evaluate((element) => {
    const item = element.closest("li")!;
    return {
      indent: item.getAttribute("data-semlo-editor-list-indent"),
      nested: !!item.parentElement?.closest("li"),
      marker: getComputedStyle(item).listStyleType,
    };
  });
  expect(info.indent === "1" || info.nested).toBe(true);
  expect(info.marker).toBe("circle");
  expect(
    await page.evaluate(() => {
      const { $from } = window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection;
      return { parent: $from.parent.textContent, offset: $from.parentOffset };
    }),
  ).toEqual({ parent: "孙列表", offset: 2 });
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    after,
  );
});

for (const backward of [false, true]) {
  for (const partial of [false, true]) {
    test(`converting a parent and grandchild preserves ${backward ? "backward" : "forward"} ${partial ? "partial" : "full"} selection`, async ({
      page,
    }) => {
      const host = await mount(
        page,
        "<ul><li><p><strong>祖父</strong></p><ul><li><p>父列表</p><ul><li><p>孙列表</p></li></ul></li><li><p><em>同级</em></p></li></ul></li></ul>",
      );
      const before = await page.evaluate(
        () => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json,
      );
      await select(page, "父列表", "孙列表", partial ? 1 : 0, partial ? 2 : undefined, backward);
      const originalSelection = await page.evaluate(() => {
        const { $anchor, $head } = window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection;
        return {
          anchor: $anchor.parent.textContent,
          anchorOffset: $anchor.parentOffset,
          head: $head.parent.textContent,
          headOffset: $head.parentOffset,
        };
      });
      await shortcut(page, 3);
      const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
      expect(after).not.toEqual(before);
      await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText(["1. ", "2. "]);
      await expect(host.locator(".semlo-editor-prose li strong")).toHaveText("祖父");
      await expect(host.locator('.semlo-editor-prose li[data-semlo-editor-list-indent="1"] em')).toHaveText("同级");
      expect(await page.evaluate(() => window.numberedHeadingChanges)).toBe(1);
      expect(
        await page.evaluate(() => {
          const { $anchor, $head } = window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection;
          return {
            anchor: $anchor.parent.textContent,
            anchorOffset: $anchor.parentOffset,
            head: $head.parent.textContent,
            headOffset: $head.parentOffset,
          };
        }),
      ).toEqual(originalSelection);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo()),
      ).toBe(true);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json),
      ).toEqual(before);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo()),
      ).toBe(true);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json),
      ).toEqual(after);
    });
  }
}

test("converting three selected nested generations keeps the sibling as a second-level bullet", async ({ page }) => {
  const host = await mount(
    page,
    "<ul><li><p>祖父</p><ul><li><p>父列表</p><ul><li><p>孙列表</p></li></ul></li><li><p><em>同级</em></p></li></ul></li></ul>",
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await select(page, "祖父", "孙列表");
  await shortcut(page, 3);
  const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  expect(after).not.toEqual(before);
  const headings = host.locator(".semlo-editor-prose > h3");
  await expect(headings.locator(".semlo-editor-heading-number")).toHaveText(["1. ", "2. ", "3. "]);
  expect(
    await page.evaluate(() => {
      const { state } = window.__semloRequireFixture("numberedHeadingEditor").editor;
      return state.doc.textBetween(state.selection.from, state.selection.to, "|");
    }),
  ).toBe("祖父|父列表|孙列表");
  const sibling = host.locator('.semlo-editor-prose li[data-semlo-editor-list-indent="1"]');
  await expect(sibling.locator("em")).toHaveText("同级");
  await expect(sibling).toHaveCSS("list-style-type", "circle");
  expect(await page.evaluate(() => window.numberedHeadingChanges)).toBe(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    after,
  );
});

test("a selected nested parent keeps its other paragraph and non-text block in order", async ({ page }) => {
  const host = await mount(
    page,
    "<ul><li><p>祖父</p><ul><li><p>父列表</p><p><strong>补充</strong></p><hr><ul><li><p><em>孙列表</em></p></li></ul></li><li><p>同级</p></li></ul></li></ul>",
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await caret(page, "父列表", 1);
  await shortcut(page, 3);
  const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  expect(after).not.toEqual(before);
  expect(
    await page.evaluate(() => {
      const nodes: string[] = [];
      window.__semloRequireFixture("numberedHeadingEditor").editor.state.doc.descendants((node) => {
        if (node.isTextblock) nodes.push(node.textContent);
        if (node.type.name === "horizontalRule") nodes.push("<hr>");
      });
      return nodes;
    }),
  ).toEqual(["祖父", "父列表", "补充", "<hr>", "孙列表", "同级"]);
  await expect(host.locator(".semlo-editor-prose strong")).toHaveText("补充");
  await expect(host.locator(".semlo-editor-prose em")).toHaveText("孙列表");
  await expect(host.locator(".semlo-editor-prose hr")).toHaveCount(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    after,
  );
});

test("a four-level nested parent retains the effective depth of descendants and siblings", async ({ page }) => {
  const host = await mount(
    page,
    "<ul><li><p>甲</p><ul><li><p>乙</p><ul><li><p>丙</p><ul><li><p><em>丁</em></p></li></ul></li><li><p>丙同级</p></li></ul></li><li><p>乙同级</p></li></ul></li></ul>",
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await caret(page, "丙", 1);
  await shortcut(page, 3);
  const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  expect(after).not.toEqual(before);
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
  for (const [text, indent, marker] of [
    ["丁", "3", "disc"],
    ["丙同级", "2", "square"],
    ["乙同级", "1", "circle"],
  ] as const) {
    const item = host
      .locator(`.semlo-editor-prose li[data-semlo-editor-list-indent="${indent}"]`)
      .filter({ hasText: text });
    await expect(item).toHaveCount(1);
    await expect(item).toHaveCSS("list-style-type", marker);
  }
  await expect(host.locator('.semlo-editor-prose li[data-semlo-editor-list-indent="3"] em')).toHaveText("丁");
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    after,
  );
});

test("an unselected blockquote subtree remains structurally unchanged when its parent becomes a heading", async ({
  page,
}) => {
  await mount(
    page,
    "<ul><li><p>祖父</p><ul><li><p>父列表</p><blockquote><p><strong>引用内容</strong></p></blockquote><ul><li><p>孙列表</p></li></ul></li><li><p>同级</p></li></ul></li></ul>",
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  const quote = await page.evaluate(() => {
    let result: unknown;
    window.__semloRequireFixture("numberedHeadingEditor").editor.state.doc.descendants((node) => {
      if (node.type.name === "blockquote") result = node.toJSON();
    });
    return result;
  });
  await caret(page, "父列表");
  await shortcut(page, 3);
  const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  expect(after).not.toEqual(before);
  expect(
    await page.evaluate(() => {
      let result: unknown;
      window.__semloRequireFixture("numberedHeadingEditor").editor.state.doc.descendants((node) => {
        if (node.type.name === "blockquote") result = node.toJSON();
      });
      return result;
    }),
  ).toEqual(quote);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    after,
  );
});

for (const [name, first, last, remaining] of [
  ["first", "甲", "甲", ["乙", "丙"]],
  ["last", "丙", "丙", ["甲", "乙"]],
  ["all", "甲", "丙", []],
] as const) {
  test(`converting ${name} in a custom-start list retains the remaining start`, async ({ page }) => {
    const host = await mount(page, '<ol start="7"><li><p>甲</p></li><li><p>乙</p></li><li><p>丙</p></li></ol>');
    await select(page, first, last);
    await shortcut(page, 3);
    const list = host.locator(".semlo-editor-prose > ol");
    if (remaining.length) {
      await expect(list).toHaveCount(1);
      await expect(list).toHaveAttribute("start", "7");
      await expect(list.locator("li")).toHaveText([...remaining]);
    } else {
      await expect(list).toHaveCount(0);
      await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText([
        "1. ",
        "2. ",
        "3. ",
      ]);
    }
  });
}

test("a single-item custom-start list converts without leaving an empty list", async ({ page }) => {
  const host = await mount(page, '<ol start="7"><li><p>甲</p></li></ol>');
  await caret(page, "甲");
  await shortcut(page, 3);
  await expect(host.locator(".semlo-editor-prose > ol")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
});

for (const start of [-2147483648, -3, 0, 2147483645]) {
  test(`custom ordered-list start ${start} stays consecutive`, async ({ page }) => {
    const host = await mount(page, `<ol start="${start}"><li><p>甲</p></li><li><p>乙</p></li><li><p>丙</p></li></ol>`);
    await caret(page, "乙");
    await shortcut(page, 3);
    const lists = host.locator(".semlo-editor-prose > ol");
    await expect(lists).toHaveCount(2);
    expect(await lists.nth(0).evaluate((list) => (list as HTMLOListElement).start)).toBe(start);
    expect(await lists.nth(1).evaluate((list) => (list as HTMLOListElement).start)).toBe(start + 1);
    await expect(lists.nth(1).locator("li")).toHaveText("丙");
  });
}

test("a blank custom-start item can become a heading without losing the following blank item", async ({ page }) => {
  const host = await mount(
    page,
    '<ol start="7"><li><p>甲</p></li><li><p></p></li><li><p></p></li><li><p>丁</p></li></ol>',
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await caret(page, "");
  await shortcut(page, 3);
  const lists = host.locator(".semlo-editor-prose > ol");
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
  await expect(lists.nth(1)).toHaveAttribute("start", "8");
  await expect(lists.nth(1).locator("li")).toHaveText(["", "丁"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
});

for (const [name, html] of [
  ["nested item", '<ol start="7"><li><p>甲</p><ul><li><p>子</p></li></ul></li><li><p>乙</p></li></ol>'],
  ["custom list in blockquote", '<blockquote><ol start="7"><li><p>甲</p></li><li><p>乙</p></li></ol></blockquote>'],
  ["multiple blocks", '<ol start="7"><li><p>甲</p><p>补充</p></li><li><p>乙</p></li></ol>'],
  [
    "nested list with multiple blocks",
    '<ul><li><p>甲</p><ol start="7"><li><p>乙</p><p>额外内容</p></li></ol></li></ul>',
  ],
  ["out-of-range end", '<ol start="2147483647"><li><p>甲</p></li><li><p>乙</p></li></ol>'],
] as const) {
  test(`an unsafe custom-start ordered list is left intact: ${name}`, async ({ page }) => {
    await mount(page, html);
    const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
    await caret(page, "乙");
    await shortcut(page, 3);
    expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
      before,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo()),
    ).toBe(false);
  });
}

for (const start of [0.5, 2147483648, -2147483649]) {
  test(`an invalid custom ordered-list start ${start} is left intact`, async ({ page }) => {
    await mount(page, "<p>初始</p>");
    await page.evaluate((value) => {
      window.__semloRequireFixture("numberedHeadingEditor").editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: value },
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] },
            ],
          },
        ],
      });
    }, start);
    const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
    await caret(page, "乙");
    await shortcut(page, 3);
    expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
      before,
    );
  });
}

test("three selected list items become consecutive numbered headings without losing the selection", async ({
  page,
}) => {
  const host = await mount(page, threeItems);
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await select(page, "第一项", "第三项");
  await shortcut(page, 3);
  const headings = host.locator(".semlo-editor-prose > h3");
  await expect(headings).toHaveCount(3);
  await expect(headings.locator(".semlo-editor-heading-number")).toHaveText(["1. ", "2. ", "3. "]);
  const selection = await page.evaluate(() => {
    const { state } = window.__semloRequireFixture("numberedHeadingEditor").editor;
    return state.doc.textBetween(state.selection.from, state.selection.to, "|");
  });
  expect(selection).toBe("第一项|第二项|第三项");
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("a mixed paragraph and list selection retains source-specific numbering", async ({ page }) => {
  const host = await mount(page, "<p>正文</p><ul><li><p>列表一</p></li><li><p>列表二</p></li></ul><p>末段</p>");
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await select(page, "正文", "列表二");
  await shortcut(page, 3);
  const headings = host.locator(".semlo-editor-prose > h3");
  await expect(headings).toHaveCount(3);
  await expect(headings.nth(0).locator(".semlo-editor-heading-number")).toHaveCount(0);
  await expect(headings.locator(".semlo-editor-heading-number")).toHaveText(["1. ", "2. "]);
  await expect(host.locator(".semlo-editor-prose > p")).toHaveText("末段");
  expect(
    await page.evaluate(() => {
      const { state } = window.__semloRequireFixture("numberedHeadingEditor").editor;
      return state.doc.textBetween(state.selection.from, state.selection.to, "|");
    }),
  ).toBe("正文|列表一|列表二");
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("a backward mixed selection stays backward after conversion and undo", async ({ page }) => {
  const host = await mount(page, "<p>正文</p><ul><li><p>列表一</p></li><li><p>列表二</p></li></ul>");
  await select(page, "正文", "列表二", 0, undefined, true);
  await shortcut(page, 3);
  await expect(host.locator(".semlo-editor-prose > h3")).toHaveCount(3);
  const after = await page.evaluate(() => {
    const { state } = window.__semloRequireFixture("numberedHeadingEditor").editor;
    return {
      backward: state.selection.anchor > state.selection.head,
      text: state.doc.textBetween(state.selection.from, state.selection.to, "|"),
    };
  });
  expect(after).toEqual({ backward: true, text: "正文|列表一|列表二" });
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection.anchor >
        window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection.head,
    ),
  ).toBe(true);
});

test("numbered headings split in the middle and create a paragraph at the end", async ({ page }) => {
  const host = await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">甲乙丙丁</h3>');
  await caret(page, "甲乙丙丁", 2);
  await page.keyboard.press("Enter");
  await expect(host.locator(".semlo-editor-prose > h3")).toHaveCount(2);
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText(["1. ", "2. "]);
  await caret(page, "丙丁", 2);
  await page.keyboard.press("Enter");
  await expect(host.locator(".semlo-editor-prose > p")).toHaveCount(1);
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText(["1. ", "2. "]);
});

test("backspace first removes the number, then turns the heading into a paragraph", async ({ page }) => {
  const host = await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed"><em>标题文字</em></h3>');
  await caret(page, "标题文字");
  await page.keyboard.press("Backspace");
  await expect(host.locator(".semlo-editor-prose > h3")).toHaveText("标题文字");
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose > h3 em")).toHaveText("标题文字");
  await page.keyboard.press("Backspace");
  await expect(host.locator(".semlo-editor-prose > p em")).toHaveText("标题文字");
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
});

test("heading style inheritance follows previous same-level heading and stops at plain peers or ancestors", async ({
  page,
}) => {
  const host = await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">编号一</h3><p>中间正文</p><p>继承正文</p><h2>上级</h2><p>重新开始</p>',
  );
  await caret(page, "继承正文");
  await shortcut(page, 3);
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText(["1. ", "2. "]);
  await caret(page, "重新开始");
  await shortcut(page, 3);
  await expect(host.locator(".semlo-editor-prose > h3").last().locator(".semlo-editor-heading-number")).toHaveCount(0);
});

test("ordinary same-level headings keep the count; ordinary higher headings reset lower counts", async ({ page }) => {
  const host = await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">编号甲</h3><h3>普通同级</h3><ul><li><p>编号乙</p></li></ul><h2>普通上级</h2><ul><li><p>编号丙</p></li></ul>',
  );
  await caret(page, "编号乙");
  await shortcut(page, 3);
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "2. "]);
  await caret(page, "编号丙");
  await shortcut(page, 3);
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "2. ", "1. "]);
});

test("number style rank responds to numbered levels anywhere in the document", async ({ page }) => {
  const host = await mount(
    page,
    '<h1 data-semlo-editor-heading-numbering="mixed">一</h1><h3 data-semlo-editor-heading-numbering="mixed">三</h3><p>二</p>',
  );
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "a. "]);
  await caret(page, "二");
  // A list origin opts this new level into numbering.
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("numberedHeadingEditor").editor;
    editor.chain().focus().toggleBulletList().run();
  });
  await shortcut(page, 2);
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "ⅰ. ", "a. "]);
  await caret(page, "二");
  await page.keyboard.press("Backspace");
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "a. "]);
});

for (const [style, expected] of [
  ["mixed", ["1. ", "a. ", "ⅰ. "]],
  ["decimal", ["1. ", "1.1. ", "1.1.1. "]],
  ["chinese", ["一、 ", "(一) ", "1. "]],
] as const) {
  test(`the observed first three levels display the ${style} numbering style`, async ({ page }) => {
    const host = await mount(
      page,
      `<h1 data-semlo-editor-heading-numbering="${style}">甲</h1><h2 data-semlo-editor-heading-numbering="${style}">乙</h2><h3 data-semlo-editor-heading-numbering="${style}">丙</h3>`,
    );
    await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText([...expected]);
    expect(
      (
        await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)
      ).content?.map((node) => node.attrs?.semloEditorHeadingNumbering),
    ).toEqual([style, style, style]);
  });
}

test("numbered HTML is standalone-visible and JSON/HTML imports do not duplicate text", async ({ page }) => {
  const host = await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">标题文字</h3>');
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot());
  expect(snapshot.text).toBe("标题文字");
  const standalone = await page.evaluate((html) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.querySelector("h3")?.textContent;
  }, snapshot.html);
  expect(standalone).toBe("1. 标题文字");
  expect(snapshot.html).toContain("data-semlo-editor-heading-marker");
  const roundtrip = await page.evaluate((html) => {
    const controller = window.__semloRequireFixture("numberedHeadingEditor");
    const beforeChanges = window.__semloRequireFixture("numberedHeadingChanges");
    controller.setContent(html);
    return {
      snapshot: controller.getSnapshot(),
      changes: window.__semloRequireFixture("numberedHeadingChanges") - beforeChanges,
    };
  }, snapshot.html);
  expect(roundtrip.snapshot.json).toEqual(snapshot.json);
  expect(roundtrip.snapshot.text).toBe(snapshot.text);
  expect(roundtrip.changes).toBe(0);
  await expect(host.getByRole("heading", { name: /1\.\s*标题文字/ })).toBeVisible();
});

test("copying numbered heading text leaves the generated marker out of plain text", async ({ page }) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">标题文字</h3>');
  await select(page, "标题文字");
  const copied = await page.evaluate(() => {
    const transfer = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: transfer });
    window.__semloRequireFixture("numberedHeadingEditor").editor.view.dom.dispatchEvent(event);
    return { text: transfer.getData("text/plain"), html: transfer.getData("text/html") };
  });
  expect(copied.text).toBe("标题文字");
  expect(copied.html).toContain('data-semlo-editor-heading-numbering="mixed"');
});

test("the numbered marker stays attached while typing in its heading", async ({ page }) => {
  const host = await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">标题文字</h3>');
  await caret(page, "标题文字", 4);
  const same = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("numberedHeadingEditor").editor;
    const marker = editor.view.dom.querySelector(".semlo-editor-heading-number");
    editor.commands.insertContent("甲");
    return marker === editor.view.dom.querySelector(".semlo-editor-heading-number");
  });
  expect(same).toBe(true);
  await expect(host.locator(".semlo-editor-prose h3 .semlo-editor-heading-number")).toHaveText("1. ");
});

test("separate editors calculate numbered levels independently", async ({ page }) => {
  const first = await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">甲</h3>');
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'numbered-heading-second'
      document.body.append(host)
      window.numberedHeadingSecond = createEditor({ element: host, outline: false, content: '<h1 data-semlo-editor-heading-numbering="mixed">乙</h1><h3 data-semlo-editor-heading-numbering="mixed">丙</h3>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.numberedHeadingSecond));
  await expect(first.locator(".semlo-editor-heading-number")).toHaveText("1. ");
  await expect(page.locator("#numbered-heading-second .semlo-editor-heading-number")).toHaveText(["1. ", "a. "]);
  await caret(page, "甲", 1);
  await page.keyboard.type("新");
  await expect(first.locator(".semlo-editor-heading-number")).toHaveText("1. ");
  await expect(page.locator("#numbered-heading-second .semlo-editor-heading-number")).toHaveText(["1. ", "a. "]);
});

for (const selected of ["父列表", "子列表一"] as const) {
  test(`converting ${selected} retains unselected flat indented list items`, async ({ page }) => {
    const host = await mount(
      page,
      '<ul><li><p>父列表</p></li><li data-semlo-editor-list-indent="1"><p>子列表一</p></li><li data-semlo-editor-list-indent="1"><p>子列表二</p></li></ul>',
    );
    const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
    await caret(page, selected);
    await shortcut(page, 3);
    await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
    const second = host
      .locator('.semlo-editor-prose li[data-semlo-editor-list-indent="1"]')
      .filter({ hasText: "子列表二" });
    await expect(second).toBeVisible();
    await expect(second).toHaveCSS("list-style-type", "circle");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
      before,
    );
  });
}

test("converting a three-level nested parent preserves descendants, siblings, selection and history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const host = await mount(
    page,
    '<ul><li><p><strong>祖父</strong></p><ul><li><p>父列表</p><ul><li><p><em>孙列表</em></p></li></ul></li><li><p><a href="https://example.com">同级</a></p></li></ul></li></ul>',
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  const retainedBlocks = () =>
    page.evaluate(() => {
      const result: unknown[] = [];
      window.__semloRequireFixture("numberedHeadingEditor").editor.state.doc.descendants((node) => {
        if (node.isTextblock && ["祖父", "孙列表", "同级"].includes(node.textContent)) result.push(node.toJSON());
      });
      return result;
    });
  const beforeBlocks = await retainedBlocks();
  await caret(page, "父列表", 1);
  await shortcut(page, 3);
  const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  expect(after).not.toEqual(before);
  await expect(host.locator(".semlo-editor-prose > h3")).toContainText("父列表");
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
  expect(
    await page.evaluate(() => {
      const blocks: string[] = [];
      window.__semloRequireFixture("numberedHeadingEditor").editor.state.doc.descendants((node) => {
        if (node.isTextblock) blocks.push(node.textContent);
      });
      return blocks;
    }),
  ).toEqual(["祖父", "父列表", "孙列表", "同级"]);
  expect(await retainedBlocks()).toEqual(beforeBlocks);
  for (const [text, level, marker] of [
    ["祖父", 0, "disc"],
    ["孙列表", 2, "square"],
    ["同级", 1, "circle"],
  ] as const) {
    const info = await host.getByText(text, { exact: true }).evaluate((element) => {
      const item = element.closest("li")!;
      let depth = 0;
      let current: Element | null = item;
      while (current) {
        depth += Number(current.getAttribute("data-semlo-editor-list-indent") || 0);
        const parent: Element | null = current.parentElement?.closest("li") ?? null;
        if (parent) depth += 1;
        current = parent;
      }
      return { depth, marker: getComputedStyle(item).listStyleType };
    });
    expect(info).toEqual({ depth: level, marker });
  }
  expect(
    await page.evaluate(() => {
      const { $from } = window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection;
      return { parent: $from.parent.textContent, offset: $from.parentOffset };
    }),
  ).toEqual({ parent: "父列表", offset: 1 });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    after,
  );
});

for (const backward of [false, true]) {
  test(`converting a selected grandparent and parent preserves the ${backward ? "backward" : "forward"} selection and descendants`, async ({
    page,
  }) => {
    const host = await mount(
      page,
      "<ul><li><p>祖父</p><ul><li><p>父列表</p><ul><li><p><em>孙列表</em></p></li></ul></li><li><p><strong>同级</strong></p></li></ul></li></ul>",
    );
    const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
    await select(page, "祖父", "父列表", 0, undefined, backward);
    const originalSelection = await page.evaluate(() => {
      const { $anchor, $head } = window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection;
      return {
        anchor: $anchor.parent.textContent,
        anchorOffset: $anchor.parentOffset,
        head: $head.parent.textContent,
        headOffset: $head.parentOffset,
      };
    });
    await shortcut(page, 3);
    const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
    expect(after).not.toEqual(before);
    const headings = host.locator(".semlo-editor-prose > h3");
    await expect(headings).toHaveCount(2);
    await expect(headings.locator(".semlo-editor-heading-number")).toHaveText(["1. ", "2. "]);
    expect(
      await page.evaluate(() => {
        const blocks: string[] = [];
        window.__semloRequireFixture("numberedHeadingEditor").editor.state.doc.descendants((node) => {
          if (node.isTextblock) blocks.push(node.textContent);
        });
        return blocks;
      }),
    ).toEqual(["祖父", "父列表", "孙列表", "同级"]);
    await expect(host.locator(".semlo-editor-prose li em")).toHaveText("孙列表");
    await expect(host.locator(".semlo-editor-prose li strong")).toHaveText("同级");
    await expect(host.locator('.semlo-editor-prose li[data-semlo-editor-list-indent="2"]')).toContainText("孙列表");
    await expect(host.locator('.semlo-editor-prose li[data-semlo-editor-list-indent="1"]')).toContainText("同级");
    expect(
      await page.evaluate(() => {
        const { $anchor, $head } = window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection;
        return {
          anchor: $anchor.parent.textContent,
          anchorOffset: $anchor.parentOffset,
          head: $head.parent.textContent,
          headOffset: $head.parentOffset,
        };
      }),
    ).toEqual(originalSelection);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
      before,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
      after,
    );
  });
}

test("nested list visual depth includes both ancestor and child indent attributes", async ({ page }) => {
  const host = await mount(
    page,
    '<ul><li data-semlo-editor-list-indent="3"><p>父列表</p><ul><li><p>目标</p></li><li data-semlo-editor-list-indent="1"><p><em>保留项</em></p></li></ul></li></ul>',
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await caret(page, "目标");
  await shortcut(page, 3);
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
  const preserved = host.locator('.semlo-editor-prose li[data-semlo-editor-list-indent="5"]');
  await expect(preserved.locator("em")).toHaveText("保留项");
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("unselected nodes and host-owned decorations keep their text positions through conversion", async ({ page }) => {
  const host = await mount(
    page,
    '<p>前段</p><ul><li><p>第一项</p></li><li><p>目标</p></li><li data-semlo-editor-list-indent="1"><p><em>保留项</em></p></li></ul><ol start="3"><li><p>其他列表</p></li></ol>',
  );
  await page.addScriptTag({
    type: "module",
    content: `import { attachCodeIndentDecoration } from '/dist/index.js'; window.attachNumberedHeadingProbe = attachCodeIndentDecoration`,
  });
  await page.waitForFunction(() => Boolean(window.attachNumberedHeadingProbe));
  const before = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("numberedHeadingEditor");
    let position = 0;
    controller.editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "保留项") position = pos;
    });
    window.__semloRequireFixture("attachNumberedHeadingProbe").bind(window)(controller, position, position + 3);
    return controller.getSnapshot().json;
  });
  await caret(page, "目标", 1);
  await shortcut(page, 3);
  await expect(host.locator(".indent-probe")).toHaveText("保留项");
  await expect(host.locator('.semlo-editor-prose li[data-semlo-editor-list-indent="1"] em')).toHaveText("保留项");
  await expect(host.locator(".semlo-editor-prose > ol")).toHaveAttribute("start", "3");
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  await expect(host.locator(".indent-probe")).toHaveText("保留项");
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(host.locator(".indent-probe")).toHaveText("保留项");
});

test("a nested list that cannot represent its inherited indent is left completely unchanged", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(
    page,
    '<ul><li data-semlo-editor-list-indent="3"><p>父列表</p><ul><li><p>目标</p></li><li data-semlo-editor-list-indent="5"><p><em>保留项</em></p></li></ul></li></ul>',
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
  await caret(page, "目标");
  await shortcut(page, 3);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.numberedHeadingChanges)).toBe(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo())).toBe(
    false,
  );
});

for (const selected of ["父列表", "子列表一"] as const) {
  test(`converting ${selected} preserves text and remaining indent from a real nested list`, async ({ page }) => {
    const host = await mount(
      page,
      "<ul><li><p>父列表</p><ul><li><p>子列表一</p></li><li><p>子列表二</p></li></ul></li></ul>",
    );
    const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
    await caret(page, selected);
    await shortcut(page, 3);
    await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
    const remaining = selected === "父列表" ? ["子列表一", "子列表二"] : ["父列表", "子列表二"];
    const snapshot = await page.evaluate(
      () => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json,
    );
    for (const text of remaining) expect(JSON.stringify(snapshot)).toContain(text);
    const second = host
      .locator(".semlo-editor-prose li")
      .filter({ has: page.getByText("子列表二", { exact: true }) })
      .last();
    const info = await second.evaluate((element) => ({
      level: element.getAttribute("data-semlo-editor-list-indent"),
      nested: element.parentElement?.closest("li") !== null,
      marker: getComputedStyle(element).listStyleType,
    }));
    expect(info.level === "1" || info.nested).toBe(true);
    expect(info.marker).toBe("circle");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json)).toEqual(
      before,
    );
  });
}

for (const [name, wrapper, type] of [
  [
    "callout",
    '<aside data-semlo-editor-callout data-tone="pink"><p>选中正文</p><p><em>容器兄弟</em></p></aside>',
    "callout",
  ],
] as const) {
  test(`selection inside a list item's ${name} keeps the container and unselected blocks without dispatch`, async ({
    page,
  }) => {
    await mount(
      page,
      `<ul><li><p><strong>祖父</strong></p><ul><li><p>父列表</p>${wrapper}<p>父补充</p><ul><li><p>孙列表</p></li></ul></li><li><p>同级</p></li></ul></li></ul>`,
    );
    const before = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
    const retained = () =>
      page.evaluate((kind) => {
        let container: { type: string; attrs: unknown } | undefined;
        const blocks: unknown[] = [];
        window.__semloRequireFixture("numberedHeadingEditor").editor.state.doc.descendants((node) => {
          if (node.type.name === kind) container = { type: node.type.name, attrs: node.attrs };
          if (node.isTextblock && node.textContent !== "选中正文") blocks.push(node.toJSON());
        });
        return { container, blocks };
      }, type);
    const expected = await retained();
    expect(expected.container).toBeDefined();
    await caret(page, "选中正文", 1);
    const selection = await page.evaluate(() =>
      window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection.toJSON(),
    );
    await shortcut(page, 3);
    const after = await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").getSnapshot().json);
    expect(after).toEqual(before);
    expect(await retained()).toEqual(expected);
    expect(await page.evaluate(() => window.numberedHeadingChanges)).toBe(0);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.state.selection.toJSON()),
    ).toEqual(selection);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("numberedHeadingEditor").editor.commands.undo()),
    ).toBe(false);
  });
}
