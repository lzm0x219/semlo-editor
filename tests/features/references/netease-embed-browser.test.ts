import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    neteaseTestEditor?: EditorController;
  }
}

test("music card editing, undo and HTML/JSON restoration", async ({ page }) => {
  const songUrl = "https://music.163.com/#/song?id=1420830402";
  const playerUrl = "https://music.163.com/outchain/player?type=2&id=1420830402&auto=0&height=66";
  await page.route("https://music.163.com/**", (route) => route.fulfill({ status: 200, body: "Music fixture" }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'netease-test'; document.body.prepend(host);
    window.neteaseTestEditor = createEditor({ element: host, outline: false, content: '<p>第一段</p>' });
  `,
  });
  const host = page.locator("#netease-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("网易云音乐");
  await panel.locator('[data-command="netease"]').click();
  const input = host.getByLabel("网易云音乐链接");
  await expect(input).toBeFocused();
  await input.fill(songUrl);
  await input.press("Enter");
  const frame = host.locator("iframe");
  await expect(frame).toHaveAttribute("src", playerUrl);
  await expect(host.locator(".semlo-editor-embed")).toHaveAttribute("data-provider", "netease");
  expect(await page.evaluate(() => window.__semloRequireFixture("neteaseTestEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(input).toHaveValue(songUrl);
  expect(await page.evaluate(() => window.__semloRequireFixture("neteaseTestEditor").editor.commands.redo())).toBe(
    true,
  );
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("neteaseTestEditor").getSnapshot());
  expect(snapshot.json.content?.find((node) => node.type === "semloEditorEmbed")?.attrs?.url).toBe(songUrl);
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("neteaseTestEditor").setContent("<p>替换内容</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("neteaseTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("neteaseTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveCount(1);
  }
  await page.evaluate(() => window.__semloRequireFixture("neteaseTestEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await expect(host.getByRole("link", { name: "打开链接" })).toHaveAttribute("href", songUrl);
  await host.getByRole("button", { name: "转换为链接" }).click();
  const link = host.locator(".semlo-editor-prose a");
  await expect(link).toHaveText(playerUrl, { timeout: 2_000 });
  await expect(link).toHaveAttribute("href", playerUrl);
  await expect(frame).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("neteaseTestEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(frame).toHaveCount(1);
  expect((await page.evaluate(() => window.__semloRequireFixture("neteaseTestEditor").getSnapshot())).json).toEqual(
    snapshot.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("neteaseTestEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(link).toHaveAttribute("href", playerUrl);
  await expect(host.locator(".semlo-editor-prose p").first()).toHaveText("第一段");
  await page.evaluate(() => window.__semloRequireFixture("neteaseTestEditor").destroy());
});
