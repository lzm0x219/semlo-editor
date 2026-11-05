import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    processonTestEditor?: EditorController;
  }
}

test("ProcessOn input, undo, conversion, HTML and JSON round trips", async ({ page }) => {
  await page.route("https://www.processon.com/**", (route) =>
    route.fulfill({ status: 200, body: "ProcessOn fixture" }),
  );
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'processon-test'; document.body.prepend(host);
    window.processonTestEditor = createEditor({element: host, outline: false, content: '<p>第一段</p>'});
  `,
  });
  const host = page.locator("#processon-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("ProcessOn");
  await panel.locator('[data-command="processon"]').click();
  const input = host.getByLabel("ProcessOn链接");
  await expect(input).toBeFocused();
  await input.fill("https://www.processon.com/view/link/5d006c43e4b0a65d8096b3d8");
  await input.press("Enter");
  const frame = host.locator("iframe");
  await expect(frame).toHaveAttribute("src", "https://www.processon.com/view/link/5d006c43e4b0a65d8096b3d8");
  expect(await page.evaluate(() => window.__semloRequireFixture("processonTestEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(input).toHaveValue("https://www.processon.com/view/link/5d006c43e4b0a65d8096b3d8");
  expect(await page.evaluate(() => window.__semloRequireFixture("processonTestEditor").editor.commands.redo())).toBe(
    true,
  );
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("processonTestEditor").getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("processonTestEditor").setContent("<p>替换</p>"));
    await expect(frame).toHaveCount(0);
    await page.evaluate((value) => window.__semloRequireFixture("processonTestEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("processonTestEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(frame).toHaveCount(1);
  }
  await page.evaluate(() => window.__semloRequireFixture("processonTestEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  await host.getByRole("button", { name: "转换为链接" }).click();
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute(
    "href",
    "https://www.processon.com/view/link/5d006c43e4b0a65d8096b3d8",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("processonTestEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(frame).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("processonTestEditor").destroy());
});
