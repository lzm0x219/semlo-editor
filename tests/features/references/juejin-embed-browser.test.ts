import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    juejinTestEditor?: EditorController;
  }
}

test("Juejin input, undo, conversion, HTML and JSON round trips", async ({ page }) => {
  const penUrl = "https://code.juejin.cn/pen/7111233570496053255";
  const embedUrl = `${penUrl}?embed=true`;
  await page.route("https://code.juejin.cn/**", (route) => route.fulfill({ status: 200, body: "Juejin fixture" }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'juejin-test'; document.body.prepend(host);
    window.juejinTestEditor = createEditor({element: host, outline: false, content: '<p>第一段</p>'});
  `,
  });
  const host = page.locator("#juejin-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("码上掘金");
  await panel.locator('[data-command="juejin"]').click();
  const input = host.getByLabel("码上掘金链接");
  await expect(input).toBeFocused();
  await input.fill(penUrl);
  await input.press("Enter");
  const frame = host.locator("iframe");
  await expect(frame).toHaveAttribute("src", embedUrl);
  expect(await page.evaluate(() => window.__semloRequireFixture("juejinTestEditor").editor.commands.undo())).toBe(true);
  await expect(input).toHaveValue(penUrl);
  expect(await page.evaluate(() => window.__semloRequireFixture("juejinTestEditor").editor.commands.redo())).toBe(true);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("juejinTestEditor").getSnapshot());
  expect(snapshot.json.content?.find((node) => node.type === "semloEditorEmbed")?.attrs?.url).toBe(penUrl);
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("juejinTestEditor").setContent("<p>替换</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("juejinTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("juejinTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveCount(1);
  }
  await page.evaluate(() => window.__semloRequireFixture("juejinTestEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await expect(host.getByRole("link", { name: "打开链接" })).toHaveAttribute("href", penUrl);
  await host.getByRole("button", { name: "转换为链接" }).click();
  const link = host.locator(".semlo-editor-prose a");
  await expect(link).toHaveText(embedUrl, { timeout: 2_000 });
  await expect(link).toHaveAttribute("href", embedUrl);
  expect(await page.evaluate(() => window.__semloRequireFixture("juejinTestEditor").editor.commands.undo())).toBe(true);
  await expect(frame).toHaveAttribute("src", embedUrl);
  expect((await page.evaluate(() => window.__semloRequireFixture("juejinTestEditor").getSnapshot())).json).toEqual(
    snapshot.json,
  );
  await page.evaluate(() => window.__semloRequireFixture("juejinTestEditor").destroy());
});
