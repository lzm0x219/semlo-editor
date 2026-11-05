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

test("edits and round-trips the card while participation comes from the host", async ({ page }) => {
  await mount(page, true);
  await expect(page.getByText("正在加载打卡状态")).toBeVisible();
  await page.getByRole("button", { name: "编辑打卡" }).click();
  await page.getByLabel("标题").fill("阅读确认");
  await page.evaluate(() => window.__semloRequireFixture("checkinPending")[0].resolve({ checkedIn: false }));
  await expect(page.getByLabel("标题")).toHaveValue("阅读确认");
  await page.getByLabel("按钮文字").fill("确认阅读");
  await page.getByLabel("设置截止日期").check();
  await page.getByLabel("截止日期", { exact: true }).fill("2030-05-01");
  await page.getByLabel("截止时间").fill("");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.getByText("截止日期：2030-05-01")).toBeVisible();
  await page.waitForFunction(() => window.__semloRequireFixture("checkinPending").length === 2);
  await page.evaluate(() => window.__semloRequireFixture("checkinPending")[1].resolve({ checkedIn: false }));
  await page.getByRole("button", { name: "确认阅读" }).click();
  await expect(page.getByText("正在提交打卡")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("checkinCalls"))).toEqual([
    "get:card-1",
    "get:card-1",
    "submit:card-1",
  ]);
  await page.evaluate(() => window.__semloRequireFixture("checkinPending")[2].resolve({ checkedIn: true }));
  await expect(page.getByRole("button", { name: "已打卡" })).toBeDisabled();
  const html = await page.evaluate(() => window.__semloRequireFixture("checkinEditor").getHTML());
  expect(html).not.toContain("已打卡");
  await page.evaluate(() => window.__semloRequireFixture("checkinEditor").destroy());
  await mount(page, false, html);
  await expect(page.getByText("阅读确认")).toBeVisible();
  await expect(page.getByText("打卡服务未配置")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认阅读" })).toBeDisabled();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("checkinEditor").getJSON().content?.[0].attrs),
  ).toMatchObject({
    cardId: "card-1",
    title: "阅读确认",
    buttonLabel: "确认阅读",
    deadline: "2030-05-01",
  });
});

test("failed submissions refresh from the service, and stale requests are aborted", async ({ page }) => {
  await mount(page, true);
  await page.evaluate(() => window.__semloRequireFixture("checkinPending")[0].resolve({ checkedIn: false }));
  await page.getByRole("button", { name: "我已读" }).click();
  await page.evaluate(() => window.__semloRequireFixture("checkinPending")[1].reject());
  await expect(page.getByText("打卡状态获取或提交失败")).toBeVisible();
  await page.getByRole("button", { name: "重新获取状态" }).click();
  await page.evaluate(() =>
    window.__semloRequireFixture("checkinEditor").commands.updateAttributes("semloEditorCheckin", { cardId: "card-2" }),
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("checkinPending")[2].signal.aborted)).toBe(true);
  await page.evaluate(() => {
    window.__semloRequireFixture("checkinPending")[2].resolve({ checkedIn: true });
    window.__semloRequireFixture("checkinPending")[3].resolve({ checkedIn: false });
  });
  await expect(page.getByRole("button", { name: "我已读" })).toBeEnabled();
  await page.evaluate(() => window.__semloRequireFixture("checkinEditor").setEditable(false));
  await expect(page.getByRole("button", { name: "编辑打卡" })).toHaveCount(0);
  await page.getByRole("button", { name: "我已读" }).click();
  await page.evaluate(() => window.__semloRequireFixture("checkinEditor").destroy());
  expect(await page.evaluate(() => window.__semloRequireFixture("checkinPending")[4].signal.aborted)).toBe(true);
});

test("service replacement cancels pending state and mismatched configuration fails closed", async ({ page }) => {
  await mount(page, true);
  await page.waitForFunction(() => window.__semloRequireFixture("checkinPending").length === 1);
  await page.evaluate(() => window.__semloRequireFixture("checkinHost").setHost(null));
  expect(await page.evaluate(() => window.__semloRequireFixture("checkinPending")[0].signal.aborted)).toBe(true);
  await expect(page.getByText("打卡服务未配置")).toBeVisible();
  await page.evaluate(() => {
    window.__semloRequireFixture("checkinPending")[0].resolve({ checkedIn: true });
    window.checkinVerify = false;
    window.checkinSyncFails = true;
    window.__semloRequireFixture("checkinHost").setHost(window.__semloRequireDefined("checkinTestHost"));
  });
  await expect(page.getByText("打卡配置尚未与服务同步")).toBeVisible();
  await expect(page.getByRole("button", { name: "我已读" })).toBeDisabled();
  await page.getByRole("button", { name: "同步打卡配置" }).click();
  await expect(page.getByText("打卡配置尚未与服务同步")).toBeVisible();
  await page.evaluate(() => {
    window.checkinSyncFails = false;
  });
  await page.getByRole("button", { name: "同步打卡配置" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("checkinPending").length === 2);
  await page.evaluate(() => window.__semloRequireFixture("checkinPending")[1].resolve({ checkedIn: false }));
  await expect(page.getByRole("button", { name: "我已读" })).toBeEnabled();
});
