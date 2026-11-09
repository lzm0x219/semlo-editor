import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    longWritingEditor?: EditorController;
    mountLongWriting?: (content: string) => void;
  }
}

const body = Array.from(
  { length: 10 },
  (_, index) =>
    `<h2>第${index + 1}节 写作与整理</h2><p>这一段记录文章的背景、观察和下一步安排，写作过程中需要保留标题层级、段落顺序以及前后的完整文字。整理文章时，可以修改措辞、核对事实并反复检查表达；不论在开头还是结尾编辑，都应当保持其他内容不变。${index === 4 ? "这里包含唯一的检索标记青石桥，稍后用于查找与替换。" : ""}</p>`,
).join("");

async function selectText(page: Page, text: string) {
  await page.locator("#long-writing .semlo-editor-prose > p").filter({ hasText: text }).click();
  await page.evaluate((target) => {
    const root = document.querySelector("#long-writing .semlo-editor-prose");
    if (!root) throw new Error("Editor not mounted");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const offset = node.textContent?.indexOf(target) ?? -1;
      if (offset < 0) continue;
      document.getSelection()?.setBaseAndExtent(node, offset, node, offset + target.length);
      return;
    }
    throw new Error(`Missing text: ${target}`);
  }, text);
}

test("long article supports writing, find and replace, formatting, links and remount", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div');
      host.id = 'long-writing';
      document.body.replaceChildren(host);
      window.mountLongWriting = content => {
        window.longWritingEditor = createEditor({ element: host, outline: false, content });
      };
      window.mountLongWriting('<p></p>');
    `,
  });
  await page.waitForFunction(() => Boolean(window.longWritingEditor));
  await page.evaluate(async (html) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob(["长文样本"], { type: "text/plain" }),
      }),
    ]);
  }, body);
  const prose = page.locator("#long-writing .semlo-editor-prose");
  await prose.click();
  await page.keyboard.insertText("长文写作流程样本");
  await page.keyboard.press("ControlOrMeta+Alt+Digit2");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("这是开篇正文，用来记录完整写作流程。");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(prose.locator(":scope > h2")).toHaveCount(11);
  await expect(prose.locator(":scope > p")).toHaveCount(11);

  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "查找内容" }).fill("青石桥");
  await expect(page.getByText("1/1", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "替换" }).click();
  await page.getByRole("textbox", { name: "替换为" }).fill("白石桥");
  await page.getByRole("button", { name: "替换", exact: true }).click();
  await expect(prose).toContainText("白石桥");
  await prose.locator(":scope > p").filter({ hasText: "白石桥" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(prose).toContainText("青石桥");
  await expect(prose).not.toContainText("白石桥");

  await selectText(page, "青石桥");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "链接", exact: true }).fill("https://example.com/");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await selectText(page, "唯一的检索标记");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(prose.locator("a")).toHaveAttribute("href", "https://example.com/");
  await expect(prose.locator("strong")).toHaveText("唯一的检索标记");

  const saved = await page.evaluate(() => {
    if (!window.longWritingEditor) throw new Error("Editor not mounted");
    return window.longWritingEditor.getSnapshot();
  });
  await page.evaluate((html) => {
    if (!window.longWritingEditor || !window.mountLongWriting) throw new Error("Editor not mounted");
    window.longWritingEditor.destroy();
    window.mountLongWriting(html);
  }, saved.html);
  const restored = await page.evaluate(() => {
    if (!window.longWritingEditor) throw new Error("Editor not mounted");
    return window.longWritingEditor.getSnapshot();
  });
  expect(restored.json).toEqual(saved.json);
  expect(restored.text).toBe(saved.text);
  await expect(prose.locator(":scope > h2")).toHaveCount(11);
  await expect(prose.locator(":scope > p")).toHaveCount(11);
  await expect(prose.locator("a")).toHaveAttribute("href", "https://example.com/");
  await expect(prose.locator("strong")).toHaveText("唯一的检索标记");
});

test("search expands a folded parent and replacement undo keeps the child visible", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div');
      host.id = 'long-writing';
      document.body.replaceChildren(host);
      window.longWritingEditor = createEditor({
        element: host, outline: false,
        content: '<h2>主章节</h2><p>开头内容</p><h3>子章节</h3><p>隐藏的检索词云杉树以及后续文字。</p><h2>末章节</h2><p>结束内容</p>',
      });
    `,
  });
  await page.waitForFunction(() => Boolean(window.longWritingEditor));
  const prose = page.locator("#long-writing .semlo-editor-prose");
  const initial = await page.evaluate(() => window.longWritingEditor!.getSnapshot());
  await page.getByRole("button", { name: "折叠标题：主章节" }).click();
  await expect(prose.locator(":scope > h3")).toBeHidden();
  expect(
    (await page.evaluate(() => window.longWritingEditor!.getSnapshot())).json.content![0].attrs!
      .semloEditorHeadingFolded,
  ).toBe(true);
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "查找内容" }).fill("云杉树");
  await expect(page.getByText("1/1", { exact: true })).toBeVisible();
  await expect(prose.locator(":scope > h3")).toBeVisible();
  await page.getByRole("tab", { name: "替换" }).click();
  await page.getByRole("textbox", { name: "替换为" }).fill("红枫树");
  await page.getByRole("button", { name: "替换", exact: true }).click();
  await expect(prose).toContainText("红枫树");
  await page.getByRole("button", { name: "关闭查找替换" }).click();
  await prose.locator(":scope > p").filter({ hasText: "红枫树" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.longWritingEditor!.getSnapshot())).toEqual(initial);
  await expect(prose.locator(":scope > h3")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(prose.locator(":scope > h3")).toBeHidden();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(prose.locator(":scope > h3")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(prose.locator(":scope > h3")).toBeHidden();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(prose.locator(":scope > h3")).toBeVisible();
});
