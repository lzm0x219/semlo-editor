import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    yidaTestEditor?: EditorController;
  }
}

test("Yida validates input, restores history and offers the original link when framing is refused", async ({
  page,
}) => {
  await page.route("https://www.aliwork.com/**", (route) =>
    route.fulfill({ status: 200, headers: { "x-frame-options": "DENY" }, body: "Yida fixture" }),
  );
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'yida-test'; document.body.prepend(host);
    window.yidaTestEditor = createEditor({element: host, outline: false, content: '<p>正文</p>'});
  `,
  });
  const host = page.locator("#yida-test");
  await host.locator(".semlo-editor-prose p").click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("宜搭");
  await panel.locator('[data-command="yida"]').click();
  const input = host.getByLabel("宜搭链接");
  await expect(input).toBeFocused();
  await input.fill("https://www.aliwork.com/s/private");
  await input.press("Enter");
  await expect(host.getByRole("status")).toHaveText("暂不支持显示该网站内容");
  await expect(host.locator("iframe")).toHaveCount(0);
  const url = "https://www.aliwork.com/o/customer_cases";
  await input.fill(url);
  await input.press("Enter");
  const frame = host.locator("iframe");
  await expect(frame).toHaveAttribute("src", url);
  expect(await page.evaluate(() => window.__semloRequireFixture("yidaTestEditor").editor.commands.undo())).toBe(true);
  await expect(input).toHaveValue(url);
  expect(await page.evaluate(() => window.__semloRequireFixture("yidaTestEditor").editor.commands.redo())).toBe(true);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("yidaTestEditor").getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("yidaTestEditor").setContent("<p>替换</p>"));
    await page.evaluate((value) => window.__semloRequireFixture("yidaTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("yidaTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveAttribute("src", url);
  }
  await page.setViewportSize({ width: 375, height: 700 });
  await page.evaluate(() => window.__semloRequireFixture("yidaTestEditor").setEditable(false));
  const original = host.getByRole("link", { name: "打开链接" });
  await expect(original).toBeVisible({ timeout: 2_000 });
  await expect(original).toHaveAttribute("href", url);
  await expect(original).toHaveAttribute("target", "_blank");
  await original.focus();
  await expect(original).toBeFocused();
  await expect(host.getByRole("button", { name: "转换为链接" })).toBeHidden();
  expect((await page.evaluate(() => window.__semloRequireFixture("yidaTestEditor").getSnapshot())).json).toEqual(
    snapshot.json,
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("yidaTestEditor");
    editor.setEditable(true);
    editor.editor.commands.setTextSelection(1);
  });
  await expect(host.locator(".semlo-editor-embed-read-link")).toBeHidden();
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await expect(original).toHaveCount(1);
  await expect(original).toHaveAttribute("href", url);
  await page.evaluate(() => window.__semloRequireFixture("yidaTestEditor").destroy());
});
