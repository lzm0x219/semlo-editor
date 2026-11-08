import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createInlineFixtureRsbuild, readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/interactive/interactive-deadline-fixture";
import { readEditorStyles } from "../../fixtures/shared/editor-styles";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let directory: string, bundle: string, styles: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-deadline-"));
  const builder = await createInlineFixtureRsbuild(
    "deadline",
    resolve("tests/fixtures/interactive/interactive-deadline-fixture.ts"),
    directory,
  );
  await builder.build();
  styles = readEditorStyles();
  bundle = await readInlineFixtureBundle(directory);
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
test("year and month selectors navigate without changing the deadline", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T12:34:56"></div>',
  );
  const input = page.getByLabel("截止日期", { exact: true });
  await input.click();
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await panel.getByRole("button", { name: "2030年" }).click({ timeout: 2500 });
  await expect(panel.getByRole("group", { name: "选择年份" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "2030年" })).toBeFocused();
  await panel.getByRole("button", { name: "2032年" }).click();
  await expect(panel.getByRole("group", { name: "2032年5月" })).toBeVisible();
  await panel.getByRole("button", { name: "May" }).click();
  await expect(panel.getByRole("group", { name: "选择月份" })).toBeVisible();
  await panel.getByRole("button", { name: "2月", exact: true }).click();
  await expect(panel.getByRole("group", { name: "2032年2月" })).toBeVisible();
  await expect(input).toHaveValue("2030-05-01 12:34:56");
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs"))).toEqual([]);
  await panel.getByRole("button", { name: "2032-02-29" }).click();
  await panel.getByRole("button", { name: "确定" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe(
    "2032-02-29T12:34:56",
  );
});

test("decade navigation and escape do not commit changes", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T12:34:56"></div>',
  );
  const input = page.getByLabel("截止日期", { exact: true });
  await input.click();
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await panel.getByRole("button", { name: "2030年" }).click({ timeout: 2500 });
  await panel.getByRole("button", { name: "下十年" }).click();
  await expect(panel.getByRole("button", { name: "2045年" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("2030-05-01 12:34:56");
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs"))).toEqual([]);
});
