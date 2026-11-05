import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type {} from "../fixtures/lifecycle/integration-update-failure-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/lifecycle/integration-update-failure-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.runIntegrationUpdateFailure === "function");
});

test("listener failure preserves the error and still applies the other integrations", async ({ page }) => {
  const result = await page.evaluate(() => window.__semloRequireFixture("runIntegrationUpdateFailure")("throw"));
  expect(result).toEqual({
    originalError: true,
    secondaryError: false,
    isAggregate: false,
    hostCurrent: true,
    enabledAfterUpdate: true,
    enabledAfterRetry: true,
    destroyed: false,
    notifications: 2,
    otherEditorUsable: true,
  });
});

for (const mode of ["replace", "same-translation"] as const) {
  test(`reentrant integration update retains the latest complete configuration (${mode})`, async ({ page }) => {
    const result = await page.evaluate(
      (mode) => window.__semloRequireFixture("runIntegrationUpdateFailure")(mode),
      mode,
    );
    expect(result).toEqual({
      originalError: false,
      secondaryError: false,
      isAggregate: false,
      hostCurrent: true,
      enabledAfterUpdate: mode === "same-translation",
      enabledAfterRetry: mode === "same-translation",
      destroyed: false,
      notifications: 2,
      otherEditorUsable: true,
    });
  });
}

test("listener destruction preserves its error and does not touch another editor", async ({ page }) => {
  const result = await page.evaluate(() => window.__semloRequireFixture("runIntegrationUpdateFailure")("destroy"));
  expect(result).toEqual({
    originalError: true,
    secondaryError: false,
    isAggregate: false,
    hostCurrent: true,
    enabledAfterUpdate: false,
    enabledAfterRetry: false,
    destroyed: true,
    notifications: 2,
    otherEditorUsable: true,
  });
});

test("a failed integration notification can be retried with the same configuration", async ({ page }) => {
  const result = await page.evaluate(() =>
    window.__semloRequireFixture("runIntegrationUpdateFailure")("translation-failure"),
  );
  expect(result).toEqual({
    originalError: true,
    secondaryError: false,
    isAggregate: false,
    hostCurrent: true,
    enabledAfterUpdate: false,
    enabledAfterRetry: true,
    destroyed: false,
    notifications: 1,
    otherEditorUsable: true,
  });
});

test("multiple failures preserve both original errors and can be retried", async ({ page }) => {
  const result = await page.evaluate(() => window.__semloRequireFixture("runIntegrationUpdateFailure")("two-failures"));
  expect(result).toEqual({
    originalError: true,
    secondaryError: true,
    isAggregate: true,
    hostCurrent: true,
    enabledAfterUpdate: false,
    enabledAfterRetry: true,
    destroyed: false,
    notifications: 2,
    otherEditorUsable: true,
  });
});

test("a runner abort listener can replace the runner synchronously", async ({ page }) => {
  const calls = await page.evaluate(() => window.__semloRequireFixture("runRunnerAbortReentry")());
  expect(calls).toEqual(["original", "latest"]);
});

test("a runner abort listener can destroy the editor during replacement", async ({ page }) => {
  const result = await page.evaluate(() => window.__semloRequireFixture("runRunnerAbortDestroy")());
  expect(result).toEqual({ originalError: undefined, destroyed: true, shellRemoved: true });
});

test("tasks started during runner replacement belong to the new runner and are tracked", async ({ page }) => {
  const result = await page.evaluate(() => window.__semloRequireFixture("runRunnerAbortStartsTask")());
  expect(result).toEqual({ calls: ["old", "new"], abortedAtStart: false, abortedOnNextChange: true });
});
