import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    extraLanguageEditor?: EditorController;
  }
}

const samples = [
  ["abap", "ABAP", "DATA value TYPE i.\nWRITE 'hello'."],
  ["agda", "Agda", "data Bool : Set where\n  true : Bool"],
  ["cypher", "Cypher", "MATCH (n:Person) WHERE n.name = $name RETURN n"],
  ["git", "Git", "git commit --message 'example'"],
  ["solidity", "Solidity", "contract Token { function transfer() public { return; } }"],
  ["velocity", "Velocity", "#if($user)\nHello $user\n#end"],
] as const;

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("fallback languages provide labelled approximate highlighting without rewriting content", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'extra-code-languages'
      document.body.prepend(host)
      window.extraLanguageEditor = createEditor({ element: host, outline: false, content: '<p></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.extraLanguageEditor));
  for (const [language, label, text] of samples) {
    expect(codeLowlight.registered(language)).toBe(true);
    await page.evaluate(
      ({ language, text }) =>
        window.__semloRequireFixture("extraLanguageEditor").setContent({
          type: "doc",
          content: [{ type: "codeBlock", attrs: { language }, content: [{ type: "text", text }] }],
        }),
      { language, text },
    );
    const card = page.locator("#extra-code-languages .semlo-editor-code-card");
    await expect(card.getByRole("button", { name: "代码语言" })).toHaveAttribute("title", `${label}（近似高亮）`);
    await expect(card.locator('[class*="hljs-"]').first()).toBeVisible();
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("extraLanguageEditor").getSnapshot());
    expect(snapshot.json.content?.[0].attrs?.language).toBe(language);
    expect(snapshot.json.content?.[0].content?.[0].text).toBe(text);
    await page.evaluate((html) => window.__semloRequireFixture("extraLanguageEditor").setContent(html), snapshot.html);
    expect(
      await page.evaluate(
        () => window.__semloRequireFixture("extraLanguageEditor").editor.state.doc.firstChild?.textContent,
      ),
    ).toBe(text);
  }
  await page.evaluate(() =>
    window.__semloRequireFixture("extraLanguageEditor").setContent({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "cypher", theme: "dark" },
          content: [{ type: "text", text: "MATCH (n:Person) WHERE n.name = $name RETURN n" }],
        },
      ],
    }),
  );
  const variable = page.locator("#extra-code-languages .hljs-variable").getByText("$name", { exact: true });
  await expect(variable).toHaveText("$name");
  expect(await variable.evaluate((element) => getComputedStyle(element).color)).not.toBe(
    await page
      .locator("#extra-code-languages .semlo-editor-code-card code")
      .evaluate((element) => getComputedStyle(element).color),
  );
});
