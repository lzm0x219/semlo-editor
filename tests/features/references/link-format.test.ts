import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    linkFormatTest?: EditorController;
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("changing a link label keeps the selected text formatting", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'link-format-test'
      document.body.prepend(host)
      window.linkFormatTest = createEditor({
        element: host,
        content: '<p><strong><em><span style="color: #ff0000">abc</span></em></strong></p>',
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.linkFormatTest));

  const host = page.locator("#link-format-test");
  const prose = host.locator(".semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.press("Home");
  for (let index = 0; index < 3; index++) await page.keyboard.press("Shift+ArrowRight");
  await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "链接", exact: true }).click();
  const form = page.getByRole("dialog", { name: "插入链接" });
  await form.getByLabel("文本").fill("新名称");
  await form.getByLabel("链接", { exact: true }).fill("https://example.com");
  await form.getByRole("button", { name: "确定" }).click();

  const checkMarks = async (expectedText: string, expectedUrl: string) => {
    const result = await page.evaluate(
      () => window.__semloRequireFixture("linkFormatTest").getSnapshot().json.content?.[0]?.content?.[0],
    );
    expect(result?.text).toBe(expectedText);
    expect(result?.marks?.some((mark) => mark.type === "bold")).toBe(true);
    expect(result?.marks?.some((mark) => mark.type === "italic")).toBe(true);
    expect(result?.marks?.find((mark) => mark.type === "textStyle")?.attrs?.color).toMatch(/(ff0000|255,\s*0,\s*0)/i);
    expect(result?.marks?.find((mark) => mark.type === "link")?.attrs?.href).toBe(expectedUrl);
  };
  await checkMarks("新名称", "https://example.com");

  await page.waitForTimeout(600);
  await prose.locator("a").click();
  await page.keyboard.press("Meta+k");
  await form.getByLabel("文本").fill("再次修改");
  await form.getByLabel("链接", { exact: true }).fill("https://example.org");
  await form.getByRole("button", { name: "确定" }).click();
  await checkMarks("再次修改", "https://example.org");
  await page.evaluate(() => window.__semloRequireFixture("linkFormatTest").editor.commands.focus());
  await expect(prose).toBeFocused();
  await page.keyboard.press("Meta+z");
  await checkMarks("新名称", "https://example.com");
  await page.keyboard.press("Meta+Shift+z");
  await checkMarks("再次修改", "https://example.org");

  await page.evaluate(() => window.__semloRequireFixture("linkFormatTest").destroy());
  expect(errors).toEqual([]);
});

test("inserting a link at an empty cursor keeps the current typing style", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'link-format-test'
      document.body.prepend(host)
      window.linkFormatTest = createEditor({ element: host, content: '<p></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.linkFormatTest));
  const host = page.locator("#link-format-test");
  await host.locator(".semlo-editor-prose p").click();
  await host.getByRole("button", { name: "加粗" }).click();
  await host.getByRole("button", { name: "链接", exact: true }).click();
  const form = page.getByRole("dialog", { name: "插入链接" });
  await form.getByLabel("文本").fill("粗体链接");
  await form.getByLabel("链接", { exact: true }).fill("https://example.com");
  await form.getByRole("button", { name: "确定" }).click();
  await expect(host.locator(".semlo-editor-prose a strong")).toHaveText("粗体链接");
  await page.evaluate(() => window.__semloRequireFixture("linkFormatTest").destroy());
});

test("links accept anchors and relative paths while rejecting unsafe schemes", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'link-format-test'
      document.body.prepend(host)
      window.linkFormatTest = createEditor({ element: host, content: '<p></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.linkFormatTest));
  const host = page.locator("#link-format-test");
  const prose = host.locator(".semlo-editor-prose");
  const form = page.getByRole("dialog", { name: "插入链接" });
  const open = async () => {
    await prose.locator("p").click();
    await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "链接", exact: true }).click();
  };

  for (const href of ["#heading", "./relative", "../relative"]) {
    await page.evaluate(() => window.__semloRequireFixture("linkFormatTest").setContent("<p></p>"));
    await open();
    await form.getByLabel("链接", { exact: true }).fill(href);
    await form.getByRole("button", { name: "确定" }).click();
    await expect(prose.locator("a")).toHaveAttribute("href", href);
    await page.evaluate(() => {
      const html = window.__semloRequireFixture("linkFormatTest").getSnapshot().html;
      window.__semloRequireFixture("linkFormatTest").setContent(html);
    });
    await expect(prose.locator("a")).toHaveAttribute("href", href);
  }

  await page.evaluate(() => window.__semloRequireFixture("linkFormatTest").setContent("<p></p>"));
  await open();
  const address = form.getByLabel("链接", { exact: true });
  await address.fill("javascript:alert(1)");
  await form.getByRole("button", { name: "确定" }).click();
  await expect(form).toBeVisible();
  expect(await address.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  const placeholder = prose.locator("a[data-semlo-editor-link-placeholder]");
  await expect(placeholder).toHaveCount(1);
  await expect(placeholder).not.toHaveAttribute("href");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__semloRequireFixture("linkFormatTest").destroy());
});
