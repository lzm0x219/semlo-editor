import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { beforeAll, afterAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/interactive/checkin-card-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let directory: string;
let bundle: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-checkin-"));
  const builder = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { checkin: resolve("tests/fixtures/interactive/checkin-card-fixture.ts") } },
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

async function mount(page: import("@rstest/playwright").Page, service: boolean, content?: string) {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ service, content }) => window.__semloRequireFixture("mountCheckin")(service, content), {
    service,
    content,
  });
}

test("an async check-in status update preserves the active input and composition", async ({ page }) => {
  await mount(page, true);
  await expect(page.getByText("正在加载打卡状态")).toBeVisible();
  await page.getByRole("button", { name: "编辑打卡" }).click();
  const title = page.getByLabel("标题");
  await title.focus();
  await title.evaluate((element: HTMLInputElement) => {
    Reflect.set(window, "testActiveInput", element);
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    element.value = "输入中";
    element.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "输入中" }));
  });
  await page.evaluate(() => window.__semloRequireFixture("checkinPending")[0].resolve({ checkedIn: false }));
  await expect(page.getByText("正在加载打卡状态")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === Reflect.get(window, "testActiveInput"))).toBe(true);
  await expect(title).toHaveValue("输入中");
  await title.evaluate((element: HTMLInputElement) => {
    element.value = "完成输入";
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "完成输入" }));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: "完成输入" }));
  });
  await page.getByRole("button", { name: "确定" }).click();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("checkinEditor").getJSON().content![0].attrs!.title),
  ).toBe("完成输入");
});

test("editing check-in replaces the participation control until the form closes", async ({ page }) => {
  await mount(page, true);
  await page.evaluate(() => window.__semloRequireFixture("checkinPending")[0].resolve({ checkedIn: false }));
  await expect(page.getByRole("button", { name: "我已读" })).toBeEnabled();
  await page.getByRole("button", { name: "编辑打卡" }).click();
  await expect(page.getByRole("form", { name: "编辑打卡" })).toBeVisible();
  await expect(page.getByRole("button", { name: "我已读" })).toHaveCount(0);
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("button", { name: "我已读" })).toBeEnabled();
});

for (const action of ["取消", "确定"] as const) {
  test(`closing check-in editing with ${action} returns focus to the edit control`, async ({ page }) => {
    await mount(page, true);
    await page.getByRole("button", { name: "编辑打卡" }).click();
    await page.getByLabel("标题").fill("修改标题");
    await page.getByRole("button", { name: action }).click();
    await expect(page.getByRole("button", { name: "编辑打卡" })).toBeFocused();
  });
}
