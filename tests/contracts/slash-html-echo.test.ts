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
  directory = await mkdtemp(join(tmpdir(), "semlo-slash-html-echo-"));
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { echo: resolve("tests/fixtures/contracts/slash-html-echo-fixture.ts") },
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: {
        alias: Object.fromEntries(
          ["core", "react", "vue", "solid"].map((name) => [
            `@semlo-editor/${name}$`,
            resolve(`packages/${name}/dist/index.js`),
          ]),
        ),
      },
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
  await page.evaluate(() => window.slashHTMLEcho?.dispose());
});

const raw = (page: Page, id: string) =>
  page.evaluate((key) => window.__semloRequireFixture("slashTableFixture").raw(key), id);
const snapshot = (page: Page, id: string) =>
  page.evaluate((key) => window.__semloRequireFixture("slashTableFixture").snapshot(key), id);
const color = (content: JSONContent) => content.content?.[0].attrs?.semloEditorHeaderBackground;
const query = (content: JSONContent) => content.content?.[0].content?.[0].content?.[1].content?.[0].content?.[0]?.text;
async function enterQuery(page: Page, id: string) {
  await page.locator(`#${id} .semlo-editor-prose tr`).first().locator("td,th").nth(1).locator("p").click();
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "插入内容" }).last()).toBeVisible();
  await page.keyboard.type("p");
  await page.evaluate(() => window.__semloRequireFixture("slashTableFixture").settle());
}

for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode}: 自身 HTML 快照 echo 保留合法小写颜色、活动查询、原生选区和撤销`, async ({ page }) => {
    await page.evaluate(
      (name) =>
        window
          .__semloRequireFixture("slashTableFixture")
          .mount(name, "primary", { content: window.__semloRequireFixture("slashHTMLEcho").table() }),
      mode,
    );
    const before = await raw(page, "primary");
    expect(color(before)).toBe("#e7efff");
    await enterQuery(page, "primary");
    const editing = await raw(page, "primary");
    expect(query(editing)).toBe("/p");
    const saved = await snapshot(page, "primary");
    expect(saved.html).toContain("#E7EFFF");
    await page.evaluate(() => window.__semloRequireFixture("slashHTMLEcho").capture("primary"));
    await page.evaluate(() => window.__semloRequireFixture("slashTableFixture").echo("primary", "html"));
    expect(await raw(page, "primary")).toEqual(editing);
    expect(await snapshot(page, "primary")).toEqual(saved);
    expect(await page.evaluate(() => window.__semloRequireFixture("slashHTMLEcho").selectionUnchanged("primary"))).toBe(
      true,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("slashHTMLEcho").replacements("primary"))).toBe(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => raw(page, "primary")).toEqual(before);
    expect(await page.evaluate(() => window.__semloRequireFixture("slashTableFixture").errors("primary"))).toEqual([]);
  });
}

test("不同或加工的 HTML、Esc 后旧快照仍替换，字面查询精确回声保持", async ({ page }) => {
  await page.evaluate(() =>
    window
      .__semloRequireFixture("slashTableFixture")
      .mount("core", "primary", { content: window.__semloRequireFixture("slashHTMLEcho").table() }),
  );
  await enterQuery(page, "primary");
  const saved = await snapshot(page, "primary");
  await page.evaluate(() => window.__semloRequireFixture("slashHTMLEcho").capture("primary"));
  await page.evaluate(
    (html) => window.__semloRequireFixture("slashTableFixture").replace("primary", html + "<!--宿主加工-->"),
    saved.html,
  );
  expect(query(await raw(page, "primary"))).toBeUndefined();
  expect(color(await raw(page, "primary"))).toBe("#E7EFFF");
  expect(await page.evaluate(() => window.__semloRequireFixture("slashHTMLEcho").replacements("primary"))).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("slashTableFixture").replace("primary", "<p>不同正文</p>"));
  expect((await snapshot(page, "primary")).text).toBe("不同正文");

  await page.evaluate(() =>
    window
      .__semloRequireFixture("slashTableFixture")
      .replace("primary", window.__semloRequireFixture("slashHTMLEcho").table()),
  );
  await enterQuery(page, "primary");
  await page.keyboard.press("Escape");
  await page.evaluate((html) => window.__semloRequireFixture("slashTableFixture").replace("primary", html), saved.html);
  expect(query(await raw(page, "primary"))).toBeUndefined();
  expect(color(await raw(page, "primary"))).toBe("#E7EFFF");

  await page.evaluate(() =>
    window
      .__semloRequireFixture("slashTableFixture")
      .mount("core", "literal", { content: window.__semloRequireFixture("slashHTMLEcho").table("/p") }),
  );
  const literal = await snapshot(page, "literal");
  const literalRaw = await raw(page, "literal");
  await page.evaluate(() => window.__semloRequireFixture("slashHTMLEcho").capture("literal"));
  await page.evaluate(
    (html) => window.__semloRequireFixture("slashTableFixture").replace("literal", html),
    literal.html,
  );
  // 普通文档精确回写自身 HTML 也不应迁移合法字段或把字面查询当作活动查询。
  expect(await raw(page, "literal")).toEqual(literalRaw);
  expect(await snapshot(page, "literal")).toEqual(literal);
  expect(query(await raw(page, "literal"))).toBe("/p");
  expect(color(await raw(page, "literal"))).toBe("#e7efff");
  expect(await page.evaluate(() => window.__semloRequireFixture("slashHTMLEcho").replacements("literal"))).toBe(0);
});

async function rendererCase(page: Page, id: string, action: RendererAction, matching = true) {
  await page.evaluate((key) => window.__semloRequireFixture("slashHTMLEcho").mountGuard(key), id);
  await page.locator(`#${id} .semlo-editor-prose > p`).click();
  await page.keyboard.type("/p");
  return page.evaluate(
    ({ key, action, matching }) => window.__semloRequireFixture("slashHTMLEcho").runGuard(key, action, matching),
    { key: id, action, matching },
  );
}

test("renderHTML 同步更新文档或状态时，匹配与不匹配的旧外层都停止", async ({ page }) => {
  for (const matching of [true, false]) {
    const result = await rendererCase(page, `replace-${matching}`, "replace", matching);
    expect(result.fired).toBe(1);
    expect(result.result).toEqual({ status: "interrupted", reason: "superseded", error: null });
    expect(result.text).toBe("宿主新正文");
    expect(result.replacements).toBe(1);
    expect(result.errors).toEqual([]);
  }
  const changed = await rendererCase(page, "selection", "selection");
  expect(changed.fired).toBe(1);
  expect(changed.sameDoc).toBe(true);
  expect(changed.sameState).toBe(false);
  expect(changed.after).toEqual(changed.before);
  expect(changed.result).toEqual({ status: "interrupted", reason: "superseded", error: null });
  expect(changed.replacements).toBe(0);
  expect(changed.errors).toEqual([]);
});

test("renderHTML 销毁或重新挂载后不再使用旧视图执行替换", async ({ page }) => {
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

test("renderHTML 异常保留原内容并报告；异常前宿主更新仍属于宿主", async ({ page }) => {
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
