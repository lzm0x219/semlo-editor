import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    extraIndentEditor?: EditorController;
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("Solidity indentation and GraphQL fallback preserve saved language", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'extra-code-indent'
      document.body.prepend(host)
      window.extraIndentEditor = createEditor({ element: host, outline: false, content: '<p></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.extraIndentEditor));
  for (const [language, input, expected] of [
    [
      "solidity",
      "contract Token {\nfunction run() {\nreturn;\n}\n}",
      "contract Token {\n  function run() {\n    return;\n  }\n}",
    ],
    ["graphql", "query {\nuser {\nname\n}\n}", "query {\nuser {\nname\n}\n}"],
  ]) {
    await page.evaluate(
      ({ language, input }) =>
        window.__semloRequireFixture("extraIndentEditor").setContent({
          type: "doc",
          content: [{ type: "codeBlock", attrs: { language }, content: [{ type: "text", text: input }] }],
        }),
      { language, input },
    );
    const card = page.locator("#extra-code-indent .semlo-editor-code-card");
    await card.hover();
    const trigger = card.getByRole("button", { name: "代码块更多设置" });
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click({ timeout: 3000 });
    await page.getByRole("menuitem", { name: "自动缩进", exact: true }).click({ timeout: 3000 });
    await expect(card.locator("code"), language).toHaveText(expected, { timeout: 3000 });
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("extraIndentEditor").getSnapshot());
    expect(snapshot.json.content?.[0].attrs?.language).toBe(language);
    if (language === "solidity") {
      expect(await page.evaluate(() => window.__semloRequireFixture("extraIndentEditor").editor.commands.undo())).toBe(
        true,
      );
      await expect(card.locator("code")).toHaveText(input);
      expect(await page.evaluate(() => window.__semloRequireFixture("extraIndentEditor").editor.commands.redo())).toBe(
        true,
      );
      await expect(card.locator("code")).toHaveText(expected);
    } else {
      await card.locator("code").click();
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("extraIndentEditor").editor;
        editor.commands.setTextSelection("query {".length + 1);
      });
      await page.keyboard.press("Enter");
      await expect(card.locator("code")).toHaveText("query {\n\nuser {\nname\n}\n}");
      expect(await page.evaluate(() => window.__semloRequireFixture("extraIndentEditor").editor.commands.undo())).toBe(
        true,
      );
      await expect(card.locator("code")).toHaveText(input);
    }
  }
});
