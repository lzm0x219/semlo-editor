import { beforeAll, afterAll, expect, test } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../../fixtures/browser/fixture-rsbuild";
import {
  mountSequence,
  dragSequence,
  readSequence,
  historySequence,
  settleSequence,
} from "../../../fixtures/list/sequences/browser-helpers";

let origin = "",
  stop = async () => {};
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer(
    "./tests/fixtures/list/sequences/numbering-sequences-framework-fixture.ts",
    { framework: true },
  ));
});
afterAll(async () => stop());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

for (const framework of ["react", "vue", "solid"] as const)
  for (const echo of ["json", "html"] as const)
    test(`${framework} 实际 ${echo} 受控回写保留独立序列、格式、选区与历史`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const prose = await mountSequence(page, origin, framework, "three", echo);
      const before = await readSequence(page);
      expect(before.documentChanges).toBe(0);
      expect(JSON.stringify(before.snapshot.json)).not.toContain("semloEditorListSequences");
      await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
      await expect(prose.locator("ol > li p")).toHaveText(["父", "甲", "丙", "乙"]);
      const moved = await readSequence(page);
      expect(moved.values).toEqual([1, 1, 1, 2]);
      expect(moved.selection).toBe("乙");
      expect(moved.documentChanges).toBe(1);
      expect(moved.snapshot.html).toContain("data-semlo-editor-list-sequences");
      await expect(prose.getByText("乙", { exact: true })).toHaveCSS("font-weight", "700");
      await historySequence(page, "undo");
      expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
      await historySequence(page, "redo");
      expect((await readSequence(page)).snapshot.json).toEqual(moved.snapshot.json);
      await page.evaluate(
        (content) => window.__semloRequireFixture("sequenceFixture").setContent(content),
        moved.snapshot.html,
      );
      await settleSequence(page);
      expect((await readSequence(page)).snapshot.json).toEqual(moved.snapshot.json);
      await prose.getByText("乙", { exact: true }).click();
      await page.keyboard.press("End");
      await page.keyboard.insertText("改");
      expect((await readSequence(page)).values).toEqual([1, 1, 1, 2]);
      expect((await readSequence(page)).errors).toEqual([]);
      expect(errors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("sequenceFixture").destroy());
      await expect(page.locator("#sequence-fixture")).toHaveCount(0);
    });

for (const [framework, echo] of [
  ["react", "html"],
  ["vue", "json"],
  ["solid", "html"],
] as const)
  test(`${framework} 受控回写中使用键盘和工具栏调整编号缩进`, async ({ page }) => {
    const prose = await mountSequence(page, origin, framework, "three", echo);
    await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
    const before = await readSequence(page);
    await prose.getByText("乙", { exact: true }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    const indented = await readSequence(page);
    expect(indented.values).toEqual([1, 1, 1, 1]);
    expect(indented.snapshot.json.content![1].content!.map((item) => item.attrs?.semloEditorListIndent)).toEqual([
      0, 1, 1, 2,
    ]);
    await expect(prose.getByText("乙", { exact: true })).toHaveCSS("font-weight", "700");
    await historySequence(page, "undo");
    expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
    await historySequence(page, "redo");
    expect((await readSequence(page)).snapshot.json).toEqual(indented.snapshot.json);
    await prose.getByText("乙", { exact: true }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+Tab");
    expect((await readSequence(page)).values).toEqual([1, 1, 1, 2]);
    await page.keyboard.press("Tab");
    expect((await readSequence(page)).values).toEqual([1, 1, 1, 1]);
    const indent = page.getByRole("button", { name: "缩进调整" });
    if (!(await indent.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
    await indent.click({ timeout: 5000 });
    await page.getByRole("menuitem", { name: "减少缩进" }).click({ timeout: 5000 });
    expect((await readSequence(page)).values).toEqual([1, 1, 1, 2]);
    expect((await readSequence(page)).errors).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("sequenceFixture").destroy());
  });

for (const [framework, echo] of [
  ["react", "html"],
  ["vue", "json"],
  ["solid", "html"],
] as const)
  test(`${framework} 受控回写保留跨段续接的缩进与撤销`, async ({ page }) => {
    page.setDefaultTimeout(5000);
    const prose = await mountSequence(page, origin, framework, "three", echo);
    const segment = (start: number, link: string, ...texts: string[]): JSONContent => ({
      type: "orderedList",
      attrs: {
        semloEditorListSequenceLink: link,
        semloEditorListSequences: { version: 1, sequences: [{ id: "root", start, origin: "initial" }] },
      },
      content: texts.map((text) => ({
        type: "listItem",
        attrs: { semloEditorListSequence: "root" },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      })),
    });
    const content: JSONContent = {
      type: "doc",
      content: [
        segment(1, "v1:_:edge", "甲", "乙"),
        { type: "paragraph", content: [{ type: "text", text: "间隔" }] },
        segment(3, "v1:edge:_", "丙", "丁"),
      ],
    };
    await page.evaluate((value) => window.__semloRequireFixture("sequenceFixture").setContent(value), content);
    await settleSequence(page);
    const before = await readSequence(page);
    expect(before.values).toEqual([1, 2, 3, 4]);
    await prose.getByText("乙", { exact: true }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    const after = await readSequence(page);
    expect(after.values).toEqual([1, 1, 2, 3]);
    await historySequence(page, "undo");
    expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
    await historySequence(page, "redo");
    expect((await readSequence(page)).snapshot.json).toEqual(after.snapshot.json);
    expect((await readSequence(page)).errors).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("sequenceFixture").destroy());
  });
