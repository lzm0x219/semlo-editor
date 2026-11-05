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
test("opening and Escape preserve the existing vote deadline and do not sync", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T12:34:56"></div>',
  );
  const input = page.getByLabel("截止日期", { exact: true });
  await input.click();
  await expect(page.getByRole("dialog", { name: "选择截止日期和时间" })).toBeVisible();
  await expect(page.getByRole("group", { name: "2030年5月" })).toBeVisible();
  await expect(page.getByRole("option", { name: "小时 12" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("option", { name: "分钟 34" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("option", { name: "秒 56" })).toHaveAttribute("aria-selected", "true");
  await input.press("Escape");
  await expect(page.getByRole("dialog", { name: "选择截止日期和时间" })).toHaveCount(0);
  await expect(input).toHaveValue("2030-05-01 12:34:56");
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs"))).toEqual([]);
});

test("choosing day and time commits seconds once and survives HTML", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T12:34:56"></div>',
  );
  await page.getByLabel("截止日期", { exact: true }).click();
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await panel.getByRole("button", { name: "2030-05-31" }).click();
  await panel.getByRole("option", { name: "小时 23" }).click();
  await panel.getByRole("option", { name: "分钟 59" }).click();
  await panel.getByRole("option", { name: "秒 59" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs"))).toEqual([]);
  await panel.getByRole("button", { name: "确定" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe(
    "2030-05-31T23:59:59",
  );
  const html = await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").getHTML());
  await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").destroy());
  await mount(page, "vote", html);
  await expect(page.getByLabel("截止日期", { exact: true })).toHaveValue("2030-05-31 23:59:59");
});

test("keyboard moves across leap day and confirms the chosen date", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2032-02-28T12:34:56"></div>',
  );
  await page.getByLabel("截止日期", { exact: true }).click();
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  const start = panel.getByRole("button", { name: "2032-02-28" });
  await start.focus();
  await start.press("ArrowRight");
  await expect(panel.getByRole("button", { name: "2032-02-29" })).toBeFocused();
  await page.keyboard.press("Enter");
  await panel.getByRole("button", { name: "确定" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe(
    "2032-02-29T12:34:56",
  );
});

test("empty drafts do not invent a deadline, and invalid typed dates do not persist", async ({ page }) => {
  await mount(page, "vote");
  const input = page.getByLabel("截止日期", { exact: true });
  await input.click();
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await expect(input).toHaveValue("");
  await input.fill("2024-02-30 12:34:56");
  await input.press("Enter");
  await expect(panel).toBeVisible();
  expect(await input.evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(false);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs"))).toEqual([]);
  await input.fill("2024-02-29 12:34:56");
  await input.press("Enter");
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe(
    "2024-02-29T12:34:56",
  );
});

test("now commits immediately and remains after Escape", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T12:34:56"></div>',
  );
  const input = page.getByLabel("截止日期", { exact: true });
  await input.click();
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await panel.getByRole("button", { name: "此刻" }).click();
  await expect(panel).toBeVisible();
  const value = await input.inputValue();
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  expect(value).not.toBe("2030-05-01 12:34:56");
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue(value);
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe(
    value.replace(" ", "T"),
  );
});

test("date-only legacy values remain unchanged without confirmation", async ({ page }) => {
  await mount(page, "vote", '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01"></div>');
  const input = page.getByLabel("截止日期", { exact: true });
  await expect(input).toHaveValue("2030-05-01");
  await input.click();
  await input.press("Escape");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").getJSON().content?.[0]?.attrs?.deadline),
  ).toBe("2030-05-01");
});

test("selecting a time without a date cannot commit", async ({ page }) => {
  await mount(page, "vote");
  const input = page.getByLabel("截止日期", { exact: true });
  await input.click();
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  await panel.getByRole("option", { name: "小时 12" }).click();
  await panel.getByRole("button", { name: "确定" }).click();
  await expect(panel).toBeVisible();
  expect(await input.evaluate((element: HTMLInputElement) => element.validationMessage)).toBe("请先选择日期");
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs"))).toEqual([]);
});

test("month navigation retains keyboard focus so Escape cancels the draft", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T12:34:56"></div>',
  );
  const input = page.getByLabel("截止日期", { exact: true });
  await input.click();
  await page.getByRole("button", { name: "下个月" }).click();
  await expect(page.getByRole("button", { name: "下个月" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "选择截止日期和时间" })).toHaveCount(0);
  await expect(input).toHaveValue("2030-05-01 12:34:56");
});

test("readonly transition closes an open picker and does not persist a draft", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T12:34:56"></div>',
  );
  await page.getByLabel("截止日期", { exact: true }).click();
  await page.getByRole("button", { name: "2030-05-02" }).click();
  await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").setEditable(false));
  await expect(page.getByRole("dialog", { name: "选择截止日期和时间" })).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").getJSON().content?.[0]?.attrs?.deadline),
  ).toBe("2030-05-01T12:34:56");
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs"))).toEqual([]);
});

test("keyboard crosses a non-leap February boundary", async ({ page }) => {
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="1900-02-28T12:34:56"></div>',
  );
  await page.getByLabel("截止日期", { exact: true }).click();
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  const start = panel.getByRole("button", { name: "1900-02-28" });
  await start.focus();
  await start.press("ArrowRight");
  await expect(panel.getByRole("button", { name: "1900-03-01" })).toBeFocused();
  await page.keyboard.press("Enter");
  await panel.getByRole("button", { name: "确定" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe(
    "1900-03-01T12:34:56",
  );
});

test("picker remains inside a narrow viewport and outside click cancels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mount(
    page,
    "vote",
    '<div data-semlo-editor-vote="" data-card-id="activity" data-deadline="2030-05-01T12:34:56"></div>',
  );
  const input = page.getByLabel("截止日期", { exact: true });
  await input.click();
  const panel = page.getByRole("dialog", { name: "选择截止日期和时间" });
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await panel.getByRole("button", { name: "2030-05-02" }).click();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await expect(panel).toHaveCount(0);
  await expect(input).toHaveValue("2030-05-01 12:34:56");
  expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs"))).toEqual([]);
});
