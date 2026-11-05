import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    amapTestEditor?: EditorController;
  }
}

test("Amap input, undo, conversion, HTML and JSON round trips", async ({ page }) => {
  await page.route("https://ditu.amap.com/**", (route) => route.fulfill({ status: 200, body: "Amap fixture" }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'amap-test'; document.body.prepend(host);
    window.amapTestEditor = createEditor({element: host, outline: false, content: '<p>第一段</p>'});
  `,
  });
  const host = page.locator("#amap-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("高德地图");
  await panel.locator('[data-command="amap"]').click();
  const input = host.getByLabel("高德地图链接");
  await expect(input).toBeFocused();
  await input.fill("https://ditu.amap.com/place/B0ABC");
  await input.press("Enter");
  await expect(host.getByRole("status")).toHaveText("暂不支持显示该网站内容");
  await expect(host.locator("iframe")).toHaveCount(0);
  await input.fill("https://ditu.amap.com/");
  await input.press("Enter");
  const frame = host.locator("iframe");
  await expect(frame).toHaveAttribute("src", "https://ditu.amap.com/");
  expect(await page.evaluate(() => window.__semloRequireFixture("amapTestEditor").editor.commands.undo())).toBe(true);
  await expect(input).toHaveValue("https://ditu.amap.com/");
  expect(await page.evaluate(() => window.__semloRequireFixture("amapTestEditor").editor.commands.redo())).toBe(true);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("amapTestEditor").getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("amapTestEditor").setContent("<p>替换</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("amapTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("amapTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveCount(1);
  }
  await page.evaluate(() => window.__semloRequireFixture("amapTestEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await host.getByRole("button", { name: "转换为链接" }).click();
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute("href", "https://ditu.amap.com/");
  expect(await page.evaluate(() => window.__semloRequireFixture("amapTestEditor").editor.commands.undo())).toBe(true);
  await expect(frame).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("amapTestEditor").destroy());
});
