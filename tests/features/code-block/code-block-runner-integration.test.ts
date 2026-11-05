import { expect, test } from "@rstest/playwright";

import type { CodeRunRequest } from "../../../packages/core/src/features/code-block/runner";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/code-block/code-block-preferences-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    codeRunnerProbe?: {
      requests: CodeRunRequest[];
      rejects: ((error: Error) => void)[];
      errors: string[];
    };
  }
}

for (const framework of ["core", "react", "vue", "solid"]) {
  test(`${framework} delegates running, reports errors, and cancels replaced or destroyed services`, async ({
    page,
  }) => {
    page.setDefaultTimeout(4000);
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
    await page.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
    await page.evaluate(async (framework) => {
      const probe: Window["codeRunnerProbe"] = (window.codeRunnerProbe = { requests: [], rejects: [], errors: [] });
      const runner = (request: CodeRunRequest) => {
        probe.requests.push(request);
        return new Promise<void>((_resolve, reject) => probe.rejects.push(reject));
      };
      const fixture = await window.__semloRequireFixture("mountCodePreferencesFixture")(
        framework,
        "runner-host",
        undefined,
        runner,
        (error) => probe.errors.push(error.message),
      );
      fixture.controller.editor.commands.setContent({
        type: "doc",
        content: [
          { type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "console.log(42)" }] },
        ],
      });
    }, framework);
    const card = page.locator("#runner-host .semlo-editor-code-card");
    await card.hover();
    const run = card.getByRole("button", { name: "运行代码" });
    await expect(run).toBeVisible();
    const before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("codePreferencesFixtures")["runner-host"],
            "codePreferencesFixtures entry",
          )
          .controller.getSnapshot().json,
    );
    await run.click();
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("codePreferencesFixtures")["runner-host"],
              "codePreferencesFixtures entry",
            )
            .controller.getSnapshot().json,
      ),
    ).toEqual(before);
    expect(
      await page.evaluate(() =>
        window.__semloRequireFixture("codeRunnerProbe").requests.map(({ language, code }) => ({ language, code })),
      ),
    ).toEqual([{ language: "javascript", code: "console.log(42)" }]);
    await page.evaluate(() => {
      window
        .__semloRequireValue(
          window.__semloRequireFixture("codePreferencesFixtures")["runner-host"],
          "codePreferencesFixtures entry",
        )
        .setRunner(() => {
          throw new Error("runner failed");
        });
    });
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("codeRunnerProbe").requests[0].signal.aborted))
      .toBe(true);
    await page.evaluate(() => window.__semloRequireFixture("codeRunnerProbe").rejects[0](new Error("stale")));
    await run.click();
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("codeRunnerProbe").errors))
      .toEqual(["runner failed"]);
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("codePreferencesFixtures")["runner-host"],
          "codePreferencesFixtures entry",
        )
        .setRunner(undefined),
    );
    await expect(run).toBeHidden();
    await card.hover();
    await card.getByRole("button", { name: "代码块更多设置" }).click();
    await expect(page.getByRole("menuitem", { name: "运行代码", exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      const probe = window.__semloRequireFixture("codeRunnerProbe");
      window
        .__semloRequireValue(
          window.__semloRequireFixture("codePreferencesFixtures")["runner-host"],
          "codePreferencesFixtures entry",
        )
        .setRunner((request) => {
          probe.requests.push(request);
          return new Promise<void>((_resolve, reject) => probe.rejects.push(reject));
        });
    });
    await card.hover();
    await expect(run).toBeVisible();
    const more = card.getByRole("button", { name: "代码块更多设置" });
    await more.focus();
    await more.press("Enter");
    const menuRun = page.getByRole("menuitem", { name: "运行代码", exact: true });
    await expect(menuRun).toBeFocused();
    await menuRun.press("Enter");
    await page.evaluate(() => {
      window
        .__semloRequireValue(
          window.__semloRequireFixture("codePreferencesFixtures")["runner-host"],
          "codePreferencesFixtures entry",
        )
        .destroy();
      window.__semloRequireFixture("codeRunnerProbe").rejects[1](new Error("destroyed"));
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("codeRunnerProbe").requests[1].signal.aborted)).toBe(
      true,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("codeRunnerProbe").errors)).toEqual([
      "runner failed",
    ]);
  });
}
