import { expect, test, type Page } from "@rstest/playwright";
import { Schema } from "@tiptap/pm/model";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { findTextMatches } from "../../../packages/core/src/ui/find/find-replace";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    findReplaceEditors?: EditorController[];
  }
}

const content = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "前文 " },
        { type: "text", text: "A", marks: [{ type: "bold" }] },
        { type: "text", text: "aA 和 aAa 后文" },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "semloEditorDate", attrs: { date: "2026-11-03" } },
        { type: "text", text: "日期之后 aaa" },
      ],
    },
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "嵌套 aaa" }] }] }],
    },
  ],
};

async function mount(page: Page, numberOfEditors = 1, initialContent: EditorContent = content) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.findReplaceEditors = []
      for (let index = 0; index < ${numberOfEditors}; index++) {
        const host = document.createElement('div')
        host.id = 'find-replace-test-' + index
        document.body.prepend(host)
        window.findReplaceEditors.push(createEditor({
          element: host,
          outline: false,
          content: ${JSON.stringify(initialContent)},
        }))
      }
    `,
  });
  await page.waitForFunction((number) => window.findReplaceEditors?.length === number, numberOfEditors);
  return page.locator("#find-replace-test-0");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("matching joins adjacent marks but never crosses inline atoms or text blocks", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline" },
      atom: { group: "inline", inline: true, atom: true },
    },
    marks: { strong: {} },
  });
  const paragraph = schema.node("paragraph", null, [
    schema.text("A", [schema.mark("strong")]),
    schema.text("aA"),
    schema.node("atom"),
    schema.text("aA"),
  ]);
  const doc = schema.node("doc", null, [paragraph, schema.node("paragraph", null, [schema.text("a")])]);
  expect(findTextMatches(doc, "aaa")).toEqual([{ from: 1, to: 4 }]);
  expect(findTextMatches(doc, "aAaA")).toEqual([]);
  expect(findTextMatches(doc, "")).toEqual([]);
});

test("find highlights case-insensitive results across marks without changing the document", async ({ page }) => {
  const host = await mount(page);
  const before = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const input = panel.getByRole("textbox", { name: "查找内容" });
  await input.fill("aaa");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
  await expect(host.locator(".semlo-editor-find-match-current")).toHaveCount(2);
  await expect(host.locator(".semlo-editor-find-match")).toHaveCount(5);
  await input.press("Enter");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("2/4");
  await input.press("Shift+Enter");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
  await panel.getByRole("button", { name: "上一个" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("4/4");
  const after = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  expect(after.json).toEqual(before.json);
  expect(after.html).toEqual(before.html);
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  await expect(host.locator(".semlo-editor-find-match")).toHaveCount(0);
});

test("replace and replace all preserve first-character formatting and are undoable", async ({ page }) => {
  const host = await mount(page);
  const before = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("aaa");
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "替换为" }).fill("新");
  await panel.getByRole("button", { name: "替换", exact: true }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/3");
  const first = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  expect(first.html).toContain("<strong>新</strong>");
  expect(first.text).toContain("新 和 aAa");
  expect(await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).json).toEqual(
    before.json,
  );
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/[1-4]\/4/);
  await panel.getByRole("button", { name: "全部替换" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("0");
  const replaced = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  expect(replaced.text).not.toMatch(/aaa/i);
  expect(replaced.text).toContain("日期之后 新");
  expect(await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).json).toEqual(
    before.json,
  );
});

for (const withCard of [false, true]) {
  test(`search ${withCard ? "revealing a card " : ""}separates edits on either side into undo steps`, async ({
    page,
  }) => {
    const html = withCard
      ? '<p>起始</p><details><summary>卡片</summary><div data-type="detailsContent"><p>隐藏词</p></div></details>'
      : "<p>起始</p>";
    const host = await mount(page, 1, html);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("findReplaceEditors")[0]
        .editor.chain()
        .setTextSelection(3)
        .insertContent("A")
        .focus()
        .run(),
    );
    // Tiptap applies focus on the next animation frame. Wait for the editor to
    // own the keyboard before sending its scoped find shortcut.
    await expect(host.locator(".semlo-editor-prose")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+f");
    const panel = page.getByRole("dialog", { name: "查找替换" });
    const input = panel.getByRole("textbox", { name: "查找内容" });
    await input.fill(withCard ? "隐藏词" : "起始");
    if (withCard) await expect(host.getByText("隐藏词")).toBeVisible();
    await input.press("Escape");
    await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].editor.commands.insertContent("B"));
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).text,
    ).toMatch(/^起始AB/);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].editor.commands.undo()),
    ).toBe(true);
    const afterFirstUndo = await page.evaluate(() =>
      window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot(),
    );
    expect(afterFirstUndo.text).toMatch(/^起始A(?:\s|$)/);
    if (withCard) expect(afterFirstUndo.text).toContain("隐藏词");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].editor.commands.undo()),
    ).toBe(true);
    const afterSecondUndo = await page.evaluate(() =>
      window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot(),
    );
    if (withCard) {
      expect(afterSecondUndo.text).toMatch(/^起始A(?:\s|$)/);
      expect(afterSecondUndo.text).toContain("隐藏词");
      await expect(host.getByText("隐藏词")).toBeHidden();
      expect(
        await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].editor.commands.undo()),
      ).toBe(true);
    }
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).text,
    ).toMatch(/^起始(?:\s|$)/);
  });
}

test("search updates after document changes and disables replacement in read-only mode", async ({ page }) => {
  const host = await mount(page);
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("aaa");
  await panel.getByRole("tab", { name: "替换" }).click();
  await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].setContent("<p>aaa AAA aaa</p>"));
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/3");
  await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].setEditable(false));
  await expect(panel.getByRole("button", { name: "全部替换" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "替换", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "下一个" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("2/3");
  await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].destroy());
  await expect(panel).toHaveCount(0);
});

test("keyboard shortcuts and overlays stay isolated across editors", async ({ page }) => {
  const first = await mount(page, 2);
  const second = page.locator("#find-replace-test-1");
  await second.locator(".semlo-editor-prose").click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("aaa");
  await expect(second.locator(".semlo-editor-find-match")).not.toHaveCount(0);
  await expect(first.locator(".semlo-editor-find-match")).toHaveCount(0);
  await panel.getByRole("textbox", { name: "查找内容" }).press("Escape");
  await expect(panel).toHaveCount(0);
  await first.getByRole("button", { name: "查找替换" }).click();
  await page.getByRole("dialog", { name: "查找替换" }).getByRole("textbox", { name: "查找内容" }).fill("aaa");
  await expect(first.locator(".semlo-editor-find-match")).not.toHaveCount(0);
  await expect(second.locator(".semlo-editor-find-match")).toHaveCount(0);
});

test("the shortcut remains available without a toolbar and in read-only mode", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-no-toolbar'
      document.body.prepend(host)
      window.findReplaceEditors = [createEditor({
        element: host,
        toolbar: false,
        editable: false,
        outline: false,
        content: '<p>只读 abc ABC</p>',
      })]
    `,
  });
  await page.waitForFunction(() => window.findReplaceEditors?.length === 1);
  const host = page.locator("#find-no-toolbar");
  await host.locator(".semlo-editor-prose").click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("abc");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/2");
  await panel.getByRole("tab", { name: "替换" }).click();
  await expect(panel.getByRole("button", { name: "替换", exact: true })).toBeDisabled();
  await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].destroy());
  await expect(panel).toHaveCount(0);
});

test("each find panel has a unique association with its trigger and cleans it up", async ({ page }) => {
  const first = await mount(page, 2);
  const second = page.locator("#find-replace-test-1");
  const firstTrigger = first.getByRole("button", { name: "查找替换" });
  const secondTrigger = second.getByRole("button", { name: "查找替换" });
  await firstTrigger.click();
  const firstId = await firstTrigger.getAttribute("aria-controls");
  expect(firstId).toBeTruthy();
  await secondTrigger.click();
  const secondId = await secondTrigger.getAttribute("aria-controls");
  expect(secondId).toBeTruthy();
  expect(secondId).not.toEqual(firstId);
  await expect(page.locator(`[id="${firstId}"]`)).toHaveAttribute("role", "dialog");
  await expect(page.locator(`[id="${secondId}"]`)).toHaveAttribute("role", "dialog");
  await page.locator(`[id="${firstId}"]`).getByRole("button", { name: "关闭查找替换" }).click();
  await expect(firstTrigger).not.toHaveAttribute("aria-controls");
  await expect(secondTrigger).toHaveAttribute("aria-controls", secondId!);
  await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[1].destroy());
  await expect(page.locator(`[id="${secondId}"]`)).toHaveCount(0);
});

test("search reveals nested folded headings without changing content or undo history", async ({ page }) => {
  const html =
    "<p>序言</p><h1>父标题</h1><p>父正文</p><h2>子标题</h2><p>隐藏命中甲</p><h1>另一区域</h1><p>另一段正文</p>";
  const first = await mount(page, 2, html);
  const second = page.locator("#find-replace-test-1");
  const original = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  await page.evaluate(() =>
    window.__semloRequireFixture("findReplaceEditors")[0].editor.chain().setTextSelection(1).insertContent("前").run(),
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  await first.getByRole("button", { name: "折叠标题：子标题" }).click();
  await first.getByRole("button", { name: "折叠标题：父标题" }).click();
  await first.getByRole("button", { name: "折叠标题：另一区域" }).click();
  await second.getByRole("button", { name: "折叠标题：子标题" }).click();
  await second.getByRole("button", { name: "折叠标题：父标题" }).click();
  await expect(first.getByText("隐藏命中甲")).toBeHidden();
  await expect(second.getByText("隐藏命中甲")).toBeHidden();
  await first.getByText("父标题", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const input = panel.getByRole("textbox", { name: "查找内容" });
  await input.fill("隐藏命中");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await expect(first.getByText("隐藏命中甲")).toBeVisible();
  await expect(first.getByRole("button", { name: "折叠标题：父标题" })).toBeVisible();
  await expect(first.getByRole("button", { name: "折叠标题：子标题" })).toBeVisible();
  await expect(first.getByText("另一段正文")).toBeHidden();
  await expect(second.getByText("隐藏命中甲")).toBeHidden();
  await expect(input).toBeFocused();
  const expectedBefore = structuredClone(before.json);
  expectedBefore.content![5].attrs!.semloEditorHeadingFolded = true;
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).json).toEqual(
    expectedBefore,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  const expectedOriginal = structuredClone(original.json);
  expectedOriginal.content![5].attrs!.semloEditorHeadingFolded = true;
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).json).toEqual(
    expectedOriginal,
  );
});

test("search can reveal folded heading content in a read-only editor", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("findReplaceEditors")[0];
    editor.setContent("<h1>只读标题</h1><p>只读隐藏文字</p>");
    editor.setEditable(false);
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  await host.getByRole("button", { name: "折叠标题：只读标题" }).click();
  await expect(host.getByText("只读隐藏文字")).toBeHidden();
  await host.getByText("只读标题", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("隐藏文字");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await expect(host.getByText("只读隐藏文字")).toBeVisible();
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).json).toEqual(
    before.json,
  );
});

test("search scrolls a revealed match into view", async ({ page }) => {
  const host = await mount(page);
  const html = `<h1>长章节</h1>${"<p>普通正文段落</p>".repeat(70)}<p>远处命中</p>`;
  await page.evaluate((value) => window.__semloRequireFixture("findReplaceEditors")[0].setContent(value), html);
  const before = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  await host.getByRole("button", { name: "折叠标题：长章节" }).click();
  await expect(host.getByText("远处命中")).toBeHidden();
  await host.getByText("长章节", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const input = panel.getByRole("textbox", { name: "查找内容" });
  await input.fill("远处命中");
  await expect(host.getByText("远处命中")).toBeVisible();
  await expect
    .poll(() =>
      host.locator(".semlo-editor-find-match-current").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      }),
    )
    .toBe(true);
  await expect(input).toBeFocused();
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).json).toEqual(
    before.json,
  );
});

test("moving to a later match reveals only its folded section", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("findReplaceEditors")[0]
      .setContent("<h1>第一节</h1><p>同一关键词 一</p><h1>第二节</h1><p>同一关键词 二</p>"),
  );
  await host.getByRole("button", { name: "折叠标题：第二节" }).click();
  await expect(host.getByText("同一关键词 二")).toBeHidden();
  await host.getByText("第一节", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("同一关键词");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/2");
  await expect(host.getByText("同一关键词 二")).toBeHidden();
  await panel.getByRole("button", { name: "下一个" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("2/2");
  await expect(host.getByText("同一关键词 二")).toBeVisible();
});

test("search reveals nested details inside folded headings and preserves their contents across undo", async ({
  page,
}) => {
  const html =
    '<h1>包含卡片</h1><details><summary>外层卡片</summary><div data-type="detailsContent"><details><summary>内层卡片</summary><div data-type="detailsContent"><p>卡片里的唯一文字</p></div></details></div></details>';
  const host = await mount(page, 1, html);
  const before = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  const outer = host.locator('[data-type="details"]').first();
  const inner = host.locator('[data-type="details"]').nth(1);
  await expect(outer.getByRole("button", { name: "展开内容" }).first()).toBeVisible();
  await host.getByRole("button", { name: "折叠标题：包含卡片" }).click();
  await expect(host.getByText("卡片里的唯一文字")).toBeHidden();
  await host.getByText("包含卡片", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const input = panel.getByRole("textbox", { name: "查找内容" });
  await input.fill("卡片里的唯一文字");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await expect(host.getByText("卡片里的唯一文字")).toBeVisible();
  await expect(outer).toHaveClass(/is-open/);
  await expect(inner).toHaveClass(/is-open/);
  const revealed = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  expect(revealed.text).toEqual(before.text);
  const openStates = await page.evaluate(() => {
    const values: boolean[] = [];
    window.__semloRequireFixture("findReplaceEditors")[0].editor.state.doc.descendants((node) => {
      if (node.type.name === "details") values.push(Boolean(node.attrs.open));
    });
    return values;
  });
  expect(openStates).toEqual([true, true]);

  await input.press("Escape");
  await inner.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.type("新");
  await expect(inner.locator("p")).toHaveText("卡片里的唯一文字新");
  await expect(inner.locator("p")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).json).toEqual(
    revealed.json,
  );
  await expect(inner.locator("p")).toBeVisible();
  await inner.getByRole("button", { name: "收起内容" }).click();
  await expect(inner.locator("p")).toBeHidden();
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).text).toEqual(
    before.text,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).json).toEqual(
    revealed.json,
  );
  await expect(inner.locator("p")).toBeVisible();
  await page.evaluate((value) => {
    const editor = window.__semloRequireFixture("findReplaceEditors")[0];
    editor.setContent("<p>临时内容</p>");
    editor.setContent(value);
  }, revealed.json);
  await expect(host.getByText("卡片里的唯一文字")).toBeVisible();
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).text).toEqual(
    before.text,
  );
});

test("search can reveal a read-only collapsed card and keep its content unchanged", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("findReplaceEditors")[0];
    editor.setContent(
      '<details><summary>只读卡片</summary><div data-type="detailsContent"><p>只读卡片正文</p></div></details>',
    );
    editor.setEditable(false);
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot());
  const body = host.locator('[data-type="detailsContent"]');
  await expect(body).toBeHidden();
  await host.getByText("只读卡片", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("只读卡片正文");
  await expect(body).toBeVisible();
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).json).toEqual(
    before.json,
  );
  await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].setEditable(true));
  await expect(body).toBeVisible();
  await host.getByRole("button", { name: "收起内容" }).click();
  await expect(body).toBeHidden();
  expect((await page.evaluate(() => window.__semloRequireFixture("findReplaceEditors")[0].getSnapshot())).json).toEqual(
    before.json,
  );
});
