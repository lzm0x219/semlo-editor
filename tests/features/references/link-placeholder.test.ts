import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    linkPlaceholderTest?: EditorController;
  }
}

async function mount(page: Page, content: string) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'link-placeholder-test'
      document.body.prepend(host)
      window.linkPlaceholderTest = createEditor({ element: host, content: ${JSON.stringify(content)} })
    `,
  });
  await page.waitForFunction(() => Boolean(window.linkPlaceholderTest));
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("an empty-cursor shortcut inserts an unaddressed link until the user confirms", async ({ page }) => {
  await mount(page, "<p>正文</p>");
  const prose = page.locator("#link-placeholder-test .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Meta+k");

  const form = page.getByRole("dialog", { name: "插入链接" });
  const placeholder = prose.locator("a[data-semlo-editor-link-placeholder]");
  await expect(form.getByLabel("文本")).toHaveValue("链接");
  await expect(placeholder).toHaveText("链接");
  expect(await placeholder.getAttribute("href")).toBeNull();
  const before = await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").getSnapshot());
  expect(
    before.json.content?.[0]?.content?.at(-1)?.marks?.find((mark) => mark.type === "link")?.attrs?.href,
  ).toBeNull();

  await form.getByLabel("文本").fill("未确认的名称");
  await expect(placeholder).toHaveText("链接");
  await page.locator("#link-placeholder-test").click({ position: { x: 1, y: 1 } });
  await expect(form).toHaveCount(0);
  expect((await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").editor.commands.undo());
  await expect(prose).toHaveText("正文");
  await expect(prose.locator("a")).toHaveCount(0);
});

test("the visible cancel action preserves the existing placeholder and returns focus", async ({ page }) => {
  await mount(page, "<p>正文</p>");
  const prose = page.locator("#link-placeholder-test .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Meta+k");
  const form = page.getByRole("dialog", { name: "插入链接" });
  const placeholder = prose.locator("a[data-semlo-editor-link-placeholder]");
  await expect(placeholder).toHaveText("链接");
  await form.getByRole("button", { name: "取消" }).click();
  await expect(form).toHaveCount(0);
  await expect(placeholder).toHaveText("链接");
  await expect(prose).toBeFocused();
  await page.keyboard.press("Meta+z");
  await expect(prose).toHaveText("正文");
});

test("link validation explains examples without excluding mail and relative URLs", async ({ page }) => {
  await mount(page, "<p></p>");
  const prose = page.locator("#link-placeholder-test .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.press("Meta+k");
  const form = page.getByRole("dialog", { name: "插入链接" });
  const address = form.getByLabel("链接", { exact: true });
  await address.fill("javascript:alert(1)");
  await form.getByRole("button", { name: "确定" }).click();
  await expect(form).toBeVisible();
  expect(await address.evaluate((input: HTMLInputElement) => input.validationMessage)).toContain("mailto:");
  await address.fill("mailto:person@example.com");
  await form.getByRole("button", { name: "确定" }).click();
  await expect(prose.locator("a")).toHaveAttribute("href", "mailto:person@example.com");
});

test("link cancellation remains reachable on a narrow viewport with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mount(page, "<p>正文</p>");
  const prose = page.locator("#link-placeholder-test .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Meta+k");
  const form = page.getByRole("dialog", { name: "插入链接" });
  const bounds = await form.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(form).toHaveCount(0);
  await expect(prose).toBeFocused();
});

test("an open link form remains visible when the viewport becomes narrower", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mount(page, "<p>正文</p>");
  await page.locator("#link-placeholder-test").evaluate((host: HTMLElement) => {
    host.style.marginLeft = "240px";
  });
  const prose = page.locator("#link-placeholder-test .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.press("Meta+k");
  const form = page.getByRole("dialog", { name: "插入链接" });
  await expect(form).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(async () => {
      const bounds = await form.boundingBox();
      return bounds ? bounds.x + bounds.width : Infinity;
    })
    .toBeLessThanOrEqual(375);
  await form.getByRole("button", { name: "取消" }).click();
  await expect(prose).toBeFocused();
});

test("a selection becomes a link immediately, retaining its text and formatting when cancelled", async ({ page }) => {
  await mount(page, "<p><strong><em>选中文字</em></strong>以及其他</p>");
  const prose = page.locator("#link-placeholder-test .semlo-editor-prose");
  const original = await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").getSnapshot().json);
  await prose.locator("p").click();
  await expect(prose).toBeFocused();
  await page.evaluate(() =>
    window.__semloRequireFixture("linkPlaceholderTest").editor.commands.setTextSelection({ from: 1, to: 5 }),
  );
  await page.waitForFunction(() => document.getSelection()?.toString() === "选中文字");
  await page.keyboard.press("Meta+k");

  const form = page.getByRole("dialog", { name: "插入链接" });
  const placeholder = prose.locator("a[data-semlo-editor-link-placeholder]");
  await expect(form.getByLabel("文本")).toHaveValue("选中文字");
  await expect(placeholder.locator("strong em")).toHaveText("选中文字");
  expect(await placeholder.getAttribute("href")).toBeNull();
  await form.getByLabel("文本").fill("尚未保存");
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(placeholder.locator("strong em")).toHaveText("选中文字");
  await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").editor.commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").getSnapshot().json)).toEqual(
    original,
  );
});

test("slash insertion and its cancellation undo back to the original slash", async ({ page }) => {
  await mount(page, "<p></p>");
  await page.evaluate(() => localStorage.setItem("semlo-editor.recent-commands.v1", '["link"]'));
  const prose = page.locator("#link-placeholder-test .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.type("/");
  await page.locator(".semlo-editor-slash-menu").getByLabel("最近使用").getByRole("button", { name: "链接" }).click();
  const form = page.getByRole("dialog", { name: "插入链接" });
  const placeholder = prose.locator("a[data-semlo-editor-link-placeholder]");
  await expect(placeholder).toHaveText("链接");
  expect(await placeholder.getAttribute("href")).toBeNull();
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(placeholder).toHaveText("链接");
  await page.keyboard.press("Meta+z");
  await expect(prose).toHaveText("/");
});

test("placeholder links survive HTML and JSON round trips and can later receive an address", async ({ page }) => {
  await mount(page, "<p></p>");
  const prose = page.locator("#link-placeholder-test .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.press("Meta+k");
  await page.keyboard.press("Escape");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("linkPlaceholderTest").setContent("<p>临时内容</p>");
      window.__semloRequireFixture("linkPlaceholderTest").setContent(value);
    }, content);
    const placeholder = prose.locator("a[data-semlo-editor-link-placeholder]");
    await expect(placeholder).toHaveText("链接");
    expect(await placeholder.getAttribute("href")).toBeNull();
    expect((await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").getSnapshot())).json).toEqual(
      snapshot.json,
    );
  }
  await prose.locator("a").click();
  await page.keyboard.press("Meta+k");
  const form = page.getByRole("dialog", { name: "插入链接" });
  await expect(form.getByLabel("文本")).toHaveValue("链接");
  await form.getByLabel("链接", { exact: true }).fill("#heading");
  await form.getByRole("button", { name: "确定" }).click();
  const link = prose.locator("a");
  await expect(link).toHaveAttribute("href", "#heading");
  expect(await link.getAttribute("data-semlo-editor-link-placeholder")).toBeNull();
});

test("document replacement, direct edits, read-only mode and destruction close stale forms", async ({ page }) => {
  await mount(page, "<p></p>");
  const prose = page.locator("#link-placeholder-test .semlo-editor-prose");
  const form = page.getByRole("dialog", { name: "插入链接" });
  const open = async () => {
    await prose.locator("p").first().click();
    await page.keyboard.press("Meta+k");
    await expect(form).toBeVisible();
  };

  await open();
  await page.evaluate(() =>
    window.__semloRequireFixture("linkPlaceholderTest").editor.commands.insertContentAt(1, "新内容"),
  );
  await expect(form).toHaveCount(0);
  await open();
  await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").setContent("<p>替换内容</p>"));
  await expect(form).toHaveCount(0);
  await expect(prose).toHaveText("替换内容");
  await open();
  await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").setEditable(false));
  await expect(form).toHaveCount(0);
  await prose.locator("p").click();
  await page.keyboard.press("Meta+k");
  await expect(form).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").setEditable(true));
  await open();
  await page.evaluate(() => window.__semloRequireFixture("linkPlaceholderTest").destroy());
  await expect(form).toHaveCount(0);
  await expect(prose).toHaveCount(0);
});
