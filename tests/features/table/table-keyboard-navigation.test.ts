import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(({ page }) => installFixtureGuards(page));

test("Tab from the last table cell adds a row and focuses its first cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot());
  const before = await snapshot();
  await prose.getByRole("cell", { name: "D", exact: true }).click();
  await page.keyboard.press("Tab");
  await expect(prose.locator("tr")).toHaveCount(3);
  const after = await snapshot();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(after.json);
  await page.keyboard.type("新行");
  await expect(prose.locator("tr").last().locator("td").first()).toHaveText("新行");
  await prose.getByRole("cell", { name: "A", exact: true }).click();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("X");
  await expect(prose.locator("tr").first().locator("td").first()).toContainText("X");
  await prose.getByRole("cell", { name: "D", exact: true }).click();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("Y");
  await expect(prose.locator("tr").nth(1).locator("td").first()).toContainText("Y");
});

test("Tab and Shift+Tab visit a horizontally merged cell once", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td colspan="2"><p>合并</p></td><td><p>末格</p></td></tr><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  await prose.getByRole("cell", { name: "合并" }).click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("跳");
  await expect(prose.locator("tr").first().locator("td").nth(1)).toContainText("跳");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("回");
  await expect(prose.locator("td[colspan='2']")).toContainText("回");
  const empty = prose.locator("tr").nth(2).locator("td").first();
  await empty.click();
  await page.keyboard.press("Backspace");
  await page.keyboard.type("留");
  await expect(empty).toHaveText("留");
});

test("Tab at the start of nonempty cell text adjusts paragraph indentation", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>左</td><td>甲</td><td>乙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const paragraph = prose.locator("td").nth(1).locator("p");
  const initial = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelectorAll("#table-navigation-test td p")[1];
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
  });
  await page.keyboard.press("Shift+Tab");
  await expect(paragraph).not.toHaveAttribute("data-semlo-editor-indent");
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
  await expect(paragraph).toHaveAttribute("data-semlo-editor-indent", "8");
  await page.keyboard.press("Shift+Tab");
  await expect(paragraph).toHaveAttribute("data-semlo-editor-indent", "7");
  await page.keyboard.press("Tab");
  await expect(paragraph).toHaveAttribute("data-semlo-editor-indent", "8");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    initial,
  );
  await page.keyboard.press("Tab");
  await page.keyboard.type("Z");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    initial,
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelectorAll("#table-navigation-test td p")[1];
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + 1);
  });
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.textContent,
    ),
  ).toBe("乙");
});

test("Tab at the start of a cell heading adjusts its indentation", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><h2>甲</h2></td><td>乙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const heading = page.locator("#table-navigation-test td h2");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const heading = document.querySelector("#table-navigation-test td h2")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(heading, 0));
  });
  await page.keyboard.press("Shift+Tab");
  await expect(heading).not.toHaveAttribute("data-semlo-editor-indent");
  await page.keyboard.press("Tab");
  await expect(heading).toHaveAttribute("data-semlo-editor-indent", "1");
  await expect(heading).toHaveText("甲");
  await expect(page.locator("#table-navigation-test td").nth(1)).toHaveText("乙");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const heading = document.querySelector("#table-navigation-test td h2")!;
    editor.commands.setTextSelection(editor.view.posAtDOM(heading, 0));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.type("Z");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("Tab from an empty cell heading or quote navigates to the next cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><h2></h2></td><td><blockquote><p></p></blockquote></td><td>乙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  for (const [selector, nextCell] of [
    ["#table-navigation-test td h2", 1],
    ["#table-navigation-test td blockquote p", 2],
  ] as const) {
    await page.evaluate((target) => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const block = document.querySelector(target)!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(block, 0));
    }, selector);
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => {
        const cell = window.getSelection()?.anchorNode?.parentElement?.closest("td");
        return cell ? [...document.querySelectorAll("#table-navigation-test td")].indexOf(cell) : -1;
      }),
    ).toBe(nextCell);
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
      before,
    );
  }
});

test("Tab at a wrapped visual line start navigates to the next cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      host.style.width = '360px'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz</td><td>乙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + 60);
  });
  await page.keyboard.press("Home");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parentOffset,
    ),
  ).toBeGreaterThan(0);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.textContent,
    ),
  ).toBe("乙");
  await expect(page.locator("#table-navigation-test td p").first()).not.toHaveAttribute("data-semlo-editor-indent");
});

test("Tab at the start of a quote paragraph in a cell adjusts its indentation", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><blockquote><p>甲</p></blockquote></td><td>乙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const paragraph = page.locator("#table-navigation-test td blockquote p");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td blockquote p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
  });
  await page.keyboard.press("Tab");
  await expect(paragraph).toHaveAttribute("data-semlo-editor-indent", "1");
  await expect(paragraph).toHaveText("甲");
  await expect(page.locator("#table-navigation-test td").nth(1)).toHaveText("乙");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td blockquote p")!;
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.type("Z");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("Tab at the start of a list item in a cell adjusts its list level", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><ul><li><p>甲</p></li></ul></td><td><ol><li><p>甲</p></li></ol></td><td><ol start="7"><li><p>甲</p></li></ol></td><td>乙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  for (const index of [0, 1, 2]) {
    const item = page.locator("#table-navigation-test td").nth(index).locator("li");
    await page.evaluate((cellIndex) => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelectorAll("#table-navigation-test td li p")[cellIndex];
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
    }, index);
    await page.keyboard.press("Tab");
    await expect(item).toHaveAttribute("data-semlo-editor-list-indent", "1");
    if (index === 2) {
      await expect(item).toHaveAttribute("value", "7");
      expect(await item.evaluate((element) => getComputedStyle(element).listStyleType)).toBe("lower-alpha");
    }
    await page.keyboard.press("Tab");
    if (index === 2) {
      await expect(item).toHaveAttribute("value", "7");
      expect(await item.evaluate((element) => getComputedStyle(element).listStyleType)).toBe("semlo-mixed-roman");
    }
    await page.keyboard.press("Tab");
    await expect(item).toHaveAttribute("data-semlo-editor-list-indent", "3");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo()),
    ).toBe(true);
    await expect(item).not.toHaveAttribute("data-semlo-editor-list-indent");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo()),
    ).toBe(true);
    await expect(item).toHaveAttribute("data-semlo-editor-list-indent", "3");
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+Tab");
    await expect(item).not.toHaveAttribute("data-semlo-editor-list-indent");
    await page.evaluate((cellIndex) => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelectorAll("#table-navigation-test td li p")[cellIndex];
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + 1);
    }, index);
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => {
        const node = window.getSelection()?.anchorNode;
        const cell = node?.parentElement?.closest("td");
        return cell ? [...document.querySelectorAll("#table-navigation-test td")].indexOf(cell) : -1;
      }),
    ).toBe(index + 1);
    await page.evaluate((cellIndex) => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelectorAll("#table-navigation-test td li p")[cellIndex];
      const start = editor.view.posAtDOM(paragraph, 0);
      editor.commands.setTextSelection({ from: start, to: start + 1 });
    }, index);
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => {
        const node = window.getSelection()?.anchorNode;
        const cell = node?.parentElement?.closest("td");
        return cell ? [...document.querySelectorAll("#table-navigation-test td")].indexOf(cell) : -1;
      }),
    ).toBe(index + 1);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(index < 2 ? "甲" : "乙");
  }
  await expect(page.locator("#table-navigation-test td").nth(3)).toHaveText("乙");
});

test("Tab indents an empty list item instead of moving to the next cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><ul><li><p></p></li></ul></td><td>乙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td li p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
  });
  const item = page.locator("#table-navigation-test td li");
  await page.keyboard.press("Tab");
  await expect(item).toHaveAttribute("data-semlo-editor-list-indent", "1");
  await page.keyboard.press("Shift+Tab");
  await expect(item).not.toHaveAttribute("data-semlo-editor-list-indent");
  await expect(page.locator("#table-navigation-test td").nth(1)).toHaveText("乙");
});

test("Tab from the middle of a list item selects the next cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><ul><li><p>甲乙丙</p></li></ul></td><td>乙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td li p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + 1);
  });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("乙");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("list indentation and immediate typing undo together inside a cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><ul><li><p>甲</p></li></ul></td><td><ul><li><p></p></li></ul></td><td>乙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  for (const index of [0, 1]) {
    await page.evaluate((cellIndex) => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelectorAll("#table-navigation-test td li p")[cellIndex];
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
    }, index);
    await page.keyboard.press("Tab");
    await page.keyboard.type("Z");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
      before,
    );
  }
});

test("Tab preserves per-level starts when indenting a table's ordered list", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><ol start="3" data-semlo-editor-list-level-starts="{&quot;1&quot;:7,&quot;2&quot;:9}"><li><p>甲</p></li><li><p>乙</p></li></ol></td><td>邻格</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td li p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
  });
  await page.keyboard.press("Tab");
  const listAttrs = () =>
    page.evaluate(() => {
      let attrs: Record<string, unknown> | undefined;
      window.__semloRequireFixture("tableNavigationEditor").editor.state.doc.descendants((node) => {
        if (node.type.name === "orderedList") attrs = node.attrs;
      });
      return attrs;
    });
  expect(await listAttrs()).toMatchObject({ start: 7, semloEditorListLevelStarts: { "0": 3, "2": 9 } });
  await page.keyboard.press("Tab");
  expect(await listAttrs()).toMatchObject({ start: 9, semloEditorListLevelStarts: { "0": 3, "1": 7 } });
  await page.keyboard.type("Z");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await listAttrs()).toMatchObject({ start: 9, semloEditorListLevelStarts: { "0": 3, "1": 7 } });
  await expect(page.locator("#table-navigation-test td li p").first()).toHaveText("Z甲");
});

test("Tab appends a full logical row when earlier cells are merged", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2">A</td><td>B</td><td colspan="2">C</td></tr><tr><td>D</td><td>E</td><td>F</td></tr><tr><td>G</td><td>H</td><td>I</td><td>末格</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await prose.getByRole("cell", { name: "末格", exact: true }).click();
  await page.keyboard.press("Tab");
  await expect(prose.locator("tr")).toHaveCount(4);
  await expect(prose.locator("tr").last().locator("td")).toHaveCount(4);
  await page.keyboard.type("Z");
  await expect(prose.locator("tr").last().locator("td").first()).toHaveText("Z");
  await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo());
  await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("Tab from a cell selection moves relative to its head cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>甲</td><td>乙</td><td>辛</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const cells: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableCell") cells.push(position);
    });
    editor.view.focus();
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
  });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("辛");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const cells: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableCell") cells.push(position);
    });
    editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[1] });
  });
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("甲");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const cells: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableCell") cells.push(position);
    });
    editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[1] });
  });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("辛");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const cells: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableCell") cells.push(position);
    });
    editor.commands.setCellSelection({ anchorCell: cells[1], headCell: cells[0] });
  });
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("甲");
  await expect(page.locator("#table-navigation-test .selectedCell")).toHaveCount(0);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const cells: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableCell") cells.push(position);
    });
    editor.commands.setCellSelection({ anchorCell: cells[1], headCell: cells[2] });
  });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("辛");
  await expect(page.locator("#table-navigation-test tr")).toHaveCount(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("cell-selection Tab skips repeated rowspan slots in physical order", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr><tr><td>D</td><td>E</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  async function selectReverse() {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const cells: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "tableCell") cells.push(position);
      });
      editor.view.focus();
      editor.commands.setCellSelection({ anchorCell: cells[3], headCell: cells[2] });
    });
  }
  await selectReverse();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("B");
  await selectReverse();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("D");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("Home and End move into the first selected cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>A</p><p>二</p></td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const first = await prose.locator("td").first().boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Home");
  await page.keyboard.type("H");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["HA二", "B"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("End");
  await page.keyboard.type("E");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["AE二", "B"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await page.mouse.move(first.x + first.width - 15, first.y + 15);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + 15, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Shift+Home");
  expect(
    await page.evaluate(() => {
      const { doc, selection } = window.__semloRequireFixture("tableNavigationEditor").editor.state;
      return doc.textBetween(selection.from, selection.to, "\n");
    }),
  ).toBe("A\n二");
  await expect(prose.locator(".selectedCell")).toHaveCount(0);
  await page.mouse.move(first.x + first.width - 15, first.y + 15);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + 15, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Shift+End");
  expect(
    await page.evaluate(() => {
      const { doc, selection } = window.__semloRequireFixture("tableNavigationEditor").editor.state;
      return doc.textBetween(selection.from, selection.to, "\n");
    }),
  ).toBe("A\n二");
  await expect(prose.locator(".selectedCell")).toHaveCount(0);
  await page.mouse.move(first.x + first.width - 15, first.y + 15);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + 15, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.type("X");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["X", "B"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["A二", "B"]);
});

test("End from a cell selection stops at the end of the first visual line", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      host.style.width = '360px'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz</td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const first = await prose.locator("td").first().boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + 15);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + 15, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("End");
  await page.keyboard.type("Z");
  const value = (await prose.locator("td").first().textContent()) ?? "";
  expect(value.replace("Z", "")).toBe("abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz");
  expect(value.indexOf("Z")).toBeGreaterThan(0);
  expect(value.indexOf("Z")).toBeLessThan(value.length - 1);
  const lines = await prose
    .locator("td")
    .first()
    .locator("p")
    .evaluate((paragraph) => {
      const text = paragraph.firstChild!;
      const index = text.textContent!.indexOf("Z");
      const before = document.createRange();
      before.setStart(text, index - 1);
      before.setEnd(text, index);
      const after = document.createRange();
      after.setStart(text, index + 1);
      after.setEnd(text, index + 2);
      return { before: before.getBoundingClientRect().top, after: after.getBoundingClientRect().top };
    });
  expect(lines.after).toBeGreaterThan(lines.before);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
  });
  await page.keyboard.press("End");
  await page.keyboard.type("Z");
  expect(await prose.locator("td").first().textContent()).toBe(value);
});

test("End in a table paragraph stops before a hard line break", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>甲<br>乙</p></td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
  });
  await page.keyboard.press("End");
  await page.keyboard.type("Z");
  const firstCell = (
    await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)
  ).content?.[0].content?.[0].content?.[0];
  expect(firstCell?.content?.[0].content).toMatchObject([
    { type: "text", text: "甲Z" },
    { type: "hardBreak" },
    { type: "text", text: "乙" },
  ]);
});

test("End at a wrapped line does not split an emoji", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      host.style.width = '360px'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>${"春风🌸".repeat(30)}</td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const first = await prose.locator("td").first().boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + 15);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + 15, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("End");
  await page.keyboard.type("Z");
  const value = (await prose.locator("td").first().textContent()) ?? "";
  expect(value.replace("Z", "")).toBe("春风🌸".repeat(30));
  expect(value).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
});

test("End at a wrapped line keeps combined emoji intact", async ({ page }) => {
  const original = "春风👨‍👩‍👧‍👦".repeat(30);
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      host.style.width = '360px'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>${original}</td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const first = await prose.locator("td").first().boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + 15);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + 15, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("End");
  await page.keyboard.type("Z");
  const value = (await prose.locator("td").first().textContent()) ?? "";
  expect(value.replace("Z", "")).toBe(original);
  const boundaries = [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(original)].map(
    (part) => part.index,
  );
  expect(boundaries).toContain(value.indexOf("Z"));
});

test("End lands on grapheme boundaries across wrapped widths", async ({ page }) => {
  const original = "甲e\u0301👨‍👩‍👧‍👦".repeat(30);
  const segments = [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(original)];
  const boundaries = new Set([...segments.map((part) => part.index), original.length]);
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>${original}</td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const deleted = new Set<string>();
  for (let width = 260; width <= 620; width += 8) {
    await page.evaluate((value) => {
      document.querySelector<HTMLElement>("#table-navigation-test")!.style.width = `${value}px`;
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const positions: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "tableCell") positions.push(position);
      });
      editor.view.focus();
      editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
    }, width);
    await page.keyboard.press("End");
    const offset = await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parentOffset,
    );
    expect(boundaries.has(offset)).toBe(true);
    const previous = segments.find((part) => part.index + part.segment.length === offset);
    if (!previous || !["e\u0301", "👨‍👩‍👧‍👦"].includes(previous.segment) || deleted.has(previous.segment)) continue;
    await page.keyboard.press("Backspace");
    const lastScalar = [...previous.segment].at(-1)!;
    const after = await prose.locator("td").first().textContent();
    expect([
      original.slice(0, offset - lastScalar.length) + original.slice(offset),
      original.slice(0, previous.index) + original.slice(offset),
    ]).toContain(after);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo()),
    ).toBe(true);
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot())).json,
    ).toEqual(before);
    deleted.add(previous.segment);
  }
  expect([...deleted].sort()).toEqual(["e\u0301", "👨‍👩‍👧‍👦"].sort());
});

test("Home collapses selected cell text at the line start", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>甲乙丙</td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    const start = editor.view.posAtDOM(paragraph, 0);
    editor.view.focus();
    editor.commands.setTextSelection({ from: start + 1, to: start + 2 });
  });
  await page.keyboard.press("Home");
  await page.keyboard.type("Z");
  await expect(page.locator("#table-navigation-test td").first()).toHaveText("Z甲乙丙");
});

test("Home in a table paragraph stops after a hard line break", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>甲<br>乙丙</p></td><td>B</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 2) + 2);
  });
  await page.keyboard.press("Home");
  await page.keyboard.type("Z");
  const cell = (await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json))
    .content?.[0].content?.[0].content?.[0];
  expect(cell?.content?.[0].content).toMatchObject([
    { type: "text", text: "甲" },
    { type: "hardBreak" },
    { type: "text", text: "Z乙丙" },
  ]);
});

test("Home in a wrapped table paragraph reaches the start of its visual line", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      host.style.width = '360px'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz</td><td>B</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + 60);
  });
  await page.keyboard.press("Home");
  await page.keyboard.type("Z");
  const result = await page
    .locator("#table-navigation-test td p")
    .first()
    .evaluate((paragraph) => {
      const text = paragraph.firstChild!;
      const index = text.textContent!.indexOf("Z");
      const before = document.createRange();
      before.setStart(text, index - 1);
      before.setEnd(text, index);
      const after = document.createRange();
      after.setStart(text, index + 1);
      after.setEnd(text, index + 2);
      return { index, before: before.getBoundingClientRect().top, after: after.getBoundingClientRect().top };
    });
  expect(result.index).toBeGreaterThan(0);
  expect(result.after).toBeGreaterThan(result.before);
});

test("Home lands on grapheme boundaries across wrapped widths", async ({ page }) => {
  const original = "甲e\u0301👨‍👩‍👧‍👦".repeat(30);
  const boundaries = new Set([
    ...[...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(original)].map((part) => part.index),
    original.length,
  ]);
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>${original}</td><td>B</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  for (let width = 260; width <= 620; width += 8) {
    await page.evaluate((value) => {
      document.querySelector<HTMLElement>("#table-navigation-test")!.style.width = `${value}px`;
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + paragraph.textContent!.length);
    }, width);
    await page.keyboard.press("Home");
    const offset = await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parentOffset,
    );
    expect(boundaries.has(offset)).toBe(true);
  }
});

test("Shift+Home and Shift+End select text to the visual line boundary", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>甲乙丙</td><td>B</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + 3);
  });
  await page.keyboard.press("Shift+Home");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("甲乙丙");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("甲乙丙");
});

test("Shift+End selects a formatted table cell line", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><strong>甲乙丙</strong></td><td><em>甲乙丙</em></td><td><u>甲乙丙</u></td><td><strong>甲</strong>乙丙</td><td>B</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  for (const index of [0, 1, 2, 3]) {
    await page.evaluate((cellIndex) => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelectorAll("#table-navigation-test td p")[cellIndex];
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
    }, index);
    await page.keyboard.press("Shift+End");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("甲乙丙");
  }
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelectorAll("#table-navigation-test td p")[3];
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + 1);
  });
  await page.keyboard.press("Shift+End");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("乙丙");
  await page.keyboard.press("Shift+Home");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("甲");
});

test("complex text falls back to native Home and End handling", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>abc אבג</td><td><p>abc <span style="font-size: 24px">def</span></p></td><td>abc</td><td>A\u061f</td><td>A\u0640</td><td>A\u0605</td><td>A\u{1ec71}</td><td>A&#8232;B</td><td>A&#8233;B</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prevented = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraphs = [...document.querySelectorAll<HTMLElement>("#table-navigation-test td p")];
    const dispatch = (paragraph: HTMLElement, options: KeyboardEventInit = {}) => {
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + 1);
      const event = new KeyboardEvent("keydown", {
        key: "End",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        ...options,
      });
      editor.view.dom.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const mixed = dispatch(paragraphs[0]);
    const formatted = dispatch(paragraphs[1]);
    const commonRtl = paragraphs.slice(3).map((paragraph) => dispatch(paragraph));
    paragraphs[2].style.direction = "rtl";
    const rtl = dispatch(paragraphs[2]);
    paragraphs[2].style.direction = "ltr";
    const composing = dispatch(paragraphs[2], { isComposing: true });
    return [mixed, formatted, rtl, composing, ...commonRtl];
  });
  expect(prevented).toEqual([false, false, false, false, false, false, false, false, false, false]);
});

test("wrapped mixed formatting falls back to native line navigation", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      host.style.width = '260px'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td><strong>abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz</strong>abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz</td><td>B</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    const range = document.createRange();
    range.selectNodeContents(paragraph.firstChild!);
    const lines = range.getClientRects().length;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0) + 1);
    const event = new KeyboardEvent("keydown", { key: "End", shiftKey: true, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    return { lines, prevented: event.defaultPrevented };
  });
  expect(result.lines).toBeGreaterThan(1);
  expect(result.prevented).toBe(false);
});

test("composing keys do not alter a cell selection", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const cells: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableCell") cells.push(position);
    });
    editor.view.focus();
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
    return ["End", "Backspace", "Enter"].map((key) => {
      const event = new KeyboardEvent("keydown", { key, isComposing: true, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      return { prevented: event.defaultPrevented, selection: editor.state.selection.constructor.name };
    });
  });
  expect(result).toEqual(Array(3).fill({ prevented: false, selection: "CellSelection" }));
});

test("End collapses selected cell text at the line end", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>甲乙丙</td><td>B</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    const start = editor.view.posAtDOM(paragraph, 0);
    editor.view.focus();
    editor.commands.setTextSelection({ from: start, to: start + 1 });
  });
  await page.keyboard.press("End");
  await page.keyboard.type("Z");
  await expect(page.locator("#table-navigation-test td").first()).toHaveText("甲乙丙Z");
});

test("End after a literal slash in a table cell reaches the end of the line", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>甲乙丙</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const cell = prose.getByRole("cell", { name: "甲乙丙", exact: true });
  await cell.click();
  await cell.click();
  await page.keyboard.press("Home");
  await page.keyboard.type("/");
  await page.keyboard.press("End");
  await page.keyboard.type("/");
  await expect(prose.locator("td").last()).toHaveText("/甲乙丙/");
});

test("arrow keys leave a selected rectangle toward its neighbouring cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'table-navigation-test'
    document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td><td>E</td><td>F</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const first = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("Shift+ArrowRight");
  await expect(prose.locator(".selectedCell")).toHaveCount(3);
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("R");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["A", "B", "RC"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  const third = await prose.getByRole("cell", { name: "C", exact: true }).boundingBox();
  if (!third) throw new Error("Missing table cell");
  await page.mouse.move(third.x + third.width - 15, third.y + third.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("L");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["LA", "B", "C"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("D");
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["DD", "E", "F"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("U");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["UA", "B", "C"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  const lowerFirst = await prose.getByRole("cell", { name: "D", exact: true }).boundingBox();
  const lowerLast = await prose.getByRole("cell", { name: "E", exact: true }).boundingBox();
  if (!lowerFirst || !lowerLast) throw new Error("Missing table cells");
  await page.mouse.move(lowerFirst.x + lowerFirst.width - 15, lowerFirst.y + lowerFirst.height / 2);
  await page.mouse.down();
  await page.mouse.move(lowerLast.x + lowerLast.width - 15, lowerLast.y + lowerLast.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("V");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["VA", "B", "C"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Tab");
  await page.keyboard.type("K");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["A", "B", "K"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(third.x + third.width - 15, third.y + third.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("Q");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["A", "B", "QC"]);
});

test("arrow navigation reaches a neighbouring vertically merged cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'table-navigation-test'
    document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2">合并</td><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const first = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("M");
  await expect(prose.locator('td[rowspan="2"]')).toHaveText("M合并");
  await expect(prose.locator("tr").first().locator("td").nth(1)).toHaveText("A");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  const merged = await prose.locator('td[rowspan="2"]').boundingBox();
  const lower = await prose.getByRole("cell", { name: "C", exact: true }).boundingBox();
  if (!merged || !lower) throw new Error("Missing table cells");
  await page.mouse.move(merged.x + merged.width - 15, merged.y + 10);
  await page.mouse.down();
  await page.mouse.move(lower.x + lower.width - 15, lower.y + lower.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(3);
  await page.keyboard.type("J");
  await expect(prose.locator('td[rowspan="2"]')).toHaveText("J");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["J", "A", "B"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["C", "D"]);
});

test("Down from a row selection expanded by a merge moves below the expanded range", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'table-navigation-test'
    document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2">合并</td><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr><tr><td>下行</td><td>E</td><td>F</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  await prose.getByRole("cell", { name: "A", exact: true }).hover();
  await page.getByRole("button", { name: "选择第 1 行" }).click();
  await expect(prose.locator(".selectedCell")).toHaveCount(5);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("X");
  await expect(prose.locator("tr").nth(2).locator("td").first()).toHaveText("X下行");
});

test("Shift+Down extends a horizontal cell selection to the next row", async ({ page }) => {
  await page.goto(process.env.SEMLO_FIXTURE_URL!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td><td>E</td><td>F</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const cells: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableCell") cells.push(position);
    });
    editor.view.focus();
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
  });
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator("#table-navigation-test .selectedCell")).toHaveText(["A", "B", "D", "E"]);
  await page.keyboard.press("Shift+ArrowUp");
  await expect(page.locator("#table-navigation-test .selectedCell")).toHaveText(["A", "B"]);
});
