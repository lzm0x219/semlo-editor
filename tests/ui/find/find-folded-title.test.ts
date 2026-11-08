import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    foldedTitleEditors?: EditorController[];
  }
}

test("searching a folded heading title opens its section and folded ancestors without changing history", async ({
  page,
}) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.foldedTitleEditors = [0, 1].map((index) => {
        const host = document.createElement('div')
        host.id = 'folded-title-test-' + index
        document.body.append(host)
        return createEditor({ element: host, outline: false, content: '<h1>父标题</h1><h2>目标标题</h2><p>目标正文</p><h1>另一标题</h1><p>其他正文</p>' })
      })
    `,
  });
  await page.waitForFunction(() => window.foldedTitleEditors?.length === 2);
  const first = page.locator("#folded-title-test-0");
  const second = page.locator("#folded-title-test-1");
  const before = await page.evaluate(() => window.__semloRequireFixture("foldedTitleEditors")[0].getSnapshot().json);
  await page.evaluate(() =>
    window.__semloRequireFixture("foldedTitleEditors")[0].editor.chain().setTextSelection(1).insertContent("前").run(),
  );
  const edited = await page.evaluate(() => window.__semloRequireFixture("foldedTitleEditors")[0].getSnapshot().json);
  await first.getByRole("button", { name: "折叠标题：目标标题" }).click();
  await first.getByRole("button", { name: "折叠标题：前父标题" }).click();
  await first.getByRole("button", { name: "折叠标题：另一标题" }).click();
  await second.getByRole("button", { name: "折叠标题：目标标题" }).click();
  await first.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标标题");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await expect(first.getByRole("button", { name: "折叠标题：目标标题" })).toHaveAttribute("aria-expanded", "true");
  await expect(first.getByRole("button", { name: "折叠标题：前父标题" })).toHaveAttribute("aria-expanded", "true");
  await expect(first.getByRole("button", { name: "展开标题：另一标题" })).toHaveAttribute("aria-expanded", "false");
  await expect(second.getByRole("button", { name: "展开标题：目标标题" })).toHaveAttribute("aria-expanded", "false");
  const expectedEdited = structuredClone(edited);
  expectedEdited.content![3].attrs!.semloEditorHeadingFolded = true;
  expect(await page.evaluate(() => window.__semloRequireFixture("foldedTitleEditors")[0].getSnapshot().json)).toEqual(
    expectedEdited,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("foldedTitleEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  const expectedBefore = structuredClone(before);
  expectedBefore.content![3].attrs!.semloEditorHeadingFolded = true;
  expect(await page.evaluate(() => window.__semloRequireFixture("foldedTitleEditors")[0].getSnapshot().json)).toEqual(
    expectedBefore,
  );
  await page.evaluate(() => window.__semloRequireFixture("foldedTitleEditors").forEach((editor) => editor.destroy()));
});

test("opening find with selected text pre-fills the query and highlights matches", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'folded-title-test'
      document.body.append(host)
      window.foldedTitleEditors = [createEditor({ element: host, outline: false, content: '<p>目标文字 和 目标文字</p>' })]
    `,
  });
  await page.waitForFunction(() => window.foldedTitleEditors?.length === 1);
  const before = await page.evaluate(() => window.__semloRequireFixture("foldedTitleEditors")[0].getSnapshot().json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldedTitleEditors")[0].editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 5 });
  });
  await expect(page.locator("#folded-title-test .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await expect(panel.getByRole("textbox", { name: "查找内容" })).toHaveValue("目标文字");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/2");
  expect(await page.evaluate(() => window.__semloRequireFixture("foldedTitleEditors")[0].getSnapshot().json)).toEqual(
    before,
  );
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("foldedTitleEditors")[0];
    api.setContent("<p>第一段</p><p>第二段</p>");
    api.editor.commands.focus();
    api.editor.commands.setTextSelection({ from: 1, to: 9 });
  });
  await expect(page.locator("#folded-title-test .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(panel.getByRole("textbox", { name: "查找内容" })).toHaveValue("第一段第二段");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("0");
  await page.evaluate(() => window.__semloRequireFixture("foldedTitleEditors")[0].destroy());
});

test("find shortcut closes the panel from the editor and retains it from the search field", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'folded-title-test'
      document.body.append(host)
      window.foldedTitleEditors = [createEditor({ element: host, outline: false, content: '<p>一段文字</p>' })]
    `,
  });
  await page.waitForFunction(() => window.foldedTitleEditors?.length === 1);
  await page.locator("#folded-title-test .semlo-editor-prose").click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const input = panel.getByRole("textbox", { name: "查找内容" });
  await input.fill("文字");
  await page.keyboard.press("ControlOrMeta+f");
  await expect(panel).toBeVisible();
  await page.locator("#folded-title-test .semlo-editor-prose").click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(panel).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("foldedTitleEditors")[0].destroy());
});
