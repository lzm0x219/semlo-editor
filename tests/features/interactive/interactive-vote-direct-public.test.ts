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
test("the public editor inserts an immediately editable vote draft", async ({ page }) => {
  await mount(page, "core");
  await page.getByRole("button", { name: "插入内容" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="vote"]').click();
  await page.waitForFunction(() => window.__semloRequireFixture("activityPending").length === 1);
  await page.evaluate(() => window.__semloRequireFixture("activityPending")[0].resolve({ cardId: "direct-vote" }));
  const vote = page.locator(".semlo-editor-vote-card");
  await expect(vote.getByLabel("标题")).toHaveAttribute("placeholder", "请输入投票标题");
  await expect(vote.getByLabel("选项 1", { exact: true })).toHaveValue("");
  await expect(vote.getByLabel("选项 2", { exact: true })).toHaveValue("");
  await expect(vote.getByRole("button", { name: "投票", exact: true })).toHaveCount(0);
  await vote.getByLabel("标题").fill("活动标题");
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireFixture("publicEditor")
          .getSnapshot()
          .json.content!.find((node) => node.type === "semloEditorVote")?.attrs?.title,
    ),
  ).toBe("活动标题");
});
