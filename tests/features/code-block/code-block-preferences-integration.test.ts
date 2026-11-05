import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/code-block/code-block-preferences-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

for (const framework of ["core", "react", "vue", "solid"]) {
  test(`${framework} restores and saves code preferences while another editor stays isolated`, async ({ page }) => {
    page.setDefaultTimeout(3000);
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
    await page.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
    await page.evaluate(async (framework) => {
      const loaded = {
        language: "python",
        theme: "dark",
        indentMode: "tab",
        indentWidth: 4,
        wordWrap: true,
        showLineNumbers: false,
        codeFontSize: 16,
      };
      await window.__semloRequireFixture("mountCodePreferencesFixture")(framework, "pref-configured", {
        load: () => loaded,
        save: (value) => {
          window.codePreferencesSaved = value;
        },
      });
      await window.__semloRequireFixture("mountCodePreferencesFixture")(framework, "pref-isolated");
      for (const id of ["pref-configured", "pref-isolated"])
        window
          .__semloRequireValue(
            window.__semloRequireFixture("codePreferencesFixtures")[id],
            "codePreferencesFixtures entry",
          )
          .controller.editor.commands.setCodeBlock();
    }, framework);
    const first = page.locator("#pref-configured .semlo-editor-code-card");
    const other = page.locator("#pref-isolated .semlo-editor-code-card");
    await expect(first.getByRole("button", { name: "代码语言" })).toHaveText("Python");
    await expect(first.getByRole("button", { name: "代码主题" })).toHaveText("One Dark Pro");
    await expect(other.getByRole("button", { name: "代码语言" })).toHaveText("Plain Text");
    await first.hover();
    await first.getByRole("button", { name: "代码主题" }).click();
    await page.getByRole("option", { name: "Night Owl", exact: true }).click();
    expect(await page.evaluate(() => window.codePreferencesSaved)).toMatchObject({
      language: "python",
      theme: "night-owl",
      indentMode: "tab",
      indentWidth: 4,
      wordWrap: true,
      showLineNumbers: false,
    });
    await expect(other.getByRole("button", { name: "代码主题" })).toHaveText("Yuque Light");
    await page.evaluate(async (framework) => {
      const saved = window.codePreferencesSaved;
      window
        .__semloRequireValue(
          window.__semloRequireFixture("codePreferencesFixtures")["pref-configured"],
          "codePreferencesFixtures entry",
        )
        .destroy();
      await window.__semloRequireFixture("mountCodePreferencesFixture")(framework, "pref-restored", {
        load: () => saved,
        save: () => {},
      });
      window
        .__semloRequireValue(
          window.__semloRequireFixture("codePreferencesFixtures")["pref-restored"],
          "codePreferencesFixtures entry",
        )
        .controller.editor.commands.setCodeBlock();
    }, framework);
    await expect(page.locator("#pref-restored").getByRole("button", { name: "代码主题" })).toHaveText("Night Owl");
  });
}

for (const framework of ["core", "react", "vue", "solid"]) {
  test(`${framework} continues after host loading and saving fail`, async ({ page }) => {
    page.setDefaultTimeout(3000);
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
    await page.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
    await page.evaluate(async (framework) => {
      const fixture = await window.__semloRequireFixture("mountCodePreferencesFixture")(framework, "pref-failure", {
        load: () => {
          throw new Error("unavailable");
        },
        save: () => {
          throw new Error("full");
        },
      });
      fixture.controller.editor.commands.setCodeBlock();
    }, framework);
    const card = page.locator("#pref-failure .semlo-editor-code-card");
    await expect(card.getByRole("button", { name: "代码语言" })).toHaveText("Plain Text");
    await card.hover();
    await card.getByRole("button", { name: "代码主题" }).click();
    await page.getByRole("option", { name: "Night Owl", exact: true }).click();
    await expect(card.getByRole("button", { name: "代码主题" })).toHaveText("Night Owl");
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("codePreferencesFixtures")["pref-failure"],
          "codePreferencesFixtures entry",
        )
        .controller.editor.commands.setContent("<p></p>"),
    );
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("codePreferencesFixtures")["pref-failure"],
          "codePreferencesFixtures entry",
        )
        .controller.editor.commands.setCodeBlock(),
    );
    await expect(card.getByRole("button", { name: "代码主题" })).toHaveText("Night Owl");
  });
}
