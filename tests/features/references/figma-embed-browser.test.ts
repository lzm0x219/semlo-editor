import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    figmaLegacyEditor?: EditorController;
    figmaLegacyChangeCount?: number;
  }
}

type Content = Parameters<EditorController["setContent"]>[0];
const legacyFile = "https://www.figma.com/file/qwccoVDBmt1FZ6U4eGus2p/%E8%AF%AD%E9%9B%80%E6%8F%92%E5%9B%BE";
const legacyURL = `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(legacyFile)}`;

function documentWith(url: string): Content {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "原有前文", marks: [{ type: "bold" }] }] },
      { type: "semloEditorEmbed", attrs: { provider: "figma", url, draft: "" } },
      { type: "paragraph", content: [{ type: "text", text: "原有后文", marks: [{ type: "italic" }] }] },
    ],
  };
}

async function mount(page: Page, content: Content = documentWith(legacyURL), echo: "json" | "html" | null = null) {
  // 只检查地址与交互；本地响应不证明 Figma 文件或账号具有预览权限。
  await page.route("https://**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<p>仅用于嵌入地址测试</p>" }),
  );
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host=document.createElement('div');host.id='figma-legacy-test';document.body.prepend(host);
      window.figmaLegacyChangeCount=0;
      let instance;
      instance=createEditor({element:host,outline:false,content:${JSON.stringify(content)},onChange:${
        echo
          ? `snapshot=>{window.figmaLegacyChangeCount++;instance.setContent(snapshot[${JSON.stringify(echo)}]);}`
          : "undefined"
      }});
      window.figmaLegacyEditor=instance;
    `,
  });
  await page.waitForFunction(() => Boolean(window.figmaLegacyEditor));
  return page.locator("#figma-legacy-test");
}

const snapshot = (page: Page) => page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").getSnapshot());

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.figmaLegacyEditor?.destroy());
});

test("legacy JSON and exported HTML preserve the original wrapper and surrounding formatting", async ({ page }) => {
  const host = await mount(page);
  await expect(host.locator("iframe")).toHaveAttribute("src", legacyURL);
  const original = await snapshot(page);
  expect(original.json.content?.[1].attrs?.url).toBe(legacyURL);
  expect(original.html).not.toContain("<iframe");
  expect(original.html).toContain("data-semlo-editor-embed");
  for (const content of [original.html, original.json]) {
    await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").setContent("<p>临时正文</p>"));
    await page.evaluate((value) => window.__semloRequireFixture("figmaLegacyEditor").setContent(value), content);
    expect((await snapshot(page)).json).toEqual(original.json);
    await expect(host.locator("iframe")).toHaveAttribute("src", legacyURL);
  }
});

test("old HTML without a raw payload accepts the validated wrapper and survives another HTML load", async ({
  page,
}) => {
  const oldHTML = `<p>前文</p><figure data-semlo-editor-embed data-provider="figma" data-url="${legacyURL.replaceAll("&", "&amp;")}">旧 Figma 内容</figure><p>后文</p>`;
  const host = await mount(page, oldHTML);
  await expect(host.locator("iframe")).toHaveAttribute("src", legacyURL);
  const original = await snapshot(page);
  expect(original.json.content?.[1].attrs).toMatchObject({ provider: "figma", url: legacyURL, draft: "" });
  await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").setContent("<p>替换</p>"));
  await page.evaluate((html) => window.__semloRequireFixture("figmaLegacyEditor").setContent(html), original.html);
  expect((await snapshot(page)).json).toEqual(original.json);
  await expect(host.locator("iframe")).toHaveAttribute("src", legacyURL);
});

for (const echo of ["json", "html"] as const) {
  test(`legacy direct conversion keeps the wrapper through ${echo} echo and one undo/redo`, async ({ page }) => {
    const host = await mount(page, documentWith(legacyURL), echo);
    const card = host.locator(".semlo-editor-embed");
    await expect(card.locator("iframe")).toHaveAttribute("src", legacyURL);
    const original = await snapshot(page);
    await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").editor.commands.setTextSelection(1));
    await card.getByRole("button", { name: "选择嵌入内容" }).click();
    await expect(card.getByRole("link", { name: "打开链接" })).toHaveAttribute("href", legacyURL);
    const convert = card.getByRole("button", { name: "转换为链接" });
    if (echo === "html") await convert.press("Enter");
    else await convert.click();
    const link = host.locator(".semlo-editor-prose p a");
    await expect(link).toHaveText(legacyURL);
    await expect(link).toHaveAttribute("href", legacyURL);
    await expect(host.locator("iframe")).toHaveCount(0);
    const converted = await snapshot(page);
    expect(converted.json.content?.[0]).toEqual(original.json.content?.[0]);
    expect(converted.json.content?.[2]).toEqual(original.json.content?.[2]);
    expect(await page.evaluate(() => window.figmaLegacyChangeCount)).toBeGreaterThan(0);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await snapshot(page)).json).toEqual(original.json);
    await expect(card.locator("iframe")).toHaveAttribute("src", legacyURL);
    expect(await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").editor.commands.redo())).toBe(
      true,
    );
    await expect(link).toHaveText(legacyURL);
    await expect(link).toHaveAttribute("href", legacyURL);
    expect((await snapshot(page)).json).toEqual(converted.json);
  });
}

test("the Figma input accepts the legacy wrapper without changing it to a modern address", async ({ page }) => {
  const host = await mount(page, documentWith(""));
  const input = host.getByLabel("Figma链接");
  await input.fill(legacyURL);
  await input.press("Enter");
  await expect(host.locator("iframe")).toHaveAttribute("src", legacyURL);
  expect((await snapshot(page)).json.content?.[1].attrs).toMatchObject({
    provider: "figma",
    url: legacyURL,
    draft: "",
  });
});

test("unsafe loaded wrappers keep their original data but cannot load or convert", async ({ page }) => {
  const host = await mount(page);
  await expect(host.locator("iframe")).toHaveAttribute("src", legacyURL);
  for (const url of [
    "https://www.figma.com/embed?embed_host=share&url=javascript%3Aalert(1)",
    legacyURL + "&url=" + encodeURIComponent(legacyFile),
    legacyURL.replace("www.figma.com/embed", "www.figma.com:443/embed"),
    "https://www.figma.com/embed?embed_host=share&url=" + encodeURIComponent(legacyURL),
  ]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("figmaLegacyEditor").setContent(value),
      documentWith(url),
    );
    const original = await snapshot(page);
    expect(original.json.content?.[1].attrs?.url).toBe(url);
    expect(original.html).not.toContain("href=");
    const card = host.locator(".semlo-editor-embed");
    await expect(card.locator("iframe")).toHaveCount(0);
    await expect(card.getByLabel("Figma链接")).toHaveValue(url);
    await expect(card.getByRole("toolbar", { name: "嵌入内容操作" })).toBeHidden();
    // 隐藏控件不能由用户操作；此处仅覆盖无效目标的防御分支。
    await card.locator('button[aria-label="转换为链接"]').evaluate((button: HTMLButtonElement) => button.click());
    expect(await snapshot(page)).toEqual(original);
    await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").setContent("<p>临时正文</p>"));
    await page.evaluate((html) => window.__semloRequireFixture("figmaLegacyEditor").setContent(html), original.html);
    expect((await snapshot(page)).json).toEqual(original.json);
    await expect(host.locator("iframe")).toHaveCount(0);
  }
});

test("Figma card edits, undo, conversion and HTML/JSON restoration", async ({ page }) => {
  const inputURL = "https://www.figma.com/proto/abc123/demo?node-id=5-3";
  const canonical = "https://www.figma.com/proto/abc123?node-id=5-3";
  const frameURL = "https://embed.figma.com/proto/abc123?node-id=5-3&embed-host=semlo";
  const host = await mount(page, "<p>第一段</p>", "json");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("Figma");
  await panel.locator('[data-command="figma"]').click();
  const input = host.getByLabel("Figma链接");
  await expect(input).toBeFocused();
  await input.fill(inputURL);
  await input.press("Enter");
  const card = host.locator(".semlo-editor-embed");
  const frame = card.locator("iframe");
  await expect(frame).toHaveAttribute("src", frameURL);
  await expect(frame).toHaveAttribute("sandbox", /allow-storage-access-by-user-activation/);
  expect(await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(frame).toHaveCount(0);
  await expect(input).toHaveValue(inputURL);
  expect(await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(frame).toHaveAttribute("src", frameURL);
  const original = await snapshot(page);
  for (const content of [original.html, original.json]) {
    await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").setContent("<p>替换内容</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("figmaLegacyEditor").setContent(value), content);
    expect((await snapshot(page)).json).toEqual(original.json);
    await expect(frame).toHaveAttribute("src", frameURL);
  }
  await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").editor.commands.setTextSelection(1));
  await card.getByRole("button", { name: "选择嵌入内容" }).click();
  await card.getByRole("button", { name: "转换为链接" }).click();
  const link = host.locator(".semlo-editor-prose p a");
  await expect(link).toHaveText(canonical);
  await expect(link).toHaveAttribute("href", canonical);
  expect(await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot(page)).json).toEqual(original.json);
  await expect(frame).toHaveAttribute("src", frameURL);
});

test("legacy embedding remains visible read-only while conversion and destroy respect the instance", async ({
  page,
}) => {
  const host = await mount(page);
  const original = await snapshot(page);
  await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").setEditable(false));
  const card = host.locator(".semlo-editor-embed");
  await expect(card.locator("iframe")).toHaveAttribute("src", legacyURL);
  await expect(card.getByRole("toolbar", { name: "嵌入内容操作" })).toBeHidden();
  await card.locator('button[aria-label="转换为链接"]').evaluate((button: HTMLButtonElement) => button.click());
  expect(await snapshot(page)).toEqual(original);
  const frame = await card.locator("iframe").elementHandle();
  await page.evaluate(() => window.__semloRequireFixture("figmaLegacyEditor").destroy());
  expect(await frame!.evaluate((element) => element.isConnected)).toBe(false);
});
