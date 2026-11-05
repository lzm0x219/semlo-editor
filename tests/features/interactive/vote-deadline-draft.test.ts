import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/interactive/interactive-deadline-fixture";
import { readEditorStyles } from "../../fixtures/shared/editor-styles";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let directory: string, bundle: string, styles: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-deadline-"));
  const builder = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { deadline: resolve("tests/fixtures/interactive/interactive-deadline-fixture.ts") } },
      output: { distPath: { root: directory }, filename: { js: "[name].js" }, cleanDistPath: false },
      tools: { rspack: { optimization: { splitChunks: false, runtimeChunk: false } } },
    },
  });
  await builder.build();
  styles = readEditorStyles();
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
async function mount(page: Page, kind: "vote" | "checkin", content?: string) {
  await page.setContent('<div class="semlo-editor"><div id="editor"></div></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ kind, content }) => window.__semloRequireFixture("mountDeadline")(kind, content), {
    kind,
    content,
  });
}
test("typing a valid timestamp updates the draft calendar and retains the typed time", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T01:02:03"></div>',
  );
  const input = page.getByLabel("截止日期", { exact: true });
  await input.fill("2032-02-27 12:34:56");
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await expect(panel.getByRole("group", { name: "2032年2月" })).toBeVisible();
  await expect(panel.getByRole("option", { name: "小时 12" })).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("button", { name: "2032-02-29" }).click();
  await panel.getByRole("button", { name: "确定" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe(
    "2032-02-29T12:34:56",
  );
});

test("typed date-only draft remains date-only when selecting a different day", async ({ page }) => {
  await mount(page, "vote");
  const input = page.getByLabel("截止日期", { exact: true });
  await input.fill("2032-02-27");
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await expect(panel.getByRole("group", { name: "2032年2月" })).toBeVisible();
  await panel.getByRole("button", { name: "2032-02-29" }).click();
  await panel.getByRole("button", { name: "确定" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe("2032-02-29");
});

test("typed draft and calendar remain local until confirmation", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T01:02:03"></div>',
  );
  const input = page.getByLabel("截止日期", { exact: true });
  await input.fill("2032-02-27 12:34:56");
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await expect(panel.getByRole("group", { name: "2032年2月" })).toBeVisible();
  await input.press("Escape");
  await expect(input).toHaveValue("2030-05-01 01:02:03");
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs"))).toEqual([]);
});

test("composing input does not change calendar until composition ends", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T01:02:03"></div>',
  );
  const input = page.getByLabel("截止日期", { exact: true });
  await input.click();
  await input.evaluate((element: HTMLInputElement) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    element.value = "2032-02-27 12:34:56";
    element.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: false }));
  });
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await expect(panel.getByRole("group", { name: "2030年5月" })).toBeVisible();
  await input.evaluate((element: HTMLInputElement) =>
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
  );
  await expect(panel.getByRole("group", { name: "2032年2月" })).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs"))).toEqual([]);
});

test("typed minute precision survives selecting a day and expands only when choosing seconds", async ({ page }) => {
  await mount(page, "vote");
  const input = page.getByLabel("截止日期", { exact: true });
  await input.fill("2032-02-27 12:34");
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await panel.getByRole("button", { name: "2032-02-29" }).click();
  await expect(input).toHaveValue("2032-02-29 12:34");
  await panel.getByRole("option", { name: "秒 05" }).click();
  await expect(input).toHaveValue("2032-02-29 12:34:05");
  await panel.getByRole("button", { name: "确定" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe(
    "2032-02-29T12:34:05",
  );
});

test("choosing a day retains a typed minute-precision deadline", async ({ page }) => {
  await mount(page, "vote");
  const input = page.getByLabel("截止日期", { exact: true });
  await input.fill("2032-02-27 12:34");
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await panel.getByRole("button", { name: "2032-02-29" }).click();
  await panel.getByRole("button", { name: "确定" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe("2032-02-29T12:34");
});

test("selecting a date after typing preserves the newly typed time", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T01:02:03"></div>',
  );
  const input = page.getByLabel("截止日期", { exact: true });
  await input.fill("2030-05-27 12:34:56");
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await panel.getByRole("button", { name: "2030-05-30" }).click();
  await expect(input).toHaveValue("2030-05-30 12:34:56");
  await panel.getByRole("button", { name: "确定" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe(
    "2030-05-30T12:34:56",
  );
});
