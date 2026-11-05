import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    tableContextEditor?: EditorController;
    tableContextClipboard?: { html: string; text: string };
  }
}

const content = `<table><tbody>
  <tr><td><p>A1</p></td><td><p>A2</p></td><td><p>A3</p></td></tr>
  <tr><td><p>B1</p></td><td><p>B2</p></td><td><p>B3</p></td></tr>
  <tr><td><p>C1</p></td><td><p>C2</p></td><td><p>C3</p></td></tr>
  </tbody></table><p>后文</p>`;
const errorsByPage = new WeakMap<Page, string[]>();

async function mount(page: Page) {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-context-test'
      document.body.prepend(host)
      window.tableContextEditor = createEditor({ element: host, content: ${JSON.stringify(content)} })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableContextEditor));
  return page.locator("#table-context-test .semlo-editor-prose");
}

const snapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("tableContextEditor").getSnapshot().json);

async function openMenu(page: Page, cellText: string) {
  const attempt = await page.locator("#table-context-test").evaluate((element: HTMLElement) => {
    const next = Number(element.dataset.menuAttempts ?? "0") + 1;
    element.dataset.menuAttempts = String(next);
    return next;
  });
  await page
    .locator("#table-context-test .semlo-editor-prose")
    .getByRole("cell", { name: cellText, exact: true })
    .click({
      button: "right",
    });
  const menu = page.getByRole("menu", { name: "表格操作" });
  try {
    await expect(menu).toBeVisible();
  } catch (error) {
    throw new Error(
      `Table menu did not open at ${cellText} (attempt ${attempt}); page errors: ${errorsByPage.get(page)}`,
      {
        cause: error,
      },
    );
  }
  return menu;
}

async function selectFirstFour(page: Page) {
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableContextEditor").editor;
    const positions: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") positions.push(position);
    });
    editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[4] });
  });
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("right-click inserts a requested number of rows or columns as a single undo event", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  let menu = await openMenu(page, "B2");
  const amount = menu.getByLabel("向上插入行数");
  await expect(amount).toHaveValue("1");
  await amount.fill("0");
  await menu.getByRole("menuitem", { name: "向上插入" }).click();
  await expect(menu).toBeVisible();
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  expect(await snapshot(page)).toEqual(before);

  await amount.fill("2");
  await menu.getByRole("menuitem", { name: "向上插入" }).click();
  await expect(menu).toHaveCount(0);
  await expect(prose.locator("tr")).toHaveCount(5);
  await expect(prose.locator("tr").nth(3).getByRole("cell").nth(1)).toHaveText("B2");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(before);

  menu = await openMenu(page, "B2");
  await menu.getByLabel("向右插入列数").fill("2");
  await menu.getByRole("menuitem", { name: "向右插入" }).click();
  await expect(prose.locator("tr").first().getByRole("cell")).toHaveCount(5);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(before);
});

test("the context menu remains clickable over the table toolbar and in maximum view", async ({ page }) => {
  const prose = await mount(page);
  await prose.getByRole("cell", { name: "B2" }).click();
  const toolbar = page.getByRole("toolbar", { name: "表格工具栏" });
  await expect(toolbar).toBeVisible();
  let menu = await openMenu(page, "B2");
  const insert = menu.getByRole("menuitem", { name: "向右插入" });
  const bounds = await insert.boundingBox();
  if (!bounds) throw new Error("Missing context menu geometry");
  await toolbar.evaluate((element, position) => {
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
  }, bounds);
  await insert.click();
  await expect(prose.locator("tr").first().getByRole("cell")).toHaveCount(4);

  await toolbar.getByRole("button", { name: "最大化表格" }).click();
  menu = await openMenu(page, "B2");
  await menu.getByRole("menuitem", { name: "向下插入" }).click();
  await expect(prose.locator("tr")).toHaveCount(4);
});

test("a cell selection is preserved on right-click and offers merge, split and matching counts", async ({ page }) => {
  const prose = await mount(page);
  await selectFirstFour(page);
  const menu = await openMenu(page, "A1");
  await expect(menu.getByRole("menuitem", { name: "剪切" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "复制" })).toBeVisible();
  await expect(menu.getByLabel("向上插入行数")).toHaveValue("2");
  await expect(menu.getByLabel("向右插入列数")).toHaveValue("2");
  await menu.getByRole("menuitem", { name: "合并单元格" }).click();
  const merged = prose.getByRole("cell").first();
  await expect(merged).toHaveAttribute("colspan", "2");
  await expect(merged).toHaveAttribute("rowspan", "2");
  await expect(merged).toContainText("A1");
  await expect(merged).toContainText("B2");

  await merged.click({ button: "right" });
  const splitMenu = page.getByRole("menu", { name: "表格操作" });
  await expect(splitMenu.getByLabel("向上插入行数")).toHaveValue("2");
  await expect(splitMenu.getByLabel("向右插入列数")).toHaveValue("2");
  await expect(splitMenu.getByRole("menuitem", { name: "合并单元格" })).toHaveCount(0);
  await splitMenu.getByRole("menuitem", { name: "拆分单元格" }).click();
  await expect(prose.locator("tr").first().getByRole("cell")).toHaveCount(3);
  await expect(prose.getByRole("cell").first()).toContainText("A1");
  await expect(prose.getByRole("cell").first()).toContainText("B2");
});

test("clearing a selected rectangle preserves other cells and can be undone", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  await selectFirstFour(page);
  const menu = await openMenu(page, "A1");
  await menu.getByRole("menuitem", { name: "清除内容" }).click();
  await expect(prose.locator("tr").nth(0).getByRole("cell")).toHaveText(["", "", "A3"]);
  await expect(prose.locator("tr").nth(1).getByRole("cell")).toHaveText(["", "", "B3"]);
  await expect(prose.locator("tr").nth(2).getByRole("cell")).toHaveText(["C1", "C2", "C3"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(before);
});

test("sequence column survives round trips, updates with row edits, and preserves manually changed numbers", async ({
  page,
}) => {
  const prose = await mount(page);
  let menu = await openMenu(page, "B2");
  await menu.getByRole("menuitem", { name: "插入序号列到最左侧" }).click();
  const firstColumn = () => prose.locator("tr").locator("td:first-child");
  await expect(firstColumn()).toHaveText(["", "1", "2"]);
  const sequence = await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").getSnapshot());
  await page.evaluate((html) => {
    window.__semloRequireFixture("tableContextEditor").setContent("<p>临时内容</p>");
    window.__semloRequireFixture("tableContextEditor").setContent(html);
  }, sequence.html);
  await expect(firstColumn()).toHaveText(["", "1", "2"]);
  menu = await openMenu(page, "B2");
  await expect(menu.getByRole("menuitem", { name: "插入序号列到最左侧" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "向下插入" }).click();
  await expect(firstColumn()).toHaveText(["", "1", "2", "3"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(firstColumn()).toHaveText(["", "1", "2"]);

  await firstColumn().nth(1).click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableContextEditor").editor;
    const text = document.querySelector(
      "#table-context-test .semlo-editor-prose tr:nth-child(2) td:first-child p",
    )!.firstChild!;
    const from = editor.view.posAtDOM(text, 0);
    editor.commands.setTextSelection({ from, to: from + 1 });
  });
  await page.waitForFunction(() => window.getSelection()?.toString() === "1");
  await page.keyboard.type("99");
  await expect(firstColumn()).toHaveText(["", "99", "2"]);
  menu = await openMenu(page, "B2");
  await menu.getByRole("menuitem", { name: "向下插入" }).click();
  await expect(firstColumn()).toHaveText(["", "99", "", "2"]);
});

test("sequence metadata survives JSON replacement and deletion renumbers remaining rows in one undo event", async ({
  page,
}) => {
  const prose = await mount(page);
  let menu = await openMenu(page, "B2");
  await menu.getByRole("menuitem", { name: "插入序号列到最左侧" }).click();
  const original = await snapshot(page);
  await page.evaluate((json) => {
    window.__semloRequireFixture("tableContextEditor").setContent("<p>临时内容</p>");
    window.__semloRequireFixture("tableContextEditor").setContent(json);
  }, original);
  expect(await snapshot(page)).toEqual(original);
  const firstColumn = () => prose.locator("tr").locator("td:first-child");
  await expect(firstColumn()).toHaveText(["", "1", "2"]);
  expect(
    await firstColumn().evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-semlo-editor-sequence"))),
  ).toEqual(["2", "2", "2"]);

  menu = await openMenu(page, "B2");
  await menu.getByRole("menuitem", { name: "删除所选行" }).click();
  await expect(firstColumn()).toHaveText(["", "1"]);
  await expect(prose.getByRole("cell", { name: "B2", exact: true })).toHaveCount(0);
  await expect(prose.getByRole("cell", { name: "C2", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(original);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(firstColumn()).toHaveText(["", "1"]);
});

test("menu closes on replacement, read-only changes, Escape and destruction", async ({ page }) => {
  const prose = await mount(page);
  let menu = await openMenu(page, "A1");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  menu = await openMenu(page, "A1");
  await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").setEditable(false));
  await expect(menu).toHaveCount(0);
  await prose.getByRole("cell", { name: "A1", exact: true }).click({ button: "right" });
  await expect(menu).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").setEditable(true));
  menu = await openMenu(page, "A1");
  await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").setContent("<p>替换文档</p>"));
  await expect(menu).toHaveCount(0);
  await page.evaluate((value) => window.__semloRequireFixture("tableContextEditor").setContent(value), content);
  menu = await openMenu(page, "A1");
  await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").destroy());
  await expect(menu).toHaveCount(0);
});

test("the selected rows, columns and whole table can be deleted and undone", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  let menu = await openMenu(page, "B2");
  await menu.getByRole("menuitem", { name: "删除所选行" }).click();
  await expect(prose.locator("tr")).toHaveCount(2);
  await expect(prose.getByText("B2")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(before);

  menu = await openMenu(page, "B2");
  await menu.getByRole("menuitem", { name: "删除所选列" }).click();
  await expect(prose.locator("tr").first().getByRole("cell")).toHaveCount(2);
  await expect(prose.getByText("B2")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(before);

  menu = await openMenu(page, "B2");
  await menu.getByRole("menuitem", { name: "删除表格" }).click();
  await expect(prose.locator("table")).toHaveCount(0);
  await expect(prose.getByText("后文")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(before);
});

test("copy and cut preserve the selected table data and cut can be undone", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          window.tableContextClipboard = {
            html: await (await items[0].getType("text/html")).text(),
            text: await (await items[0].getType("text/plain")).text(),
          };
        },
      },
    });
  });
  await selectFirstFour(page);
  let menu = await openMenu(page, "A1");
  await menu.getByRole("menuitem", { name: "复制" }).click();
  await page.waitForFunction(() => Boolean(window.tableContextClipboard));
  const copied = await page.evaluate(() => window.tableContextClipboard!);
  expect(copied.text).toBe("A1\tA2\nB1\tB2");
  expect(copied.html).toContain("<table");
  expect(await snapshot(page)).toEqual(before);

  await selectFirstFour(page);
  menu = await openMenu(page, "A1");
  await menu.getByRole("menuitem", { name: "剪切" }).click();
  await expect(prose.locator("tr").first().getByRole("cell")).toHaveText(["", "", "A3"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(before);
});

test("explicit numbering starts at the requested row and can be undone", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  const menu = await openMenu(page, "B1");
  await expect(menu.getByLabel("自动编号起始行")).toHaveValue("2");
  await menu.getByLabel("自动编号起始行").fill("3");
  await menu.getByRole("menuitem", { name: "自动编号" }).click();
  await expect(prose.locator("tr").locator("td:first-child")).toHaveText(["A1", "B1", "1"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableContextEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot(page)).toEqual(before);
});
