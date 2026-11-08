import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { restartedDragDocument } from "../../fixtures/list/list-restarted-drag-fixture";
import { dragSequence } from "../../fixtures/list/sequences/browser-helpers";

declare global {
  interface Window {
    sequencePublicEditor?: EditorController;
    sequencePublicChanges?: number;
  }
}
test.beforeEach(async ({ page }) => installFixtureGuards(page));
async function setup(page: Page, five: boolean, style: "mixed" | "decimal") {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'sequence-public'; document.body.prepend(host);
    window.sequencePublicChanges = 0;
    window.sequencePublicEditor = createEditor({ element: host, content: '<p></p>', outline: false,
      onChange(snapshot) { window.sequencePublicChanges++; window.sequencePublicEditor.setContent(snapshot.json); }
    });
  `,
  });
  await page.waitForFunction(() => Boolean(window.sequencePublicEditor));
  await page.evaluate(
    (content) => window.__semloRequireFixture("sequencePublicEditor").setContent(content),
    restartedDragDocument(five, style),
  );
  return page.locator("#sequence-public .semlo-editor-prose");
}
const snapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("sequencePublicEditor").getSnapshot());
for (const style of ["mixed", "decimal"] as const)
  for (const [name, five, source, target, before, expectedTexts, expectedValues] of [
    ["三子项乙下移", false, "乙", "丙", false, ["父", "甲", "丙", "乙"], [1, 1, 1, 2]],
    ["三子项乙上移", false, "乙", "甲", true, ["父", "乙", "甲", "丙"], [1, 1, 1, 2]],
    ["五子项普通甲移到末尾", true, "甲", "戊", false, ["父", "乙", "丙", "丁", "戊", "甲"], [1, 1, 2, 1, 2, 1]],
    ["五子项重启丁移到前方", true, "丁", "甲", true, ["父", "丁", "甲", "乙", "丙", "戊"], [1, 1, 1, 1, 2, 2]],
  ] as const)
    test(`实际核心包 ${style} ${name} 原生向量及JSON/HTML历史`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const prose = await setup(page, five, style);
      const initial = await snapshot(page);
      expect(JSON.stringify(initial.json)).not.toContain("semloEditorListSequences");
      await dragSequence(
        page,
        prose.getByText(source, { exact: true }),
        prose.getByText(target, { exact: true }),
        before,
      );
      await expect(prose.locator("ol > li p")).toHaveText([...expectedTexts]);
      expect(
        await prose.locator("ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual(expectedValues);
      if (style === "decimal")
        expect(
          await prose
            .locator("ol > li")
            .evaluateAll((items) => items.slice(1).map((item) => getComputedStyle(item).listStyleType)),
        ).toEqual(expectedValues.slice(1).map((value) => `"1.${value}. "`));
      const moved = await snapshot(page);
      expect(moved.html).toContain("data-semlo-editor-list-sequences");
      expect(
        await page.evaluate(
          () => window.__semloRequireFixture("sequencePublicEditor").editor.state.selection.$from.parent.textContent,
        ),
      ).toBe(source);
      expect(await page.evaluate(() => window.__semloRequireFixture("sequencePublicChanges"))).toBe(1);
      await expect(prose.getByText("乙", { exact: true })).toHaveCSS("font-weight", "700");
      if (style === "mixed" && five) {
        // 保留成功断言后的实机画面，供父级与原生向量对照；不改变拖动或文档状态。
        await page.locator("#sequence-public").screenshot({
          path: `test-results/list-sequences/${source === "甲" ? "ordinary-to-end" : "restart-to-front"}.png`,
        });
      }
      expect(
        await page.evaluate(() => window.__semloRequireFixture("sequencePublicEditor").editor.commands.undo()),
      ).toBe(true);
      expect((await snapshot(page)).json).toEqual(initial.json);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("sequencePublicEditor").editor.commands.redo()),
      ).toBe(true);
      expect((await snapshot(page)).json).toEqual(moved.json);
      await page.evaluate((html) => window.__semloRequireFixture("sequencePublicEditor").setContent(html), moved.html);
      expect((await snapshot(page)).json).toEqual(moved.json);
      expect(errors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("sequencePublicEditor").destroy());
    });

test("实际核心包按真实几何目标拒绝跨父跨层及带子项目标", async ({ page }) => {
  const prose = await setup(page, false, "mixed");
  const json = restartedDragDocument();
  const list = json.content!.find((node) => node.type === "orderedList")!;
  const item = (text: string, level: number) => ({
    type: "listItem",
    attrs: { semloEditorListIndent: level },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  list.content!.push(item("另父", 0), item("另子", 1));
  await page.evaluate((content) => window.__semloRequireFixture("sequencePublicEditor").setContent(content), json);
  let before = await snapshot(page);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("另父", { exact: true }), true);
  expect((await snapshot(page)).json).toEqual(before.json);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("另子", { exact: true }), true);
  expect((await snapshot(page)).json).toEqual(before.json);
  // 先完成受支持同父移动，让完全相同的几何负控制再经过 v1 路径。
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
  await expect(prose.locator("ol > li p")).toHaveText(["父", "甲", "丙", "乙", "另父", "另子"]);
  before = await snapshot(page);
  expect(before.html).toContain("data-semlo-editor-list-sequences");
  await dragSequence(page, prose.getByText("甲", { exact: true }), prose.getByText("另父", { exact: true }), true);
  expect((await snapshot(page)).json).toEqual(before.json);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("另子", { exact: true }), true);
  expect((await snapshot(page)).json).toEqual(before.json);
  const grouped = restartedDragDocument();
  grouped.content!.find((node) => node.type === "orderedList")!.content!.push(item("丙子", 2));
  await page.evaluate((content) => window.__semloRequireFixture("sequencePublicEditor").setContent(content), grouped);
  before = await snapshot(page);
  await dragSequence(page, prose.getByText("甲", { exact: true }), prose.getByText("丙", { exact: true }), true);
  expect((await snapshot(page)).json).toEqual(before.json);
  const shared = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequencePublicEditor").editor;
    const list = editor.state.doc.content.content.find((node) => node.type.name === "orderedList")!;
    editor.view.dispatch(
      editor.state.tr.replaceWith(0, editor.state.doc.content.size, [list, list]).setMeta("preventUpdate", true),
    );
    return editor.state.doc.child(0) === editor.state.doc.child(1);
  });
  expect(shared).toBe(true);
  before = await snapshot(page);
  await dragSequence(
    page,
    prose.locator(":scope > ol").nth(0).getByText("乙", { exact: true }),
    prose.locator(":scope > ol").nth(1).getByText("甲", { exact: true }),
    true,
  );
  expect((await snapshot(page)).json).toEqual(before.json);
  await page.evaluate(() => window.__semloRequireFixture("sequencePublicEditor").destroy());
});
