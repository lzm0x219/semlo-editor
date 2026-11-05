import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    indentLanguagesEditor?: EditorController;
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("code indentation uses the selected language parser without delaying the menu action", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'indent-languages'
      document.body.prepend(host)
      window.indentLanguagesEditor = createEditor({ element: host, outline: false })
    `,
  });
  await page.waitForFunction(() => Boolean(window.indentLanguagesEditor));
  const cases = [
    ["cpp", "int main(){\nreturn 0;\n}", "int main(){\n  return 0;\n}"],
    ["csharp", "class C {\nvoid M() {\nreturn;\n}\n}", "class C {\n  void M() {\n    return;\n  }\n}"],
    ["html", "<div>\n<span>hello</span>\n</div>", "<div>\n  <span>hello</span>\n</div>"],
    ["css", ".a {\ncolor: red;\n}", ".a {\n  color: red;\n}"],
    ["xml", "<root>\n<child>text</child>\n</root>", "<root>\n  <child>text</child>\n</root>"],
    ["vue", "<template>\n<div>hello</div>\n</template>", "<template>\n  <div>hello</div>\n</template>"],
  ];
  for (const [language, input, expected] of cases) {
    await page.evaluate(
      ({ language, input }) =>
        window.__semloRequireFixture("indentLanguagesEditor").editor.commands.setContent({
          type: "doc",
          content: [{ type: "codeBlock", attrs: { language }, content: [{ type: "text", text: input }] }],
        }),
      { language, input },
    );
    const card = page.locator("#indent-languages .semlo-editor-code-card");
    await card.hover();
    const trigger = card.getByRole("button", { name: "代码块更多设置" });
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    const menu = page.getByRole("menu", { name: "代码块设置" });
    await expect(menu, language).toBeVisible();
    await menu.getByRole("menuitem", { name: "自动缩进", exact: true }).click();
    await expect(card.locator("code"), language).toHaveText(expected);
  }
});
