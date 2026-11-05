import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    jinshujuTestEditor?: EditorController;
  }
}

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
  await host.getByRole("button", { name: "转换为链接" }).click();
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute("href", "https://jinshuju.net/f/an1MIH");
  expect(await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(frame).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("jinshujuTestEditor").destroy());
});
