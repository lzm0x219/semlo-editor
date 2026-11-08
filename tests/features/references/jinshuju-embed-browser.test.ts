import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    jinshujuTestEditor?: EditorController;
    jinshujuEchoChanges?: number;
  }
}

const officialFormURL = "https://jinshuju.net/f/KOMVqn";
const officialEmbedURL = "https://jinshuju.net/f/KOMVqn?background=white&banner=show&embedded=true&inner_redirect=true";
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.jinshujuTestEditor?.destroy());
});

function documentWithForm(url: string): Parameters<EditorController["setContent"]>[0] {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "原有前文", marks: [{ type: "bold" }] }] },
      { type: "semloEditorEmbed", attrs: { provider: "jinshuju", url, draft: "" } },
      { type: "paragraph", content: [{ type: "text", text: "原有后文", marks: [{ type: "italic" }] }] },
    ],
  };
}
async function mount(page: Page, echo: "json" | "html" | null = null) {
  // 本地路由只检查地址与编辑历史，不访问或提交真实表单。
  await page.route("https://jinshuju.net/**", (route) => route.fulfill({ status: 200, body: "Jinshuju URL fixture" }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host=document.createElement('div');host.id='jinshuju-test';document.body.prepend(host);
      window.jinshujuEchoChanges=0;
      let controller;
      controller=createEditor({element:host,outline:false,content:${JSON.stringify(documentWithForm(""))},onChange:${
        echo
          ? `snapshot=>{window.jinshujuEchoChanges++;controller.setContent(snapshot[${JSON.stringify(echo)}]);}`
          : "undefined"
      }});
      window.jinshujuTestEditor=controller;
    `,
  });
  await page.waitForFunction(() => Boolean(window.jinshujuTestEditor));
  return page.locator("#jinshuju-test");
}
const currentSnapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").getSnapshot());

test("Jinshuju input, undo, conversion, HTML and JSON round trips", async ({ page }) => {
  await page.route("https://jinshuju.net/**", (route) => route.fulfill({ status: 200, body: "Jinshuju fixture" }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'jinshuju-test'; document.body.prepend(host);
    window.jinshujuTestEditor = createEditor({element: host, outline: false, content: '<p>第一段</p>'});
  `,
  });
  const host = page.locator("#jinshuju-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("金数据");
  await panel.locator('[data-command="jinshuju"]').click();
  const input = host.getByLabel("金数据链接");
  await expect(input).toBeFocused();
  await expect(host.getByRole("button", { name: "查看示例", includeHidden: true })).toBeHidden();
  await input.fill("https://jinshuju.net/f/an1MIH");
  await input.press("Enter");
  const frame = host.locator("iframe");
  await expect(frame).toHaveAttribute(
    "src",
    "https://jinshuju.net/f/an1MIH?background=white&banner=show&embedded=true&inner_redirect=true",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(input).toHaveValue("https://jinshuju.net/f/an1MIH");
  expect(await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.redo())).toBe(
    true,
  );
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").setContent("<p>替换</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("jinshujuTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveCount(1);
  }
  await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await expect(host.getByRole("link", { name: "打开链接" })).toHaveAttribute("href", "https://jinshuju.net/f/an1MIH");
  await host.getByRole("button", { name: "转换为链接" }).click();
  const link = host.locator(".semlo-editor-prose a");
  const embedded = "https://jinshuju.net/f/an1MIH?background=white&banner=show&embedded=true&inner_redirect=true";
  await expect(link).toHaveText(embedded);
  await expect(link).toHaveAttribute("href", embedded);
  const converted = await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").getSnapshot());
  expect(await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(frame).toHaveCount(1);
  expect((await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").getSnapshot())).json).toEqual(
    snapshot.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(link).toHaveText(embedded);
  await expect(link).toHaveAttribute("href", embedded);
  expect((await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").getSnapshot())).json).toEqual(
    converted.json,
  );
  await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").destroy());
});

for (const echo of ["json", "html"] as const) {
  test(`${echo}: 官方公开表单直接转换保留四参、前后文与单步撤销重做`, async ({ page }) => {
    const host = await mount(page, echo);
    const card = host.locator(".semlo-editor-embed");
    await expect(card.getByRole("button", { name: "查看示例", includeHidden: true })).toBeHidden();
    const input = card.getByLabel("金数据链接");
    await input.fill(officialFormURL);
    await input.press("Enter");
    await expect(card.locator("iframe")).toHaveAttribute("src", officialEmbedURL);
    const before = await currentSnapshot(page);
    expect(before.json.content?.[1].attrs?.url).toBe(officialFormURL);
    const changes = await page.evaluate(() => window.jinshujuEchoChanges!);
    await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.setTextSelection(1));
    await card.getByRole("button", { name: "选择嵌入内容" }).click();
    await expect(card.getByRole("link", { name: "打开链接" })).toHaveAttribute("href", officialFormURL);
    const convert = card.getByRole("button", { name: "转换为链接" });
    if (echo === "html") await convert.press("Enter");
    else await convert.click();
    const link = host.locator(".semlo-editor-prose p a");
    await expect(link).toHaveText(officialEmbedURL);
    await expect(link).toHaveAttribute("href", officialEmbedURL);
    await expect(card).toHaveCount(0);
    const converted = await currentSnapshot(page);
    expect(converted.json.content?.[0]).toEqual(before.json.content?.[0]);
    expect(converted.json.content?.[2]).toEqual(before.json.content?.[2]);
    expect(converted.json.attrs).toEqual(before.json.attrs);
    expect(await page.evaluate(() => window.jinshujuEchoChanges!)).toBeGreaterThan(changes);
    expect(await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await currentSnapshot(page)).json).toEqual(before.json);
    await expect(card.locator("iframe")).toHaveAttribute("src", officialEmbedURL);
    expect(await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await currentSnapshot(page)).json).toEqual(converted.json);
    await expect(link).toHaveText(officialEmbedURL);
    await expect(link).toHaveAttribute("href", officialEmbedURL);
  });
}

test("金数据转换覆盖四个显示参数并保留既有channel，原始分享数据可撤销恢复", async ({ page }) => {
  const host = await mount(page);
  const raw =
    "https://jinshuju.net/f/KOMVqn?channel=demo&background=black&banner=hide&embedded=false&inner_redirect=false#section";
  const canonical =
    "https://jinshuju.net/f/KOMVqn?channel=demo&background=black&banner=hide&embedded=false&inner_redirect=false";
  const expected =
    "https://jinshuju.net/f/KOMVqn?channel=demo&background=white&banner=show&embedded=true&inner_redirect=true";
  await page.evaluate(
    (value) => window.__semloRequireFixture("jinshujuTestEditor").setContent(value),
    documentWithForm(raw),
  );
  const card = host.locator(".semlo-editor-embed");
  const before = await currentSnapshot(page);
  expect(before.json.content?.[1].attrs?.url).toBe(raw);
  await expect(card.locator("iframe")).toHaveAttribute("src", expected);
  await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.setTextSelection(1));
  await card.getByRole("button", { name: "选择嵌入内容" }).click();
  await expect(card.getByRole("link", { name: "打开链接" })).toHaveAttribute("href", canonical);
  await card.getByRole("button", { name: "转换为链接" }).click();
  const link = host.locator(".semlo-editor-prose p a");
  await expect(link).toHaveText(expected);
  await expect(link).toHaveAttribute("href", expected);
  expect(await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await currentSnapshot(page)).json).toEqual(before.json);
  await expect(card.locator("iframe")).toHaveAttribute("src", expected);
});
