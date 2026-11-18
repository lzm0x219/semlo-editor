import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(({ page }) => installFixtureGuards(page));

for (const start of [2, 3, 4, 5]) {
  test(`first-column sequence starts at physical row ${start} after a rowspan`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({element: host, content: '<table><tbody><tr><td>标题</td><td>A</td></tr><tr><td rowspan="2">分组</td><td>B</td></tr><tr><td>C</td></tr><tr><td>待一</td><td>D</td></tr><tr><td>待二</td><td>E</td></tr></tbody></table>'})
    `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    const host = page.locator("#table-navigation-test");
    const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
    await host.getByRole("cell", { name: "标题", exact: true }).click({ button: "right" });
    const menu = page.getByRole("menu", { name: "表格操作" });
    await menu.getByRole("spinbutton", { name: "自动编号起始行" }).fill(String(start));
    await menu.getByRole("menuitem", { name: "自动编号" }).click();
    const firstColumn = host.locator("td[data-semlo-editor-sequence]");
    const expected =
      start === 2 ? ["标题", "1", "2", "3"] : start <= 4 ? ["标题", "分组", "1", "2"] : ["标题", "分组", "待一", "1"];
    await expect(firstColumn).toHaveText(expected);
    const numbered = await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
      before,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
      numbered,
    );
    if (start === 4) {
      await host.getByRole("cell", { name: "D", exact: true }).click({ button: "right" });
      await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向下插入" }).click();
      await expect(host.locator("td[data-semlo-editor-sequence]")).toHaveText(["标题", "分组", "1", "2", "3"]);
    }
  });
}

test("first-column sequence preserves data when colspan crosses its boundary", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const html =
    '<table><tbody><tr><td colspan="2">跨列内容</td></tr><tr><td>待填</td><td>右侧数据</td></tr></tbody></table>';
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({element:host, content:${JSON.stringify(html)}})
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const host = page.locator("#table-navigation-test");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await host.getByRole("cell", { name: "待填", exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "表格操作" });
  const input = menu.getByRole("spinbutton", { name: "自动编号起始行" });
  await input.fill("1");
  await menu.getByRole("menuitem", { name: "自动编号" }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(menu.getByRole("status")).toHaveText("无法编号，请检查起始行和首列合并单元格");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
});

for (const rowSpan of [1, 2]) {
  test(`numbering below a ${rowSpan}-row cross-column header preserves it`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    const header = `<tr><td colspan="2" rowspan="${rowSpan}"><p>表头</p><p>右侧资料</p></td><td>其他</td></tr>`;
    const middle = rowSpan === 2 ? "<tr><td>跨行旁列</td></tr>" : "";
    const html = `<table><tbody>${header}${middle}<tr><td>待一</td><td>K</td><td>P</td></tr><tr><td>待二</td><td>L</td><td>Q</td></tr></tbody></table>`;
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({element:host, content:${JSON.stringify(html)}})
    `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    const host = page.locator("#table-navigation-test");
    const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
    const headerCell = host.locator('td[colspan="2"]');
    const originalHeader = await headerCell.innerHTML();
    await host.getByRole("cell", { name: "待一", exact: true }).click({ button: "right" });
    const menu = page.getByRole("menu", { name: "表格操作" });
    await menu.getByRole("spinbutton", { name: "自动编号起始行" }).fill(String(rowSpan + 1));
    await menu.getByRole("menuitem", { name: "自动编号" }).click();
    await expect(host.locator("td[data-semlo-editor-sequence]")).toHaveText(["表头右侧资料", "1", "2"]);
    expect(await headerCell.innerHTML()).toBe(originalHeader);
    await expect(host.getByRole("cell", { name: "K", exact: true })).toBeVisible();
    const numbered = await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
      before,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
      numbered,
    );
    await host.getByRole("cell", { name: "K", exact: true }).click({ button: "right" });
    await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向下插入" }).click();
    await expect(host.locator("td[data-semlo-editor-sequence]")).toHaveText(["表头右侧资料", "1", "2", "3"]);
    expect(await headerCell.innerHTML()).toBe(originalHeader);
  });
}

test("merging sequence cells below a cross-column header preserves data and undo", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const html =
    '<table><tbody><tr><td colspan="2" data-semlo-editor-sequence="2"><p>表头</p><p>右侧资料</p></td><td>其他</td></tr><tr><td data-semlo-editor-sequence="2">1</td><td>A</td><td>P</td></tr><tr><td data-semlo-editor-sequence="2">2</td><td>B</td><td>Q</td></tr><tr><td data-semlo-editor-sequence="2">3</td><td>C</td><td>R</td></tr></tbody></table>';
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({element:host, content:${JSON.stringify(html)}})
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const host = page.locator("#table-navigation-test");
  const header = host.locator('td[colspan="2"]');
  const originalHeader = await header.innerHTML();
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const before = await snapshot();
  const first = await host.getByRole("cell", { name: "1", exact: true }).boundingBox();
  const second = await host.getByRole("cell", { name: "2", exact: true }).boundingBox();
  if (!first || !second) throw new Error("Missing numbered cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 15, second.y + second.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(host.locator(".selectedCell")).toHaveCount(2);
  await host.getByRole("cell", { name: "2", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "合并单元格" }).click();
  await expect(host.locator("td[data-semlo-editor-sequence]")).toHaveText(["表头右侧资料", "1", "2"]);
  await expect(host.locator('td[rowspan="2"]')).toHaveText("1");
  expect(await header.innerHTML()).toBe(originalHeader);
  for (const text of ["A", "B", "C", "P", "Q", "R"])
    await expect(host.getByRole("cell", { name: text, exact: true })).toBeVisible();
  const merged = await snapshot();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(before);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(merged);
});

test("merging sequence cells below a cross-row-and-column header preserves data and undo", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const html =
    '<table><tbody><tr><td colspan="2" rowspan="2" data-semlo-editor-sequence="2"><p>表头</p><p>右侧资料</p></td><td>其他</td></tr><tr><td>跨行旁列</td></tr><tr><td data-semlo-editor-sequence="2">1</td><td>A</td><td>P</td></tr><tr><td data-semlo-editor-sequence="2">2</td><td>B</td><td>Q</td></tr><tr><td data-semlo-editor-sequence="2">3</td><td>C</td><td>R</td></tr></tbody></table>';
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({element:host, content:${JSON.stringify(html)}})
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const host = page.locator("#table-navigation-test");
  const header = host.locator('td[colspan="2"]');
  const originalHeader = await header.innerHTML();
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const before = await snapshot();
  const first = await host.getByRole("cell", { name: "1", exact: true }).boundingBox();
  const second = await host.getByRole("cell", { name: "2", exact: true }).boundingBox();
  if (!first || !second) throw new Error("Missing numbered cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 15, second.y + second.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(host.locator(".selectedCell")).toHaveCount(2);
  await host.getByRole("cell", { name: "2", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "合并单元格" }).click();
  await expect(host.locator("td[data-semlo-editor-sequence]")).toHaveText(["表头右侧资料", "1", "2"]);
  await expect(host.getByRole("cell", { name: "1", exact: true })).toHaveAttribute("rowspan", "2");
  expect(await header.innerHTML()).toBe(originalHeader);
  for (const text of ["A", "B", "C", "P", "Q", "R"])
    await expect(host.getByRole("cell", { name: text, exact: true })).toBeVisible();
  const merged = await snapshot();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(before);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(merged);
});

test("merging an edited sequence below a spanning header keeps all text and can be undone", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const html =
    '<table><tbody><tr><td colspan="2" rowspan="2" data-semlo-editor-sequence="2"><p>表头</p><p>右侧资料</p></td><td>其他</td></tr><tr><td>跨行旁列</td></tr><tr><td data-semlo-editor-sequence="2">1</td><td>A</td><td>P</td></tr><tr><td data-semlo-editor-sequence="2">手改</td><td>B</td><td>Q</td></tr><tr><td data-semlo-editor-sequence="2">3</td><td>C</td><td>R</td></tr></tbody></table>';
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({element:host, content:${JSON.stringify(html)}})
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const host = page.locator("#table-navigation-test");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const before = await snapshot();
  const header = await host.locator('td[colspan="2"]').innerHTML();
  const first = await host.getByRole("cell", { name: "1", exact: true }).boundingBox();
  const second = await host.getByRole("cell", { name: "手改", exact: true }).boundingBox();
  if (!first || !second) throw new Error("Missing sequence cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 15, second.y + second.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(host.locator(".selectedCell")).toHaveCount(2);
  await host.getByRole("cell", { name: "手改", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "合并单元格" }).click();
  const merged = host.locator('td[rowspan="2"]').filter({ hasText: "手改" });
  await expect(merged).toContainText("1");
  await expect(merged).toContainText("手改");
  expect(await host.locator('td[colspan="2"]').innerHTML()).toBe(header);
  for (const text of ["A", "B", "C", "P", "Q", "R"])
    await expect(host.getByRole("cell", { name: text, exact: true })).toBeVisible();
  const after = await snapshot();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(before);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(after);
});

test("numbering from inside a cross-column and cross-row header preserves all header content", async ({ page }) => {
  const rowSpan = 2;
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const header = `<tr><td colspan="2" rowspan="${rowSpan}"><p>表头</p><p>右侧资料</p></td><td>其他</td></tr>`;
  const middle = rowSpan === 2 ? "<tr><td>跨行旁列</td></tr>" : "";
  const html = `<table><tbody>${header}${middle}<tr><td>待一</td><td>K</td><td>P</td></tr><tr><td>待二</td><td>L</td><td>Q</td></tr></tbody></table>`;
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({element:host, content:${JSON.stringify(html)}})
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const host = page.locator("#table-navigation-test");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const headerCell = host.locator('td[colspan="2"]');
  const originalHeader = await headerCell.innerHTML();
  await host.getByRole("cell", { name: "待一", exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "表格操作" });
  await menu.getByRole("spinbutton", { name: "自动编号起始行" }).fill("2");
  await menu.getByRole("menuitem", { name: "自动编号" }).click();
  await expect(host.locator("td[data-semlo-editor-sequence]")).toHaveText(["表头右侧资料", "1", "2"]);
  expect(await headerCell.innerHTML()).toBe(originalHeader);
  await expect(host.getByRole("cell", { name: "K", exact: true })).toBeVisible();
  const numbered = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    numbered,
  );
  await host.getByRole("cell", { name: "K", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向下插入" }).click();
  await expect(host.locator("td[data-semlo-editor-sequence]")).toHaveText(["表头右侧资料", "1", "2", "3"]);
  expect(await headerCell.innerHTML()).toBe(originalHeader);
});

test("repeatedly merging numbered cells preserves spanning header and undo history", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const html =
    '<table><tbody><tr><td colspan="2" rowspan="2" data-semlo-editor-sequence="2"><p>表头</p><p>右侧资料</p></td><td>其他</td></tr><tr><td>跨行旁列</td></tr><tr><td data-semlo-editor-sequence="2">1</td><td>A</td><td>P</td></tr><tr><td data-semlo-editor-sequence="2">2</td><td>B</td><td>Q</td></tr><tr><td data-semlo-editor-sequence="2">3</td><td>C</td><td>R</td></tr><tr><td data-semlo-editor-sequence="2">4</td><td>D</td><td>S</td></tr></tbody></table>';
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({element:host, content:${JSON.stringify(html)}})
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const host = page.locator("#table-navigation-test");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const before = await snapshot();
  const header = await host.locator('td[colspan="2"]').innerHTML();
  const merge = async () => {
    const first = await host.getByRole("cell", { name: "1", exact: true }).boundingBox();
    const second = await host.getByRole("cell", { name: "2", exact: true }).boundingBox();
    if (!first || !second) throw new Error("Missing numbered cells");
    await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width - 15, second.y + second.height / 2, { steps: 5 });
    await page.mouse.up();
    await host.getByRole("cell", { name: "2", exact: true }).click({ button: "right" });
    await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "合并单元格" }).click();
  };
  await merge();
  await expect(host.locator("td[data-semlo-editor-sequence]")).toHaveText(["表头右侧资料", "1", "2", "3"]);
  const once = await snapshot();
  await merge();
  await expect(host.locator("td[data-semlo-editor-sequence]")).toHaveText(["表头右侧资料", "1", "2"]);
  await expect(host.getByRole("cell", { name: "1", exact: true })).toHaveAttribute("rowspan", "3");
  expect(await host.locator('td[colspan="2"]').innerHTML()).toBe(header);
  for (const text of ["A", "B", "C", "D", "P", "Q", "R", "S"])
    await expect(host.getByRole("cell", { name: text, exact: true })).toBeVisible();
  const twice = await snapshot();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(once);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(before);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(once);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(twice);
});

test("merging an edited spanning sequence cell retains text and supports undo", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const html =
    '<table><tbody><tr><td colspan="2" rowspan="2" data-semlo-editor-sequence="2"><p>表头</p><p>右侧资料</p></td><td>其他</td></tr><tr><td>跨行旁列</td></tr><tr><td data-semlo-editor-sequence="2">1</td><td>A</td><td>P</td></tr><tr><td data-semlo-editor-sequence="2">2</td><td>B</td><td>Q</td></tr><tr><td data-semlo-editor-sequence="2">3</td><td>C</td><td>R</td></tr><tr><td data-semlo-editor-sequence="2">4</td><td>D</td><td>S</td></tr></tbody></table>';
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({element:host, content:${JSON.stringify(html)}})
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const host = page.locator("#table-navigation-test");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const header = await host.locator('td[colspan="2"]').innerHTML();
  const merge = async () => {
    const first = await host.getByRole("cell", { name: "1", exact: true }).boundingBox();
    const second = await host.getByRole("cell", { name: "2", exact: true }).boundingBox();
    if (!first || !second) throw new Error("Missing numbered cells");
    await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width - 15, second.y + second.height / 2, { steps: 5 });
    await page.mouse.up();
    await host.getByRole("cell", { name: "2", exact: true }).click({ button: "right" });
    await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "合并单元格" }).click();
  };
  await merge();
  await expect(host.locator("td[data-semlo-editor-sequence]")).toHaveText(["表头右侧资料", "1", "2", "3"]);
  const firstCell = host.locator('td[rowspan="2"]').filter({ hasText: "1" });
  await firstCell.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("X");
  await expect(firstCell).toHaveText("1X");
  const beforeSecondMerge = await snapshot();
  const first = await host.getByRole("cell", { name: "1X", exact: true }).boundingBox();
  const second = await host.getByRole("cell", { name: "2", exact: true }).boundingBox();
  if (!first || !second) throw new Error("Missing edited and numbered cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 15, second.y + second.height / 2, { steps: 5 });
  await page.mouse.up();
  await host.getByRole("cell", { name: "2", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "合并单元格" }).click();
  const merged = host.locator('td[rowspan="3"]');
  await expect(merged).toContainText("1X");
  await expect(merged).toContainText("2");
  expect(await host.locator('td[colspan="2"]').innerHTML()).toBe(header);
  for (const text of ["A", "B", "C", "D", "P", "Q", "R", "S"])
    await expect(host.getByRole("cell", { name: text, exact: true })).toBeVisible();
  const afterSecondMerge = await snapshot();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(beforeSecondMerge);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(afterSecondMerge);
});

test("pressing and releasing an unset column boundary preserves content and undo", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; host.style.width = '520px'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({element:host, outline:false, content:'<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>'})
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const initial = await snapshot();
  await prose.getByRole("cell", { name: "B", exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(prose.getByRole("cell", { name: "B!", exact: true })).toBeVisible();
  const before = await snapshot();
  const box = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  if (!box) throw new Error("Missing table cell");
  const x = box.x + box.width - 1;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await expect(prose.locator(".column-resize-handle").first()).toBeVisible();
  await page.mouse.down();
  await page.mouse.up();
  expect(await snapshot()).toEqual(before);
  const initialPreviewWidth = await prose
    .locator("table col")
    .first()
    .evaluate((col) => col.getBoundingClientRect().width);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 35, y, { steps: 5 });
  const previewWidth = await prose
    .locator("table col")
    .first()
    .evaluate((col) => col.getBoundingClientRect().width);
  expect(previewWidth - initialPreviewWidth).toBeGreaterThan(30);
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
  expect(await snapshot()).toEqual(before);
  const restoredPreviewWidth = await prose
    .locator("table col")
    .first()
    .evaluate((col) => col.getBoundingClientRect().width);
  expect(restoredPreviewWidth).toBeCloseTo(initialPreviewWidth, 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(initial);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(before);
  const initialWidth = await prose
    .locator("table col")
    .first()
    .evaluate((col) => col.getBoundingClientRect().width);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 35, y, { steps: 5 });
  await page.mouse.up();
  const resized = await snapshot();
  const resizedWidth = await prose
    .locator("table col")
    .first()
    .evaluate((col) => col.getBoundingClientRect().width);
  expect(resizedWidth - initialWidth).toBeGreaterThan(30);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(before);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(resized);
});
