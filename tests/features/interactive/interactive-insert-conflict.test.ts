import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { beforeAll, afterAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/interactive/interactive-card-insert-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let directory: string;
let bundle: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-insert-"));
  const builder = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { insert: resolve("tests/fixtures/interactive/interactive-card-insert-fixture.ts") } },
      output: { distPath: { root: directory }, filename: { js: "[name].js" }, cleanDistPath: false },
      tools: { rspack: { optimization: { splitChunks: false, runtimeChunk: false } } },
    },
  });
  await builder.build();
  bundle = await readFile(
    join(
      directory,
      "static/js",
      (await readdir(join(directory, "static/js"))).find((name) => name.endsWith(".js"))!,
    ),
    "utf8",
  );
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(page: import("@rstest/playwright").Page, kind: "checkin" | "vote" = "checkin") {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate((value) => {
    window.__semloRequireFixture("setupInsert")();
    window.__semloRequireFixture("startInsert")(value);
  }, kind);
  await page.waitForFunction(() => window.__semloRequireFixture("insertPending").length === 1);
}

test("late creation reports a conflict when its ID is already used by a card", async ({ page }) => {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.__semloRequireFixture("setupInsert")();
    window
      .__semloRequireFixture("insertEditor")
      .commands.insertContent({ type: "semloEditorCheckin", attrs: { cardId: " existing " } });
    window.__semloRequireFixture("startInsert")("checkin");
    window.__semloRequireFixture("insertCancel").abort();
    window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "existing" });
  });
  await page.waitForFunction(() => window.__semloRequireFixture("insertReports").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([
    { cardId: "existing", reason: "id-conflict" },
  ]);
});

test("a late creation detects a card added while creation was pending", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window
      .__semloRequireFixture("insertEditor")
      .commands.insertContent({ type: "semloEditorVote", attrs: { cardId: "created" } });
    window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "created" });
  });
  await page.waitForFunction(() => window.__semloRequireFixture("insertReports").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([
    { cardId: "created", reason: "id-conflict" },
  ]);
});

test("an existing activity ID with surrounding whitespace still blocks insertion", async ({ page }) => {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.__semloRequireFixture("setupInsert")();
    window
      .__semloRequireFixture("insertEditor")
      .commands.insertContent({ type: "semloEditorCheckin", attrs: { cardId: " existing " } });
    window.__semloRequireFixture("startInsert")("checkin");
    window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "existing" });
  });
  await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
  expect((await page.evaluate(() => window.__semloRequireDefined("insertResult")))?.status).toBe("failed");
  expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([
    { cardId: "existing", reason: "id-conflict" },
  ]);
  expect(await page.locator(".semlo-editor-checkin-card").count()).toBe(1);
});
