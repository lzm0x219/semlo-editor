import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../fixtures/browser/fixture-rsbuild";
import type {} from "../fixtures/lifecycle/translation-failure-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/lifecycle/translation-failure-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountTranslationFailure === "function");
});

async function begin(page: Page, mode: "report" | "destroy" | "integrations" | "document" | "throw") {
  await page.evaluate((mode) => {
    window.__semloRequireFixture("mountTranslationFailure")(mode);
    window.__semloRequireFixture("translationFailureFixture").begin();
  }, mode);
  await page.waitForFunction(() => window.translationFailureFixture?.requests.length === 1);
}

test("active service failure reports its original error and retains panel retry", async ({ page }) => {
  await begin(page, "report");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("translationFailureFixture");
    fixture.requests[0].reject(fixture.failure);
  });
  const panel = page.locator("#translation-failure .semlo-editor-translation-panel");
  await expect(panel.getByRole("status")).toHaveText("翻译失败");
  await expect(panel.getByRole("button", { name: "重试" })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("translationFailureFixture");
      return {
        sameError: fixture.errors[0] === fixture.failure,
        count: fixture.errors.length,
        unhandled: fixture.unhandled,
      };
    }),
  ).toEqual({ sameError: true, count: 1, unhandled: [] });
  await panel.getByRole("button", { name: "重试" }).click();
  await page.waitForFunction(() => window.translationFailureFixture?.requests.length === 2);
  await page.evaluate(() =>
    window.__semloRequireFixture("translationFailureFixture").requests[1].resolve("new translation"),
  );
  await expect(panel.getByLabel("译文")).toHaveText("new translation");
});

test("a service cancellation is not reported and remains retryable", async ({ page }) => {
  await begin(page, "report");
  await page.evaluate(() =>
    window
      .__semloRequireFixture("translationFailureFixture")
      .requests[0].reject(new DOMException("cancelled", "AbortError")),
  );
  const panel = page.locator("#translation-failure .semlo-editor-translation-panel");
  await expect(panel.getByRole("button", { name: "重试" })).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("translationFailureFixture").errors.length)).toBe(0);
});

test("non-Error service failures are normalized for onError", async ({ page }) => {
  await begin(page, "report");
  await page.evaluate(() =>
    window.__semloRequireFixture("translationFailureFixture").requests[0].reject("network failed"),
  );
  await page.waitForFunction(() => window.translationFailureFixture?.errors.length === 1);
  expect(
    await page.evaluate(() => {
      const error = window.__semloRequireFixture("translationFailureFixture").errors[0];
      return { isError: error instanceof Error, message: error.message };
    }),
  ).toEqual({ isError: true, message: "network failed" });
});

test("an exception from onError is observable without an unhandled promise rejection", async ({ page }) => {
  await begin(page, "throw");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("translationFailureFixture");
    fixture.requests[0].reject(fixture.failure);
  });
  await page.waitForFunction(() => window.translationFailureFixture?.thrownErrors.length === 1);
  expect(
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("translationFailureFixture");
      return {
        original: fixture.errors[0] === fixture.failure,
        handler: fixture.thrownErrors[0] === fixture.handlerFailure,
        unhandled: fixture.unhandled,
      };
    }),
  ).toEqual({ original: true, handler: true, unhandled: [] });
  await expect(
    page.locator("#translation-failure .semlo-editor-translation-panel").getByRole("button", { name: "重试" }),
  ).toBeVisible();
});

test("invalid translation results are reported as errors", async ({ page }) => {
  await begin(page, "report");
  await page.evaluate(() =>
    window.__semloRequireFixture("translationFailureFixture").requests[0].resolve(42 as unknown as string),
  );
  await expect(page.locator(".semlo-editor-translation-panel").getByRole("status")).toHaveText("翻译失败");
  expect(
    await page.evaluate(() =>
      window.__semloRequireFixture("translationFailureFixture").errors.map((error) => error.message),
    ),
  ).toEqual(["翻译服务返回了无效结果"]);
});

for (const action of ["close", "integrations", "document", "destroy"] as const) {
  test(`a rejected stale request is not reported after ${action}`, async ({ page }) => {
    await begin(page, "report");
    await page.evaluate((action) => {
      const fixture = window.__semloRequireFixture("translationFailureFixture");
      if (action === "close") document.querySelector<HTMLButtonElement>('[aria-label="关闭翻译"]')!.click();
      if (action === "integrations") fixture.controller.setIntegrations({});
      if (action === "document") fixture.controller.setContent("<p>new document</p>");
      if (action === "destroy") fixture.controller.destroy();
      fixture.requests[0].reject(fixture.failure);
    }, action);
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(
      await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("translationFailureFixture");
        return {
          aborted: fixture.requests[0].signal.aborted,
          errors: fixture.errors.length,
          unhandled: fixture.unhandled,
        };
      }),
    ).toEqual({ aborted: true, errors: 0, unhandled: [] });
  });
}

for (const mode of ["destroy", "integrations", "document"] as const) {
  test(`onError can synchronously change the editor (${mode})`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await begin(page, mode);
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("translationFailureFixture");
      fixture.requests[0].reject(fixture.failure);
    });
    await page.waitForFunction(() => window.translationFailureFixture?.errors.length === 1);
    if (mode === "destroy") {
      await expect(page.locator("#translation-failure .semlo-editor")).toHaveCount(0);
    } else {
      await page.waitForFunction(() => (window.translationFailureFixture?.requests.length ?? 0) >= 2);
      const panel = page.locator("#translation-failure .semlo-editor-translation-panel");
      await expect(panel.getByRole("status")).toHaveText("翻译中…");
      await page.evaluate(() => {
        const requests = window.__semloRequireFixture("translationFailureFixture").requests;
        requests.at(-1)!.resolve("replacement translation");
      });
      await expect(panel.getByLabel("译文")).toHaveText("replacement translation");
    }
    expect(
      await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("translationFailureFixture");
        return {
          sameError: fixture.errors[0] === fixture.failure,
          unhandled: fixture.unhandled,
          otherUsable: fixture.other.editor.commands.insertContent("X"),
        };
      }),
    ).toEqual({ sameError: true, unhandled: [], otherUsable: true });
    expect(pageErrors).toEqual([]);
  });
}
