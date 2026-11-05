import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    restartConversionEditor?: EditorController;
    restartConversionChanges?: number;
  }
}

const labels = ["甲甲", "乙乙", "丙丙", "丁丁", "戊戊", "己己", "庚庚"];

type Case = {
  name: string;
  levels: number[];
  restarts: number[];
  selected: number;
  before: string[];
  after: string[];
};

const cases: Case[] = [
  {
    name: "observed before restart",
    levels: [0, 1, 1, 1],
    restarts: [2],
    selected: 1,
    before: ["1.", "1.1.", "1.1.", "1.2."],
    after: ["1.", "1.1.", "1.2."],
  },
  {
    name: "observed restart itself",
    levels: [0, 1, 1, 1],
    restarts: [2],
    selected: 2,
    before: ["1.", "1.1.", "1.1.", "1.2."],
    after: ["1.", "1.1.", "1.1."],
  },
  {
    name: "later top-level sibling",
    levels: [0, 1, 1, 1, 0],
    restarts: [2],
    selected: 2,
    before: ["1.", "1.1.", "1.1.", "1.2.", "2."],
    after: ["1.", "1.1.", "1.1.", "2."],
  },
  {
    name: "third-level preceding item",
    levels: [0, 1, 2, 2, 2, 1, 0],
    restarts: [3],
    selected: 2,
    before: ["1.", "1.1.", "1.1.1.", "1.1.1.", "1.1.2.", "1.2.", "2."],
    after: ["1.", "1.1.", "1.1.1.", "1.1.2.", "1.2.", "2."],
  },
  {
    name: "third-level restart item",
    levels: [0, 1, 2, 2, 2, 1, 0],
    restarts: [3],
    selected: 3,
    before: ["1.", "1.1.", "1.1.1.", "1.1.1.", "1.1.2.", "1.2.", "2."],
    after: ["1.", "1.1.", "1.1.1.", "1.1.1.", "1.2.", "2."],
  },
  {
    name: "multiple restarts converting the intervening item",
    levels: [0, 1, 1, 1, 1, 1],
    restarts: [2, 4],
    selected: 3,
    before: ["1.", "1.1.", "1.1.", "1.2.", "1.1.", "1.2."],
    after: ["1.", "1.1.", "1.1.", "1.1.", "1.2."],
  },
  {
    name: "multiple restarts converting the first restart",
    levels: [0, 1, 1, 1, 1, 1],
    restarts: [2, 4],
    selected: 2,
    before: ["1.", "1.1.", "1.1.", "1.2.", "1.1.", "1.2."],
    after: ["1.", "1.1.", "1.1.", "1.1.", "1.2."],
  },
  {
    name: "multiple restarts converting the second restart",
    levels: [0, 1, 1, 1, 1, 1],
    restarts: [2, 4],
    selected: 4,
    before: ["1.", "1.1.", "1.1.", "1.2.", "1.1.", "1.2."],
    after: ["1.", "1.1.", "1.1.", "1.2.", "1.1."],
  },
];

function fixture(item: Case): EditorContent {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 1, semloEditorOrderedStyle: "decimal" },
        content: item.levels.map((indent, index) => ({
          type: "listItem",
          attrs: {
            semloEditorListIndent: indent,
            semloEditorListRestart: item.restarts.includes(index),
            ...(index !== item.selected && (index === 0 || index === item.levels.length - 1)
              ? { semloEditorHostToken: `host-${index}` }
              : {}),
          },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: labels[index], ...(index === 0 ? { marks: [{ type: "bold" }] } : {}) }],
            },
          ],
        })),
      },
      { type: "paragraph", content: [{ type: "text", text: "末尾", marks: [{ type: "italic" }] }] },
    ],
  };
}

async function mount(page: Page, content: EditorContent, paragraphHost: "none" | "paragraph" | "preserved" = "none") {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'restart-conversion-test'
      document.body.append(host)
      const custom = Extension.create({
        name: 'restartConversionHost',
        addGlobalAttributes() { return [{ types: ['listItem'], attributes: {
          semloEditorHostToken: { default: null,
            parseHTML: element => element.getAttribute('data-host-token'),
            renderHTML: attrs => attrs.semloEditorHostToken === null ? {} : { 'data-host-token': attrs.semloEditorHostToken },
          },
        } }] },
      })
      const paragraphHost = ${JSON.stringify(paragraphHost)}
      const paragraphCustom = Extension.create({
        name: 'restartConversionParagraphHost', priority: 1,
        addGlobalAttributes() { return [{ types: paragraphHost === 'preserved' ? ['paragraph', 'heading'] : ['paragraph'], attributes: {
          semloEditorHostParagraph: { default: null,
            parseHTML: element => element.getAttribute('data-host-paragraph'),
            renderHTML: attrs => attrs.semloEditorHostParagraph === null ? {} : { 'data-host-paragraph': attrs.semloEditorHostParagraph },
          },
        } }] },
        addCommands() {
          if (paragraphHost !== 'preserved') return {}
          return { setHeading: attrs => ({ state, commands }) => commands.setNode('heading', {
            ...attrs, semloEditorHostParagraph: state.selection.$from.parent.attrs.semloEditorHostParagraph,
          }) }
        },
      })
      window.restartConversionChanges = 0
      window.restartConversionEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        extensions: paragraphHost === 'none' ? [custom] : [custom, paragraphCustom],
        onChange: () => { window.restartConversionChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.restartConversionEditor));
  return page.locator("#restart-conversion-test");
}

async function select(page: Page, text: string, anchor: number, head: number) {
  await page.evaluate(
    ({ text, anchor, head }) => {
      const editor = window.__semloRequireFixture("restartConversionEditor").editor;
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === text) at = pos + 1;
      });
      if (at < 0) throw new Error("Missing selected text");
      editor.view.focus();
      editor.commands.setTextSelection({ from: at + anchor, to: at + head });
    },
    { text, anchor, head },
  );
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const controller = window.__semloRequireFixture("restartConversionEditor");
    const { state, view } = controller.editor;
    const blocks: Array<{ text: string; node: JSONContent }> = [];
    const items: Array<{ text: string; attrs: Record<string, unknown> }> = [];
    state.doc.descendants((node) => {
      if (node.isTextblock) blocks.push({ text: node.textContent, node: node.toJSON() });
      if (node.type.name === "listItem")
        items.push({ text: node.firstChild?.textContent ?? "", attrs: { ...node.attrs } });
    });
    return {
      ...controller.getSnapshot(),
      blocks,
      items,
      selection: {
        anchorText: state.selection.$anchor.parent.textContent,
        anchorOffset: state.selection.$anchor.parentOffset,
        headText: state.selection.$head.parent.textContent,
        headOffset: state.selection.$head.parentOffset,
      },
      focused: view.hasFocus(),
      changes: window.__semloRequireFixture("restartConversionChanges"),
    };
  });
}

async function markers(page: Page) {
  return page.locator("#restart-conversion-test .semlo-editor-prose li").evaluateAll((items) =>
    items.map((element) => ({
      text: Array.from(element.children).find((child) => child.tagName === "P")?.textContent,
      marker: getComputedStyle(element).listStyleType,
    })),
  );
}

async function convertAndCheck(page: Page, item: Case, anchor: number, head: number, toolbar = false) {
  const host = await mount(page, fixture(item));
  const selected = labels[item.selected];
  await select(page, selected, anchor, head);
  const before = await inspect(page);
  expect((await markers(page)).map((entry) => entry.marker)).toEqual(item.before.map((value) => `"${value} "`));
  if (toolbar) {
    await host.getByRole("button", { name: "段落样式" }).click();
    await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
  } else await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(after.json).not.toEqual(before.json);
  expect(after.changes - before.changes).toBe(1);
  expect(after.focused).toBe(true);
  expect(after.selection).toEqual(before.selection);
  expect(after.blocks.map((block) => block.text)).toEqual(before.blocks.map((block) => block.text));
  expect(after.blocks.filter((block) => block.text !== selected)).toEqual(
    before.blocks.filter((block) => block.text !== selected),
  );
  expect(after.items).toEqual(before.items.filter((entry) => entry.text !== selected));
  expect(after.blocks.find((block) => block.text === selected)?.node).toMatchObject({
    type: "heading",
    attrs: { level: 3, semloEditorHeadingNumbering: "mixed" },
  });
  await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
  expect((await markers(page)).map((entry) => entry.marker)).toEqual(item.after.map((value) => `"${value} "`));
  expect(after.html.includes('data-semlo-editor-list-restart="true"')).toBe(
    item.restarts.some((index) => index !== item.selected),
  );
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await inspect(page);
  expect(undone.json).toEqual(before.json);
  expect(undone.selection).toEqual(before.selection);
  expect(undone.focused).toBe(true);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  const redone = await inspect(page);
  expect(redone.json).toEqual(after.json);
  expect(redone.selection).toEqual(after.selection);
  expect(redone.focused).toBe(true);
  return { before, after };
}

for (const item of cases) {
  test(`${item.name} keeps contents, numbering, caret and one undo/redo`, async ({ page }) => {
    const { after } = await convertAndCheck(page, item, 1, 1);
    for (const saved of [after.html, after.json]) {
      await page.evaluate(
        (content) => window.__semloRequireFixture("restartConversionEditor").setContent(content),
        saved,
      );
      expect((await inspect(page)).json).toEqual(after.json);
      expect((await markers(page)).map((entry) => entry.marker)).toEqual(item.after.map((value) => `"${value} "`));
    }
  });
}

for (const item of cases.slice(0, 2)) {
  for (const [name, anchor, head] of [
    ["forward", 0, 2],
    ["backward", 2, 0],
  ] as const) {
    test(`${item.name} preserves the ${name} text selection`, async ({ page }) => {
      await convertAndCheck(page, item, anchor, head);
    });
  }
  test(`${item.name} converts through the toolbar`, async ({ page }) => {
    await convertAndCheck(page, item, 1, 1, true);
  });
}

for (const variant of [
  "custom-start",
  "level-seed",
  "different-neighbor-level",
  "adjacent-restarts",
  "different-restart-levels",
] as const) {
  test(`unobserved restart structure remains unchanged: ${variant}`, async ({ page }) => {
    const base: Case =
      variant === "different-restart-levels"
        ? { name: variant, levels: [0, 1, 1, 1, 2, 2, 2], restarts: [2, 5], selected: 1, before: [], after: [] }
        : { ...cases[0], levels: [...cases[0].levels], restarts: [...cases[0].restarts] };
    if (variant === "different-neighbor-level") base.levels[3] = 2;
    if (variant === "adjacent-restarts") base.restarts = [2, 3];
    const content = fixture(base) as JSONContent;
    const list = content.content![0];
    if (variant === "custom-start") list.attrs!.start = 7;
    if (variant === "level-seed") list.attrs!.semloEditorListLevelStarts = { 1: 3 };
    await mount(page, content);
    await select(page, labels[base.selected], 1, 1);
    const before = await inspect(page);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await inspect(page);
    expect(after.json).toEqual(before.json);
    expect(after.selection).toEqual(before.selection);
    expect(after.changes).toBe(before.changes);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("restartConversionEditor").editor.commands.undo()),
    ).toBe(false);
  });
}

for (const paragraphHost of ["paragraph", "preserved"] as const) {
  test(`a selected paragraph's host attribute is ${paragraphHost === "preserved" ? "preserved" : "protected by rollback"}`, async ({
    page,
  }) => {
    const item = cases[0];
    const content = fixture(item) as JSONContent;
    const paragraph = content.content![0].content![item.selected].content![0];
    paragraph.attrs = { semloEditorHostParagraph: "secret" };
    const host = await mount(page, content, paragraphHost);
    await select(page, labels[item.selected], 1, 1);
    const before = await inspect(page);
    expect(before.html).toContain('data-host-paragraph="secret"');
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await inspect(page);
    if (paragraphHost === "paragraph") {
      expect(after.json).toEqual(before.json);
      expect(after.selection).toEqual(before.selection);
      expect(after.changes).toBe(before.changes);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("restartConversionEditor").editor.commands.undo()),
      ).toBe(false);
    } else {
      await expect(host.locator(".semlo-editor-prose > h3")).toHaveText("1. 乙乙");
      expect(
        after.blocks.find((block) => block.text === labels[item.selected])?.node.attrs?.semloEditorHostParagraph,
      ).toBe("secret");
      expect(after.html).toContain('data-host-paragraph="secret"');
      expect(after.selection).toEqual(before.selection);
      await page.keyboard.press("ControlOrMeta+z");
      expect((await inspect(page)).json).toEqual(before.json);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      expect((await inspect(page)).json).toEqual(after.json);
    }
  });
}
