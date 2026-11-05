import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    figmaTestEditor?: EditorController;
  }
}

test("Figma card edits, undo, conversion and HTML/JSON restoration", async ({ page }) => {
  await page.route("https://embed.figma.com/**", (route) => route.fulfill({ status: 200, body: "Figma fixture" }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div');
    host.id = 'figma-test'; document.body.prepend(host);
    window.figmaTestEditor = createEditor({ element: host, outline: false, content: '<p>第一段</p>' });
  `,
  });
  const host = page.locator("#figma-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("Figma");
  await panel.locator('[data-command="figma"]').click();
  const input = host.getByLabel("Figma链接");
  await expect(input).toBeFocused();
  await input.fill("https://www.figma.com/proto/abc123/demo?node-id=5-3");
  await input.press("Enter");
  const frame = host.locator("iframe");
  await expect(frame).toHaveAttribute("src", "https://embed.figma.com/proto/abc123?node-id=5-3&embed-host=semlo");
  await expect(frame).toHaveAttribute("sandbox", /allow-storage-access-by-user-activation/);
  expect(await page.evaluate(() => window.__semloRequireFixture("figmaTestEditor").editor.commands.undo())).toBe(true);
  await expect(input).toHaveValue("https://www.figma.com/proto/abc123/demo?node-id=5-3");
  expect(await page.evaluate(() => window.__semloRequireFixture("figmaTestEditor").editor.commands.redo())).toBe(true);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("figmaTestEditor").getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("figmaTestEditor").setContent("<p>替换内容</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("figmaTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("figmaTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveCount(1);
  }
  await page.evaluate(() => window.__semloRequireFixture("figmaTestEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await host.getByRole("button", { name: "转换为链接" }).click();
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute(
    "href",
    "https://www.figma.com/proto/abc123?node-id=5-3",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("figmaTestEditor").editor.commands.undo())).toBe(true);
  await expect(frame).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("figmaTestEditor").destroy());
});
