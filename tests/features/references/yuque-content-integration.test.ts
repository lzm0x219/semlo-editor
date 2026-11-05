import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import type {} from "../../fixtures/references/yuque-content-fixture";
import { readEditorStyles } from "../../fixtures/shared/editor-styles";

let directory: string, bundle: string, styles: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-public-interactive-"));
  const builder = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { integration: resolve("tests/fixtures/references/yuque-content-fixture.ts") },
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
  await page.evaluate(({ mode, enabled }) => window.yuqueMount(mode, enabled), { mode, enabled });
  await page.waitForFunction(() => Boolean(window.yuqueEditor));
}
async function openPicker(page: Page) {
  await page.getByRole("button", { name: "插入内容" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="yuque"]').click();
  await expect(page.getByRole("dialog", { name: "语雀内容" })).toBeVisible();
}
for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode} inserts a host-resolved link and restores it from HTML`, async ({ page }) => {
    await mount(page, mode);
    await openPicker(page);
    await page.getByLabel("搜索文档或表格").fill("demo");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByRole("button", { name: "文档：测试文档" }).click();
    await expect(page.getByRole("dialog", { name: "语雀内容" })).toHaveCount(0);
    const snapshot = await page.evaluate(() => window.yuqueEditor!.getSnapshot());
    expect(snapshot.html).toContain('href="https://example.invalid/doc"');
    expect(snapshot.text).toContain("测试文档");
    await page.evaluate((html) => window.yuqueEditor!.setContent(html), snapshot.html);
    expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).html).toContain(
      'href="https://example.invalid/doc"',
    );
    await page.evaluate(() => window.yuqueDestroy());
  });
}
test("without a provider the entry stays disabled", async ({ page }) => {
  await mount(page, "core", false);
  await page.getByRole("button", { name: "插入内容" }).click();
  await expect(
    page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="yuque"]'),
  ).toBeDisabled();
});
test("removing the provider closes and cancels the active picker", async ({ page }) => {
  await mount(page, "core");
  await openPicker(page);
  await page.getByLabel("搜索文档或表格").fill("pending");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.waitForFunction(() => window.yuquePending.length === 1);
  await page.evaluate(() => window.yuqueReplace(false));
  expect(await page.evaluate(() => window.yuquePending[0].signal.aborted)).toBe(true);
  await expect(page.getByRole("dialog", { name: "语雀内容" })).toHaveCount(0);
  await page.evaluate(() =>
    window.yuquePending[0].resolve([
      { id: "old", title: "旧结果", href: "https://example.invalid/old", kind: "document" },
    ]),
  );
  expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).text).not.toContain("旧结果");
});
test("unsafe host links are not offered for insertion", async ({ page }) => {
  await mount(page, "core");
  await openPicker(page);
  await page.getByLabel("搜索文档或表格").fill("unsafe");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("没有找到内容");
  expect(await page.getByRole("button", { name: "文档：不安全" }).count()).toBe(0);
});

test("slash input is replaced only after choosing a result", async ({ page }) => {
  await mount(page, "core");
  await page.locator("#editor .semlo-editor-prose p").click();
  await page.keyboard.type("/yq");
  await page.locator('.semlo-editor-slash-menu .semlo-editor-card-item[data-command="yuque"]').click();
  expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).text).toContain("/yq");
  await page.getByLabel("内容链接").fill("table");
  await page.getByRole("button", { name: "解析链接" }).click();
  await page.getByRole("button", { name: "表格：测试表格" }).click();
  const snapshot = await page.evaluate(() => window.yuqueEditor!.getSnapshot());
  expect(snapshot.text).not.toContain("/yq");
  expect(snapshot.text).toContain("测试表格");
  expect(snapshot.html).toContain('href="https://example.invalid/table"');
});

test("a document change closes the picker without inserting a stale result", async ({ page }) => {
  await mount(page, "core");
  await openPicker(page);
  await page.getByLabel("搜索文档或表格").fill("pending");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.waitForFunction(() => window.yuquePending.length === 1);
  await page.evaluate(() => window.yuqueEditor!.editor.commands.insertContent("改变"));
  await expect(page.getByRole("dialog", { name: "语雀内容" })).toHaveCount(0);
  expect(await page.evaluate(() => window.yuquePending[0].signal.aborted)).toBe(true);
});

test("block-below inserts a saved link only after the host choice", async ({ page }) => {
  await mount(page, "core");
  await page.evaluate(() => window.yuqueEditor!.setContent("<p>原块</p><p>后块</p>"));
  await page.locator("#editor .semlo-editor-prose p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  const before = await page.evaluate(() => JSON.stringify(window.yuqueEditor!.getSnapshot().json));
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="yuque"]').click();
  expect(await page.evaluate(() => JSON.stringify(window.yuqueEditor!.getSnapshot().json))).toBe(before);
  await page.getByLabel("搜索文档或表格").fill("demo");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("button", { name: "文档：测试文档" }).click();
  const snapshot = await page.evaluate(() => window.yuqueEditor!.getSnapshot());
  expect(snapshot.text).toContain("测试文档");
  expect(snapshot.html).toContain('href="https://example.invalid/doc"');
  expect(snapshot.json.content!.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
});

for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode} controlled replacement closes and cancels stale picker work`, async ({ page }) => {
    await mount(page, mode);
    await openPicker(page);
    await page.getByLabel("搜索文档或表格").fill("pending");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.waitForFunction(() => window.yuquePending.length === 1);
    await page.evaluate(() => window.yuqueSetContent("<p>受控替换</p>"));
    await expect(page.getByRole("dialog", { name: "语雀内容" })).toHaveCount(0);
    expect(await page.evaluate(() => window.yuquePending[0].signal.aborted)).toBe(true);
    await page.evaluate(() =>
      window.yuquePending[0].resolve([
        { id: "old", title: "旧结果", href: "https://example.invalid/old", kind: "document" },
      ]),
    );
    expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).text).toContain("受控替换");
    expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).text).not.toContain("旧结果");
  });
}
