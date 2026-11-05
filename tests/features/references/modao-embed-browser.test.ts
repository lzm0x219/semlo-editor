import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    modaoTestEditor?: EditorController;
  }
}

test("Modao input, undo, conversion, HTML and JSON round trips", async ({ page }) => {
  await page.route("https://free.modao.cc/**", (route) => route.fulfill({ status: 200, body: "Modao fixture" }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'modao-test'; document.body.prepend(host);
    window.modaoTestEditor = createEditor({element: host, outline: false, content: '<p>第一段</p>'});
  `,
  });
  const host = page.locator("#modao-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("墨刀");
  await panel.locator('[data-command="modao"]').click();
  const input = host.getByLabel("墨刀链接");
  await expect(input).toBeFocused();
  await input.fill(
    "https://free.modao.cc/app/2cd26580a6717a147454df7470e7ec464093cba3/embed/v2#screen=sk71k6d1dfxulzx",
  );
  await input.press("Enter");
  const frame = host.locator("iframe");
  await expect(frame).toHaveAttribute(
    "src",
    "https://free.modao.cc/app/2cd26580a6717a147454df7470e7ec464093cba3/embed/v2#screen=sk71k6d1dfxulzx",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("modaoTestEditor").editor.commands.undo())).toBe(true);
  await expect(input).toHaveValue(
    "https://free.modao.cc/app/2cd26580a6717a147454df7470e7ec464093cba3/embed/v2#screen=sk71k6d1dfxulzx",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("modaoTestEditor").editor.commands.redo())).toBe(true);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("modaoTestEditor").getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("modaoTestEditor").setContent("<p>替换</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("modaoTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("modaoTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveCount(1);
  }
  await page.evaluate(() => window.__semloRequireFixture("modaoTestEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await host.getByRole("button", { name: "转换为链接" }).click();
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute(
    "href",
    "https://free.modao.cc/app/2cd26580a6717a147454df7470e7ec464093cba3/embed/v2#screen=sk71k6d1dfxulzx",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("modaoTestEditor").editor.commands.undo())).toBe(true);
  await expect(frame).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("modaoTestEditor").destroy());
});
