import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { readInlineFixtureBundle } from "../fixtures/browser/fixture-bundle";
import type { RendererAction } from "../fixtures/contracts/slash-html-echo-fixture";

let directory: string, bundle: string, style: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-format-html-echo-"));
  const alias = Object.fromEntries(
    ["core", "react", "vue", "solid"].map((name) => [
      `@semlo-editor/${name}$`,
      resolve(`packages/${name}/dist/index.js`),
    ]),
  );
  alias["@semlo-editor/core/style.css$"] = resolve("packages/core/dist/style.css");
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { echo: resolve("tests/fixtures/contracts/format-html-echo-fixture.ts") },
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias },
      output: { distPath: { root: directory }, cleanDistPath: false, filename: { js: "[name].js" } },
      tools: { rspack: { optimization: { splitChunks: false, runtimeChunk: false } } },
    },
  });
  await build.build();
  bundle = await readInlineFixtureBundle(directory);
  style = await readFile(resolve("packages/core/dist/style.css"), "utf8");
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.setContent("<style>body{margin:0;padding:24px 0}</style>");
  await page.addStyleTag({ content: style });
  await page.addScriptTag({ content: bundle });
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.formatHTMLEcho?.dispose());
});

const raw = (page: Page, id = "primary") =>
  page.evaluate((key) => window.__semloRequireFixture("formatHTMLEcho").raw(key), id);
const snapshot = (page: Page, id = "primary") =>
  page.evaluate((key) => window.__semloRequireFixture("formatHTMLEcho").snapshot(key), id);
const stats = (page: Page, id = "primary") =>
  page.evaluate((key) => window.__semloRequireFixture("formatHTMLEcho").stats(key), id);
const marks = (content: JSONContent, index: number) => content.content?.[index].content?.[0].marks ?? [];
const color = (content: JSONContent, index: number) =>
  marks(content, index).find((mark) => mark.type === "textStyle")?.attrs?.color;
const ticket = (content: JSONContent, index: number) =>
  marks(content, index).find((mark) => mark.type === "formatEchoSemantic")?.attrs?.ticket;

for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode}: 普通文档格式操作的精确HTML回写保留原字段、选区与一次撤销重做`, async ({ page }) => {
    await page.evaluate((name) => window.__semloRequireFixture("formatHTMLEcho").mount(name, "primary"), mode);
    const before = await raw(page);
    expect(color(before, 0)).toBe("#aabbcc");
    expect(color(before, 1)).toBe("#334455");
    expect(ticket(before, 1)).toBe("unselectedCase");
    expect(await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").select("primary"))).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").format("primary"))).toBe(true);
    const formatted = await raw(page);
    expect(formatted.content?.[1]).toEqual(before.content?.[1]);
    expect(formatted.attrs).toEqual(before.attrs);
    expect(color(formatted, 0)).toBe("#aabbcc");
    expect(ticket(formatted, 0)).toBe("selectedCase");
    expect(marks(formatted, 0).some((mark) => mark.type === "bold")).toBe(false);
    expect(await stats(page)).toEqual({
      replacements: 0,
      changes: 1,
      echoes: 1,
      selection: { from: 1, to: 6 },
      nativeSelection: { anchor: 1, focus: 6, text: "FIRST" },
      selectionUnchanged: true,
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").history("primary", "undo"))).toBe(
      true,
    );
    expect(await raw(page)).toEqual(before);
    expect(await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").history("primary", "redo"))).toBe(
      true,
    );
    expect(await raw(page)).toEqual(formatted);
    expect(await stats(page)).toEqual({
      replacements: 0,
      changes: 3,
      echoes: 3,
      selection: { from: 1, to: 6 },
      nativeSelection: { anchor: 1, focus: 6, text: "FIRST" },
      selectionUnchanged: true,
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").errors("primary"))).toEqual([]);
  });
}

test("普通HTML精确回写仍先解析；JSON相等不调用宿主序列化", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").mount("core", "primary"));
  const before = await raw(page);
  const html = await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").probe("primary", "html"));
  expect(html.status).toBe("unchanged");
  expect(html.parses).toBeGreaterThan(0);
  expect(html.renders).toBeGreaterThan(0);
  expect(html).toMatchObject({ sameState: true, sameDoc: true, sameView: true, replacements: 0, errors: [] });
  const json = await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").probe("primary", "json"));
  expect(json).toMatchObject({
    status: "unchanged",
    parses: 0,
    renders: 0,
    sameState: true,
    replacements: 0,
    errors: [],
  });
  expect(await raw(page)).toEqual(before);
  const changed = await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").selectionControl("primary"));
  expect(changed).toEqual({ unchanged: false, native: { anchor: 2, focus: 4, text: "IR" } });
});

test("先卸载的普通文档仍可替换外部HTML并重新挂载", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").mount("core", "primary"));
  const result = await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").unmountedReplace("primary"));
  expect(result).toEqual({
    replacement: { status: "applied" },
    mounted: true,
    text: "未挂载期间的外部正文",
    errors: [],
  });
});

test("自身精确HTML也不会绕过宿主parseHTML异常或失效原状态", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").mount("core", "primary"));
  const before = await raw(page);
  const result = await page.evaluate(() =>
    window.__semloRequireFixture("formatHTMLEcho").probe("primary", "html", true),
  );
  expect(result.status).toBe("parse-failed");
  expect(result.parses).toBeGreaterThan(0);
  expect(result.renders).toBe(0);
  expect(result).toMatchObject({ sameState: true, sameDoc: true, sameView: true, replacements: 0 });
  expect(result.errors).toHaveLength(1);
  expect(result.error).toBeTruthy();
  expect(await raw(page)).toEqual(before);
});

test("加工HTML、旧自身快照与真正外部正文继续正常替换", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").mount("core", "primary"));
  const older = await snapshot(page);
  await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").select("primary"));
  await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").format("primary"));
  const current = await snapshot(page);
  await page.evaluate(
    (html) => window.__semloRequireFixture("formatHTMLEcho").replace("primary", html + "<!--宿主加工-->"),
    current.html,
  );
  const processed = await raw(page);
  expect(color(processed, 1)).toBe("rgb(51, 68, 85)");
  expect(ticket(processed, 1)).toBe("UNSELECTEDCASE");
  expect((await stats(page)).replacements).toBe(1);
  await page.evaluate((html) => window.__semloRequireFixture("formatHTMLEcho").replace("primary", html), older.html);
  expect(marks(await raw(page), 0).some((mark) => mark.type === "bold")).toBe(true);
  expect((await stats(page)).replacements).toBe(2);
  await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").replace("primary", "<p>真正外部正文</p>"));
  expect((await snapshot(page)).text).toBe("真正外部正文");
  expect((await stats(page)).replacements).toBe(3);
  expect(await page.evaluate(() => window.__semloRequireFixture("formatHTMLEcho").errors("primary"))).toEqual([]);
});

async function rendererCase(page: Page, id: string, action: RendererAction, matching = true) {
  await page.evaluate((key) => window.__semloRequireFixture("slashHTMLEcho").mountGuard(key), id);
  // 不输入查询；选择探针使 selection 回调确实改变状态，而文档仍是普通文档。
  await page.locator(`#${id} aside[data-semlo-html-echo-probe]`).click();
  return page.evaluate(
    ({ key, action, matching }) => window.__semloRequireFixture("slashHTMLEcho").runGuard(key, action, matching),
    { key: id, action, matching },
  );
}

test("普通文档序列化中宿主替换或改选区时，旧外层停止", async ({ page }) => {
  for (const matching of [true, false]) {
    const result = await rendererCase(page, `replace-${matching}`, "replace", matching);
    expect(result.before.content?.[0].content).toBeUndefined();
    expect(result.fired).toBe(1);
    expect(result.result).toEqual({ status: "interrupted", reason: "superseded", error: null });
    expect(result.text).toBe("宿主新正文");
    expect(result.replacements).toBe(1);
    expect(result.errors).toEqual([]);
  }
  const selection = await rendererCase(page, "selection", "selection");
  expect(selection.fired).toBe(1);
  expect(selection.sameDoc).toBe(true);
  expect(selection.sameState).toBe(false);
  expect(selection.after).toEqual(selection.before);
  expect(selection.result).toEqual({ status: "interrupted", reason: "superseded", error: null });
  expect(selection.replacements).toBe(0);
});

test("普通文档序列化中销毁与低层重挂使旧视图失效", async ({ page }) => {
  const destroyed = await rendererCase(page, "destroy", "destroy");
  expect(destroyed.fired).toBe(1);
  expect(destroyed.destroyed).toBe(true);
  expect(destroyed.result).toEqual({ status: "interrupted", reason: "destroyed", error: null });
  expect(destroyed.replacements).toBe(0);
  expect(destroyed.errors).toEqual([]);
  const remounted = await rendererCase(page, "remount", "remount");
  expect(remounted.fired).toBe(1);
  expect(remounted.sameView).toBe(false);
  expect(remounted.after).toEqual(remounted.before);
  expect(remounted.result).toEqual({ status: "interrupted", reason: "unmounted", error: null });
  expect(remounted.replacements).toBe(0);
  expect(remounted.errors).toEqual([]);
});

test("普通文档renderHTML抛错保持原文，先更新再抛错保留宿主新文", async ({ page }) => {
  const failed = await rendererCase(page, "throw", "throw");
  expect(failed.fired).toBe(1);
  expect(failed.result).toEqual({ status: "failed", reason: null, error: "host renderHTML failed" });
  expect(failed.sameState).toBe(true);
  expect(failed.after).toEqual(failed.before);
  expect(failed.sameError).toBe(true);
  expect(failed.errors).toEqual(["host renderHTML failed"]);
  expect(failed.replacements).toBe(0);
  const newer = await rendererCase(page, "replace-throw", "replace-throw");
  expect(newer.fired).toBe(1);
  expect(newer.result).toEqual({ status: "interrupted", reason: "superseded", error: "host renderHTML failed" });
  expect(newer.text).toBe("宿主新正文");
  expect(newer.errors).toEqual(["host renderHTML failed"]);
});
