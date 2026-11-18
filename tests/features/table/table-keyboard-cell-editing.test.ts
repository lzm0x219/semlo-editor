import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { dragCells } from "../../fixtures/table/drag-cells";

test.beforeEach(({ page }) => installFixtureGuards(page));

test("deleting at cell boundaries preserves the table and neighbouring cells", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>甲</td><td>乙</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelectorAll("#table-navigation-test td p")[2];
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
  });
  await page.keyboard.press("Backspace");
  await page.keyboard.press("End");
  await page.keyboard.press("Delete");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.textContent,
    ),
  ).toBe("甲");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelectorAll("#table-navigation-test td p")[2];
    const start = editor.view.posAtDOM(paragraph, 0);
    editor.commands.setTextSelection({ from: start, to: start + 1 });
  });
  await page.keyboard.press("Backspace");
  const empty = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    empty,
  );
  await expect(page.locator("#table-navigation-test tr").nth(1).locator("td")).toHaveText(["", "乙"]);
});

test("Backspace and Delete join paragraphs within a cell without changing its neighbour", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>甲</p><p>乙</p></td><td>邻格</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelectorAll("#table-navigation-test td:first-child p")[1];
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
  });
  await page.keyboard.press("Backspace");
  await expect(page.locator("#table-navigation-test td").first().locator("p")).toHaveText(["甲乙"]);
  await expect(page.locator("#table-navigation-test td").nth(1)).toHaveText("邻格");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td:first-child p")!;
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + 1);
  });
  await page.keyboard.press("Delete");
  await expect(page.locator("#table-navigation-test td").first().locator("p")).toHaveText(["甲乙"]);
  await expect(page.locator("#table-navigation-test td").nth(1)).toHaveText("邻格");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("typing into selected cells replaces only the top-left cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'table-navigation-test'
    document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p style="text-align:center"><strong>A</strong></p></td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot());
  const first = prose.getByRole("cell", { name: "A", exact: true });
  const last = prose.getByRole("cell", { name: "B", exact: true });
  await dragCells(first, last);
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.type("XYZ");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["XYZ", "B"]);
  await expect(prose.locator("tr").first().locator("td strong")).toHaveText("XYZ");
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["C", "D"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await dragCells(last, first);
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.type("Y");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["Y", "B"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await dragCells(first, last);
  await page.keyboard.insertText("输入");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["输入", "B"]);
  await expect(prose.locator("tr").first().locator("td strong")).toHaveText("输入");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await dragCells(first, last);
  await page.keyboard.press("Backspace");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["", ""]);
  await expect(prose.locator("tr").first().locator("td").first().locator("p")).not.toHaveAttribute(
    "style",
    /text-align/,
  );
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["C", "D"]);
  await expect(prose.locator(".selectedCell")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.constructor.name,
    ),
  ).toBe("TextSelection");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await dragCells(last, first);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Z");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["Z", ""]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["Z", ""]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  const bottomRight = prose.getByRole("cell", { name: "D", exact: true });
  await dragCells(bottomRight, first);
  await expect(prose.locator(".selectedCell")).toHaveCount(4);
  await page.keyboard.type("Z");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["Z", "B"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["C", "D"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("clearing a selection with an empty first cell and typing undoes together", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p></p></td><td>B</td><td>C</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot());
  const first = await prose.locator("td").first().boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Z");
  await expect(prose.locator("td")).toHaveText(["Z", "", "C"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("clearing a selected row keeps the table and puts the cursor in its first cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot());
  await prose.getByText("C", { exact: true }).click();
  await page.getByRole("button", { name: "选择第 2 行" }).click();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("X");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["A", "B"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["X", ""]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("select all first selects cell text and then the table", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<p>前文</p><table><tbody><tr><td colspan="2">合并</td><td>B</td></tr><tr><td>C</td><td>D</td><td>E</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot());
  await prose.getByRole("cell", { name: "合并", exact: true }).click();
  await prose.getByText("合并", { exact: true }).click();
  if (process.platform === "darwin") {
    await page.keyboard.press("End");
    await page.keyboard.press("Control+A");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.empty),
    ).toBe(true);
  }
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("合并");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await expect(prose.locator(".selectedCell")).toHaveCount(5);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.constructor.name,
    ),
  ).toBe("CellSelection");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await expect(prose.locator(".selectedCell")).toHaveCount(5);
  await page.keyboard.press("Backspace");
  await expect(prose.locator("table")).toHaveCount(1);
  await expect(prose.locator("td[colspan='2']")).toHaveCount(1);
  await expect(prose.locator("td")).toHaveText(["", "", "", "", ""]);
  await expect(prose.locator(".selectedCell")).toHaveCount(5);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.keyboard.press("Delete");
  await expect(prose.locator("table")).toHaveCount(1);
  await expect(prose.locator("td")).toHaveText(["", "", "", "", ""]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Z");
  await expect(prose.locator("td")).toHaveText(["Z", "", "", "", ""]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await prose.getByText("合并", { exact: true }).click();
  const first = await prose.getByRole("cell", { name: "合并", exact: true }).boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await expect(prose.locator(".selectedCell")).toHaveCount(5);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    editor.commands.focus();
  });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("前文");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("后文");
});

test("Control+A selects cell contents on non-Mac platforms", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "Linux x86_64" }));
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  await prose.getByText("A", { exact: true }).click();
  await prose.getByText("A", { exact: true }).click();
  await page.keyboard.press("Control+A");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("A");
  await page.keyboard.press("Control+A");
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
});

test("select all handles a multi-paragraph cell and an empty cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>第一段</p><p>第二段</p></td><td><p></p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  await prose.getByText("第一段", { exact: true }).click();
  await prose.getByText("第一段", { exact: true }).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  expect(
    await page.evaluate(() => {
      const { doc, selection } = window.__semloRequireFixture("tableNavigationEditor").editor.state;
      return doc.textBetween(selection.from, selection.to, "\n");
    }),
  ).toBe("第一段\n第二段");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await prose.locator("td").nth(1).locator("p").click();
  await prose.locator("td").nth(1).locator("p").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
});

test("select all inside a table code block stays within the code", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><pre><code>alpha\\nbeta</code></pre><p>额外内容</p></td><td>邻格</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const code = prose.locator("pre code");
  await code.click();
  await code.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("alpha\nbeta");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("alpha\nbeta");
  await expect(prose.locator(".selectedCell")).toHaveCount(0);
});

test("Tab inside a table code block inserts a tab instead of moving cells", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><pre><code>alpha\\nbeta</code></pre></td><td>邻格</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const code = document.querySelector("#table-navigation-test pre code")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(code, 0) + 5);
  });
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#table-navigation-test pre code")).toHaveText("alpha\nbeta");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.type.name,
    ),
  ).toBe("codeBlock");
  await page.keyboard.press("Tab");
  await expect(page.locator("#table-navigation-test pre code")).toHaveText("alpha\t\nbeta");
  await expect(page.locator("#table-navigation-test td").nth(1)).toHaveText("邻格");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.type.name,
    ),
  ).toBe("codeBlock");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const code = document.querySelector("#table-navigation-test pre code")!;
    editor.commands.setTextSelection(editor.view.posAtDOM(code, 0));
  });
  await page.keyboard.press("Tab");
  await expect(page.locator("#table-navigation-test pre code")).toHaveText("  alpha\nbeta");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#table-navigation-test pre code")).toHaveText("alpha\nbeta");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const code = document.querySelector("#table-navigation-test pre code")!;
    const start = editor.view.posAtDOM(code, 0);
    editor.commands.setTextSelection({ from: start, to: start + 10 });
  });
  await page.keyboard.press("Tab");
  await expect(page.locator("#table-navigation-test pre code")).toHaveText("  alpha\n  beta");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#table-navigation-test pre code")).toHaveText("alpha\nbeta");
});

test("Shift+End inside a table code block selects the current code line", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><pre><code>alpha\\nbeta</code></pre></td><td>邻格</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const code = document.querySelector("#table-navigation-test pre code")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(code, 0) + 5);
  });
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("alpha");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const code = document.querySelector("#table-navigation-test pre code")!;
    editor.commands.setTextSelection(editor.view.posAtDOM(code, 0) + 10);
  });
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("beta");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const cells: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableCell") cells.push(position);
    });
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
  });
  await page.keyboard.press("End");
  await page.keyboard.type("Z");
  await expect(page.locator("#table-navigation-test pre code")).toHaveText("alphaZ\nbeta");
});

test("Enter and Escape keep the selected rectangle; Shift+Enter replaces its first cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p style="text-align:center"><strong>A</strong></p></td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot());
  const first = await prose.locator("td").first().boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("Enter");
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.keyboard.press("Escape");
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("Shift+Enter");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["", "B"]);
  const firstCell = (await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot()))
    .json.content?.[0].content?.[0].content?.[0];
  expect(firstCell?.content?.[0].content?.[0]?.type).toBe("hardBreak");
  expect(firstCell?.content?.[0].attrs?.textAlign).toBeNull();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("X");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["X", "B"]);
  await expect(prose.locator("tr").first().locator("td strong")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("input replaces a selected code block cell with a paragraph", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><pre><code>first</code></pre></td><td><pre><code>second</code></pre></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot());
  await prose.locator("td").first().locator("code").click();
  await page.getByRole("button", { name: "选择第 1 行" }).click();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("Shift+Enter");
  await expect(prose.locator("td").first().locator("pre")).toHaveCount(0);
  await expect(prose.locator("td").last().locator("pre")).toContainText("second");
  const firstCell = (await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot()))
    .json.content?.[0].content?.[0].content?.[0];
  expect(firstCell?.content?.[0]).toMatchObject({ type: "paragraph", content: [{ type: "hardBreak" }] });
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await prose.locator("td").first().locator("code").click();
  await page.getByRole("button", { name: "选择第 1 行" }).click();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.type("Z");
  await expect(prose.locator("td").first().locator("p")).toHaveText("Z");
  await expect(prose.locator("td").last().locator("pre")).toContainText("second");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("selected heading cells keep the heading for text but use a paragraph for Shift+Enter", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><h2>A</h2></td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const before = await snapshot();
  const selectCells = () =>
    page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const positions: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "tableCell") positions.push(position);
      });
      editor.view.focus();
      editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
    });
  await selectCells();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.type("Z");
  await expect(prose.locator("td").first().locator("h2")).toHaveText("Z");
  await expect(prose.locator("td").last()).toHaveText("B");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(before);
  await selectCells();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("Shift+Enter");
  expect((await snapshot()).content?.[0].content?.[0].content?.[0].content?.[0]).toMatchObject({
    type: "paragraph",
    content: [{ type: "hardBreak" }],
  });
  await expect(prose.locator("td").last()).toHaveText("B");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(before);
});

test("selected quote cells keep the quote for text but use a paragraph for Shift+Enter", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><blockquote><p>A</p></blockquote></td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const before = await snapshot();
  const selectCells = () =>
    page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const positions: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "tableCell") positions.push(position);
      });
      editor.view.focus();
      editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
    });
  await selectCells();
  await page.keyboard.type("Z");
  await expect(prose.locator("td").first().locator("blockquote")).toHaveText("Z");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(before);
  await selectCells();
  await page.keyboard.press("Shift+Enter");
  expect((await snapshot()).content?.[0].content?.[0].content?.[0].content?.[0]).toMatchObject({
    type: "paragraph",
    content: [{ type: "hardBreak" }],
  });
  await expect(prose.locator("td").last()).toHaveText("B");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await snapshot()).toEqual(before);
});

test("input replaces an image in the first selected cell without changing other cells", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p><img src="/tests/sample-image.svg" alt="图片"></p></td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot());
  const selectCells = () =>
    page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const positions: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "tableCell") positions.push(position);
      });
      editor.view.focus();
      editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
    });
  await selectCells();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.type("Z");
  await expect(prose.locator("td").first()).toHaveText("Z");
  await expect(prose.locator("td").last()).toHaveText("B");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await selectCells();
  await page.keyboard.press("Shift+Enter");
  const firstCell = (await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot()))
    .json.content?.[0].content?.[0].content?.[0];
  expect(firstCell?.content?.[0]).toMatchObject({ type: "paragraph", content: [{ type: "hardBreak" }] });
  await expect(prose.locator("td").last()).toHaveText("B");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("typing into a selected rectangle preserves the first list item structure", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'table-navigation-test'
    document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><ul><li><p>一</p></li><li><p>二</p></li></ul></td><td>留</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot());
  const first = await prose.locator("td").first().boundingBox();
  const last = await prose.locator("td").last().boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.type("X");
  await expect(prose.locator("td").first().locator("li")).toHaveText(["X"]);
  await expect(prose.locator("td").last()).toHaveText("留");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const positions: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableCell") positions.push(position);
    });
    editor.view.focus();
    editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
  });
  await page.keyboard.press("Shift+Enter");
  await expect(prose.locator("td").first().locator("ul")).toHaveCount(0);
  const firstCell = (await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot()))
    .json.content?.[0].content?.[0].content?.[0];
  expect(firstCell?.content?.[0]).toMatchObject({ type: "paragraph", content: [{ type: "hardBreak" }] });
  await expect(prose.locator("td").last()).toHaveText("留");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("Enter and Shift+Enter in cell text create and undo their respective breaks", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>甲</td><td>邻格</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const cell = page.locator("#table-navigation-test td").first();
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  for (const key of ["Enter", "Shift+Enter"]) {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press(key);
    await expect(cell.locator("p")).toHaveCount(key === "Enter" ? 2 : 1);
    if (key === "Shift+Enter") await expect(cell.locator("br:not(.ProseMirror-trailingBreak)")).toHaveCount(1);
    await expect(page.locator("#table-navigation-test td").nth(1)).toHaveText("邻格");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
      before,
    );
  }
});
