import { expect, test, type Page } from "@rstest/playwright";

import { normalizeCodeLanguage } from "../../../packages/core/src/features/code-block/language-aliases";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    aliasEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'code-alias-test'
      document.body.prepend(host)
      window.aliasEditor = createEditor({ element: host, outline: false, content: '<p></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.aliasEditor));
  return page.locator("#code-alias-test");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("language normalization handles non-strings and leaves unknown identifiers unknown", () => {
  for (const invalid of [undefined, null, 42, false, {}, ["js"]])
    expect(normalizeCodeLanguage(invalid)).toBe("plaintext");
  expect(normalizeCodeLanguage("  JS  ")).toBe("javascript");
  expect(normalizeCodeLanguage("Plain Text")).toBe("plaintext");
  expect(normalizeCodeLanguage("PL/SQL")).toBe("plsql");
  expect(normalizeCodeLanguage("Asm")).toBe("x86asm");
  expect(normalizeCodeLanguage("__proto__")).toBe("__proto__");
  expect(normalizeCodeLanguage("constructor")).toBe("constructor");
  expect(normalizeCodeLanguage("js-custom")).toBe("js-custom");
});

test("a js code fence selects JavaScript and uses the same highlighting and indentation", async ({ page }) => {
  const host = await mount(page);
  await host.locator(".semlo-editor-prose").click();
  await page.keyboard.type("```js ");
  const card = host.locator(".semlo-editor-code-card");
  await expect(card).toHaveCount(1);
  await page.keyboard.type("if(x){}");
  await expect(card.locator(".hljs-keyword")).toContainText("if");
  const button = card.getByRole("button", { name: "代码语言" });
  await expect(button).toHaveText("JavaScript");
  await button.click();
  await expect(page.getByRole("option", { name: "JavaScript", exact: true })).toHaveAttribute("aria-selected", "true");
  await card.getByRole("combobox", { name: "搜索代码语言" }).press("Escape");

  const before = await page.evaluate(() => window.__semloRequireFixture("aliasEditor").getSnapshot());
  expect(before.json.content?.find((node) => node.type === "codeBlock")?.attrs?.language).toBe("js");
  expect(before.html).toContain("language-js");
  await page.evaluate(() => {
    window.__semloRequireFixture("aliasEditor").editor.view.focus();
    window.__semloRequireFixture("aliasEditor").editor.commands.setTextSelection(7);
  });
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("aliasEditor").editor.state.doc.firstChild?.textContent),
  ).toBe("if(x){\n  \n}");
  expect(await page.evaluate(() => window.__semloRequireFixture("aliasEditor").editor.commands.undo())).toBe(true);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("aliasEditor").editor.state.doc.firstChild?.textContent),
  ).toBe("if(x){}");
});

test("imported aliases display canonical choices without changing their stored language", async ({ page }) => {
  const host = await mount(page);
  const samples = [
    ["JS", "JavaScript", "javascript", "const value = 1", ".hljs-keyword"],
    ["ts", "TypeScript", "typescript", "const value: number = 1", ".hljs-keyword"],
    ["py", "Python", "python", "def value():", ".hljs-keyword"],
    ["asm", "Asm", "x86asm", "mov eax, 1", ""],
    ["c++", "C++", "cpp", "return 1;", ".hljs-keyword"],
    ["c#", "C#", "csharp", "return 1;", ".hljs-keyword"],
    ["PL/SQL", "PL/SQL", "plsql", "select * from example;", ".hljs-keyword"],
    ["sh", "Bash", "bash", "if true; then echo hi; fi", ".hljs-keyword"],
    ["yml", "YAML", "yaml", "name: value", ".semlo-editor-syntax-atom"],
    ["md", "Markdown", "markdown", "# Title", ".hljs-section"],
    ["txt", "Plain Text", "plaintext", "plain text", ""],
  ] as const;

  for (const [alias, label, canonical, text, token] of samples) {
    await page.evaluate(
      ({ alias, text }) =>
        window
          .__semloRequireFixture("aliasEditor")
          .setContent(`<pre><code class="language-${alias}">${text}</code></pre>`),
      { alias, text },
    );
    const card = host.locator(".semlo-editor-code-card");
    const button = card.getByRole("button", { name: "代码语言" });
    await expect(button).toHaveText(label);
    await expect(button).toHaveAttribute("data-value", canonical);
    if (token) await expect(card.locator(token).first()).toBeVisible();
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("aliasEditor").getSnapshot());
    expect(snapshot.json.content?.find((node) => node.type === "codeBlock")?.attrs?.language).toBe(alias);
    expect(snapshot.html).toContain(`language-${alias}`);
  }
});

test("unknown and object-like language names retain their label and safely fall back to plain text", async ({
  page,
}) => {
  const host = await mount(page);
  for (const name of ["unknown-Language", "__proto__", "constructor"]) {
    await page.evaluate(
      (name) =>
        window.__semloRequireFixture("aliasEditor").setContent({
          type: "doc",
          content: [{ type: "codeBlock", attrs: { language: name }, content: [{ type: "text", text: "const x = 1" }] }],
        }),
      name,
    );
    const card = host.locator(".semlo-editor-code-card");
    const button = card.getByRole("button", { name: "代码语言" });
    await expect(button).toHaveText(name);
    await expect(button).toHaveAttribute("title", `${name}（纯文本）`);
    await expect(card.locator('[class*="hljs-"]')).toHaveCount(0);
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("aliasEditor").getSnapshot());
    expect(snapshot.json.content?.find((node) => node.type === "codeBlock")?.attrs?.language).toBe(name);
  }
});
