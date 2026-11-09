import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { EditorContent, EditorSnapshot } from "@semlo-editor/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type { SlashTableMode } from "../../fixtures/insertion/slash-table-draft-fixture";

let directory: string, bundle: string, style: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-slash-table-"));
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { table: resolve("tests/fixtures/insertion/slash-table-draft-fixture.ts") },
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      // 显式使用组件产物，避免仓库 tsconfig 的源码别名绕过包入口。
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
  await page.evaluate(() => window.slashTableFixture?.dispose());
});

const target = (page: Page, id: string) =>
  page.locator(`#${id} .semlo-editor-prose tr`).first().locator("td,th").nth(1).locator("p");
const snapshot = (page: Page, id: string) =>
  page.evaluate((key) => window.__semloRequireFixture("slashTableFixture").snapshot(key), id);
const raw = (page: Page, id: string) =>
  page.evaluate((key) => window.__semloRequireFixture("slashTableFixture").raw(key), id);
const cellText = (content: EditorContent) =>
  typeof content === "string"
    ? content
    : content.content?.[0].content?.[0].content?.[1].content?.[0].content?.[0]?.text;

async function enterQuery(page: Page, id: string) {
  const paragraph = target(page, id);
  await expect(paragraph).toBeVisible();
  await paragraph.click();
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "插入内容" }).last()).toBeVisible();
  await page.keyboard.type("p");
  await page.evaluate(() => window.__semloRequireFixture("slashTableFixture").settle());
  await expect(paragraph).toHaveText("/p");
}

function committedJSON(saved: EditorSnapshot) {
  const json = structuredClone(saved.json);
  json.content![0].content![0].content![1].content![0].content = [{ type: "text", text: "/p" }];
  return json;
}

for (const mode of ["core", "react", "vue", "solid"] as const satisfies readonly SlashTableMode[]) {
  test(`${mode}: 单元格查询受控保存为空，Esc 提交后撤销重做和保存恢复保留表格`, async ({ page }) => {
    await page.evaluate((name) => window.__semloRequireFixture("slashTableFixture").mount(name, "primary"), mode);
    const saved = await snapshot(page, "primary");
    await enterQuery(page, "primary");
    expect(cellText(await raw(page, "primary"))).toBe("/p");
    expect(await snapshot(page, "primary")).toEqual(saved);
    for (const format of ["json", "html"] as const) {
      await page.evaluate((value) => window.__semloRequireFixture("slashTableFixture").echo("primary", value), format);
      expect(cellText(await raw(page, "primary"))).toBe("/p");
      expect(await snapshot(page, "primary")).toEqual(saved);
    }
    await page.keyboard.press("Backspace");
    await expect(target(page, "primary")).toHaveText("/");
    expect(await snapshot(page, "primary")).toEqual(saved);
    await page.keyboard.type("p");
    const changeCount = await page.evaluate(
      () => window.__semloRequireFixture("slashTableFixture").changes("primary").length,
    );
    await page.keyboard.press("Escape");
    await expect.poll(async () => cellText((await snapshot(page, "primary")).json)).toBe("/p");
    const committed = await snapshot(page, "primary");
    expect(committed.json).toEqual(committedJSON(saved));
    expect(committed.text).toContain("/p");
    expect(committed.html).toContain("<p>/p</p>");
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("slashTableFixture").changes("primary").length))
      .toBe(changeCount + 1);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("slashTableFixture").changes("primary").at(-1)),
    ).toEqual(committed);
    await expect(target(page, "primary")).toHaveText("/p");

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => snapshot(page, "primary")).toEqual(saved);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => snapshot(page, "primary")).toEqual(committed);

    await page.evaluate(
      ({ name, content }) => window.__semloRequireFixture("slashTableFixture").mount(name, "saved", { content }),
      { name: mode, content: saved.html },
    );
    expect(await snapshot(page, "saved")).toEqual(saved);
    await page.evaluate(
      ({ name, content }) => window.__semloRequireFixture("slashTableFixture").mount(name, "committed", { content }),
      { name: mode, content: committed.json },
    );
    expect(await snapshot(page, "committed")).toEqual(committed);
    expect(
      await page.evaluate(() =>
        ["primary", "saved", "committed"].flatMap((id) => window.__semloRequireFixture("slashTableFixture").errors(id)),
      ),
    ).toEqual([]);
  });
}

test("表头单元格同层查询与另一实例分别保存，离开查询及外部替换不误写", async ({ page }) => {
  await page.evaluate(async () => {
    const fixture = window.__semloRequireFixture("slashTableFixture");
    await fixture.mount("core", "header", { cell: "tableHeader" });
    await fixture.mount("core", "other");
  });
  const headerBefore = await snapshot(page, "header");
  const otherBefore = await snapshot(page, "other");
  await enterQuery(page, "header");
  await enterQuery(page, "other");
  expect(await snapshot(page, "header")).toEqual(headerBefore);
  expect(await snapshot(page, "other")).toEqual(otherBefore);
  await page.keyboard.press("Escape");
  await expect.poll(async () => cellText((await snapshot(page, "other")).json)).toBe("/p");
  expect(await snapshot(page, "header")).toEqual(headerBefore);
  const otherCommitted = await snapshot(page, "other");

  // 从表外文字起点离开查询，避开仍属于该实例、位于段落右侧的建议浮层。
  await page.locator("#header .semlo-editor-prose > p").click({ position: { x: 6, y: 6 } });
  await page.keyboard.type("!");
  await expect.poll(async () => cellText((await snapshot(page, "header")).json)).toBe("/p");
  expect((await snapshot(page, "header")).text).toContain("!表外后文");
  expect(await snapshot(page, "other")).toEqual(otherCommitted);
  await page.evaluate(() => window.__semloRequireFixture("slashTableFixture").replace("header", "<p>宿主新文档</p>"));
  expect((await snapshot(page, "header")).text).toBe("宿主新文档");
  expect(await snapshot(page, "other")).toEqual(otherCommitted);
  expect(
    await page.evaluate(() =>
      ["header", "other"].flatMap((id) => window.__semloRequireFixture("slashTableFixture").errors(id)),
    ),
  ).toEqual([]);
});

test("载入表格中的字面查询保持全部格式并可再次保存恢复", async ({ page }) => {
  await page.evaluate(() =>
    window.__semloRequireFixture("slashTableFixture").mount("core", "literal", { literal: "/p" }),
  );
  const literal = await snapshot(page, "literal");
  expect(cellText(literal.json)).toBe("/p");
  expect(literal.text).toContain("/p");
  expect(literal.html).toContain("<p>/p</p>");
  expect(await raw(page, "literal")).toEqual(
    await page.evaluate(() => window.__semloRequireFixture("slashTableFixture").snapshotAsRaw("literal")),
  );
  await page.evaluate(
    (content) => window.__semloRequireFixture("slashTableFixture").mount("core", "reloaded", { content }),
    literal.html,
  );
  expect(await snapshot(page, "reloaded")).toEqual(literal);
});
