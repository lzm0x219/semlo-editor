import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-fold-preferences-fixture";
let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-fold-preferences-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const server = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${server.port}`;
  stop = () => server.server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

for (const fault of ["load", "save"] as const) {
  test(`host ${fault} failure leaves editing and in-memory folding usable`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.foldPreferences));
    await page.evaluate(
      (mode) => window.__semloRequireFixture("foldPreferences").mount("A", true, false, undefined, "r1", mode),
      fault,
    );
    const host = page.locator("#fold-preferences-host");
    const before = await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot());
    await host.getByRole("button", { name: "折叠标题：标题" }).click();
    await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
    await host.getByRole("button", { name: "展开标题：标题" }).click();
    await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
    expect(
      await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot()),
    ).toEqual(before);
    expect(errors).toEqual([]);
  });
}

test("malformed stored state is ignored and invalid positions are not applied", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("foldPreferences");
    fixture.records.set("A:r1", {
      version: 999,
      positions: [0],
    } as unknown as import("../../../packages/core/src/index").HeadingFoldPreferences);
    fixture.mount("A");
  });
  const host = page.locator("#fold-preferences-host");
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("foldPreferences");
    fixture.records.set("A:r2", { version: 1, positions: [-1, 99999, 0.5, 0, 0] });
    fixture.mount("A", true, false, undefined, "r2");
  });
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  await page.waitForFunction(() => window.foldPreferences!.records.get("A:r2")?.positions.length === 1);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("foldPreferences").records.get("A:r2")?.positions),
  ).toEqual([0]);
});

test("load reentry that replaces the document cannot restore or save the old revision", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("foldPreferences");
    fixture.records.set("A:r1", { version: 1, positions: [0] });
    fixture.mount("A", true, false, undefined, "r1", "reenter");
  });
  const host = page.locator("#fold-preferences-host");
  await expect(host.locator(".semlo-editor-prose p")).toHaveText("替换后的正文");
  await expect(host.locator(".semlo-editor-prose p")).toBeVisible();
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await expect(host.locator(".semlo-editor-prose p")).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").saves)).toBe(0);
});
