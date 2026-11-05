import { expect, test, type Page } from "@rstest/playwright";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    headingRestartEditor?: EditorController;
    headingRestartChanges?: number;
  }
}

const restartedList =
  '<ol data-semlo-editor-ordered-style="decimal">' +
  '<li><p>戊</p></li><li data-semlo-editor-list-indent="1"><p>己</p></li>' +
  '<li data-semlo-editor-list-indent="1" data-semlo-editor-list-restart="true" data-host-token="retain"><p>庚</p></li>' +
  '<li data-semlo-editor-list-indent="1"><p>辛</p></li></ol>';

async function mount(page: Page, content: EditorContent, hostAttributes = false) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'heading-restart-test'
      document.body.append(host)
      const hostExtension = Extension.create({
        name: 'headingRestartHostAttribute',
        addGlobalAttributes() { return [{ types: ['listItem'], attributes: {
          semloEditorHostToken: {
            default: null,
            parseHTML: element => element.getAttribute('data-host-token'),
            renderHTML: attrs => attrs.semloEditorHostToken === null ? {} : { 'data-host-token': attrs.semloEditorHostToken },
          },
        } }] },
      })
      window.headingRestartChanges = 0
      window.headingRestartEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        extensions: ${hostAttributes} ? [hostExtension] : [],
        onChange: () => { window.headingRestartChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.headingRestartEditor));
  return page.locator("#heading-restart-test .semlo-editor-prose");
}

async function select(page: Page, firstText: string, lastText = firstText, backward = false) {
  await page.evaluate(
    ({ firstText, lastText, backward }) => {
      const editor = window.__semloRequireFixture("headingRestartEditor").editor;
      const positions = new Map<string, { from: number; to: number }>();
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock) positions.set(node.textContent, { from: pos + 1, to: pos + node.nodeSize - 1 });
      });
      const first = positions.get(firstText);
      const last = positions.get(lastText);
      if (!first || !last) throw new Error("Missing selected blocks");
      editor.view.focus();
      editor.commands.setTextSelection({ from: backward ? last.to : first.from, to: backward ? first.from : last.to });
    },
    { firstText, lastText, backward },
  );
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const controller = window.__semloRequireFixture("headingRestartEditor");
    const { state, view } = controller.editor;
    return {
      ...controller.getSnapshot(),
      selection: state.selection.toJSON(),
      text: state.doc.textBetween(state.selection.from, state.selection.to, "\n"),
      focused: view.hasFocus(),
      changes: window.headingRestartChanges,
    };
  });
}

for (const [name, first, last, backward] of [
  ["selected restart item", "庚", "庚", false],
  ["unselected following restart item", "戊", "戊", false],
  ["unselected earlier restart item", "辛", "辛", false],
  ["backward selection containing a restart item", "己", "辛", true],
] as const) {
  test(`conversion conservatively leaves the list and selection intact: ${name}`, async ({ page }) => {
    await mount(page, restartedList, true);
    await select(page, first, last, backward);
    const before = await snapshot(page);
    expect(before.focused).toBe(true);
    expect(before.html).toContain('data-semlo-editor-list-restart="true"');
    expect(before.html).toContain('data-host-token="retain"');
    await page.keyboard.press("ControlOrMeta+Alt+3");
    expect(await snapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.__semloRequireFixture("headingRestartEditor").editor.commands.undo())).toBe(
      false,
    );
  });
}

for (const [name, html, text] of [
  [
    "the selected parent's nested ordered list",
    '<ul><li><p>父</p><ol><li data-semlo-editor-list-restart="true"><p>子甲</p></li><li><p>子乙</p></li></ol></li></ul>',
    "父",
  ],
  [
    "an ancestor list of the selected nested item",
    '<ol><li data-semlo-editor-list-restart="true"><p>祖</p><ul><li><p>父</p></li></ul></li></ol>',
    "父",
  ],
] as const) {
  test(`conversion safely retains restart metadata in ${name}`, async ({ page }) => {
    await mount(page, html);
    await select(page, text);
    const before = await snapshot(page);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    expect(await snapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.__semloRequireFixture("headingRestartEditor").editor.commands.undo())).toBe(
      false,
    );
  });
}

test("a different list with restart metadata does not block normal list heading conversion", async ({ page }) => {
  const html = "<ol><li><p>甲</p></li><li><p>乙</p></li></ol><p>隔开</p>" + restartedList;
  const prose = await mount(page, html, true);
  await select(page, "乙");
  const before = await snapshot(page);
  const otherList = before.json.content?.at(-1);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await snapshot(page);
  await expect(prose.locator(":scope > h3")).toHaveText("1. 乙");
  expect(after.json.content?.at(-1)).toEqual(otherList);
  expect(after.html).toContain('data-semlo-editor-list-restart="true"');
  expect(after.html).toContain('data-host-token="retain"');
  expect(after.text).toBe(before.text);
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await snapshot(page);
  expect(undone.json).toEqual(before.json);
  expect(undone.selection).toEqual(before.selection);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("a non-list paragraph can become a heading alongside an unrelated restarted list", async ({ page }) => {
  const prose = await mount(page, "<p>正文</p>" + restartedList);
  await select(page, "正文");
  const before = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await snapshot(page);
  await expect(prose.locator(":scope > h3")).toHaveText("正文");
  expect(after.json.content?.at(-1)).toEqual(before.json.content?.at(-1));
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("a nested quote may change heading style without moving a restarted ancestor list", async ({ page }) => {
  const html =
    '<ol><li data-semlo-editor-list-restart="true"><p>祖</p><ul><li><p>父</p>' +
    "<blockquote><p>引用</p></blockquote><ul><li><p>孙</p></li></ul>" +
    "</li></ul></li></ol>";
  const prose = await mount(page, html);
  await select(page, "引用");
  const before = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await snapshot(page);
  await expect(prose.locator("blockquote > h3")).toHaveText("引用");
  expect(after.html).toContain('data-semlo-editor-list-restart="true"');
  expect(after.text).toBe(before.text);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("HTML and JSON round trips retain restart metadata and host attributes", async ({ page }) => {
  await mount(page, restartedList, true);
  const source = await snapshot(page);
  expect(source.html).toContain('data-semlo-editor-list-restart="true"');
  expect(source.html).toContain('data-host-token="retain"');
  for (const content of [source.html, source.json]) {
    await mount(page, content, true);
    const roundTrip = await snapshot(page);
    expect(roundTrip.json).toEqual(source.json);
    expect(roundTrip.html).toContain('data-semlo-editor-list-restart="true"');
    expect(roundTrip.html).toContain('data-host-token="retain"');
  }
});

test("a restart inside an untouched sibling subtree does not block conversion", async ({ page }) => {
  const html =
    '<ul><li><p>甲</p></li><li><p>乙</p><ol><li data-semlo-editor-list-restart="true"><p>子</p></li></ol></li></ul>';
  const prose = await mount(page, html);
  await select(page, "甲");
  const before = await snapshot(page);
  const untouched = before.json.content?.[0]?.content?.[1];
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await snapshot(page);
  await expect(prose.locator(":scope > h3")).toHaveText("1. 甲");
  expect(after.json.content?.find((node) => node.type === "bulletList")?.content?.[0]).toEqual(untouched);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("an adjacent restarted list is retained or the entire conversion is rolled back", async ({ page }) => {
  const html =
    "<ol><li><p>甲</p></li><li><p>乙</p></li></ol>" +
    '<ol><li><p>丙</p></li><li data-semlo-editor-list-restart="true"><p>丁</p></li></ol>';
  const prose = await mount(page, html);
  await select(page, "甲");
  const before = await snapshot(page);
  const lists = before.json.content?.filter((node) => node.type === "orderedList") ?? [];
  expect(lists).toHaveLength(2);
  const untouched = lists[1];
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await snapshot(page);
  if (JSON.stringify(after.json) === JSON.stringify(before.json)) {
    expect(after.selection).toEqual(before.selection);
    expect(after.changes).toBe(before.changes);
    expect(await page.evaluate(() => window.__semloRequireFixture("headingRestartEditor").editor.commands.undo())).toBe(
      false,
    );
  } else {
    await expect(prose.locator(":scope > h3")).toHaveText("1. 甲");
    expect(
      after.json.content?.find(
        (node) =>
          node.type === "orderedList" && node.content?.some((item) => item.content?.[0]?.content?.[0]?.text === "丁"),
      ),
    ).toEqual(untouched);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await snapshot(page)).json).toEqual(before.json);
  }
});
