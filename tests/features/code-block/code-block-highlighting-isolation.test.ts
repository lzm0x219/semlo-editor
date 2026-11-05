import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

for (const language of ["javascript", "lua"]) {
  test(`${language} highlighting remains isolated between editors`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    const prefix = language === "javascript" ? "const " : "";
    await page.addScriptTag({
      type: "module",
      content: `
        import {createEditor} from '/dist/index.js'
        for (const [id, source] of [['syntax-first', ${JSON.stringify(`${prefix}first = 1`)}], ['syntax-second', ${JSON.stringify(`${prefix}second = 2`)}]]) {
          const host=document.createElement('div');host.id=id;document.body.append(host)
          createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:${JSON.stringify(language)}},content:[{type:'text',text:source}]}]}})
        }
      `,
    });
    const first = page.locator("#syntax-first .semlo-editor-code-card");
    const second = page.locator("#syntax-second .semlo-editor-code-card");
    await expect(first.locator(".semlo-editor-syntax-number").getByText("1", { exact: true })).toBeVisible();
    await expect(second.locator(".semlo-editor-syntax-number").getByText("2", { exact: true })).toBeVisible();
    await first.locator("code").click();
    await page.keyboard.press("End");
    await page.keyboard.type("0");
    await expect(first.locator("code")).toHaveText(`${prefix}first = 10`);
    await expect(second.locator("code")).toHaveText(`${prefix}second = 2`);
    await expect(second.locator(".semlo-editor-syntax-number").getByText("2", { exact: true })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Z");
    await expect(first.locator("code")).toHaveText(`${prefix}first = 1`);
    await expect(second.locator("code")).toHaveText(`${prefix}second = 2`);
    await expect(second.locator(".semlo-editor-syntax-number").getByText("2", { exact: true })).toBeVisible();
  });
}
