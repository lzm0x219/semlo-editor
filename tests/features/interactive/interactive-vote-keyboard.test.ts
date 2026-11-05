import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/interactive/interactive-history-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let directory: string, bundle: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-history-card-"));
  const builder = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { deadline: resolve("tests/fixtures/interactive/interactive-history-fixture.ts") } },
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
async function mount(page: Page, kind: "vote" | "checkin", _content?: string) {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate((kind) => window.__semloRequireFixture("mountHistoryCard")(kind), kind);
}

test("undo and redo while editing a vote title restore the document and host", async ({ page }) => {
  await mount(page, "vote");
  const title = page.getByLabel("标题");
  await title.click();
  await title.press("End");
  await title.pressSequentially("abc");
  await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 1);
  await title.press("ControlOrMeta+z");
  await expect(page.getByLabel("标题")).not.toHaveValue("原标题abc");
  const undone = await page.getByLabel("标题").inputValue();
  await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 2, undefined, {
    timeout: 4000,
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs")[1].config.title)).toBe(undone);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("historyCardEditor").getJSON().content![0].attrs!.title),
  ).toBe(undone);
  await page.getByLabel("标题").press("ControlOrMeta+Shift+z");
  await expect(page.getByLabel("标题")).toHaveValue("原标题abc");
  await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 3, undefined, {
    timeout: 4000,
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs")[2].config.title)).toBe("原标题abc");
});

test("deleting an option preserves keyboard focus and can be undone", async ({ page }) => {
  await mount(page, "vote");
  await page.getByRole("button", { name: "删除选项 2" }).click();
  await expect(page.getByRole("button", { name: "删除选项 1" })).toBeFocused();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("historyCardEditor").getJSON().content![0].attrs!.options),
  ).toHaveLength(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("选项 2", { exact: true })).toBeVisible();
  await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length >= 1);
  expect(
    await page.evaluate(() => {
      const config = window.__semloRequireFixture("historyCardSyncs").at(-1)!.config;
      return config.kind === "vote" ? config.options.length : null;
    }),
  ).toBe(2);
});

test("mode selection can be undone and redone from the focused control", async ({ page }) => {
  await mount(page, "vote");
  const mode = page.getByLabel("投票类型");
  await mode.focus();
  await mode.selectOption("multiple");
  await expect(mode).toHaveValue("multiple");
  await mode.press("ControlOrMeta+z");
  await expect(page.getByLabel("投票类型")).toHaveValue("single");
  await expect(page.getByLabel("投票类型")).toBeFocused();
  await page.getByLabel("投票类型").press("ControlOrMeta+Shift+z");
  await expect(page.getByLabel("投票类型")).toHaveValue("multiple");
});

test("removing the final option moves focus to the add control", async ({ page }) => {
  await mount(page, "vote");
  await page.getByRole("button", { name: "删除选项 2" }).click();
  await page.getByRole("button", { name: "删除选项 1" }).click();
  await expect(page.getByRole("button", { name: "添加选项" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("选项 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加选项" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByLabel("选项 1", { exact: true })).toHaveCount(0);
});

test("editor undo after input undo does not bring the removed text back", async ({ page }) => {
  await mount(page, "vote");
  const title = page.getByLabel("标题");
  await title.click();
  await title.press("End");
  await title.pressSequentially("abc");
  await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 1);
  await title.press("ControlOrMeta+z");
  const undone = await page.getByLabel("标题").inputValue();
  expect(undone).not.toBe("原标题abc");
  await page.evaluate(() => window.__semloRequireFixture("historyCardUndo")());
  expect(await page.getByLabel("标题").inputValue()).not.toBe("原标题abc");
});

for (const field of ["标题", "选项 1"] as const) {
  test(`${field} does not persist or synchronize incomplete IME composition`, async ({ page }) => {
    await mount(page, "vote");
    const input = page.getByLabel(field, { exact: true });
    await input.focus();
    await input.evaluate((element: HTMLInputElement) => {
      element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      element.value = "拼音中";
      element.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "拼音中" }));
    });
    await page.waitForTimeout(600);
    const before = await page.evaluate(
      () => window.__semloRequireFixture("historyCardEditor").getJSON().content![0].attrs!,
    );
    expect(field === "标题" ? before.title : before.options[0].label).toBe(field === "标题" ? "原标题" : "甲");
    expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs"))).toEqual([]);
    await input.evaluate((element: HTMLInputElement) => {
      element.value = "汉字";
      element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "汉字" }));
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data: "汉字" }));
    });
    await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 1);
    const saved = await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs")[0].config);
    expect(saved.kind === "vote" && (field === "标题" ? saved.title : saved.options[0].label)).toBe("汉字");
  });
}

test("adding an option focuses its input and typing updates the stored option", async ({ page }) => {
  await mount(page, "vote");
  await page.getByRole("button", { name: "添加选项" }).click();
  const newOption = page.getByLabel("选项 3", { exact: true });
  await expect(newOption).toBeFocused();
  await newOption.pressSequentially("新选项");
  const attrs = await page.evaluate(
    () => window.__semloRequireFixture("historyCardEditor").getJSON().content![0].attrs!,
  );
  expect(attrs.options[2].label).toBe("新选项");
  await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 1);
  const saved = await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs")[0].config);
  expect(saved.kind === "vote" && saved.options[2].label).toBe("新选项");
});
