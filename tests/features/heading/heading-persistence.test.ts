import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    headingPersistenceEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'heading-persistence'
      document.body.append(host)
      window.headingPersistenceEditor = createEditor({ element: host, outline: false, content: '<p></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.headingPersistenceEditor));
  return page.locator("#heading-persistence");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("plain text and HTML paste preserve the observed paragraph and heading structure", async ({ page }) => {
  const host = await mount(page);
  const paste = async (plain: string, html?: string) =>
    page.evaluate(
      ({ plain, html }) => {
        const editor = window.__semloRequireFixture("headingPersistenceEditor").editor;
        editor.commands.focus();
        editor.commands.selectAll();
        const data = new DataTransfer();
        data.setData("text/plain", plain);
        if (html) data.setData("text/html", html);
        editor.view.dom.dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
        );
      },
      { plain, html },
    );
  await paste("# 一级粘贴\n## 二级粘贴\n普通文本");
  await expect(host.locator(".semlo-editor-prose > p")).toHaveText(["# 一级粘贴", "## 二级粘贴", "普通文本"]);
  await expect(host.locator(".semlo-editor-prose > h1, .semlo-editor-prose > h2")).toHaveCount(0);
  await paste(
    "一级粗斜\n正文 链接\n三级",
    '<h1>一级<strong>粗</strong><em>斜</em></h1><p>正文 <a href="https://example.com/">链接</a></p><h3>三级</h3>',
  );
  await expect(host.locator(".semlo-editor-prose > h1")).toHaveText("一级粗斜");
  await expect(host.locator(".semlo-editor-prose > h1 strong")).toHaveText("粗");
  await expect(host.locator(".semlo-editor-prose > h1 em")).toHaveText("斜");
  await expect(host.locator(".semlo-editor-prose > p a")).toHaveAttribute("href", "https://example.com/");
  await expect(host.locator(".semlo-editor-prose > h3")).toHaveText("三级");
  const original = await page.evaluate(() => window.__semloRequireFixture("headingPersistenceEditor").getSnapshot());
  const restored = await page.evaluate((snapshot) => {
    const controller = window.__semloRequireFixture("headingPersistenceEditor");
    controller.setContent("<p>替换内容</p>");
    controller.setContent(snapshot.html);
    const fromHtml = controller.getSnapshot();
    controller.setContent("<p>替换内容</p>");
    controller.setContent(snapshot.json);
    return { fromHtml, fromJson: controller.getSnapshot() };
  }, original);
  expect(restored.fromHtml.json).toEqual(original.json);
  expect(restored.fromJson.json).toEqual(original.json);
});

for (const framework of ["react", "vue", "solid"]) {
  test(`${framework} controlled content preserves heading conversion and subsequent editing`, async ({ page }) => {
    await page.goto(new URL("/tests/controlled.html", process.env.SEMLO_TEST_ORIGIN!).href);
    const host = page.locator(`#${framework}`);
    const prose = host.locator(".semlo-editor-prose");
    const column = host.locator(".semlo-editor-column").first();
    await expect(prose).toBeVisible();
    await column.locator("p").click();
    await page.keyboard.insertText("复盘标题");
    await expect(column.locator("p")).toHaveText("复盘标题");
    await host.getByRole("button", { name: "段落样式" }).click();
    await page.getByRole("menuitemradio", { name: "标题3" }).click();
    await expect(column.locator("h3")).toHaveText("复盘标题");
    await page.keyboard.insertText("追加");
    await expect(column.locator("h3")).toHaveText("复盘标题追加");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("正文");
    await expect(column.locator("p")).toHaveText("正文");
    await expect(column.locator("h3")).toHaveText("复盘标题追加");
    await expect(host.getByRole("button", { name: "状态：初始" })).toBeVisible();
  });
}
