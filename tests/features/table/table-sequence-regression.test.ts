import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    sequenceRegressionEditor?: EditorController;
  }
}

function sequenceTable(prefix: string, start: number, rows: number) {
  return `<table><tbody>${Array.from({ length: rows }, (_, row) => {
    const number = row + 1 < start ? "" : String(row + 2 - start);
    return `<tr><td data-semlo-editor-sequence="${start}"><p>${number}</p></td><td><p>${prefix}${row + 1}</p></td></tr>`;
  }).join("")}</tbody></table>`;
}

async function mount(page: Page, content: string) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'sequence-regression-test'
      document.body.prepend(host)
      window.sequenceRegressionEditor = createEditor({ element: host, content: ${JSON.stringify(content)} })
    `,
  });
  await page.waitForFunction(() => Boolean(window.sequenceRegressionEditor));
  return page.locator("#sequence-regression-test .semlo-editor-prose");
}

const snapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").getSnapshot().json);

async function openMenu(page: Page, cell: ReturnType<Page["locator"]>) {
  await cell.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "表格操作" });
  await expect(menu).toBeVisible();
  return menu;
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("clearing a whole numbered table clears the sequence without deleting the table", async ({ page }) => {
  const prose = await mount(page, `${sequenceTable("A", 1, 3)}<p>后文</p>`);
  const before = await snapshot(page);
  await prose.getByText("A1", { exact: true }).click();
  await prose.getByText("A1", { exact: true }).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await expect(prose.locator(".selectedCell")).toHaveCount(6);
  await page.keyboard.press("Backspace");
  await expect(prose.locator("table")).toHaveCount(1);
  await expect(prose.locator("td")).toHaveText(["", "", "", "", "", ""]);
  await expect(prose.locator(".selectedCell")).toHaveCount(6);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});

test("deleting a numbered table followed by a paragraph preserves the paragraph and undo history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const prose = await mount(page, `${sequenceTable("A", 2, 3)}<p>后文</p>`);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceRegressionEditor").editor;
    editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.firstChild!.nodeSize));
  });
  await expect(prose.locator("table")).toHaveCount(0);
  await expect(prose).toHaveText("后文");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(before);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.redo()),
  ).toBe(true);
  await expect(prose).toHaveText("后文");
  expect(errors).toEqual([]);
});

test("deleting or replacing one numbered table never changes an adjacent numbered table", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page, `${sequenceTable("A", 2, 3)}${sequenceTable("B", 1, 4)}<p>尾部</p>`);
  const before = await snapshot(page);
  const second = before.content?.[1];
  expect(second?.type).toBe("table");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceRegressionEditor").editor;
    editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.firstChild!.nodeSize));
  });
  expect((await snapshot(page)).content?.[0]).toEqual(second);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(before);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.redo()),
  ).toBe(true);
  expect((await snapshot(page)).content?.[0]).toEqual(second);

  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.undo()),
  ).toBe(true);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceRegressionEditor").editor;
    const replacement = editor.state.schema.nodes.paragraph.create(null, editor.state.schema.text("替换段落"));
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.firstChild!.nodeSize, replacement));
  });
  let after = await snapshot(page);
  expect(after.content?.[0]?.type).toBe("paragraph");
  expect(after.content?.[1]).toEqual(second);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(before);

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceRegressionEditor").editor;
    const replacement = editor.state.doc.child(1);
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.firstChild!.nodeSize, replacement));
  });
  after = await snapshot(page);
  expect(after.content?.[0]).toEqual(second);
  expect(after.content?.[1]).toEqual(second);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("inserting before a numbered table keeps it independent when another table is edited", async ({ page }) => {
  const prose = await mount(page, `${sequenceTable("A", 2, 3)}${sequenceTable("B", 1, 4)}<p>尾部</p>`);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceRegressionEditor").editor;
    const paragraph = editor.state.schema.nodes.paragraph.create(null, editor.state.schema.text("前文"));
    editor.view.dispatch(editor.state.tr.insert(0, paragraph).setMeta("addToHistory", false));
  });
  const afterPrefix = await snapshot(page);
  expect(afterPrefix.content?.[1]).toEqual(before.content?.[0]);
  expect(afterPrefix.content?.[2]).toEqual(before.content?.[1]);
  const menu = await openMenu(page, prose.getByRole("cell", { name: "B2", exact: true }));
  await menu.getByRole("menuitem", { name: "向下插入" }).click();
  const tables = prose.locator("table");
  await expect(tables.nth(0).locator("tr td:first-child")).toHaveText(["", "1", "2"]);
  await expect(tables.nth(1).locator("tr td:first-child")).toHaveText(["1", "2", "3", "4", "5"]);
  expect((await snapshot(page)).content?.[1]).toEqual(afterPrefix.content?.[1]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(afterPrefix);
});

test("two generated sequence columns survive round trips and update independently", async ({ page }) => {
  const prose = await mount(
    page,
    "<table><tbody><tr><td><p>A1</p></td><td><p>A2</p></td></tr><tr><td><p>B1</p></td><td><p>B2</p></td></tr><tr><td><p>C1</p></td><td><p>C2</p></td></tr></tbody></table><p>尾部</p>",
  );
  let menu = await openMenu(page, prose.getByRole("cell", { name: "B1", exact: true }));
  await menu.getByRole("menuitem", { name: "插入序号列到最左侧" }).click();
  menu = await openMenu(page, prose.locator("tr").nth(1).locator("td").first());
  await menu.getByRole("menuitem", { name: "插入序号列到最左侧" }).click();
  const column = (index: number) => prose.locator(`tr td:nth-child(${index})`);
  await expect(column(1)).toHaveText(["", "1", "2"]);
  await expect(column(2)).toHaveText(["", "1", "2"]);
  const saved = await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").getSnapshot());
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("sequenceRegressionEditor").setContent("<p>临时内容</p>");
      window.__semloRequireFixture("sequenceRegressionEditor").setContent(value);
    }, content);
    expect(await snapshot(page)).toEqual(saved.json);
  }
  const before = await snapshot(page);
  menu = await openMenu(page, prose.getByRole("cell", { name: "B1", exact: true }));
  await menu.getByRole("menuitem", { name: "向下插入" }).click();
  await expect(column(1)).toHaveText(["", "1", "2", "3"]);
  await expect(column(2)).toHaveText(["", "1", "2", "3"]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(before);

  menu = await openMenu(page, prose.getByRole("cell", { name: "B1", exact: true }));
  await menu.getByRole("menuitem", { name: "删除所选行" }).click();
  await expect(column(1)).toHaveText(["", "1"]);
  await expect(column(2)).toHaveText(["", "1"]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(before);

  await column(1).nth(1).click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceRegressionEditor").editor;
    const text = document.querySelector(
      "#sequence-regression-test .semlo-editor-prose tr:nth-child(2) td:first-child p",
    )!.firstChild!;
    const from = editor.view.posAtDOM(text, 0);
    editor.commands.setTextSelection({ from, to: from + 1 });
  });
  await page.waitForFunction(() => window.getSelection()?.toString() === "1");
  await page.keyboard.type("99");
  await expect(column(1)).toHaveText(["", "99", "2"]);
  menu = await openMenu(page, prose.getByRole("cell", { name: "B1", exact: true }));
  await menu.getByRole("menuitem", { name: "向下插入" }).click();
  await expect(column(1)).toHaveText(["", "99", "", "2"]);
  await expect(column(2)).toHaveText(["", "1", "2", "3"]);
});

test("inserting above a numbering start never overwrites existing numeric content", async ({ page }) => {
  const html = `<table><tbody>
    <tr><td data-semlo-editor-sequence="3"><p>标题</p></td><td><p>A</p></td></tr>
    <tr><td data-semlo-editor-sequence="3"><p>42</p></td><td><p>B</p></td></tr>
    <tr><td data-semlo-editor-sequence="3"><p>1</p></td><td><p>C</p></td></tr>
    </tbody></table><p>尾部</p>`;
  const prose = await mount(page, html);
  const menu = await openMenu(page, prose.getByRole("cell", { name: "A", exact: true }));
  await menu.getByRole("menuitem", { name: "向上插入" }).click();
  await expect(prose.locator("tr td:first-child")).toHaveText(["", "标题", "42", "1"]);
});

test("sequence columns with different start rows each retain their own numbering", async ({ page }) => {
  const html = `<table><tbody>
    <tr><td data-semlo-editor-sequence="1"><p>1</p></td><td data-semlo-editor-sequence="2"><p></p></td><td><p>A</p></td></tr>
    <tr><td data-semlo-editor-sequence="1"><p>2</p></td><td data-semlo-editor-sequence="2"><p>1</p></td><td><p>B</p></td></tr>
    <tr><td data-semlo-editor-sequence="1"><p>3</p></td><td data-semlo-editor-sequence="2"><p>2</p></td><td><p>C</p></td></tr>
    </tbody></table><p>尾部</p>`;
  const prose = await mount(page, html);
  const before = await snapshot(page);
  const menu = await openMenu(page, prose.getByRole("cell", { name: "B", exact: true }));
  await menu.getByRole("menuitem", { name: "向下插入" }).click();
  await expect(prose.locator("tr td:nth-child(1)")).toHaveText(["1", "2", "3", "4"]);
  await expect(prose.locator("tr td:nth-child(2)")).toHaveText(["", "1", "2", "3"]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceRegressionEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});
