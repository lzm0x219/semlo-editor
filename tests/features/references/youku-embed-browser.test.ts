import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    youkuTestEditor?: EditorController;
  }
}

test("Youku input, undo, conversion, HTML and JSON round trips", async ({ page }) => {
  await page.route("https://player.youku.com/**", (route) => route.fulfill({ status: 200, body: "Youku fixture" }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'youku-test'; document.body.prepend(host);
    window.youkuTestEditor = createEditor({element: host, outline: false, content: '<p>第一段</p>'});
  `,
  });
  const host = page.locator("#youku-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("优酷");
  await panel.locator('[data-command="youku"]').click();
  const input = host.getByLabel("优酷链接");
  await expect(input).toBeFocused();
  await input.fill("https://v.youku.com/v_show/id_XNDc1NDU1MTQwOA==.html");
  await input.press("Enter");
  const frame = host.locator("iframe");
  await expect(frame).toHaveAttribute("src", "https://player.youku.com/embed/XNDc1NDU1MTQwOA==");
  expect(await page.evaluate(() => window.__semloRequireFixture("youkuTestEditor").editor.commands.undo())).toBe(true);
  await expect(input).toHaveValue("https://v.youku.com/v_show/id_XNDc1NDU1MTQwOA==.html");
  expect(await page.evaluate(() => window.__semloRequireFixture("youkuTestEditor").editor.commands.redo())).toBe(true);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("youkuTestEditor").getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("youkuTestEditor").setContent("<p>替换</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("youkuTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("youkuTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveCount(1);
  }
  await page.evaluate(() => window.__semloRequireFixture("youkuTestEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await host.getByRole("button", { name: "转换为链接" }).click();
  await expect(host.locator(".semlo-editor-prose a")).toHaveText("https://player.youku.com/embed/XNDc1NDU1MTQwOA==");
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute(
    "href",
    "https://player.youku.com/embed/XNDc1NDU1MTQwOA==",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("youkuTestEditor").editor.commands.undo())).toBe(true);
  await expect(frame).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("youkuTestEditor").destroy());
});
