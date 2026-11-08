import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { expect, test, type Page } from "@rstest/playwright";

let origin: string;
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/find/details-search-history-fixture.ts" } },
      resolve: {
        alias: {
          "@semlo-editor/core$": resolve("packages/core/dist/index.js"),
          "@semlo-editor/core/style.css": resolve("packages/core/dist/style.css"),
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
test.afterAll(async () => stop?.());

async function search(page: Page) {
  await page.goto(origin);
  const host = page.locator("#details-search-history");
  const paragraph = host.locator(".semlo-editor-prose > p").first();
  await expect(host.getByText("折叠命中文字")).toBeHidden();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("新");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("折叠命中");
  await expect(host.getByText("折叠命中文字")).toBeVisible();
  return { host, paragraph, panel };
}

test("折叠正文的搜索展开与前文输入分别撤销重做", async ({ page }) => {
  const { host, paragraph, panel } = await search(page);
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  await paragraph.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(host.getByText("折叠命中文字")).toBeHidden();
  await expect(paragraph).toHaveText("前文新");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(paragraph).toHaveText("前文");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(paragraph).toHaveText("前文新");
  await expect(host.getByText("折叠命中文字")).toBeHidden();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(host.getByText("折叠命中文字")).toBeVisible();
});

test("替换折叠正文后先撤销文字、再撤销展开", async ({ page }) => {
  const { host, paragraph, panel } = await search(page);
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "替换为" }).fill("替换结果");
  await panel.getByRole("button", { name: "替换", exact: true }).click();
  await expect(host.getByText("替换结果文字")).toBeVisible();
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  await paragraph.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(host.getByText("折叠命中文字")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(host.getByText("折叠命中文字")).toBeHidden();
  await expect(paragraph).toHaveText("前文新");
});
