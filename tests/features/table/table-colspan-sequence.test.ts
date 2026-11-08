import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type { SequenceVariant } from "../../fixtures/table/table-colspan-sequence-fixture";

let directory: string, bundle: string, style: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-colspan-sequence-"));
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { sequence: resolve("tests/fixtures/table/table-colspan-sequence-fixture.ts") } },
      resolve: {
        alias: {
          "@semlo-editor/core$": resolve("packages/core/dist/index.js"),
          "@semlo-editor/core/style.css$": resolve("packages/core/dist/style.css"),
        },
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
  await page.evaluate(() => window.colspanSequenceFixture?.dispose());
});

const snapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("colspanSequenceFixture").snapshot("primary"));
const table = (content: JSONContent) => content.content!.find((node) => node.type === "table")!;
const header = (content: JSONContent) => table(content).content![0].content![0];
const firstColumn = (page: Page) => page.locator("#primary .semlo-editor-prose table tr").locator("td:first-child");
const prose = (page: Page) => page.locator("#primary .semlo-editor-prose");
async function mount(page: Page, variant: SequenceVariant = "marked", echo: "json" | "html" = "json") {
  await page.evaluate(
    ({ variant, echo }) => window.__semloRequireFixture("colspanSequenceFixture").mount("primary", echo, variant),
    { variant, echo },
  );
}
async function openNumbering(page: Page, row = 1) {
  await prose(page).locator("table tr").nth(row).locator("td").first().click({ button: "right" });
  const menu = page.getByRole("menu", { name: "表格操作" });
  await expect(menu).toBeVisible();
  return menu;
}
async function nativeSetup(page: Page) {
  await prose(page).getByRole("cell", { name: "跨列标题", exact: true }).click({ button: "right" });
  let menu = page.getByRole("menu", { name: "表格操作" });
  await expect(menu.getByRole("menuitem", { name: "自动编号", exact: true })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "插入序号列到最左侧" }).click();
  await expect(firstColumn(page)).toHaveText(["", "1", "2"]);
  await page.evaluate(() => window.__semloRequireFixture("colspanSequenceFixture").selectHeader("primary"));
  await expect(prose(page).locator(".selectedCell")).toHaveCount(3);
  await prose(page).getByRole("cell", { name: "跨列标题", exact: true }).click({ button: "right" });
  menu = page.getByRole("menu", { name: "表格操作" });
  await menu.getByRole("menuitem", { name: "合并单元格", exact: true }).click();
  await expect(prose(page).locator('td[colspan="4"] p')).toHaveText(["跨列标题", "第三列表头"]);
}
function expectOutsideUnchanged(before: JSONContent, after: JSONContent) {
  expect(after.content!.filter((node) => node.type !== "table")).toEqual(
    before.content!.filter((node) => node.type !== "table"),
  );
  expect(table(after).attrs).toEqual(table(before).attrs);
  for (let row = 1; row < 3; row++)
    expect(table(after).content![row].content!.slice(1)).toEqual(table(before).content![row].content!.slice(1));
}

for (const echo of ["json", "html"] as const) {
  test(`${echo}: 真实插序号列及整行合并后，可显式从首宽格编号并单次撤销重做与往返`, async ({ page }) => {
    await mount(page, "native", echo);
    await nativeSetup(page);
    const before = await snapshot(page);
    expect(header(before.json).attrs).toMatchObject({ colspan: 4, rowspan: 1, semloEditorSequence: 2 });
    const menu = await openNumbering(page);
    const input = menu.getByRole("spinbutton", { name: "自动编号起始行" });
    await expect(input).toHaveValue("2");
    await input.fill("1");
    await menu.getByRole("menuitem", { name: "自动编号", exact: true }).click();
    await expect(page.getByRole("menu", { name: "表格操作" })).toHaveCount(0);
    await expect(firstColumn(page)).toHaveText(["1", "2", "3"]);
    const numbered = await snapshot(page);
    expectOutsideUnchanged(before.json, numbered.json);
    expect(header(numbered.json).attrs).toEqual({ ...header(before.json).attrs, semloEditorSequence: 1 });
    expect(header(numbered.json).content).toEqual([
      { type: "paragraph", attrs: header(before.json).content![0].attrs, content: [{ type: "text", text: "1" }] },
    ]);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("colspanSequenceFixture").history("primary", "undo")),
    ).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    await expect(prose(page).locator('td[colspan="4"] p')).toHaveText(["跨列标题", "第三列表头"]);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("colspanSequenceFixture").history("primary", "redo")),
    ).toBe(true);
    expect((await snapshot(page)).json).toEqual(numbered.json);
    for (const value of [numbered.html, numbered.json]) {
      await page.evaluate(() =>
        window.__semloRequireFixture("colspanSequenceFixture").replace("primary", "<p>中间正文</p>"),
      );
      await page.evaluate(
        (content) => window.__semloRequireFixture("colspanSequenceFixture").replace("primary", content),
        value,
      );
      expect((await snapshot(page)).json).toEqual(numbered.json);
    }
    expect(await page.evaluate(() => window.__semloRequireFixture("colspanSequenceFixture").errors("primary"))).toEqual(
      [],
    );
  });
}

test("真实把第二行1键入9后，默认从第二行重置保留宽表头，单次撤销回9/2", async ({ page }) => {
  await mount(page, "marked", "html");
  const original = await snapshot(page);
  await page.evaluate(() => window.__semloRequireFixture("colspanSequenceFixture").selectNumber("primary", 1));
  await page.keyboard.type("9");
  await expect(firstColumn(page)).toHaveText(["跨列标题第三列表头", "9", "2"]);
  const edited = await snapshot(page);
  const menu = await openNumbering(page);
  await expect(menu.getByRole("spinbutton", { name: "自动编号起始行" })).toHaveValue("2");
  await menu.getByRole("menuitem", { name: "自动编号", exact: true }).click();
  await expect(firstColumn(page)).toHaveText(["跨列标题第三列表头", "1", "2"]);
  const numbered = await snapshot(page);
  expect(header(numbered.json)).toEqual(header(original.json));
  expectOutsideUnchanged(edited.json, numbered.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("colspanSequenceFixture").history("primary", "undo")),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(edited.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("colspanSequenceFixture").history("primary", "redo")),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(numbered.json);
});

for (const variant of ["unmarked", "other-column", "partial", "invalid", "rowspan"] as const) {
  test(`${variant}: 非受支持的首逻辑列不允许覆盖跨列文字`, async ({ page }) => {
    await mount(page, variant);
    const before = await snapshot(page);
    const menu = await openNumbering(page, variant === "rowspan" ? 2 : 1);
    const input = menu.getByRole("spinbutton", { name: "自动编号起始行" });
    await input.fill("1");
    await menu.getByRole("menuitem", { name: "自动编号", exact: true }).click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(menu.getByRole("status")).toHaveText("无法编号，请检查起始行和首列合并单元格");
    expect(await snapshot(page)).toEqual(before);
    await page.keyboard.press("Escape");
    await prose(page).locator("table tr").first().locator("td").first().click({ button: "right" });
    const headerMenu = page.getByRole("menu", { name: "表格操作" });
    await expect(headerMenu.getByRole("menuitem", { name: "自动编号", exact: true })).toHaveCount(0);
    await expect(headerMenu.getByRole("menuitem", { name: "插入序号列到最左侧" })).toBeVisible();
  });
}

test("损坏起始输入不改动已有跨列序号列", async ({ page }) => {
  await mount(page);
  const before = await snapshot(page);
  const menu = await openNumbering(page);
  const input = menu.getByRole("spinbutton", { name: "自动编号起始行" });
  for (const value of ["0", "-1", "4", "1.5", ""]) {
    await input.fill(value);
    await menu.getByRole("menuitem", { name: "自动编号", exact: true }).click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    expect(await snapshot(page)).toEqual(before);
  }
});

test("显式跨列编号不扩大原自动插行策略", async ({ page }) => {
  await mount(page, "native");
  await nativeSetup(page);
  let menu = await openNumbering(page);
  await menu.getByRole("spinbutton", { name: "自动编号起始行" }).fill("1");
  await menu.getByRole("menuitem", { name: "自动编号", exact: true }).click();
  const before = await snapshot(page);
  await prose(page).getByRole("cell", { name: "左一", exact: true }).click({ button: "right" });
  menu = page.getByRole("menu", { name: "表格操作" });
  await menu.getByRole("menuitem", { name: "向下插入", exact: true }).click();
  await expect(firstColumn(page)).toHaveText(["1", "2", "", "3"]);
  expect(header((await snapshot(page)).json)).toEqual(header(before.json));
  expect(
    await page.evaluate(() => window.__semloRequireFixture("colspanSequenceFixture").history("primary", "undo")),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});
