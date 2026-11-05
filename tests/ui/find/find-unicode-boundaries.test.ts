import { expect, test } from "@rstest/playwright";
import { Schema } from "@tiptap/pm/model";

import { findStringRanges } from "../../../packages/core/src/features/database/find-database-matches";
import { findTextMatches } from "../../../packages/core/src/ui/find/find-replace";

test("case folding respects the observed end boundary of lowercase expansions", () => {
  expect(findStringRanges("İ", "i")).toEqual([]);
  expect(findStringRanges("İi", "i")).toEqual([{ start: 1, end: 2 }]);
  expect(findStringRanges("İ", "i\u0307")).toEqual([{ start: 0, end: 1 }]);
  expect(findStringRanges("İ", "\u0307")).toEqual([{ start: 0, end: 1 }]);
  expect(findStringRanges("İX", "\u0307x")).toEqual([{ start: 0, end: 2 }]);
  expect(findStringRanges("i\u0307", "i")).toEqual([{ start: 0, end: 1 }]);
  expect(findStringRanges("ΟΣ", "ος")).toEqual([]);
  expect(findStringRanges("ΟΣ", "οσ")).toEqual([{ start: 0, end: 2 }]);
  expect(findStringRanges("😀İi", "i")).toEqual([{ start: 3, end: 4 }]);
  const schema = new Schema({
    nodes: { doc: { content: "block+" }, paragraph: { content: "text*", group: "block" }, text: {} },
  });
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("İi")])]);
  expect(findTextMatches(doc, "i")).toEqual([{ from: 2, to: 3 }]);
  expect(findTextMatches(doc, "i\u0307")).toEqual([{ from: 1, to: 2 }]);
});

test("replacement does not consume a character when only part of its case fold matches", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'unicode-find-test'
      document.body.append(host)
      window.unicodeFindEditor = createEditor({ element: host, outline: false, content: '<p>İi</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "unicodeFindEditor")));
  await page.locator("#unicode-find-test").getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("i");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "替换为" }).fill("X");
  await panel.getByRole("button", { name: "替换", exact: true }).click();
  await expect(page.locator("#unicode-find-test .semlo-editor-prose")).toHaveText("İX");
  const undone = await page.evaluate(() => Reflect.get(window, "unicodeFindEditor").editor.commands.undo());
  expect(undone).toBe(true);
  await expect(page.locator("#unicode-find-test .semlo-editor-prose")).toHaveText("İi");
  await page.evaluate(() => Reflect.get(window, "unicodeFindEditor").destroy());
});
