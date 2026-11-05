import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    codeFenceEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'code-fence-test'
      document.body.prepend(host)
      window.codeFenceEditor = createEditor({ element: host, outline: false, content: '<p></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.codeFenceEditor));
  return page.locator("#code-fence-test");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("code fences accept language aliases with capitals and punctuation and preserve them on round-trip", async ({
  page,
}) => {
  const host = await mount(page);
  for (const [fence, alias, label] of [
    ["```", "C++", "C++"],
    ["~~~", "C#", "C#"],
    ["```", "PL/SQL", "PL/SQL"],
    ["~~~", "JS", "JavaScript"],
    ["```", "unknown-lang", "unknown-lang"],
  ]) {
    await page.evaluate(() => window.__semloRequireFixture("codeFenceEditor").setContent("<p></p>"));
    await host.locator(".semlo-editor-prose").click();
    await page.keyboard.type(`${fence}${alias} `);
    const card = host.locator(".semlo-editor-code-card");
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("button", { name: "代码语言" })).toHaveText(label);
    await page.keyboard.type("sample");
    expect(await page.evaluate(() => window.__semloRequireFixture("codeFenceEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () => window.__semloRequireFixture("codeFenceEditor").editor.state.doc.firstChild?.textContent,
      ),
    ).toBe(`${fence}${alias} `);
    expect(await page.evaluate(() => window.__semloRequireFixture("codeFenceEditor").editor.commands.redo())).toBe(
      true,
    );
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("codeFenceEditor").getSnapshot());
    expect(snapshot.json.content?.find((node) => node.type === "codeBlock")?.attrs?.language).toBe(alias);
    expect(snapshot.html).toContain(`language-${alias}`);
    await page.evaluate((html) => window.__semloRequireFixture("codeFenceEditor").setContent(html), snapshot.html);
    await expect(host.locator(".semlo-editor-code-card").getByRole("button", { name: "代码语言" })).toHaveText(label);
    expect(
      await page.evaluate(
        () => window.__semloRequireFixture("codeFenceEditor").editor.state.doc.firstChild?.textContent,
      ),
    ).toBe("sample");
  }
});
