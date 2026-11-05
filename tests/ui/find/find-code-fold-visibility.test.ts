import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("find tracks visible code when folding changes in editable and read-only modes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'find-code-fold-test'
    document.body.append(host)
    window.findCodeFoldEditor = createEditor({ element: host, outline: false,
      content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'javascript' },
        content: [{ type: 'text', text: 'function example() {\\n  return target;\\n}' }] }, { type: 'paragraph' }] } })
  `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findCodeFoldEditor")));
  const host = page.locator("#find-code-fold-test");
  const code = host.locator(".semlo-editor-code-card");
  const fold = code.getByRole("button", { name: "折叠第 1 行代码" });
  // The gutter is virtualized and only renders controls near the viewport.
  await code.scrollIntoViewIfNeeded();
  await expect(fold).toBeVisible();
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("target");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await fold.click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("0");
  await code.getByRole("button", { name: "展开折叠代码" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await page.evaluate(() => Reflect.get(window, "findCodeFoldEditor").setEditable(false));
  await fold.click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("0");
  await code.getByRole("button", { name: "展开折叠代码" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await page.evaluate(() => Reflect.get(window, "findCodeFoldEditor").destroy());
});

test("replace all skips hidden code while replacing a visible match", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'replace-code-fold-test'
    document.body.append(host)
    const code = 'function example() {\\n  return target;\\n}'
    window.replaceCodeFoldEditor = createEditor({ element: host, outline: false,
      content: { type: 'doc', content: [
        { type: 'codeBlock', attrs: { language: 'javascript', folds: [{ from: code.indexOf('{') + 1, to: code.lastIndexOf('}') }] }, content: [{ type: 'text', text: code }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'target' }] }
      ] } })
  `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "replaceCodeFoldEditor")));
  const host = page.locator("#replace-code-fold-test");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "查找内容" }).fill("target");
  await panel.getByRole("textbox", { name: "替换为" }).fill("changed");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await panel.getByRole("button", { name: "全部替换" }).click();
  const json = await page.evaluate(() => Reflect.get(window, "replaceCodeFoldEditor").editor.getJSON());
  expect(json.content[0].content[0].text).toContain("target");
  expect(json.content[1].content[0].text).toBe("changed");
  await page.evaluate(() => Reflect.get(window, "replaceCodeFoldEditor").destroy());
});
