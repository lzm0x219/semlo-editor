import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    taobaoTestEditor?: EditorController;
  }
}

test("Taobao input, undo, conversion, HTML and JSON round trips", async ({ page }) => {
  await page.route("https://cloud.video.taobao.com/**", (route) =>
    route.fulfill({ status: 200, body: "Taobao fixture" }),
  );
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'taobao-test'; document.body.prepend(host);
    window.taobaoTestEditor = createEditor({element: host, outline: false, content: '<p>第一段</p>'});
  `,
  });
  const host = page.locator("#taobao-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("淘宝视频");
  await panel.locator('[data-command="taobao"]').click();
  const input = host.getByLabel("淘宝视频链接");
  await expect(input).toBeFocused();
  await expect(host.getByRole("button", { name: "查看示例", includeHidden: true })).toBeHidden();
  await input.fill("https://cloud.video.taobao.com/play/u/1804320196/p/1/e/6/t/1/287344840104.mp4");
  await input.press("Enter");
  const frame = host.locator("video");
  await expect(frame).toHaveAttribute(
    "src",
    "https://cloud.video.taobao.com/play/u/1804320196/p/1/e/6/t/1/287344840104.mp4",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taobaoTestEditor").editor.commands.undo())).toBe(true);
  await expect(input).toHaveValue("https://cloud.video.taobao.com/play/u/1804320196/p/1/e/6/t/1/287344840104.mp4");
  expect(await page.evaluate(() => window.__semloRequireFixture("taobaoTestEditor").editor.commands.redo())).toBe(true);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("taobaoTestEditor").getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("taobaoTestEditor").setContent("<p>替换</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("taobaoTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("taobaoTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveCount(1);
  }
  await page.evaluate(() => window.__semloRequireFixture("taobaoTestEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await host.getByRole("button", { name: "转换为链接" }).click();
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute(
    "href",
    "https://cloud.video.taobao.com/play/u/1804320196/p/1/e/6/t/1/287344840104.mp4",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taobaoTestEditor").editor.commands.undo())).toBe(true);
  await expect(frame).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("taobaoTestEditor").destroy());
});
