import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";
import type { Locator } from "playwright";

import { createDemoDatabase } from "../../../demo/database-example";
import type { EditorController } from "../../../packages/core/src/types";
import { longWritingArticle, longWritingCode } from "../../fixtures/text/long-writing-article";

declare global {
  interface Window {
    longWritingEditor?: EditorController;
    mountLongWriting?: (content: string) => void;
    rejectLongWritingPaste?: boolean;
    longWritingRejectedPastes?: number;
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

async function dragTextRange(page: Page, prose: Locator, anchor: string, head: string) {
  const [start, end] = await prose.evaluate(
    (root, labels) => {
      return labels.map((label) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent !== label) continue;
          const range = document.createRange();
          range.setStart(walker.currentNode, 4);
          range.collapse(true);
          const caret = range.getBoundingClientRect();
          return { x: caret.x, y: caret.y + caret.height / 2 };
        }
        throw new Error(`未找到选区端点：${label}`);
      });
    },
    [anchor, head],
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(
    ([anchorText, headText]) => {
      const { $anchor, $head } = window.longWritingEditor!.editor.state.selection;
      return (
        $anchor.parent.textContent === anchorText &&
        $anchor.parentOffset === 4 &&
        $head.parent.textContent === headText &&
        $head.parentOffset === 4
      );
    },
    [anchor, head],
  );
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

async function mountFromStorage(page: Page, format: "json" | "html") {
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div');
      host.id = 'long-writing';
      document.body.replaceChildren(host);
      const saved = sessionStorage.getItem('article');
      window.longWritingEditor = createEditor({
        element: host,
        outline: false,
        content: saved ? ${format === "json" ? "JSON.parse(saved)" : "saved"} : '<p></p>',
        onChange: snapshot => sessionStorage.setItem('article', ${format === "json" ? "JSON.stringify(snapshot.json)" : "snapshot.html"}),
      });
    `,
  });
  await page.waitForFunction(() => Boolean(window.longWritingEditor));
}

test("a report with database records and video can be edited after changing its storage format", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  const videoUrl = new URL("/tests/sample-video.mp4", page.url()).href;
  const initial: JSONContent = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "项目进展" }] },
      createDemoDatabase(new Date(2026, 10, 20)),
      {
        type: "semloEditorVideo",
        attrs: { src: videoUrl, name: "进展录像.mp4", size: 3009, mimeType: "video/mp4" },
      },
      { type: "paragraph", content: [{ type: "text", text: "收尾说明" }] },
    ],
  };
  const save = (value: string) => page.evaluate((value) => sessionStorage.setItem("article", value), value);
  const snapshot = () => page.evaluate(() => window.longWritingEditor!.getSnapshot());
  await save(JSON.stringify(initial));
  await mountFromStorage(page, "json");
  const original = await snapshot();
  await save(original.html);
  await page.reload();
  await mountFromStorage(page, "html");
  expect(await snapshot()).toEqual(original);

  const prose = page.locator("#long-writing .semlo-editor-prose");
  const field = prose.getByLabel("第 1 行 事项");
  await expect(field).toHaveValue("收集灵感");
  await field.fill("确认交接");
  await field.press("Tab");
  const closing = prose.getByText("收尾说明", { exact: true });
  await closing.click();
  await expect(field).toHaveValue("确认交接");
  const edited = await snapshot();
  expect(edited.json).not.toEqual(original.json);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(field).toHaveValue("收集灵感");
  expect(await snapshot()).toEqual(original);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(field).toHaveValue("确认交接");
  expect(await snapshot()).toEqual(edited);
  expect(await page.evaluate(() => sessionStorage.getItem("article"))).toBe(edited.html);

  await page.reload();
  await mountFromStorage(page, "html");
  await expect(field).toHaveValue("确认交接");
  await expect(prose.locator("video")).toHaveAttribute("src", videoUrl);
  await expect(closing).toBeVisible();
  expect(await snapshot()).toEqual(edited);
});

for (const { width, format } of [
  { width: 1280, format: "json" },
  { width: 375, format: "html" },
] as const) {
  test(`mixed long article survives a page reload using ${format} storage at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(process.env.SEMLO_FIXTURE_URL!);
    await mountFromStorage(page, format);
    await page.evaluate(async (html) => {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) })]);
    }, body);
    const prose = page.locator("#long-writing .semlo-editor-prose");
    await prose.click();
    await page.keyboard.insertText("长文整合验收");
    await page.keyboard.press("ControlOrMeta+Alt+Digit2");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("开篇仍应保持可见。");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+v");
    await expect(prose.locator(":scope > h2")).toHaveCount(11);

    await prose.locator(":scope > p").last().click();
    const mac = await page.evaluate(() => navigator.platform.includes("Mac"));
    await page.keyboard.press(mac ? "Meta+ArrowDown" : "Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("1. ");
    await page.keyboard.insertText("校对引文");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("整理附表");
    await expect(prose.locator("ol li")).toHaveText(["校对引文", "整理附表"]);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await page.getByRole("option", { name: "表格 插入表格", exact: true }).hover();
    await page.getByLabel("2行2列", { exact: true }).click();
    const cells = prose.locator("table :is(td, th)");
    await expect(cells).toHaveCount(4);
    // 给插表与单元格输入留出历史分组间隔，避免依赖 CI 机器的操作速度。
    await page.clock.setFixedTime(Date.now() + 1000);
    await cells.first().click();
    await page.keyboard.insertText("材料已核对");
    await expect(cells.first()).toHaveText("材料已核对");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(cells.first()).toHaveText("");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(cells.first()).toHaveText("材料已核对");

    const section = "第10节 写作与整理";
    await page.getByRole("button", { name: `折叠标题：${section}`, exact: true }).click();
    await expect(cells.first()).toBeHidden();
    const saved = await page.evaluate(() => window.longWritingEditor!.getSnapshot());
    expect(await page.evaluate(() => sessionStorage.getItem("article"))).toBe(
      format === "json" ? JSON.stringify(saved.json) : saved.html,
    );
    await page.reload();
    await mountFromStorage(page, format);
    expect(await page.evaluate(() => window.longWritingEditor!.getSnapshot())).toEqual(saved);
    await expect(prose.locator("ol li").last()).toBeHidden();
    await expect(cells.first()).toBeHidden();
    await page.getByRole("button", { name: `展开标题：${section}`, exact: true }).click();
    await expect(prose.locator("ol li")).toHaveText(["校对引文", "整理附表"]);
    await expect(cells.first()).toHaveText("材料已核对");
    await cells.last().click();
    await page.keyboard.insertText("重载后继续编辑");
    await expect(cells.last()).toHaveText("重载后继续编辑");
    expect(await page.evaluate(() => sessionStorage.getItem("article"))).toContain("重载后继续编辑");
  });
}

test("an imported long article preserves list, table and code when writing resumes after reload", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await mountFromStorage(page, "html");
  await page.evaluate(async (html) => {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) })]);
  }, longWritingArticle);
  const prose = page.locator("#long-writing .semlo-editor-prose");
  await prose.click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(prose.locator(":scope > h2")).toHaveCount(10);
  await expect(prose.locator(":scope > h3")).toHaveText("执行明细");
  await expect(prose.locator("ol li")).toHaveText(["校对引文", "整理附表"]);
  await expect(prose.locator("table td")).toHaveText(["材料", "状态", "编号清单", "待核对"]);
  expect(await prose.locator("pre code").textContent()).toBe(longWritingCode);
  const snapshot = () => page.evaluate(() => window.longWritingEditor!.getSnapshot());
  const saved = await snapshot();
  expect(await page.evaluate(() => sessionStorage.getItem("article"))).toBe(saved.html);
  await page.reload();
  await mountFromStorage(page, "html");
  expect(await snapshot()).toEqual(saved);

  await selectText(page, "收尾说明");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.insertText("，已核对");
  await expect(prose.locator(":scope > p").last()).toHaveText("收尾说明，已核对");
  const edited = await snapshot();
  await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot()).toEqual(saved);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await snapshot()).toEqual(edited);
  expect(await page.evaluate(() => sessionStorage.getItem("article"))).toBe(edited.html);
  await page.reload();
  await mountFromStorage(page, "html");
  expect(await snapshot()).toEqual(edited);
});

test("桌面跨标题、正文和编号项替换保留未选内容，一次撤销恢复原选区", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  const source =
    "<p>序言保留</p><h2>标题前半标题右半</h2><p>中间正文</p>" +
    '<ol start="4"><li><p>首项左边首项尾部</p></li><li><p>第二项保留</p></li></ol><p>尾注保留</p>';
  await page.evaluate((html) => sessionStorage.setItem("article", html), source);
  await mountFromStorage(page, "html");
  const prose = page.locator("#long-writing .semlo-editor-prose");
  const selection = () => page.evaluate(() => window.longWritingEditor!.editor.state.selection.toJSON());
  const snapshot = () => page.evaluate(() => window.longWritingEditor!.getSnapshot());
  const before = await snapshot();
  await dragTextRange(page, prose, "标题前半标题右半", "首项左边首项尾部");
  const beforeSelection = await selection();
  await page.evaluate(() => navigator.clipboard.writeText("替换"));
  await page.keyboard.press("ControlOrMeta+v");
  await expect(prose.locator(":scope > h2")).toHaveText("标题前半替换首项尾部");
  await expect(prose.locator(":scope > p")).toHaveText(["序言保留", "尾注保留"]);
  await expect(prose.locator("ol > li")).toHaveText(["第二项保留"]);
  await expect(prose.locator("ol")).toHaveAttribute("start", "4");
  const after = await snapshot();

  await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot()).toEqual(before);
  expect(await selection()).toEqual(beforeSelection);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await snapshot()).toEqual(after);
  await page.reload();
  await mountFromStorage(page, "html");
  expect(await snapshot()).toEqual(after);
});

test("反向拖选跨数据表和视频后，粘贴替换可一次撤销并恢复原选区", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  const videoUrl = new URL("/tests/sample-video.mp4", page.url()).href;
  const initial: JSONContent = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "上节保留" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "章节前半章节后半" }] },
      createDemoDatabase(new Date(2026, 10, 20)),
      { type: "semloEditorVideo", attrs: { src: videoUrl, name: "进展录像.mp4", size: 3009, mimeType: "video/mp4" } },
      { type: "paragraph", content: [{ type: "text", text: "结尾前半结尾后半" }] },
      { type: "paragraph", content: [{ type: "text", text: "下节保留" }] },
    ],
  };
  await page.evaluate((doc) => sessionStorage.setItem("article", JSON.stringify(doc)), initial);
  await mountFromStorage(page, "json");
  const prose = page.locator("#long-writing .semlo-editor-prose");
  const value = prose.getByLabel("第 1 行 事项");
  const video = prose.locator("video");
  await expect(value).toHaveValue("收集灵感");
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
  await page.addScriptTag({
    type: "module",
    content: `
      import { Plugin } from '/dist/index.js';
      window.longWritingRejectedPastes = 0;
      window.longWritingEditor.editor.registerPlugin(new Plugin({
        filterTransaction(transaction) {
          if (!window.rejectLongWritingPaste || transaction.getMeta('uiEvent') !== 'paste') return true;
          window.longWritingRejectedPastes++;
          return false;
        }
      }));
      window.rejectLongWritingPaste = true;
    `,
  });
  await page.waitForFunction(() => window.rejectLongWritingPaste);
  const snapshot = () => page.evaluate(() => window.longWritingEditor!.getSnapshot());
  const selection = () => page.evaluate(() => window.longWritingEditor!.editor.state.selection.toJSON());
  const saved = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("article")!));
  const before = await snapshot();
  const beforeSave = await saved();

  await dragTextRange(page, prose, "结尾前半结尾后半", "章节前半章节后半");
  const beforeSelection = await selection();
  expect(beforeSelection.anchor).toBeGreaterThan(beforeSelection.head);
  await page.evaluate(() => navigator.clipboard.writeText("替换"));
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => page.evaluate(() => window.longWritingRejectedPastes)).toBeGreaterThan(0);
  expect(await snapshot()).toEqual(before);
  expect(await selection()).toEqual(beforeSelection);
  expect(await saved()).toEqual(beforeSave);
  expect(await page.evaluate(() => window.longWritingEditor!.editor.can().undo())).toBe(false);

  await page.evaluate(() => (window.rejectLongWritingPaste = false));
  await page.keyboard.press("ControlOrMeta+v");
  await expect(prose.locator(":scope > h2")).toHaveText("章节前半替换结尾后半");
  await expect(prose.locator(":scope > p")).toHaveText(["上节保留", "下节保留"]);
  await expect(value).toHaveCount(0);
  await expect(video).toHaveCount(0);
  const after = await snapshot();
  expect(await saved()).toEqual(after.json);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(value).toHaveValue("收集灵感");
  await expect(video).toHaveAttribute("src", videoUrl);
  expect(await snapshot()).toEqual(before);
  expect(await selection()).toEqual(beforeSelection);
  expect(await saved()).toEqual(before.json);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await snapshot()).toEqual(after);
  expect(await saved()).toEqual(after.json);
  await page.reload();
  await mountFromStorage(page, "json");
  expect(await snapshot()).toEqual(after);
});
