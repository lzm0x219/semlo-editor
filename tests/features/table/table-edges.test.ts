import { expect, test, type Page } from "@rstest/playwright";
import type { Locator } from "playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    tableEdgeEditor?: EditorController;
    tableEdgeOther?: EditorController;
    createTableEdgeOther?(): void;
  }
}

const content = `<table><tbody>
  <tr><td><p>A1</p></td><td><p>A2</p></td><td><p>A3</p></td></tr>
  <tr><td><p>B1</p></td><td><p>B2</p></td><td><p>B3</p></td></tr>
  <tr><td><p>C1</p></td><td><p>C2</p></td><td><p>C3</p></td></tr>
  </tbody></table><p>后文</p>`;

async function mount(page: Page, html = content) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-edge-test'
      document.body.prepend(host)
      window.tableEdgeEditor = createEditor({ element: host, content: ${JSON.stringify(html)} })
      window.createTableEdgeOther = () => {
        const other = document.createElement('div')
        other.id = 'table-edge-other'
        document.body.append(other)
        window.tableEdgeOther = createEditor({
          element: other,
          content: '<table><tbody><tr><td><p>另一张表</p></td></tr></tbody></table>',
        })
      }
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableEdgeEditor));
  const prose = page.locator("#table-edge-test .semlo-editor-prose");
  await prose.locator("td,th").first().hover();
  await expect(page.getByRole("button", { name: "选择第 1 行" })).toBeVisible();
  return prose;
}

const snapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").getSnapshot().json);

async function dragTo(page: Page, source: Locator, target: Locator, axis: "row" | "column") {
  // The overlay replaces its buttons on the next animation frame after a
  // selection or undo. Retry while that replacement is in progress.
  const geometry: {
    from?: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
    to?: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
  } = {};
  await expect
    .poll(async () => {
      const [from, to] = await Promise.all([source.boundingBox(), target.boundingBox()]);
      if (!from || !to) return false;
      geometry.from = from;
      geometry.to = to;
      return true;
    })
    .toBe(true);
  const { from, to } = geometry;
  if (!from || !to) throw new Error("Table edge geometry became unavailable");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    axis === "row" ? to.x + to.width / 2 : to.x + to.width - 2,
    axis === "row" ? to.y + to.height - 2 : to.y + to.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("edge bands select a row or column and add or delete it with one undo", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "选择第 2 行" }).click();
  await expect(prose.locator(".selectedCell")).toHaveText(["B1", "B2", "B3"]);
  await page.getByRole("button", { name: "在下方插入行" }).click();
  await expect(prose.locator("tr")).toHaveCount(4);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["", "", ""]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);

  await expect(page.getByRole("button", { name: "选择第 2 列" })).toBeVisible();
  await page.getByRole("button", { name: "选择第 2 列" }).click();
  await expect(prose.locator(".selectedCell")).toHaveText(["A2", "B2", "C2"]);
  await page.getByRole("button", { name: "在右侧插入列" }).click();
  await expect(prose.locator("tr").first().locator("td")).toHaveCount(4);
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["A1", "A2", "", "A3"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);

  await expect(page.getByRole("button", { name: "选择第 2 行" })).toBeVisible();
  await page.getByRole("button", { name: "选择第 2 行" }).click();
  await page.getByRole("button", { name: "删除所选行" }).click();
  await expect(prose.locator("tr")).toHaveCount(2);
  await expect(prose.getByText("B2", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});

test("Shift-click selects a continuous range in either direction and a plain click resets it", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  const column = (number: number) => page.getByRole("button", { name: `选择第 ${number} 列` });
  const row = (number: number) => page.getByRole("button", { name: `选择第 ${number} 行` });

  await column(1).click();
  await column(3).click({ modifiers: ["Shift"] });
  await expect(prose.locator(".selectedCell")).toHaveText(["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]);
  await column(2).click();
  await expect(prose.locator(".selectedCell")).toHaveText(["A2", "B2", "C2"]);
  await column(1).click({ modifiers: ["Shift"] });
  await expect(prose.locator(".selectedCell")).toHaveText(["A1", "A2", "B1", "B2", "C1", "C2"]);

  await row(3).click();
  await row(1).click({ modifiers: ["Shift"] });
  await expect(prose.locator(".selectedCell")).toHaveText(["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]);
  await row(2).click();
  await expect(prose.locator(".selectedCell")).toHaveText(["B1", "B2", "B3"]);
  expect(await snapshot(page)).toEqual(before);
});

test("Shift ranges include merged cells without changing table content", async ({ page }) => {
  const prose = await mount(
    page,
    '<table><tbody><tr><td colspan="2"><p>合并</p></td><td><p>甲</p></td></tr><tr><td><p>乙</p></td><td><p>丙</p></td><td><p>丁</p></td></tr><tr><td><p>戊</p></td><td><p>己</p></td><td><p>庚</p></td></tr></tbody></table>',
  );
  const before = await snapshot(page);
  await page.getByRole("button", { name: "选择第 3 列" }).click();
  await page.getByRole("button", { name: "选择第 2 列" }).click({ modifiers: ["Shift"] });
  await expect(prose.getByRole("cell", { name: "合并" })).toHaveClass(/selectedCell/);
  await expect(prose.getByRole("cell", { name: "甲" })).toHaveClass(/selectedCell/);
  await expect(prose.getByRole("cell", { name: "丙" })).toHaveClass(/selectedCell/);
  await expect(prose.getByRole("cell", { name: "丁" })).toHaveClass(/selectedCell/);
  expect(await snapshot(page)).toEqual(before);
});

test("a reverse Shift row range expands around row-spanning cells", async ({ page }) => {
  const prose = await mount(
    page,
    '<table><tbody><tr><td rowspan="2"><p>合并</p></td><td><p>甲</p></td></tr><tr><td><p>乙</p></td></tr><tr><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table>',
  );
  const before = await snapshot(page);
  await page.getByRole("button", { name: "选择第 3 行" }).click();
  await page.getByRole("button", { name: "选择第 2 行" }).click({ modifiers: ["Shift"] });
  await expect(prose.locator(".selectedCell")).toHaveText(["合并", "甲", "乙", "丙", "丁"]);
  await page.getByRole("button", { name: "选择第 3 行" }).click();
  await expect(prose.locator(".selectedCell")).toHaveText(["丙", "丁"]);
  expect(await snapshot(page)).toEqual(before);
});

test("deleting a Shift-selected column range is a single undo event", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "选择第 3 列" }).click();
  await page.getByRole("button", { name: "选择第 2 列" }).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "删除所选列" }).click();
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["A1"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["B1"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["C1"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});

test("dragging row and column bands reorders whole rows and columns", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  await dragTo(
    page,
    page.getByRole("button", { name: "选择第 2 行" }),
    page.getByRole("button", { name: "选择第 3 行" }),
    "row",
  );
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["A1", "A2", "A3"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["C1", "C2", "C3"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["B1", "B2", "B3"]);
  await expect(prose.locator(".selectedCell")).toHaveText(["B1", "B2", "B3"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);

  await expect(page.getByRole("button", { name: "选择第 2 列" })).toBeVisible();
  await dragTo(
    page,
    page.getByRole("button", { name: "选择第 2 列" }),
    page.getByRole("button", { name: "选择第 3 列" }),
    "column",
  );
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["A1", "A3", "A2"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["B1", "B3", "B2"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["C1", "C3", "C2"]);
  await expect(prose.locator(".selectedCell")).toHaveText(["A2", "B2", "C2"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});

test("row dragging targets the row under the pointer when row heights differ", async ({ page }) => {
  // Use real multi-line document content: mutating a managed <tr>'s style is
  // observed by ProseMirror and the next reconciliation can replace that row.
  const prose = await mount(page, content.replace("<p>A1</p>", "<p>A1<br><br><br><br><br><br></p>"));
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll<HTMLElement>("#table-edge-test .semlo-editor-prose tr");
    const firstRow = rows[0]?.getBoundingClientRect();
    const secondRow = rows[1]?.getBoundingClientRect();
    const firstBand = document.querySelector<HTMLElement>('[aria-label="选择第 1 行"]')?.getBoundingClientRect();
    const secondBand = document.querySelector<HTMLElement>('[aria-label="选择第 2 行"]')?.getBoundingClientRect();
    if (!firstRow || !secondRow || !firstBand || !secondBand) return false;
    const dropY = firstBand.bottom - 2;
    return (
      Math.abs(firstBand.top - firstRow.top) < 1 &&
      Math.abs(firstBand.bottom - firstRow.bottom) < 1 &&
      Math.abs(secondBand.top - secondRow.top) < 1 &&
      Math.abs(dropY - (secondRow.top + secondRow.bottom) / 2) < Math.abs(dropY - (firstRow.top + firstRow.bottom) / 2)
    );
  });
  await dragTo(
    page,
    page.getByRole("button", { name: "选择第 3 行" }),
    page.getByRole("button", { name: "选择第 1 行" }),
    "row",
  );
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["C1", "C2", "C3"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["A1", "A2", "A3"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["B1", "B2", "B3"]);
});

test("column dragging targets the column under the pointer when column widths differ", async ({ page }) => {
  const prose = await mount(page);
  await prose.locator("table").evaluate((table: HTMLTableElement) => {
    table.style.width = "360px";
    table.style.tableLayout = "fixed";
    const columns = table.querySelectorAll<HTMLTableColElement>("colgroup > col");
    columns[0].style.width = "220px";
    columns[1].style.width = "40px";
    columns[2].style.width = "100px";
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction(() => {
    const first = document.querySelector<HTMLElement>('[aria-label="选择第 1 列"]')?.getBoundingClientRect();
    const second = document.querySelector<HTMLElement>('[aria-label="选择第 2 列"]')?.getBoundingClientRect();
    return !!first && !!second && first.width > second.width * 2;
  });
  await dragTo(
    page,
    page.getByRole("button", { name: "选择第 3 列" }),
    page.getByRole("button", { name: "选择第 1 列" }),
    "column",
  );
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["A3", "A1", "A2"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["B3", "B1", "B2"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["C3", "C1", "C2"]);
});

test("dragging selected rows and columns keeps their order and is undone in one step", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  const row = (number: number) => page.getByRole("button", { name: `选择第 ${number} 行` });
  const column = (number: number) => page.getByRole("button", { name: `选择第 ${number} 列` });

  await row(1).click();
  await row(2).click({ modifiers: ["Shift"] });
  await dragTo(page, row(2), row(3), "row");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["C1", "C2", "C3"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["A1", "A2", "A3"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["B1", "B2", "B3"]);
  await expect(prose.locator(".selectedCell")).toHaveText(["A1", "A2", "A3", "B1", "B2", "B3"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);

  await expect(column(1)).toBeVisible();
  await column(1).click();
  await column(2).click({ modifiers: ["Shift"] });
  await dragTo(page, column(2), column(3), "column");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["A3", "A1", "A2"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["B3", "B1", "B2"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["C3", "C1", "C2"]);
  await expect(prose.locator(".selectedCell")).toHaveText(["A1", "A2", "B1", "B2", "C1", "C2"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});

test("reverse-selected rows and columns can be moved before an earlier band", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  const row = (number: number) => page.getByRole("button", { name: `选择第 ${number} 行` });
  const column = (number: number) => page.getByRole("button", { name: `选择第 ${number} 列` });

  await row(3).click();
  await row(2).click({ modifiers: ["Shift"] });
  await dragTo(page, row(2), row(1), "row");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["B1", "B2", "B3"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["C1", "C2", "C3"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["A1", "A2", "A3"]);
  await expect(prose.locator(".selectedCell")).toHaveText(["B1", "B2", "B3", "C1", "C2", "C3"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);

  await expect(column(3)).toBeVisible();
  await column(3).click();
  await column(2).click({ modifiers: ["Shift"] });
  await dragTo(page, column(2), column(1), "column");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["A2", "A3", "A1"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["B2", "B3", "B1"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["C2", "C3", "C1"]);
  await expect(prose.locator(".selectedCell")).toHaveText(["A2", "A3", "B2", "B3", "C2", "C3"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});

test("dropping inside the selection preserves it, while a plain click selects one band", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  const row = (number: number) => page.getByRole("button", { name: `选择第 ${number} 行` });
  await row(1).click();
  await row(2).click({ modifiers: ["Shift"] });
  await dragTo(page, row(2), row(1), "row");
  expect(await snapshot(page)).toEqual(before);
  await expect(prose.locator(".selectedCell")).toHaveText(["A1", "A2", "A3", "B1", "B2", "B3"]);
  await row(2).click();
  await expect(prose.locator(".selectedCell")).toHaveText(["B1", "B2", "B3"]);
  expect(await snapshot(page)).toEqual(before);
});

test("selected rows with rowspans move together and keep their numbers", async ({ page }) => {
  const prose = await mount(
    page,
    '<table><tbody><tr><td><p>1</p></td><td rowspan="2"><p>合并</p></td><td><p>甲</p></td></tr><tr><td><p>2</p></td><td><p>乙</p></td></tr><tr><td><p>3</p></td><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table>',
  );
  const before = await snapshot(page);
  const row = (number: number) => page.getByRole("button", { name: `选择第 ${number} 行` });
  await row(1).click();
  await row(2).click({ modifiers: ["Shift"] });
  await dragTo(page, row(2), row(3), "row");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["3", "丙", "丁"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["1", "合并", "甲"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["2", "乙"]);
  await expect(prose.getByRole("cell", { name: "合并" })).toHaveAttribute("rowspan", "2");
  await expect(prose.locator(".selectedCell")).toHaveText(["1", "合并", "甲", "2", "乙"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});

test("selected columns move across a merged destination without splitting cells", async ({ page }) => {
  const prose = await mount(
    page,
    '<table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td><td colspan="2"><p>合并</p></td></tr><tr><td><p>A1</p></td><td><p>A2</p></td><td><p>A3</p></td><td><p>A4</p></td></tr></tbody></table>',
  );
  const before = await snapshot(page);
  const column = (number: number) => page.getByRole("button", { name: `选择第 ${number} 列` });
  await column(1).click();
  await column(2).click({ modifiers: ["Shift"] });
  await dragTo(page, column(2), column(3), "column");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["合并", "甲", "乙"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["A3", "A4", "A1", "A2"]);
  await expect(prose.getByRole("cell", { name: "合并" })).toHaveAttribute("colspan", "2");
  await expect(prose.locator(".selectedCell")).toHaveText(["甲", "乙", "A1", "A2"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});

test("dragging onto another table does not move either table", async ({ page }) => {
  const prose = await mount(
    page,
    `${content}<p>两表之间</p><table><tbody><tr><td><p>另一张表</p></td></tr></tbody></table>`,
  );
  const before = await snapshot(page);
  const source = page.getByRole("button", { name: "选择第 2 行" });
  const from = await source.boundingBox();
  const other = await prose.getByRole("cell", { name: "另一张表" }).boundingBox();
  if (!from || !other) throw new Error("Missing table geometry");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(other.x + other.width / 2, other.y + other.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await snapshot(page)).toEqual(before);
  await expect(prose.locator(".selectedCell")).toHaveText(["B1", "B2", "B3"]);
});

test("row drag follows the table when its layout changes", async ({ page }) => {
  const prose = await mount(page, `<p>前文</p>${content}`);
  await prose.getByText("前文", { exact: true }).click();
  await prose.getByText("B1", { exact: true }).hover();
  const source = page.getByRole("button", { name: "选择第 2 行" });
  const destination = page.getByRole("button", { name: "选择第 3 行" });
  const from = await source.boundingBox();
  const beforeTarget = await destination.boundingBox();
  if (!from || !beforeTarget) throw new Error("Missing table edge geometry");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#table-edge-test")!.style.marginTop = "40px";
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction((top) => {
    const element = document.querySelector<HTMLElement>('[aria-label="选择第 3 行"]');
    return !!element && element.getBoundingClientRect().top > top + 5;
  }, beforeTarget.y);
  const afterTarget = await destination.boundingBox();
  if (!afterTarget) throw new Error("The row handle disappeared during drag");
  await page.mouse.move(afterTarget.x + afterTarget.width / 2, afterTarget.y + afterTarget.height - 2, { steps: 8 });
  await page.mouse.up();
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["C1", "C2", "C3"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["B1", "B2", "B3"]);
});

test("merged cells are retained when selecting and inserting beside a row", async ({ page }) => {
  const prose = await mount(
    page,
    '<table><tbody><tr><td rowspan="2"><p>合并</p></td><td><p>甲</p></td></tr><tr><td><p>乙</p></td></tr><tr><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table><p>后文</p>',
  );
  const before = await snapshot(page);
  await page.getByRole("button", { name: "选择第 1 行" }).click();
  await expect(prose.getByRole("cell", { name: "合并" })).toHaveClass(/selectedCell/);
  await page.getByRole("button", { name: "在下方插入行" }).click();
  await expect(prose.locator("tr")).toHaveCount(4);
  await expect(prose.getByRole("cell", { name: "合并" })).toHaveAttribute("rowspan", "2");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});

test("edge controls follow the focused table and clean up on replacement and destruction", async ({ page }) => {
  const prose = await mount(page);
  await page.evaluate(() => window.__semloRequireFixture("createTableEdgeOther").bind(window)());
  await page.locator("#table-edge-other .semlo-editor-prose td").click();
  await expect(page.getByRole("button", { name: "选择第 1 行" })).toHaveCount(1);
  await page.getByRole("button", { name: "选择第 1 行" }).click();
  await expect(page.locator("#table-edge-other .selectedCell")).toHaveText(["另一张表"]);
  await expect(prose.locator(".selectedCell")).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("tableEdgeOther").setContent("<p>已替换</p>"));
  await expect(page.getByRole("button", { name: "选择第 1 行" })).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("tableEdgeOther").destroy());
  await prose.getByText("A1", { exact: true }).hover();
  await expect(page.getByRole("button", { name: "选择第 1 行" })).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").destroy());
  await expect(page.getByRole("button", { name: "选择第 1 行" })).toHaveCount(0);
});

test("read-only changes or destruction cancel an unfinished drag", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  const row = page.getByRole("button", { name: "选择第 1 行" });
  const destination = page.getByRole("button", { name: "选择第 3 行" });
  const sourceBox = await row.boundingBox();
  const destinationBox = await destination.boundingBox();
  if (!sourceBox || !destinationBox) throw new Error("Missing table row handles");
  await page.mouse.move(sourceBox.x + 6, sourceBox.y + 6);
  await page.mouse.down();
  await page.mouse.move(destinationBox.x + 6, destinationBox.y + destinationBox.height - 2, { steps: 6 });
  await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").setEditable(false));
  await page.mouse.up();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByRole("button", { name: "选择第 1 行" })).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").setEditable(true));
  await prose.locator("td").first().hover();
  await expect(page.getByRole("button", { name: "选择第 1 行" })).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").editor.setEditable(false, false));
  await expect(page.getByRole("button", { name: "选择第 1 行" })).toHaveCount(0);

  await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").setEditable(true));
  await prose.locator("td").first().hover();
  const latestSource = await row.boundingBox();
  const latestDestination = await destination.boundingBox();
  if (!latestSource || !latestDestination) throw new Error("Missing table row handles after restoring editing");
  await page.mouse.move(latestSource.x + 6, latestSource.y + 6);
  await page.mouse.down();
  await page.mouse.move(latestDestination.x + 6, latestDestination.y + latestDestination.height - 2, { steps: 6 });
  await page.evaluate(() => window.__semloRequireFixture("tableEdgeEditor").destroy());
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "选择第 1 行" })).toHaveCount(0);
});

test("column bands remain clipped to the table wrapper while scrolling horizontally", async ({ page }) => {
  const prose = await mount(page);
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#table-edge-test")!;
    host.style.width = "360px";
    const table = host.querySelector<HTMLTableElement>("table")!;
    table.style.width = "1100px";
  });
  const wrapper = prose.locator(".tableWrapper");
  await wrapper.evaluate((element: HTMLElement) => {
    element.scrollLeft = 400;
  });
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>("#table-edge-test .tableWrapper")!.scrollLeft > 0,
  );
  // The scroll event and the overlay's animation-frame update happen after
  // scrollLeft changes. Wait for the bands to match the visible columns.
  await page.waitForFunction(() => {
    const wrapper = document.querySelector<HTMLElement>("#table-edge-test .tableWrapper")!;
    const clip = wrapper.getBoundingClientRect();
    const columns = [...wrapper.querySelectorAll<HTMLTableColElement>("colgroup > col")];
    const bands = [...document.querySelectorAll<HTMLElement>(".semlo-editor-table-edge-column")];
    const visible = columns.flatMap((column, index) => {
      const rect = column.getBoundingClientRect();
      const left = Math.max(rect.left, clip.left, 0);
      const right = Math.min(rect.right, clip.right, window.innerWidth);
      return right > left ? [{ index, left, right }] : [];
    });
    return (
      bands.length === visible.length &&
      bands.length > 0 &&
      visible.every(({ index, left, right }) => {
        const band = bands.find((element) => element.getAttribute("aria-label") === `选择第 ${index + 1} 列`);
        if (!band) return false;
        const rect = band.getBoundingClientRect();
        return Math.abs(rect.left - left) < 1 && Math.abs(rect.right - right) < 1;
      })
    );
  });
  const geometry = await page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>("#table-edge-test .tableWrapper")!.getBoundingClientRect();
    const bands = [...document.querySelectorAll<HTMLElement>(".semlo-editor-table-edge-column")].map((element) =>
      element.getBoundingClientRect(),
    );
    return { left: wrapper.left, right: wrapper.right, bands: bands.map(({ left, right }) => ({ left, right })) };
  });
  expect(geometry.bands.length).toBeGreaterThan(0);
  expect(geometry.bands.every((band) => band.left >= geometry.left - 1 && band.right <= geometry.right + 1)).toBe(true);
});
