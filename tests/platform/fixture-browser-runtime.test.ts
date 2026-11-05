import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

test("fixture guards reject uninitialized globals and preserve valid values", async ({ page }) => {
  const origin = process.env.SEMLO_TEST_ORIGIN;
  if (!origin) throw new Error("Rstest browser server was not started");
  await installFixtureGuards(page);
  await page.goto(origin);

  await expect(page.evaluate(() => Reflect.get(window, "__semloRequireFixture")("blockApi"))).rejects.toThrow(
    "Browser fixture global blockApi is not initialized",
  );
  await expect(page.evaluate(() => Reflect.get(window, "__semloIncrementFixture")("fontCalls"))).rejects.toThrow(
    "Browser fixture global fontCalls is not initialized",
  );
  await expect(page.evaluate(() => window.__semloRequireValue(undefined, "nested value"))).rejects.toThrow(
    "Browser fixture nested value is not initialized",
  );
  const values = await page.evaluate(() => {
    Reflect.set(window, "fontCalls", 0);
    Reflect.set(window, "copied", "");
    Reflect.set(window, "databaseOldConfirm", null);
    const requireFixture = Reflect.get(window, "__semloRequireFixture");
    const requireDefined = Reflect.get(window, "__semloRequireDefined");
    const increment = Reflect.get(window, "__semloIncrementFixture");
    return {
      zero: requireFixture("fontCalls"),
      empty: requireFixture("copied"),
      nullable: requireDefined("databaseOldConfirm"),
      before: increment("fontCalls"),
      after: requireFixture("fontCalls"),
    };
  });
  expect(values).toEqual({ zero: 0, empty: "", nullable: null, before: 0, after: 1 });

  await page.evaluate(() => Reflect.set(window, "tableTests", {}));
  await expect(page.evaluate(() => Reflect.get(window, "__semloRequireTableEditor")("missing"))).rejects.toThrow(
    "Browser fixture table editor missing is not initialized",
  );
  await page.reload();
  await expect(page.evaluate(() => Reflect.get(window, "__semloRequireFixture")("fontCalls"))).rejects.toThrow(
    "Browser fixture global fontCalls is not initialized",
  );
});

test("fixture guards are available when a test uses setContent without navigating", async ({ page }) => {
  await installFixtureGuards(page);
  await page.setContent("<main>fixture</main>");
  await expect(page.evaluate(() => Reflect.get(window, "__semloRequireFixture")("blockApi"))).rejects.toThrow(
    "Browser fixture global blockApi is not initialized",
  );
});
