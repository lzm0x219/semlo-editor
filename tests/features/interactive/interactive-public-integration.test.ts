import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/interactive/interactive-public-fixture";
import { readEditorStyles } from "../../fixtures/shared/editor-styles";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let directory: string, bundle: string, styles: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-public-interactive-"));
  const builder = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { integration: resolve("tests/fixtures/interactive/interactive-public-fixture.ts") },
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": resolve("packages/core/src/index.ts") } },
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
  styles = [
    readEditorStyles(),
    await readFile(resolve("packages/core/src/features/blocks/actions/block-actions.css"), "utf8"),
  ].join("\n");
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(page: Page, mode: "core" | "react" | "vue" | "solid", enabled = true) {
  await page.setContent('<div id="editor" style="width:900px;margin:100px"></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ mode, enabled }) => window.__semloRequireFixture("publicMount")(mode, enabled), {
    mode,
    enabled,
  });
  await page.waitForFunction(() => Boolean(window.publicEditor));
}
async function toolbarVote(page: Page) {
  await page.getByRole("button", { name: "插入内容" }).click();
  const menu = page.getByRole("dialog", { name: "插入内容" });
  await menu.locator('.semlo-editor-card-item[data-command="vote"]').click();
}

for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode}: service replacement cancels pending creation and reports to original callback`, async ({ page }) => {
    await mount(page, mode);
    await toolbarVote(page);
    await page.waitForFunction(() => window.__semloRequireFixture("activityPending").length === 1);
    await page.evaluate(() => window.__semloRequireFixture("publicReplace")(true));
    await page.waitForFunction(() => window.__semloRequireFixture("activityPending")[0].signal.aborted);
    await page.evaluate(() => window.__semloRequireFixture("activityPending")[0].resolve({ cardId: "old-activity" }));
    await page.waitForFunction(() => window.__semloRequireFixture("activityReports").length === 1);
    expect(await page.evaluate(() => window.__semloRequireFixture("activityReports"))).toEqual([
      { cardId: "old-activity", callback: "first", reason: "host-changed" },
    ]);
    expect(await page.locator(".semlo-editor-vote-card").count()).toBe(0);
    await toolbarVote(page);
    await page.waitForFunction(() => window.__semloRequireFixture("activityPending").length === 2);
    expect(await page.evaluate(() => window.__semloRequireFixture("activityPending")[1].name)).toBe("second");
    await page.evaluate(() => window.__semloRequireFixture("activityPending")[1].resolve({ cardId: "new-activity" }));
    await expect(page.locator(".semlo-editor-vote-card")).toHaveCount(1);
    await page.evaluate(() => window.__semloRequireFixture("publicDestroy")());
  });
}

test("without a host, interactive menu items are disabled", async ({ page }) => {
  await mount(page, "core", false);
  await page.getByRole("button", { name: "插入内容" }).click();
  await expect(
    page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="vote"]'),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.__semloRequireFixture("activityPending").length)).toBe(0);
});

test("slash text stays until the service succeeds and is replaced in one edit", async ({ page }) => {
  await mount(page, "core");
  await page.locator("#editor .semlo-editor-prose p").click();
  await page.keyboard.type("/vote");
  await page.locator('.semlo-editor-slash-menu .semlo-editor-card-item[data-command="vote"]').click();
  await page.waitForFunction(() => window.__semloRequireFixture("activityPending").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("publicEditor").getSnapshot().text)).toContain("/vote");
  await page.evaluate(() => window.__semloRequireFixture("activityPending")[0].resolve({ cardId: "slash-vote" }));
  await expect(page.locator(".semlo-editor-vote-card")).toHaveCount(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("publicEditor").getSnapshot().text)).not.toContain(
    "/vote",
  );
});

test("block-below waits before inserting and preserves the existing block", async ({ page }) => {
  await mount(page, "core");
  await page.evaluate(() => window.__semloRequireFixture("publicEditor").setContent("<p>原块</p><p>后块</p>"));
  await page.locator("#editor .semlo-editor-prose p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  const before = await page.evaluate(() =>
    JSON.stringify(window.__semloRequireFixture("publicEditor").getSnapshot().json),
  );
  await page
    .getByRole("dialog", { name: "插入内容" })
    .locator('.semlo-editor-card-item[data-command="checkin"]')
    .click();
  await page.waitForFunction(() => window.__semloRequireFixture("activityPending").length === 1);
  expect(
    await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("publicEditor").getSnapshot().json)),
  ).toBe(before);
  await page.evaluate(() => window.__semloRequireFixture("activityPending")[0].resolve({ cardId: "below" }));
  await expect(page.locator(".semlo-editor-checkin-card")).toHaveCount(1);
  const types = await page.evaluate(() =>
    window
      .__semloRequireFixture("publicEditor")
      .getSnapshot()
      .json.content!.map((node) => node.type),
  );
  expect(types).toEqual(["paragraph", "semloEditorCheckin", "paragraph"]);
});

test("slash creation failure preserves the input", async ({ page }) => {
  await mount(page, "core");
  await page.locator("#editor .semlo-editor-prose p").click();
  await page.keyboard.type("/checkin");
  await page.locator('.semlo-editor-slash-menu .semlo-editor-card-item[data-command="checkin"]').click();
  await page.waitForFunction(() => window.__semloRequireFixture("activityPending").length === 1);
  await page.evaluate(() => window.__semloRequireFixture("activityPending")[0].reject(new Error("创建失败")));
  await expect(page.getByRole("alert")).toHaveText("创建失败");
  expect(await page.evaluate(() => window.__semloRequireFixture("publicEditor").getSnapshot().text)).toContain(
    "/checkin",
  );
  await expect(page.locator(".semlo-editor-checkin-card")).toHaveCount(0);
});

test("destroy reports a late creation to the captured callback", async ({ page }) => {
  await mount(page, "core");
  await toolbarVote(page);
  await page.waitForFunction(() => window.__semloRequireFixture("activityPending").length === 1);
  await page.evaluate(() => window.__semloRequireFixture("publicDestroy")());
  expect(await page.evaluate(() => window.__semloRequireFixture("activityPending")[0].signal.aborted)).toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("activityPending")[0].resolve({ cardId: "after-destroy" }));
  await page.waitForFunction(() => window.__semloRequireFixture("activityReports").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("activityReports"))).toEqual([
    { cardId: "after-destroy", callback: "first", reason: "target-changed" },
  ]);
});

test("existing activity reloads state after a host change", async ({ page }) => {
  await mount(page, "core");
  await page.evaluate(() =>
    window
      .__semloRequireFixture("publicEditor")
      .setContent({ type: "doc", content: [{ type: "semloEditorCheckin", attrs: { cardId: "existing" } }] }),
  );
  await expect(page.getByRole("button", { name: "我已读" })).toBeEnabled();
  await page.evaluate(() => window.__semloRequireFixture("publicReplace")(true));
  await expect(page.getByRole("button", { name: "已打卡" })).toBeDisabled();
});
