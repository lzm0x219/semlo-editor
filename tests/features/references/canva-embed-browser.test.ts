import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    canvaTestEditor?: EditorController;
  }
}

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
  await host.getByRole("button", { name: "转换为链接" }).click();
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute(
    "href",
    "https://www.canva.cn/design/DAD3c63mhHU/view",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").editor.commands.undo())).toBe(true);
  await expect(frame).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("canvaTestEditor").destroy());
});
