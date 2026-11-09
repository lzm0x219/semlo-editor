import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { nativeYuqueQuoteHTML, yuqueCrossBlockQuoteHTML } from "../../fixtures/text/yuque-quote-clipboard";

declare global {
  interface Window {
    quotePasteEditor?: EditorController;
    quotePasteOther?: EditorController;
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

async function mountBoundaryEditor(page: Page, content: string, controlled = false) {
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").destroy());
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      let instance
      instance = createEditor({ element: document.querySelector('#quote-paste'), outline: false,
        content: ${JSON.stringify(content)}, ${controlled ? "onChange: snapshot => instance.setContent(snapshot.json)" : ""} })
      window.quotePasteEditor = instance
    `,
  });
}

async function pasteBoundary(page: Page, html: string) {
  await page.evaluate((content) => {
    const editor = window.__semloRequireFixture("quotePasteEditor").editor;
    const data = new DataTransfer();
    data.setData("text/plain", "\n引用甲乙");
    data.setData("text/html", content);
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  }, html);
}

for (const sample of [
  {
    name: "粘到空段落时不多出空段",
    content: "<p>前段</p><blockquote><p>引用甲乙</p></blockquote><p>后段</p><p></p>",
    expected: "<p>前段</p><blockquote><p>引用甲乙</p></blockquote><p>后段</p><blockquote><p>引用甲乙</p></blockquote>",
  },
  {
    name: "粘到正文中间时保留独立后缀",
    content: "<p>后段</p>",
    selection: { from: 2, to: 2 },
    expected: "<p>后</p><blockquote><p>引用甲乙</p></blockquote><p>段</p>",
  },
  {
    name: "替换段内选区时保留两侧文字及格式",
    content: "<p><strong>前</strong>中<em>后</em></p>",
    selection: { from: 2, to: 3 },
    expected: "<p><strong>前</strong></p><blockquote><p>引用甲乙</p></blockquote><p><em>后</em></p>",
    controlled: true,
  },
  {
    name: "替换反向段内选区时保留两侧文字",
    content: "<p>前中后</p>",
    selection: { from: 3, to: 2 },
    expected: "<p>前</p><blockquote><p>引用甲乙</p></blockquote><p>后</p>",
  },
  {
    name: "替换段首选区时保留空前缀和独立后缀",
    content: "<p>前中后</p>",
    selection: { from: 1, to: 2 },
    expected: "<p></p><blockquote><p>引用甲乙</p></blockquote><p>中后</p>",
  },
  {
    name: "段首光标粘贴时保留空前缀和独立后缀",
    content: "<p>前中后</p>",
    selection: { from: 1, to: 1 },
    expected: "<p></p><blockquote><p>引用甲乙</p></blockquote><p>前中后</p>",
  },
  {
    name: "替换整段文字时合并前缀空段",
    content: "<p>前中后</p>",
    selection: { from: 1, to: 4 },
    expected: "<blockquote><p>引用甲乙</p></blockquote>",
  },
  {
    name: "多个前缀空段只合并首个",
    content: "<p></p>",
    html: yuqueCrossBlockQuoteHTML.replace(
      '<div class="ne-quote" style=',
      '<p id="u12345678" class="ne-p" style="margin: 0; padding: 0; min-height: 24px"><span class="ne-text"></span></p><div class="ne-quote" style=',
    ),
    expected: "<p></p><blockquote><p>引用甲乙</p></blockquote>",
  },
]) {
  test(`语雀跨正文与引用复制的片段${sample.name}，可撤销重做`, async ({ page }) => {
    await mountBoundaryEditor(page, sample.content, sample.controlled);
    const before = await page.evaluate((selection) => {
      const controller = window.__semloRequireFixture("quotePasteEditor");
      controller.editor.commands.focus("end");
      if (selection) controller.editor.commands.setTextSelection(selection);
      return controller.getSnapshot().json;
    }, sample.selection);
    await pasteBoundary(page, sample.html ?? yuqueCrossBlockQuoteHTML);
    const after = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
    expect(after.html).toBe(sample.expected);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
      before,
    );
    if (sample.selection) {
      const selection = await page.evaluate(() =>
        window.__semloRequireFixture("quotePasteEditor").editor.state.selection.toJSON(),
      );
      expect(selection).toMatchObject({ anchor: sample.selection.from, head: sample.selection.to });
    }
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
      after.json,
    );
    if (sample.controlled) {
      const fromHTML = await page.evaluate((html) => {
        const controller = window.__semloRequireFixture("quotePasteEditor");
        controller.setContent(html);
        return controller.getSnapshot().json;
      }, after.html);
      expect(fromHTML).toEqual(after.json);
    }
  });
}

test("语雀片段粘贴后可继续输入并分别撤销和重做", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>甲乙</p>");
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  const before = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("quotePasteEditor");
    controller.editor.commands.focus();
    controller.editor.commands.setTextSelection(2);
    return controller.getSnapshot().json;
  });
  await page.waitForFunction(() => {
    const selection = document.getSelection();
    return selection?.anchorNode?.textContent === "甲乙" && selection.anchorOffset === 1;
  });
  await page.keyboard.insertText("新");
  await page.waitForFunction(
    () => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html === "<p>甲新乙</p>",
  );
  const beforePaste = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json);
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  const pasted = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("quotePasteEditor");
    const selection = controller.editor.state.selection;
    return {
      json: controller.getSnapshot().json,
      empty: selection.empty,
      parent: selection.$from.parent.type.name,
      suffix: selection.$from.parent.textContent,
      offset: selection.$from.parentOffset,
    };
  });
  expect({ empty: pasted.empty, parent: pasted.parent, suffix: pasted.suffix, offset: pasted.offset }).toEqual({
    empty: true,
    parent: "paragraph",
    suffix: "乙",
    offset: 0,
  });
  await page.keyboard.insertText("续");
  const edited = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("quotePasteEditor");
    return {
      json: controller.getSnapshot().json,
      html: controller.getSnapshot().html,
      text: controller.editor.state.doc.textContent,
    };
  });
  expect(edited.text).toBe("甲新引用甲乙续乙");
  expect(edited.html).toBe("<p>甲新</p><blockquote><p>引用甲乙</p></blockquote><p>续</p><p>乙</p>");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    pasted.json,
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    beforePaste,
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    beforePaste,
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    pasted.json,
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    edited.json,
  );
});

test("段中开启粗体后粘贴语雀片段，引用继承粗体且不吞入后缀", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>甲乙</p>");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("quotePasteEditor").editor;
    editor.commands.focus();
    editor.commands.setTextSelection(2);
    editor.commands.setBold();
  });
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  const prose = page.locator("#quote-paste .semlo-editor-prose");
  await expect(prose.locator(":scope > p")).toHaveText(["甲", "乙"]);
  await expect(prose.locator(":scope > blockquote")).toHaveText("引用甲乙");
  await expect(prose.locator(":scope > blockquote strong")).toHaveText("引用甲乙");
});

test("空段粘贴引用后输入生成正文，受控回写和撤销保留边界", async ({ page }) => {
  await mountBoundaryEditor(page, "<p></p>", true);
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").editor.commands.focus("end"));
  await page.waitForFunction(() => document.activeElement?.closest("#quote-paste") !== null);
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  const pasted = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
  expect(pasted.html).toBe("<blockquote><p>引用甲乙</p></blockquote>");
  await page.keyboard.insertText("续");
  await page.keyboard.insertText("写");
  const edited = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
  expect(edited.html).toBe("<blockquote><p>引用甲乙</p></blockquote><p>续写</p>");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    pasted.json,
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p></p>",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    edited.json,
  );
});

test("段尾粘贴引用后输入生成正文，分别撤销输入和粘贴", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>目标</p>", true);
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").editor.commands.focus("end"));
  await page.waitForFunction(() => document.activeElement?.closest("#quote-paste") !== null);
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  const pasted = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
  expect(pasted.html).toBe("<p>目标</p><blockquote><p>引用甲乙</p></blockquote>");
  await page.keyboard.insertText("续");
  const edited = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
  expect(edited.html).toBe("<p>目标</p><blockquote><p>引用甲乙</p></blockquote><p>续</p>");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    pasted.json,
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>目标</p>",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    edited.json,
  );
});

test("段尾粘贴后组合输入生成正文且可分别撤销", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>目标</p>");
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").editor.commands.focus("end"));
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  const pasted = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
  await page.evaluate(() =>
    window
      .__semloRequireFixture("quotePasteEditor")
      .editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" })),
  );
  await page.keyboard.insertText("测试");
  await page.evaluate(() =>
    window
      .__semloRequireFixture("quotePasteEditor")
      .editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "测试" })),
  );
  await expect
    .poll(() => page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html))
    .toBe("<p>目标</p><blockquote><p>引用甲乙</p></blockquote><p>测试</p>");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    pasted.json,
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>目标</p>",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>目标</p><blockquote><p>引用甲乙</p></blockquote><p>测试</p>",
  );
});

test("段中粘贴后组合输入与后缀分段，并保留受控回写和撤销", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>甲乙</p>", true);
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").editor.commands.setTextSelection(2));
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  const pasted = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
  await page.evaluate(() =>
    window
      .__semloRequireFixture("quotePasteEditor")
      .editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
  );
  await page.keyboard.insertText("测试");
  await page.evaluate(() =>
    window
      .__semloRequireFixture("quotePasteEditor")
      .editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "测试" })),
  );
  await expect
    .poll(() => page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html))
    .toBe("<p>甲</p><blockquote><p>引用甲乙</p></blockquote><p>测试</p><p>乙</p>");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    pasted.json,
  );
});

test("Chromium 组合输入更新并上屏后可分别撤销和重做", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>目标</p>");
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").editor.commands.focus("end"));
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  const pasted = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
  const session = await page.context().newCDPSession(page);
  await session.send("Input.imeSetComposition", { text: "ce", selectionStart: 2, selectionEnd: 2 });
  await session.send("Input.imeSetComposition", { text: "测试", selectionStart: 2, selectionEnd: 2 });
  await session.send("Input.insertText", { text: "测试" });
  await expect
    .poll(() => page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html))
    .toBe("<p>目标</p><blockquote><p>引用甲乙</p></blockquote><p>测试</p>");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    pasted.json,
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>目标</p>",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>目标</p><blockquote><p>引用甲乙</p></blockquote><p>测试</p>",
  );
  await session.detach();
});

test("取消组合输入不创建空段且撤销粘贴", async ({ page }) => {
  await mountBoundaryEditor(page, "<p></p>");
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  await page.evaluate(() => {
    const dom = window.__semloRequireFixture("quotePasteEditor").editor.view.dom;
    dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<blockquote><p>引用甲乙</p></blockquote>",
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p></p>",
  );
});

test("组合期间外部替换文档后不应用旧输入候选", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>目标</p>");
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").editor.commands.focus("end"));
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("quotePasteEditor");
    controller.editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    controller.setContent("<p>新文档</p>");
    controller.editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "旧" }));
  });
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>新文档</p>",
  );
});

test("组合结束时销毁编辑器不会派发旧事务", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mountBoundaryEditor(page, "<p>目标</p>");
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").editor.commands.focus("end"));
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("quotePasteEditor")
      .editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
  );
  await page.keyboard.insertText("测试");
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("quotePasteEditor");
    controller.editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "测试" }));
    controller.destroy();
  });
  await page.waitForTimeout(50);
  expect(errors).toEqual([]);
});

test("组合期间切换只读后不移动已输入文字", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>目标</p>");
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").editor.commands.focus("end"));
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("quotePasteEditor")
      .editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
  );
  await page.keyboard.insertText("测试");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("quotePasteEditor").editor;
    editor.setEditable(false);
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "测试" }));
  });
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>目标</p><blockquote><p>引用甲乙测试</p></blockquote>",
  );
});

test("粘贴后选区移动使继续输入候选失效", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>甲乙</p>");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("quotePasteEditor").editor;
    editor.commands.focus();
    editor.commands.setTextSelection(2);
  });
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("quotePasteEditor").editor;
    const position = editor.state.selection.from;
    editor.commands.setTextSelection(1);
    editor.commands.setTextSelection(position);
  });
  await page.keyboard.insertText("续");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>甲</p><blockquote><p>引用甲乙</p></blockquote><p>续乙</p>",
  );
});

test("后置宿主粘贴处理器让出时只调用一次，输入和粘贴分别撤销", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>甲乙</p>", true);
  await page.addScriptTag({
    type: "module",
    content: `
      import { Plugin } from '/dist/index.js'
      const editor = window.quotePasteEditor.editor
      window.quotePasteHostCalls = 0
      editor.registerPlugin(new Plugin({ props: { handlePaste: () => { window.quotePasteHostCalls++; return false } } }),
        (plugin, plugins) => [...plugins, plugin])
    `,
  });
  await page.waitForFunction(() => (window as unknown as { quotePasteHostCalls?: number }).quotePasteHostCalls === 0);
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").editor.commands.setTextSelection(2));
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  const pasted = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
  await page.keyboard.insertText("续");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>甲</p><blockquote><p>引用甲乙</p></blockquote><p>续</p><p>乙</p>",
  );
  expect(await page.evaluate(() => (window as unknown as { quotePasteHostCalls: number }).quotePasteHostCalls)).toBe(1);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    pasted.json,
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>甲乙</p>",
  );
});

test("语雀粘贴的历史边界不影响另一个实例，销毁后可重新挂载", async ({ page }) => {
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'quote-paste-other'
      document.body.append(host)
      window.quotePasteOther = createEditor({ element: host, outline: false, content: '<p>另一实例</p>' })
    `,
  });
  await mountBoundaryEditor(page, "<p>甲乙</p>");
  const before = await page.evaluate(() => {
    const other = window.quotePasteOther!;
    other.editor.commands.focus();
    other.editor.commands.insertContent("一");
    const first = window.__semloRequireFixture("quotePasteEditor");
    first.editor.commands.focus();
    first.editor.commands.setTextSelection(2);
    return other.getSnapshot().json;
  });
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  const outcome = await page.evaluate(() => {
    const other = window.quotePasteOther!;
    other.editor.commands.focus();
    other.editor.commands.insertContent("二");
    const typed = other.getSnapshot().json;
    const undo = other.editor.commands.undo();
    const undone = other.getSnapshot().text;
    const redo = other.editor.commands.redo();
    const redone = other.getSnapshot().json;
    other.destroy();
    const first = window.__semloRequireFixture("quotePasteEditor");
    first.destroy();
    return { typed, undo, undone, redo, redone };
  });
  expect(outcome.undo).toBe(true);
  expect(outcome.undone).toBe("另一实例");
  expect(outcome.redo).toBe(true);
  expect(outcome.redone).toEqual(outcome.typed);
  expect(outcome.redone).not.toEqual(before);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.quotePasteEditor = createEditor({ element: document.querySelector('#quote-paste'), outline: false,
        content: '<p>重新挂载</p>' })
    `,
  });
  await page.waitForFunction(() => window.quotePasteEditor && !window.quotePasteEditor.editor.isDestroyed);
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().text)).toBe(
    "重新挂载",
  );
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").editor.commands.focus("end"));
  await page.waitForFunction(() => document.activeElement?.closest("#quote-paste") !== null);
  await page.keyboard.insertText("续");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().html)).toBe(
    "<p>重新挂载续</p>",
  );
});

test("自动链接追加事务后，语雀引用粘贴与后续输入仍可分别撤销", async ({ page }) => {
  await mountBoundaryEditor(page, "<p>example.com后</p>");
  await page.locator("#quote-paste .semlo-editor-prose p").click();
  const before = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("quotePasteEditor");
    controller.editor.commands.setTextSelection(12);
    return controller.getSnapshot().json;
  });
  await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
  const pasted = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
  expect(pasted.html).toContain(
    '<a target="_blank" rel="noopener noreferrer nofollow" href="http://example.com">example.com</a>',
  );
  await page.keyboard.insertText("续");
  const edited = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot());
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    pasted.json,
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
    edited.json,
  );
});

for (const sample of [
  { name: "空段", content: "<p></p>", selection: { from: 1, to: 1 } },
  { name: "整段选区", content: "<p>甲乙</p>", selection: { from: 1, to: 3 } },
]) {
  test(`语雀引用粘到${sample.name}后，连续输入与粘贴可分别撤销`, async ({ page }) => {
    await mountBoundaryEditor(page, sample.content);
    await page.locator("#quote-paste .semlo-editor-prose p").click();
    const before = await page.evaluate((selection) => {
      const controller = window.__semloRequireFixture("quotePasteEditor");
      controller.editor.commands.setTextSelection(selection);
      return controller.getSnapshot().json;
    }, sample.selection);
    await pasteBoundary(page, yuqueCrossBlockQuoteHTML);
    const pasted = await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json);
    await page.keyboard.insertText("续");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
      pasted,
    );
    await page.keyboard.press("ControlOrMeta+z");
    expect(await page.evaluate(() => window.__semloRequireFixture("quotePasteEditor").getSnapshot().json)).toEqual(
      before,
    );
  });
}
