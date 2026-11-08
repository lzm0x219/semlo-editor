import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    listTabLevelStartsEditor?: EditorController;
    listTabLevelStartsChanges?: number;
  }
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (text: string, indent: number) => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text)],
});
const interleaved = {
  type: "doc",
  content: [
    {
      type: "orderedList",
      attrs: { start: 1 },
      content: [item("甲", 0), item("乙", 1), item("丙", 0), item("丁", 1), item("戊", 0)],
    },
  ],
};
const converted = {
  type: "doc",
  content: [
    { type: "orderedList", attrs: { start: 1 }, content: [item("甲", 0), item("乙", 1)] },
    {
      type: "heading",
      attrs: { level: 3, semloEditorHeadingNumbering: "mixed" },
      content: [{ type: "text", text: "丙" }],
    },
    {
      type: "orderedList",
      attrs: { start: 2, semloEditorListLevelStarts: { "0": 2 } },
      content: [item("丁", 1), item("戊", 0)],
    },
  ],
};

async function mount(page: Page, content: object) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'list-tab-level-starts'
      document.body.append(host)
      window.listTabLevelStartsChanges = 0
      window.listTabLevelStartsEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        onChange: () => { window.listTabLevelStartsChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.listTabLevelStartsEditor));
  return page.locator("#list-tab-level-starts");
}

async function select(page: Page, first: string, last = first, backward = false) {
  await page.evaluate(
    ({ first, last, backward }) => {
      const editor = window.__semloRequireFixture("listTabLevelStartsEditor").editor;
      const positions = new Map<string, { from: number; to: number }>();
      editor.state.doc.descendants((node, position) => {
        if (node.isTextblock && (node.textContent === first || node.textContent === last))
          positions.set(node.textContent, { from: position + 1, to: position + node.nodeSize - 1 });
      });
      const start = positions.get(first),
        end = positions.get(last);
      if (!start || !end) throw new Error("Missing list item");
      editor.view.focus();
      editor.commands.setTextSelection({ from: backward ? end.to : start.from, to: backward ? start.from : end.to });
    },
    { first, last, backward },
  );
}

async function selection(page: Page) {
  return page.evaluate(() => {
    const { state } = window.__semloRequireFixture("listTabLevelStartsEditor").editor;
    const { $anchor, $head, from, to } = state.selection;
    return {
      anchor: $anchor.parent.textContent,
      anchorOffset: $anchor.parentOffset,
      head: $head.parent.textContent,
      headOffset: $head.parentOffset,
      text: state.doc.textBetween(from, to, "\n"),
    };
  });
}

async function markers(page: Page) {
  return page
    .locator("#list-tab-level-starts .semlo-editor-prose > ol")
    .last()
    .locator(":scope > li")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent,
        indent: Number(node.getAttribute("data-semlo-editor-list-indent") || 0),
        value: node.getAttribute("value"),
        marker: getComputedStyle(node).listStyleType,
      })),
    );
}

for (const source of ["already converted", "convert in editor"] as const) {
  for (const backward of [false, true]) {
    test(`${source}: Tab remaps ordered level starts with ${backward ? "backward" : "forward"} selection, undo and HTML/JSON round trips`, async ({
      page,
    }) => {
      const host = await mount(page, source === "already converted" ? converted : interleaved);
      if (source === "convert in editor") {
        await select(page, "丙");
        await host.getByRole("button", { name: "段落样式" }).click();
        await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
      }
      await expect(host.locator(".semlo-editor-prose > h3")).toContainText("丙");
      expect(await markers(page)).toEqual([
        { text: "丁", indent: 1, value: "2", marker: "lower-alpha" },
        { text: "戊", indent: 0, value: "2", marker: "decimal" },
      ]);
      const before = await page.evaluate(() => window.__semloRequireFixture("listTabLevelStartsEditor").getSnapshot());
      const secondList = before.json.content?.filter((node) => node.type === "orderedList").at(-1);
      expect(secondList?.attrs).toMatchObject({ start: 2, semloEditorListLevelStarts: { "0": 2 } });
      await select(page, "丁", "戊", backward);
      const selected = await selection(page);
      expect(selected.text).toBe("丁\n戊");
      const changes = await page.evaluate(() => window.__semloRequireFixture("listTabLevelStartsChanges"));
      await page.keyboard.press("Tab");
      expect(await selection(page)).toEqual(selected);
      expect(await page.evaluate(() => window.__semloRequireFixture("listTabLevelStartsChanges"))).toBe(changes + 1);
      expect(await markers(page)).toEqual([
        { text: "丁", indent: 2, value: "1", marker: "semlo-mixed-roman" },
        { text: "戊", indent: 1, value: "2", marker: "lower-alpha" },
      ]);
      const after = await page.evaluate(() => window.__semloRequireFixture("listTabLevelStartsEditor").getSnapshot());
      expect(
        await page.evaluate(() => window.__semloRequireFixture("listTabLevelStartsEditor").editor.commands.undo()),
      ).toBe(true);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("listTabLevelStartsEditor").getSnapshot().json),
      ).toEqual(before.json);
      expect(await markers(page)).toEqual([
        { text: "丁", indent: 1, value: "2", marker: "lower-alpha" },
        { text: "戊", indent: 0, value: "2", marker: "decimal" },
      ]);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("listTabLevelStartsEditor").editor.commands.redo()),
      ).toBe(true);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("listTabLevelStartsEditor").getSnapshot().json),
      ).toEqual(after.json);
      for (const snapshot of [before, after]) {
        for (const content of [snapshot.html, snapshot.json]) {
          const restored = await page.evaluate((value) => {
            const controller = window.__semloRequireFixture("listTabLevelStartsEditor");
            controller.setContent("<p>临时内容</p>");
            controller.setContent(value);
            return controller.getSnapshot();
          }, content);
          expect(restored.json).toEqual(snapshot.json);
          expect(restored.text).toBe(snapshot.text);
        }
      }
    });
  }
}
