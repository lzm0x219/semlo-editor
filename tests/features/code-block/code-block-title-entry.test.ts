import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    codeTitleEditor?: EditorController;
  }
}

test("Enter finishes a code block title and the saved title survives HTML and JSON round trips", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'code-title-entry'
      document.body.prepend(host)
      window.codeTitleEditor = createEditor({ element: host, outline: false,
        content: '<pre><code>const answer = 42</code></pre>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.codeTitleEditor));
  const card = page.locator("#code-title-entry .semlo-editor-code-card");
  await card.hover();
  const title = card.getByRole("textbox", { name: "代码块名称" });
  await title.fill("示例标题");
  await expect(title).toBeFocused();
  await title.press("Enter");
  await expect(title).not.toBeFocused();
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("codeTitleEditor").getSnapshot());
  expect(snapshot.json.content?.[0].attrs?.title).toBe("示例标题");
  expect(snapshot.html).toContain('data-title="示例标题"');
  for (const content of [snapshot.json, snapshot.html]) {
    await page.evaluate((value) => window.__semloRequireFixture("codeTitleEditor").setContent(value), content);
    await expect(title).toHaveValue("示例标题");
    await expect(card.locator("code")).toHaveText("const answer = 42");
  }
  await card.hover();
  await title.click();
  await title.fill("示例标题追加");
  await title.press("ControlOrMeta+z");
  await expect(title).toHaveValue("示例标题");
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("codeTitleEditor").getSnapshot())).json.content?.[0].attrs
      ?.title,
  ).toBe("示例标题");
});
