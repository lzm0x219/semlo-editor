import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type {} from "../fixtures/interactive/interactive-history-fixture";

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

test("reentrant stale check-in form cannot sync after outer activity replacement", async ({ page }) => {
  await mount(page, "checkin");
  await page.getByRole("button", { name: "编辑打卡" }).click();
  await page.getByLabel("标题").fill("旧表单内容");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("historyCardEditor");
    const form = document.querySelector<HTMLFormElement>('form[aria-label="编辑打卡"]')!;
    const submit = () => {
      editor.off("beforeTransaction", submit);
      form.requestSubmit();
    };
    editor.on("beforeTransaction", submit);
    editor.commands.updateAttributes("semloEditorCheckin", { cardId: "other", title: "外部内容" });
  });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs"))).toEqual([]);
});

for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} detached edit controls cannot mutate a replacement activity`, async ({ page }) => {
    await mount(page, kind);
    if (kind === "checkin") await page.getByRole("button", { name: "编辑打卡" }).click();
    await page.evaluate((kind) => {
      const editor = window.__semloRequireFixture("historyCardEditor");
      const form = document.querySelector<HTMLFormElement>(
        `form[aria-label="编辑${kind === "vote" ? "投票" : "打卡"}"]`,
      )!;
      const title = form.querySelector<HTMLInputElement>('input[aria-label="标题"], label input')!;
      editor.commands.updateAttributes(kind === "vote" ? "semloEditorVote" : "semloEditorCheckin", {
        cardId: "other",
        title: "外部内容",
      });
      title.value = "过期控件内容";
      title.dispatchEvent(new Event("input", { bubbles: true }));
      if (kind === "checkin") form.requestSubmit();
    }, kind);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs"))).toEqual([]);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("historyCardEditor").getJSON().content?.[0].attrs?.title),
    ).toBe("外部内容");
  });
}

for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} edit does not sync through a host replaced before the transaction`, async ({ page }) => {
    await mount(page, kind);
    if (kind === "checkin") {
      await page.getByRole("button", { name: "编辑打卡" }).click();
      await page.getByLabel("标题").fill("本地内容");
    }
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("historyCardEditor");
      const swap = () => {
        editor.off("beforeTransaction", swap);
        window.__semloRequireFixture("replaceHistoryHost")();
      };
      editor.on("beforeTransaction", swap);
    });
    if (kind === "vote") await page.getByLabel("标题").fill("本地内容");
    else await page.getByRole("button", { name: "确定" }).click();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs"))).toEqual([]);
  });
}
