import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { nativeYuqueQuoteHTML } from "../../fixtures/text/yuque-quote-clipboard";

declare global {
  interface Window {
    quotePasteEditor?: EditorController;
  }
}

async function paste(page: Page, html: string) {
  await page.evaluate((content) => {
    const editor = window.__semloRequireFixture("quotePasteEditor").editor;
    editor.commands.focus();
    editor.commands.selectAll();
    const data = new DataTransfer();
    data.setData("text/plain", "原有引用内容");
    data.setData("text/html", content);
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  }, html);
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'quote-paste'
      document.body.append(host)
      window.quotePasteEditor = createEditor({ element: host, outline: false, content: '<p>原文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.quotePasteEditor));
});

for (const sample of [
  {
    name: "顶层引用",
    html: '<blockquote><p>正文 <strong>粗体</strong> <a href="https://example.com/">链接</a></p><h3>标题</h3></blockquote>',
    text: "正文 粗体 链接标题",
    format: "strong",
  },
  {
    name: "双层引用",
    html: "<blockquote><p>外层开头</p><blockquote><p><strong>内层引用</strong></p></blockquote><p>外层结尾</p></blockquote>",
    text: "外层开头内层引用外层结尾",
    format: "strong",
  },
  {
    name: "三层无序列表内的引用",
    html: "<ul><li><p>祖父</p><ul><li><p>父列表</p><blockquote><p><strong>引用内容</strong></p></blockquote><ul><li><p>孙列表</p></li></ul></li><li><p>同级</p></li></ul></li></ul>",
    text: "祖父父列表引用内容孙列表同级",
    format: "strong",
  },
  {
    name: "带起点的有序列表内的引用",
    html: '<ol start="7"><li><p>第七项</p><blockquote><p><em>引用段落</em></p></blockquote><ol><li><p>子项甲</p></li></ol></li><li><p>第八项</p></li></ol>',
    text: "第七项引用段落子项甲第八项",
    format: "em",
  },
]) {
  test(`无来源标记的${sample.name}展开引用并保留格式及撤销`, async ({ page }) => {
    await paste(page, sample.html);
    const prose = page.locator("#quote-paste .semlo-editor-prose");
    await expect(prose.locator("blockquote")).toHaveCount(0);
    await expect(prose).toHaveText(sample.text);
    await expect(prose.locator(sample.format)).toHaveCount(1);
    if (sample.name === "顶层引用") {
      await expect(prose.locator("h3")).toHaveText("标题");
      await expect(prose.locator('a[href="https://example.com/"]')).toHaveText("链接");
    }
    if (sample.name === "双层引用") await expect(prose.locator(":scope > p")).toHaveCount(3);
    if (sample.name === "三层无序列表内的引用") {
      await expect(prose.locator("ul ul ul li")).toHaveText("孙列表");
      await expect(prose.locator(":scope > ul > li > ul > li")).toHaveCount(2);
    }
    if (sample.name === "带起点的有序列表内的引用") {
      await expect(prose.locator(":scope > ol")).toHaveAttribute("start", "7");
      await expect(prose.locator(":scope > ol > li")).toHaveCount(2);
      await expect(prose.locator(":scope > ol > li ol li")).toHaveText("子项甲");
    }
    const result = await page.evaluate(() => {
      const controller = window.__semloRequireFixture("quotePasteEditor");
      const snapshot = controller.getSnapshot();
      controller.editor.commands.undo();
      const undo = controller.getSnapshot().text;
      controller.editor.commands.redo();
      const redo = controller.getSnapshot().json;
      controller.setContent(snapshot.html);
      const fromHtml = controller.getSnapshot().json;
      controller.setContent(snapshot.json);
      return { snapshot, undo, redo, fromHtml, fromJson: controller.getSnapshot().json };
    });
    expect(result.undo).toBe("原文");
    expect(result.redo).toEqual(result.snapshot.json);
    expect(result.fromHtml).toEqual(result.snapshot.json);
    expect(result.fromJson).toEqual(result.snapshot.json);
  });
}

test("受控内容回写保留展开后的列表层级", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").destroy());
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      let instance
      instance = createEditor({ element: document.querySelector('#quote-paste'), outline: false,
        content: '<p>原文</p>', onChange: snapshot => instance.setContent(snapshot.json) })
      window.quotePasteEditor = instance
    `,
  });
  await paste(
    page,
    '<ol start="7"><li><p>第七项</p><blockquote><p>引用</p></blockquote><ol><li><p>子项</p></li></ol></li><li><p>第八项</p></li></ol>',
  );
  const prose = page.locator("#quote-paste .semlo-editor-prose");
  await expect(prose.locator("blockquote")).toHaveCount(0);
  await expect(prose.locator(":scope > ol > li > p")).toHaveText(["第七项", "引用", "第八项"]);
  await expect(prose.locator(":scope > ol > li ol li")).toHaveText("子项");
  const result = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("quotePasteEditor");
    const saved = controller.getSnapshot().json;
    controller.editor.commands.undo();
    const undo = controller.getSnapshot().text;
    controller.editor.commands.redo();
    return { saved, undo, redo: controller.getSnapshot().json };
  });
  expect(result.undo).toBe("原文");
  expect(result.redo).toEqual(result.saved);
});

test("编辑器实际复制的嵌套引用再粘贴保留结构", async ({ page }) => {
  const copied = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("quotePasteEditor");
    controller.setContent("<ul><li><p>父项</p><blockquote><p>内部引用</p></blockquote></li></ul>");
    const editor = controller.editor;
    editor.commands.focus();
    editor.commands.selectAll();
    const data = new DataTransfer();
    editor.view.dom.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }));
    const html = data.getData("text/html");
    controller.setContent("<p></p>");
    editor.commands.focus();
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
    return html;
  });
  expect(copied).toContain("data-pm-slice");
  await expect(page.locator("#quote-paste .semlo-editor-prose li blockquote")).toHaveText("内部引用");
});

test("语雀实际复制的引用经过受控回写仍可撤销与保存往返", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").destroy());
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      let instance
      instance = createEditor({ element: document.querySelector('#quote-paste'), outline: false,
        content: '<p>原文</p>', onChange: snapshot => instance.setContent(snapshot.json) })
      window.quotePasteEditor = instance
    `,
  });
  await paste(page, nativeYuqueQuoteHTML);
  await expect(page.locator("#quote-paste .semlo-editor-prose blockquote")).toHaveText("语雀原生引用样本");
  const result = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("quotePasteEditor");
    const saved = controller.getSnapshot();
    controller.editor.commands.undo();
    const undo = controller.getSnapshot().text;
    controller.editor.commands.redo();
    const redo = controller.getSnapshot().json;
    controller.setContent(saved.html);
    return { saved, undo, redo, fromHTML: controller.getSnapshot().json };
  });
  expect(result.undo).toBe("原文");
  expect(result.redo).toEqual(result.saved.json);
  expect(result.fromHTML).toEqual(result.saved.json);
});
