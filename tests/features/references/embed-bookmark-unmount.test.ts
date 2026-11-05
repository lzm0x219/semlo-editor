import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => installFixtureGuards(page));
for (const kind of ["core", "react", "vue", "solid"] as const) {
  test(`${kind} restarts bookmark resolution on remount and discards old response`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => {
      const editor = window.__semloRequireValue(
        window.__semloRequireFixture("bookmarkFramework").controller,
        "controller",
      ).editor;
      editor.unmount();
      editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
    });
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 2, {
      timeout: 3000,
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      true,
    );
    await page.evaluate(() => {
      const pending = window.__semloRequireFixture("bookmarkFramework").pending;
      pending[0].resolve({ title: "过期结果" });
      pending[1].resolve({ title: "有效结果" });
    });
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("有效结果");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });
  test(`${kind} preserves an embed URL draft across remount`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() => {
      const editor = window.__semloRequireValue(
        window.__semloRequireFixture("bookmarkFramework").controller,
        "controller",
      ).editor;
      editor.commands.setTextSelection(1);
      editor.commands.insertContent({ type: "semloEditorEmbed", attrs: { provider: "codepen", url: "", draft: "" } });
    });
    const card = host.locator(".semlo-editor-embed").first();
    const input = card.getByLabel("CodePen链接");
    await input.fill("https://codepen.io/Mamboleoo/pen/XWJPxpZ");
    await page.evaluate(() => {
      const editor = window.__semloRequireValue(
        window.__semloRequireFixture("bookmarkFramework").controller,
        "controller",
      ).editor;
      editor.unmount();
      editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
    });
    await expect(input).toHaveValue("https://codepen.io/Mamboleoo/pen/XWJPxpZ");
    await input.press("Enter");
    await expect(card.locator("iframe")).toHaveCount(1);
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });
  test(`${kind} changes pending bookmark resolver while unmounted`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    const baseline = await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").integrationWrites);
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("bookmarkFramework");
      const editor = window.__semloRequireValue(fixture.controller, "controller").editor;
      editor.unmount();
      fixture.replace();
    });
    await page.waitForFunction(
      (previous) => window.__semloRequireFixture("bookmarkFramework").integrationWrites > previous,
      baseline,
      { timeout: 3000 },
    );
    await page.evaluate(() => {
      const editor = window.__semloRequireValue(
        window.__semloRequireFixture("bookmarkFramework").controller,
        "controller",
      ).editor;
      editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
    });
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 2, {
      timeout: 3000,
    });
    const state = await page.evaluate(() => {
      const pending = window.__semloRequireFixture("bookmarkFramework").pending;
      return { aborted: pending[0].signal.aborted, next: pending[1].label };
    });
    expect(state).toEqual({ aborted: true, next: "second" });
    await page.evaluate(() =>
      window.__semloRequireFixture("bookmarkFramework").pending[1].resolve({ title: "新解析器" }),
    );
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新解析器");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });
}
