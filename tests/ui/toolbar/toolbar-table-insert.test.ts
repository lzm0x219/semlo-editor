import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    tableInsertSnapshot?(): unknown;
  }
}

test("root table cell limits both insertion menus and search", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-table-insert-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-table-insert-fixture-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const cell = page.locator("#table-insert-fixture .semlo-editor-prose td p").first();
    await cell.click();
    await page.keyboard.type("/");
    const slash = page.getByRole("listbox", { name: "插入内容" });
    await expect(slash).toBeVisible();
    await expect(slash.locator(".semlo-editor-quick-grid")).toHaveCount(0);
    const allowed = [
      "图片",
      "附件",
      "状态",
      "语雀 AI 助手-写作助手",
      "公式",
      "高亮块",
      "引用",
      "插入分割线",
      "表情",
      "图册",
      "提及",
      "语雀内容",
      "日期",
      "本地文件",
      "本地音频",
      "本地视频",
    ];
    const hidden = [
      "表格",
      "画板",
      "思维导图",
      "流程图",
      "数据表",
      "画册",
      "看板",
      "分栏卡片",
      "折叠块",
      "代码块",
      "文本绘图",
      "UML图",
      "日历",
      "投票",
      "打卡",
      "加密文本",
      "哔哩哔哩",
    ];
    for (const text of allowed) await expect(slash.getByText(text, { exact: true }).first(), text).toBeVisible();
    for (const text of hidden) await expect(slash.getByText(text, { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await cell.click();
    await page.getByRole("button", { name: "插入内容" }).click();
    const panel = page.getByRole("dialog", { name: "插入内容" });
    await expect(panel).toBeVisible();
    for (const text of allowed) await expect(panel.getByText(text, { exact: true }).first(), text).toBeVisible();
    for (const text of hidden) await expect(panel.getByText(text, { exact: true })).toHaveCount(0);
    await panel.getByRole("textbox", { name: "搜索插入内容" }).fill("zdk");
    await expect(panel.getByText("折叠块", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    const filledCell = page.locator("#table-insert-fixture .semlo-editor-prose td p").nth(1);
    await filledCell.click();
    await page.keyboard.insertText("甲乙丙");
    await page.keyboard.press("Home");
    await page.keyboard.type("/");
    await expect(filledCell).toHaveText("/甲乙丙");
    await expect(slash).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("/");
    await expect(filledCell).toHaveText("/甲乙丙/");
    await expect(slash).toHaveCount(0);
    await page.getByRole("button", { name: "插入内容" }).click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("高亮块", { exact: true })).toBeVisible();
    await expect(panel.getByText("表格", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    const lastCell = page.locator("#table-insert-fixture .semlo-editor-prose td").nth(2);
    await lastCell.locator("p").click();
    await page.keyboard.type("/glk");
    await expect(slash.getByText("高亮块", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(lastCell.locator("aside[data-semlo-editor-callout]")).toHaveCount(1);
    expect(
      await page.evaluate(() =>
        Boolean(window.getSelection()?.anchorNode?.parentElement?.closest("aside[data-semlo-editor-callout]")),
      ),
    ).toBe(true);
    for (const { query, expected, type } of [
      { query: "wxlb", expected: "ul li", type: "bulletList" },
      { query: "yxlb", expected: "ol li", type: "orderedList" },
      { query: "rwlb", expected: 'ul[data-type="taskList"] li', type: "taskList" },
      { query: "h1", expected: "h1", type: "heading" },
      { query: "h2", expected: "h2", type: "heading" },
      { query: "h3", expected: "h3", type: "heading" },
      { query: "h4", expected: "h4", type: "heading" },
      { query: "h5", expected: "h5", type: "heading" },
      { query: "h6", expected: "h6", type: "heading" },
      { query: "p", expected: "p", type: "paragraph" },
      { query: "lj", expected: "link", type: "link" },
    ]) {
      await page.reload();
      const cell = page.locator("#table-insert-fixture .semlo-editor-prose td").first();
      await cell.locator("p").click();
      await page.keyboard.type(`/${query}`);
      await expect(slash.locator('[aria-selected="true"]')).toHaveCount(1);
      if (type === "heading") await expect(slash.locator('[data-command^="heading"]')).toHaveCount(6);
      await expect(slash.locator('[aria-selected="true"]'), query).toHaveAttribute(
        "data-command",
        type === "heading" ? `heading${query.slice(1)}` : type,
      );
      await page.keyboard.press("Enter");
      if (expected === "link") await expect(page.getByRole("dialog", { name: "插入链接" })).toBeVisible();
      else {
        await expect(cell.locator(expected), query).toHaveCount(1);
        await expect(page.locator("#table-insert-fixture .semlo-editor-prose")).toBeFocused();
        const snapshot = JSON.stringify(
          await page.evaluate(() => window.__semloRequireFixture("tableInsertSnapshot").bind(window)()),
        );
        expect(snapshot).toContain(`"type":"${type}"`);
        if (type === "paragraph") await expect(cell.locator("p")).toHaveText("");
        if (type === "heading") {
          await page.keyboard.type("/");
          await expect(cell.locator(expected)).toHaveText("/");
          await expect(slash).toHaveCount(0);
          await page.getByRole("button", { name: "插入内容" }).click();
          await expect(panel.getByText("表格", { exact: true })).toHaveCount(0);
          await expect(panel.getByText("高亮块", { exact: true }).first()).toBeVisible();
        }
        if (["wxlb", "yxlb", "rwlb"].includes(query)) {
          await page.keyboard.type("/");
          await expect(cell.locator("li p")).toHaveText("/");
          await expect(slash).toHaveCount(0);
          await page.getByRole("button", { name: "插入内容" }).click();
          await expect(panel.getByText("表格", { exact: true })).toHaveCount(0);
          await expect(panel.getByText("高亮块", { exact: true }).first()).toBeVisible();
        }
      }
    }
    await page.reload();
    const multiCell = page.locator("#table-insert-fixture .semlo-editor-prose td").first();
    await multiCell.locator("p").click();
    await page.keyboard.insertText("第一段");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await expect(slash).toBeVisible();
    await expect(slash.locator(".semlo-editor-quick-grid")).toHaveCount(1);
    await expect(slash.getByText("表格", { exact: true })).toHaveCount(0);
    await expect(slash.getByText("高亮块", { exact: true }).first()).toBeVisible();
    await page.reload();
    await multiCell.locator("p").click();
    await page.keyboard.insertText("第一段");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("甲乙丙");
    await page.keyboard.press("Home");
    await page.keyboard.type("/");
    await expect(multiCell.locator("p").nth(1)).toHaveText("/甲乙丙");
    await expect(slash).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await expect(slash).toBeVisible();
    await expect(slash.locator(".semlo-editor-quick-grid")).toHaveCount(1);
    await expect(slash.getByText("表格", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText("甲乙丙");
    await page.keyboard.press("Home");
    await page.keyboard.type("/");
    await expect(multiCell.locator("p").nth(2)).toHaveText("/甲乙丙");
    await expect(slash).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await expect(slash).toBeVisible();
    await expect(slash.locator(".semlo-editor-quick-grid")).toHaveCount(1);
    await expect(slash.getByText("表格", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText("甲乙丙");
    await page.keyboard.press("Home");
    await page.keyboard.type("/");
    await expect(multiCell.locator("p").nth(3)).toHaveText("/甲乙丙");
    await expect(slash).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/wxlb");
    await page.keyboard.press("Enter");
    await expect(multiCell.locator("ul li")).toHaveCount(1);
    await page.keyboard.type("/");
    await expect(multiCell.locator("li p")).toHaveText("/");
    await expect(slash).toHaveCount(0);
    await page.getByRole("button", { name: "插入内容" }).click();
    await expect(panel.getByText("表格", { exact: true })).toHaveCount(0);
    await expect(panel.getByText("高亮块", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "插入内容" }).click();
    await multiCell.locator("li p").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/h2");
    await page.keyboard.press("Enter");
    await expect(multiCell.locator("h2")).toHaveCount(1);
    await page.keyboard.type("/");
    await expect(multiCell.locator("h2")).toHaveText("/");
    await expect(slash).toHaveCount(0);
    await page.getByRole("button", { name: "插入内容" }).click();
    await expect(panel.getByText("表格", { exact: true })).toHaveCount(0);
    await expect(panel.getByText("高亮块", { exact: true }).first()).toBeVisible();
    await page.reload();
    const codeCell = page.locator("#table-insert-fixture .semlo-editor-prose td").first();
    await codeCell.locator("p").click();
    await page.keyboard.type("/hndm");
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect(codeCell.locator("code")).toHaveText("abc");
    await expect(page.locator("#table-insert-fixture .semlo-editor-prose")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(codeCell.locator("p")).toHaveText("/");
  } finally {
    await server.close();
  }
});
