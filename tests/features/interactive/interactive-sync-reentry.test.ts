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

test("vote sync cancellation cannot retarget a replacement activity", async ({ page }) => {
  await mount(page, "vote");
  await page.evaluate(() => {
    const host = window.__semloRequireFixture("historyCardHost");
    const editor = window.__semloRequireFixture("historyCardEditor");
    host.setHost({
      createActivity: async () => ({ cardId: "unused" }),
      verifyConfiguration: async () => true,
      syncConfiguration: async (id, _config, signal) => {
        document.body.dataset.syncIds = `${document.body.dataset.syncIds ?? ""}${id},`;
        if (id === "activity")
          signal.addEventListener(
            "abort",
            () => {
              editor.commands.updateAttributes("semloEditorVote", { cardId: "replacement", title: "外部内容" });
            },
            { once: true },
          );
        return await new Promise<void>(() => {});
      },
      vote: {
        getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
        submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
      },
    });
  });
  await page.getByLabel("标题").fill("首次修改");
  await page.waitForFunction(() => document.body.dataset.syncIds === "activity,");
  await page.getByLabel("标题").fill("再次修改");
  await page.waitForFunction(
    () => window.__semloRequireFixture("historyCardEditor").getJSON().content?.[0].attrs?.cardId === "replacement",
  );
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.body.dataset.syncIds)).toBe("activity,");
});

test("a removed check-in retry control cannot synchronize after the editor is destroyed", async ({ page }) => {
  await mount(page, "checkin");
  await page.evaluate(() => {
    const host = window.__semloRequireFixture("historyCardHost");
    host.setHost({
      createActivity: async () => ({ cardId: "unused" }),
      verifyConfiguration: async () => false,
      syncConfiguration: async () => {
        document.body.dataset.syncCalls = String(Number(document.body.dataset.syncCalls ?? "0") + 1);
        throw new Error("failed");
      },
      checkin: { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: true }) },
    });
  });
  await page.getByRole("button", { name: "编辑打卡" }).click();
  await page.getByLabel("标题").fill("修改标题");
  await page.getByRole("button", { name: "确定" }).click();
  await page.getByRole("button", { name: "同步打卡配置" }).waitFor();
  await page.evaluate(() => {
    const retry = [...document.querySelectorAll("button")].find((button) => button.textContent === "同步打卡配置")!;
    window.__semloRequireFixture("historyCardEditor").destroy();
    retry.click();
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.body.dataset.syncCalls)).toBe("1");
});

test("check-in save cannot sync a replacement made by a cancelled host request", async ({ page }) => {
  await mount(page, "checkin");
  await page.evaluate(() => {
    const host = window.__semloRequireFixture("historyCardHost");
    const editor = window.__semloRequireFixture("historyCardEditor");
    host.setHost({
      createActivity: async () => ({ cardId: "unused" }),
      verifyConfiguration: async () => true,
      syncConfiguration: async (id, _config, signal) => {
        document.body.dataset.syncIds = `${document.body.dataset.syncIds ?? ""}${id},`;
        signal.addEventListener(
          "abort",
          () => {
            editor.commands.updateAttributes("semloEditorCheckin", { cardId: "replacement", title: "外部内容" });
          },
          { once: true },
        );
        return await new Promise<void>(() => {});
      },
      checkin: { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: true }) },
    });
  });
  await page.getByRole("button", { name: "编辑打卡" }).click();
  await page.getByLabel("标题").fill("首次修改");
  await page.getByRole("button", { name: "确定" }).click();
  await page.waitForFunction(() => document.body.dataset.syncIds === "activity,");
  await page.getByRole("button", { name: "编辑打卡" }).click();
  await page.getByLabel("标题").fill("再次修改");
  await page.getByRole("button", { name: "确定" }).click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.body.dataset.syncIds)).toBe("activity,");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("historyCardEditor").getJSON().content?.[0].attrs?.cardId),
  ).toBe("replacement");
});
