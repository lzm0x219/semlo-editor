import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../fixtures/browser/fixture-rsbuild";
import type {} from "../fixtures/lifecycle/initialization-failure-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/lifecycle/initialization-failure-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.runInitializationFailure === "function");
});
for (const timing of ["none", "before original", "after original"] as const) {
  test(`editor setup preserves errors and releases other resources (${timing})`, async ({ page }) => {
    const result = await page.evaluate(
      (timing) => window.__semloRequireFixture("runInitializationFailure")(timing),
      timing,
    );
    expect(result.setupTriggered).toBe(true);
    expect(result.cleanupTriggered).toBe(timing !== "none");
    expect(result.setupPreserved).toBe(true);
    expect(result.cleanupPreserved).toBe(timing !== "none");
    expect(result.errorCount).toBe(timing === "none" ? 1 : 2);
    expect(result.isAggregate).toBe(timing !== "none");
    expect(result.destroyEvents).toBe(1);
    expect(result.shell).toBe(false);
    expect(result.editorDestroyed).toBe(true);
    // A host that throws before delegating can leave that one observer alive.
    expect(result.activeObservers).toBe(timing === "before original" ? 1 : 0);
  });
}

for (const cleanupFails of [false, true]) {
  test(`final toolbar refresh failure releases resources even if cleanup fails (${cleanupFails})`, async ({ page }) => {
    const result = await page.evaluate(
      (cleanupFails) => window.__semloRequireFixture("runRefreshFailure")(cleanupFails),
      cleanupFails,
    );
    expect(result).toEqual({
      originalError: true,
      cleanupError: cleanupFails,
      errorCount: cleanupFails ? 2 : 1,
      destroyed: true,
      destroyEvents: 1,
      shellRemoved: true,
      otherEditorUsable: true,
    });
  });
}
