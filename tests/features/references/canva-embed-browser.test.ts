import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    canvaTestEditor?: EditorController;
    canvaEchoChanges?: number;
  }
}

const canvaCanonicalURL = "https://www.canva.cn/design/DAD3c63mhHU/view";
const canvaEmbedURL = canvaCanonicalURL + "?embed";

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.canvaTestEditor?.destroy());
});

function documentWithCanva(url: string): Parameters<EditorController["setContent"]>[0] {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "原有前文", marks: [{ type: "bold" }] }] },
      { type: "semloEditorEmbed", attrs: { provider: "canva", url, draft: "" } },
      { type: "paragraph", content: [{ type: "text", text: "原有后文", marks: [{ type: "italic" }] }] },
    ],
  };
}

async function mount(page: Page, url = "", echo: "json" | "html" | null = null) {
  // 路由只验证地址和编辑操作，远程设计是否可见由父级真实浏览器另验。
  await page.route("https://**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "Canva URL fixture" }),
  );
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host=document.createElement('div');host.id='canva-test';document.body.prepend(host);
      window.canvaEchoChanges=0;
      let controller;
      controller=createEditor({element:host,outline:false,content:${JSON.stringify(documentWithCanva(url))},onChange:${
        echo
          ? `snapshot=>{window.canvaEchoChanges++;controller.setContent(snapshot[${JSON.stringify(echo)}]);}`
          : "undefined"
      }});
      window.canvaTestEditor=controller;
    `,
  });
  await page.waitForFunction(() => Boolean(window.canvaTestEditor));
  return page.locator("#canva-test");
}

const currentSnapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").getSnapshot());

test("Canva input, undo, conversion, HTML and JSON round trips", async ({ page }) => {
  await page.route("https://www.canva.cn/**", (route) => route.fulfill({ status: 200, body: "Canva fixture" }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'canva-test'; document.body.prepend(host);
    window.canvaTestEditor = createEditor({element: host, outline: false, content: '<p>第一段</p>'});
  `,
  });
  const host = page.locator("#canva-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("Canva");
  await panel.locator('[data-command="canva"]').click();
  const input = host.getByLabel("Canva链接");
  await expect(input).toBeFocused();
  await input.fill("https://www.canva.cn/design/DAD3c63mhHU/view?embed");
  await input.press("Enter");
  const frame = host.locator("iframe");
  await expect(frame).toHaveAttribute("src", "https://www.canva.cn/design/DAD3c63mhHU/view?embed");
  expect(await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.undo())).toBe(true);
  await expect(input).toHaveValue("https://www.canva.cn/design/DAD3c63mhHU/view?embed");
  expect(await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.redo())).toBe(true);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").setContent("<p>替换</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("canvaTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveCount(1);
  }
  await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await expect(host.getByRole("link", { name: "打开链接" })).toHaveAttribute("href", canvaCanonicalURL);
  expect(snapshot.json.content?.find((node) => node.type === "semloEditorEmbed")?.attrs?.url).toBe(canvaCanonicalURL);
  await host.getByRole("button", { name: "转换为链接" }).click();
  const link = host.locator(".semlo-editor-prose a");
  await expect(link).toHaveText(canvaEmbedURL);
  await expect(link).toHaveAttribute("href", canvaEmbedURL);
  const converted = await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").getSnapshot());
  expect(await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.undo())).toBe(true);
  await expect(frame).toHaveCount(1);
  expect((await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").getSnapshot())).json).toEqual(
    snapshot.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.redo())).toBe(true);
  await expect(link).toHaveText(canvaEmbedURL);
  await expect(link).toHaveAttribute("href", canvaEmbedURL);
  expect((await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").getSnapshot())).json).toEqual(
    converted.json,
  );
  await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").destroy());
});

for (const echo of ["json", "html"] as const) {
  test(`${echo}: Canva示例直接转换保留embed、前后文及单步撤销重做`, async ({ page }) => {
    const host = await mount(page, "", echo);
    const card = host.locator(".semlo-editor-embed");
    await card.getByRole("button", { name: "查看示例" }).click();
    await expect(card.locator("iframe")).toHaveAttribute("src", canvaEmbedURL);
    const before = await currentSnapshot(page);
    expect(before.json.content?.[1].attrs?.url).toBe(canvaCanonicalURL);
    const changes = await page.evaluate(() => window.canvaEchoChanges!);
    await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.setTextSelection(1));
    await card.getByRole("button", { name: "选择嵌入内容" }).click();
    await expect(card.getByRole("link", { name: "打开链接" })).toHaveAttribute("href", canvaCanonicalURL);
    const convert = card.getByRole("button", { name: "转换为链接" });
    if (echo === "html") await convert.press("Enter");
    else await convert.click();
    const link = host.locator(".semlo-editor-prose p a");
    await expect(link).toHaveText(canvaEmbedURL);
    await expect(link).toHaveAttribute("href", canvaEmbedURL);
    await expect(card).toHaveCount(0);
    const converted = await currentSnapshot(page);
    expect(converted.json.content?.[0]).toEqual(before.json.content?.[0]);
    expect(converted.json.content?.[2]).toEqual(before.json.content?.[2]);
    expect(converted.json.attrs).toEqual(before.json.attrs);
    expect(await page.evaluate(() => window.canvaEchoChanges!)).toBeGreaterThan(changes);
    expect(await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await currentSnapshot(page)).json).toEqual(before.json);
    await expect(card.locator("iframe")).toHaveAttribute("src", canvaEmbedURL);
    expect(await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await currentSnapshot(page)).json).toEqual(converted.json);
    await expect(link).toHaveText(canvaEmbedURL);
    await expect(link).toHaveAttribute("href", canvaEmbedURL);
  });
}

test("普通输入和旧分享地址只转换校验后的embed目标，撤销保留原文", async ({ page }) => {
  const share = "https://www.canva.com/design/DACL-CgO2NA/ybPLSlaEaBqein2rb-ohaw/view";
  const host = await mount(page);
  for (const item of [
    { input: true, raw: canvaCanonicalURL, canonical: canvaCanonicalURL, expected: canvaEmbedURL },
    {
      input: false,
      raw: share + "?embed&redirect=https://evil.test&tracking=discard",
      canonical: share,
      expected: share + "?embed",
    },
  ]) {
    if (item.input) {
      const input = host.getByLabel("Canva链接");
      await input.fill(item.raw);
      await input.press("Enter");
    } else {
      await page.evaluate(
        (value) => window.__semloRequireFixture("canvaTestEditor").setContent(value),
        documentWithCanva(item.raw),
      );
    }
    const card = host.locator(".semlo-editor-embed");
    const before = await currentSnapshot(page);
    expect(before.json.content?.[1].attrs?.url).toBe(item.raw);
    await expect(card.locator("iframe")).toHaveAttribute("src", item.expected);
    await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.setTextSelection(1));
    await card.getByRole("button", { name: "选择嵌入内容" }).click();
    await expect(card.getByRole("link", { name: "打开链接" })).toHaveAttribute("href", item.canonical);
    await card.getByRole("button", { name: "转换为链接" }).click();
    const link = host.locator(".semlo-editor-prose p a");
    await expect(link).toHaveText(item.expected);
    await expect(link).toHaveAttribute("href", item.expected);
    expect(await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await currentSnapshot(page)).json).toEqual(before.json);
    await expect(card.locator("iframe")).toHaveAttribute("src", item.expected);
  }
});

test("只读Canva卡片保留展示且直接转换不得写入", async ({ page }) => {
  const host = await mount(page, canvaEmbedURL);
  const before = await currentSnapshot(page);
  await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").setEditable(false));
  const card = host.locator(".semlo-editor-embed");
  await expect(card.locator("iframe")).toHaveAttribute("src", canvaEmbedURL);
  await expect(card.getByRole("toolbar", { name: "嵌入内容操作" })).toBeHidden();
  const convert = card.locator('button[aria-label="转换为链接"]');
  await expect(convert).toBeDisabled();
  // 用户不能点击隐藏控件；直接派发事件覆盖只读处理器的防御分支。
  await convert.evaluate((button) => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(await currentSnapshot(page)).toEqual(before);
});

test("非法提交保留草稿，载入的非法地址不能加载或直接转换", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-embed");
  const input = card.getByLabel("Canva链接");
  await input.fill("javascript:alert(1)");
  const draft = await currentSnapshot(page);
  await input.press("Enter");
  await expect(card.getByRole("status")).toBeVisible();
  expect(await currentSnapshot(page)).toEqual(draft);
  expect(draft.json.content?.[1].attrs).toMatchObject({ url: "", draft: "javascript:alert(1)" });
  for (const url of [
    "javascript:alert(1)",
    "https://www.canva.cn.evil.test/design/id/view?embed",
    "https://evil@www.canva.cn/design/id/view?embed",
    "https://www.canva.cn/design/id/edit?embed",
  ]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("canvaTestEditor").setContent(value),
      documentWithCanva(url),
    );
    const before = await currentSnapshot(page);
    expect(before.json.content?.[1].attrs?.url).toBe(url);
    await expect(card.locator("iframe")).toHaveCount(0);
    await expect(card.getByLabel("Canva链接")).toHaveValue(url);
    await expect(card.getByRole("toolbar", { name: "嵌入内容操作" })).toBeHidden();
    await card.locator('button[aria-label="转换为链接"]').evaluate((button: HTMLButtonElement) => button.click());
    expect(await currentSnapshot(page)).toEqual(before);
    await expect(host.locator(".semlo-editor-prose a[href]")).toHaveCount(0);
  }
});
