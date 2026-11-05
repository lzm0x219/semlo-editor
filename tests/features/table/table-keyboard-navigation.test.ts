import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    tableNavigationEditor?: EditorController;
    tableNavigationEditorOther?: EditorController;
  }
}

test("Tab from the last table cell adds a row and focuses its first cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
      expect(await item.evaluate((element) => getComputedStyle(element).listStyleType)).toBe("lower-roman");
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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

test("deleting at cell boundaries preserves the table and neighbouring cells", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  const first = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
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
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.type("Y");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["Y", "B"]);
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
  await page.keyboard.insertText("输入");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["输入", "B"]);
  await expect(prose.locator("tr").first().locator("td strong")).toHaveText("输入");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
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
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2, { steps: 5 });
  await page.mouse.up();
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
  const bottomRight = await prose.getByRole("cell", { name: "D", exact: true }).boundingBox();
  if (!bottomRight) throw new Error("Missing table cell");
  await page.mouse.move(bottomRight.x + bottomRight.width - 15, bottomRight.y + bottomRight.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2, { steps: 5 });
  await page.mouse.up();
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  const first = await prose.locator("td").first().boundingBox();
  const last = await prose.locator("td").last().boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height - 3);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height - 3, { steps: 5 });
  await page.mouse.up();
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
  const restoredFirst = await prose.locator("td").first().boundingBox();
  const restoredLast = await prose.locator("td").last().boundingBox();
  if (!restoredFirst || !restoredLast) throw new Error("Missing table cells");
  await page.mouse.move(restoredFirst.x + restoredFirst.width - 15, restoredFirst.y + restoredFirst.height - 3);
  await page.mouse.down();
  await page.mouse.move(restoredLast.x + restoredLast.width - 15, restoredLast.y + restoredLast.height - 3, {
    steps: 5,
  });
  await page.mouse.up();
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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

test("Home and End move into the first selected cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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

test("typing into a selected rectangle preserves the first list item structure", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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

test("Down from a row selection expanded by a merge moves below the expanded range", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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

test("Tab selects all paragraphs in the next table cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>em</td><td><p>T</p><p>WK</p></td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const text = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(text, text.childNodes.length));
  });
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => {
      const { from, to } = window.__semloRequireFixture("tableNavigationEditor").editor.state.selection;
      return window.__semloRequireFixture("tableNavigationEditor").editor.state.doc.textBetween(from, to, "\n");
    }),
  ).toBe("T\nWK");
});

test("Tab selects code in the next table cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>甲横</td><td><pre><code>alpha\\nbeta</code></pre></td><td>后格</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => {
      const { state } = window.__semloRequireFixture("tableNavigationEditor").editor;
      return state.doc.textBetween(state.selection.from, state.selection.to, "\n");
    }),
  ).toBe("alpha\nbeta");
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("甲横");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("后格");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const code = document.querySelector("#table-navigation-test pre code")!;
    const from = editor.view.posAtDOM(code, 0);
    editor.commands.setTextSelection({ from, to: from + code.textContent!.length });
  });
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.type.name,
    ),
  ).toBe("codeBlock");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.type("x");
  await expect(page.locator("#table-navigation-test td").nth(1)).toHaveText("x");
  await expect(page.locator("#table-navigation-test td").nth(1).locator("pre")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(page.locator("#table-navigation-test td").nth(1).locator("pre code")).toHaveText("alpha\nbeta");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Backspace");
  await expect(page.locator("#table-navigation-test td").nth(1).locator("pre")).toHaveCount(0);
  await expect(page.locator("#table-navigation-test td").nth(1)).toHaveText("");
  await page.keyboard.type("x");
  await expect(page.locator("#table-navigation-test td").nth(1)).toHaveText("x");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(page.locator("#table-navigation-test td").nth(1).locator("pre code")).toHaveText("alpha\nbeta");
  for (const key of ["Enter", "Shift+Enter"]) {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press(key);
    const cell = page.locator("#table-navigation-test td").nth(1);
    await expect(cell.locator("pre")).toHaveCount(0);
    await expect(cell.locator("p")).toHaveCount(key === "Enter" ? 2 : 1);
    if (key === "Shift+Enter") await expect(cell.locator("br:not(.ProseMirror-trailingBreak)")).toHaveCount(1);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo()),
    ).toBe(true);
    await expect(cell.locator("pre code")).toHaveText("alpha\nbeta");
  }
});

test("code cell navigation exposes the card boundary", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
  await expect(page.locator("#table-navigation-test .semlo-editor-table-code-boundary")).toHaveCount(1);
  await page.keyboard.type("x");
  await expect(page.locator("#table-navigation-test td").nth(1).locator("pre code")).toHaveText("alpha");
  await expect(page.locator("#table-navigation-test td").nth(1).locator("p")).toHaveText("x");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("y");
  await expect(page.locator("#table-navigation-test td").nth(1).locator("pre code")).toHaveText("alpha");
  await expect(page.locator("#table-navigation-test td").nth(1).locator("p")).toHaveText("y");
  expect(
    await page
      .locator("#table-navigation-test td")
      .nth(1)
      .evaluate((el) => Array.from(el.children).map((n) => n.tagName)),
  ).toEqual(["P", "DIV"]);
});

test("code boundary handles plain-text paste without replacing the code", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "粘贴");
    window
      .__semloRequireFixture("tableNavigationEditor")
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  });
  await expect(page.locator("#table-navigation-test td").nth(1).locator("pre code")).toHaveText("alpha");
  await expect(page.locator("#table-navigation-test td").nth(1).locator("p")).toHaveText("粘贴");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowLeft");
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", "<p>第一</p><p>第二</p>");
    transfer.setData("text/plain", "第一\n第二");
    window
      .__semloRequireFixture("tableNavigationEditor")
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  });
  await expect(page.locator("#table-navigation-test td").nth(1).locator("p")).toHaveText(["第一", "第二"]);
  await expect(page.locator("#table-navigation-test td").nth(1).locator("pre code")).toHaveText("alpha");
});

test("code boundary deletes the adjacent card and undoes the operation", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  for (const [direction, deletion] of [
    ["ArrowLeft", "Delete"],
    ["ArrowRight", "Backspace"],
  ]) {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press(direction);
    await expect(page.locator("#table-navigation-test .semlo-editor-table-code-boundary")).toBeVisible();
    await page.keyboard.press(deletion);
    await expect(page.locator("#table-navigation-test td").nth(1).locator("pre")).toHaveCount(0);
    await expect(page.locator("#table-navigation-test td").nth(1).locator("p")).toHaveCount(1);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo()),
    ).toBe(true);
    await expect(page.locator("#table-navigation-test td").nth(1).locator("pre code")).toHaveText("alpha");
  }
});

test("composition at a code boundary starts in a new paragraph", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    editor.view.dom.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertCompositionText",
        data: "中",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    editor.commands.insertContent("中");
  });
  await expect(page.locator("#table-navigation-test td").nth(1).locator("pre code")).toHaveText("alpha");
  await expect(page.locator("#table-navigation-test td").nth(1).locator("p")).toHaveText("中");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(page.locator("#table-navigation-test td").nth(1).locator("p")).toHaveCount(0);
});

test("code boundary maps across edits and stays isolated between editors", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    for (const [id, key] of [['boundary-a', 'tableNavigationEditor'], ['boundary-b', 'tableNavigationEditorOther']]) {
      const host = document.createElement('div'); host.id = id; document.body.prepend(host)
      window[key] = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
    }
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor && window.tableNavigationEditorOther));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#boundary-a td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  const before = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const type = editor.state.selection.toJSON().type;
    const paragraph = document.querySelector("#boundary-a td p")!;
    editor.view.dispatch(editor.state.tr.insertText("z", editor.view.posAtDOM(paragraph, 0)));
    return { type, after: editor.state.selection.toJSON().type };
  });
  expect(before).toEqual({ type: "semloEditorTableCodeBoundary", after: "semloEditorTableCodeBoundary" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditorOther").editor;
    editor.view.focus();
  });
  await expect(page.locator("#boundary-a .semlo-editor-table-code-boundary")).toBeHidden();
  await expect(page.locator("#boundary-b .semlo-editor-table-code-boundary")).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.view.focus());
  await expect(page.locator("#boundary-a .semlo-editor-table-code-boundary")).toBeVisible();
  await page.keyboard.type("x");
  await expect(page.locator("#boundary-a td").nth(1).locator("pre code")).toHaveText("alpha");
  await expect(page.locator("#boundary-a td").nth(1).locator("p")).toHaveText("x");
  await expect(page.locator("#boundary-b td").nth(1).locator("p")).toHaveCount(0);
});

test("arrow keys enter code from its adjacent boundary", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  for (const [outward, inward, offset] of [
    ["ArrowLeft", "ArrowRight", 0],
    ["ArrowRight", "ArrowLeft", 5],
  ] as const) {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press(outward);
    await page.keyboard.press(inward);
    expect(
      await page.evaluate(() => {
        const { $from } = window.__semloRequireFixture("tableNavigationEditor").editor.state.selection;
        return { type: $from.parent.type.name, offset: $from.parentOffset };
      }),
    ).toEqual({ type: "codeBlock", offset });
  }
});

test("code boundary keeps the document intact when navigating away", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td><td>C</td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  for (const key of ["ArrowLeft", "ArrowRight"]) {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press(key);
    await page.keyboard.press(key);
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
      before,
    );
  }
});

test("Enter and Shift+Enter in cell text create and undo their respective breaks", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
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

test("Home and End from a selected code cell move before the code block", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  for (const key of ["Home", "End"]) {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press(key);
    await page.keyboard.type("x");
    const cell = page.locator("#table-navigation-test td").nth(1);
    await expect(cell.locator("p")).toHaveText("x");
    await expect(cell.locator("pre code")).toHaveText("alpha");
    expect(await cell.evaluate((element) => Array.from(element.children).map((child) => child.tagName))).toEqual([
      "P",
      "DIV",
    ]);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo()),
    ).toBe(true);
  }
});

test("Shift+Home and Shift+End keep a navigated code cell selected", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  for (const key of ["Shift+Home", "Shift+End"]) {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press(key);
    await page.keyboard.type("x");
    const cell = page.locator("#table-navigation-test td").nth(1);
    await expect(cell).toHaveText("x");
    await expect(cell.locator("pre")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.commands.undo()),
    ).toBe(true);
    await expect(cell.locator("pre code")).toHaveText("alpha");
  }
});

test("Shift+arrow from a navigated code cell follows the card selection", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>甲</td><td><pre><code>alpha</code></pre></td><td>乙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  async function selectCode() {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
  }
  await selectCode();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.locator("#table-navigation-test .selectedCell")).toHaveCount(2);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
    before,
  );
  await selectCode();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator("#table-navigation-test .semlo-editor-table-code-boundary")).toBeVisible();
  await page.keyboard.type("x");
  const codeCell = page.locator("#table-navigation-test td").nth(1);
  await expect(codeCell.locator("pre code")).toHaveText("alpha");
  await expect(codeCell.locator("p")).toHaveText("x");
});

test("Shift+Up expands a code cell upward, Shift+Down shrinks it or leaves the card", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>甲</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  async function selectCode() {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
      const paragraph = document.querySelectorAll("#table-navigation-test td p")[2];
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
  }
  await selectCode();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(page.locator("#table-navigation-test .selectedCell")).toHaveCount(2);
  await expect(page.locator("#table-navigation-test tr").first().locator("td").nth(1)).toHaveClass(/selectedCell/);
  await expect(page.locator("#table-navigation-test tr").last().locator("td").last()).toHaveClass(/selectedCell/);
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator("#table-navigation-test .selectedCell")).toHaveCount(1);
  await expect(page.locator("#table-navigation-test tr").last().locator("td").last()).toHaveClass(/selectedCell/);
  await selectCode();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator("#table-navigation-test .semlo-editor-table-code-boundary")).toBeVisible();
  await page.keyboard.type("x");
  const codeCell = page.locator("#table-navigation-test td").last();
  await expect(codeCell.locator("pre code")).toHaveText("alpha");
  await expect(codeCell.locator("p")).toHaveText("x");
});

test("Shift+Down from a code cell with rows below leaves the card", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>甲</td><td><pre><code>alpha</code></pre></td></tr><tr><td>C</td><td>D</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelectorAll("#table-navigation-test td p")[2];
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator("#table-navigation-test .semlo-editor-table-code-boundary")).toBeVisible();
  await expect(page.locator("#table-navigation-test .selectedCell")).toHaveCount(0);
  await page.keyboard.type("x");
  const cell = page.locator("#table-navigation-test tr").nth(1).locator("td").last();
  await expect(cell.locator("pre code")).toHaveText("alpha");
  await expect(cell.locator("p")).toHaveText("x");
});

test("ArrowUp from selected code cell enters the cell above", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>上格</td></tr><tr><td>甲</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelectorAll("#table-navigation-test td p")[2];
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowUp");
  expect(
    await page.evaluate(() => {
      const { $from } = window.__semloRequireFixture("tableNavigationEditor").editor.state.selection;
      return { text: $from.parent.textContent, offset: $from.parentOffset };
    }),
  ).toEqual({ text: "上格", offset: 0 });
});

test("ArrowDown from a last-row code cell reaches the next code card", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td><td><pre><code>beta</code></pre></td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("x");
  const first = page.locator("#table-navigation-test td").nth(1);
  const second = page.locator("#table-navigation-test td").nth(2);
  await expect(first.locator("pre code")).toHaveText("alpha");
  await expect(second.locator("pre code")).toHaveText("beta");
  await expect(second.locator("p")).toHaveText("x");
  expect(await second.evaluate((element) => Array.from(element.children).map((child) => child.tagName))).toEqual([
    "P",
    "DIV",
  ]);
});

test("ArrowDown from a code cell with a row below reaches the next code card", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-navigation-test'
      document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td><td><pre><code>beta</code></pre></td></tr><tr><td>C</td><td>D</td><td>E</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("x");
  const first = page.locator("#table-navigation-test td").nth(1);
  const second = page.locator("#table-navigation-test td").nth(2);
  await expect(first.locator("pre code")).toHaveText("alpha");
  await expect(second.locator("pre code")).toHaveText("beta");
  await expect(second.locator("p")).toHaveText("x");
  expect(await second.evaluate((element) => Array.from(element.children).map((child) => child.tagName))).toEqual([
    "P",
    "DIV",
  ]);
});

for (const mode of [
  "direct",
  "controller",
  "during",
  "during-direct",
  "during-readonly",
  "rejected",
  "readonly",
  "replace",
] as const) {
  test(`resize listeners are cleaned up when the start is ${mode}`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div')
        host.id = 'table-navigation-test'
        host.style.width = '520px'
        document.body.prepend(host)
        window.tableNavigationEditor = createEditor({ element: host, outline: false, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>' })
      `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
    const prose = page.locator("#table-navigation-test .semlo-editor-prose");
    const box = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
    if (!box) throw new Error("Missing cell");
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    await expect(prose.locator(".column-resize-handle").first()).toBeVisible();
    await page.evaluate((mode) => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      const editor = controller.editor;
      const plugin = editor.state.plugins.find((p) =>
        (p as unknown as { key: string }).key.includes("tableColumnResizing"),
      );
      if (!plugin) throw new Error("Missing column resize plugin");
      if (mode === "rejected") {
        const Plugin = editor.state.plugins[0].constructor as typeof import("@tiptap/pm/state").Plugin;
        editor.registerPlugin(new Plugin({ filterTransaction: (tr) => !tr.getMeta(plugin)?.setDragging }));
      }
      const tracked = new Map<EventListenerOrEventListenerObject, string>();
      const add = window.addEventListener,
        remove = window.removeEventListener;
      window.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if ((type === "mousemove" || type === "mouseup") && listener) tracked.set(listener, type);
        return add.call(window, type, listener, options);
      } as typeof window.addEventListener;
      window.removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) {
        if (listener) tracked.delete(listener);
        return remove.call(window, type, listener, options);
      } as typeof window.removeEventListener;
      (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount = () => tracked.size;
      editor.on("transaction", ({ transaction }) => {
        if (!transaction.getMeta(plugin)?.setDragging) return;
        if (mode === "direct") editor.destroy();
        if (mode === "controller") controller.destroy();
        if (mode === "readonly") controller.setEditable(false);
        if (mode === "replace") controller.setContent("<p>替换</p>");
      });
    }, mode);
    await page.mouse.down();
    if (mode === "during" || mode === "during-direct" || mode === "during-readonly") {
      await page.mouse.move(box.x + box.width + 25, box.y + box.height / 2, { steps: 4 });
      expect(
        await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
      ).toBe(2);
      await page.evaluate((mode) => {
        const controller = window.__semloRequireFixture("tableNavigationEditor");
        if (mode === "during-direct") controller.editor.destroy();
        else if (mode === "during-readonly") controller.setEditable(false);
        else controller.destroy();
      }, mode);
    }
    if (mode === "direct" || mode === "controller" || mode === "during" || mode === "during-direct")
      expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isDestroyed)).toBe(
        true,
      );
    if (mode === "readonly" || mode === "during-readonly")
      expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isEditable)).toBe(
        false,
      );
    if (mode === "rejected" || mode === "readonly" || mode === "during-readonly")
      expect(
        await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json),
      ).toEqual(before);
    if (mode === "replace") await expect(prose).toHaveText("替换");
    expect(
      await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
    ).toBe(0);
    await page.mouse.up();
  });
}

for (const mode of ["direct", "controller"] as const) {
  test(`row selection can synchronously destroy via ${mode}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>' })
  `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    await page.locator("#table-navigation-test td").first().hover();
    const handle = page.getByRole("button", { name: "选择第 1 行" });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (!box) throw new Error("Missing row handle");
    await page.evaluate((mode) => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      const editor = controller.editor;
      editor.on("transaction", ({ transaction }) => {
        if (transaction.selection.toJSON().type !== "cell") return;
        if (mode === "direct") editor.destroy();
        else controller.destroy();
      });
    }, mode);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isDestroyed)).toBe(
      true,
    );
    await page.mouse.up();
    expect(errors).toEqual([]);
  });
}

test("a throwing resize-start transaction leaves the next drag usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; host.style.width = '520px'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, outline: false, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const box = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  if (!box) throw new Error("Missing cell");
  const x = box.x + box.width - 1,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await expect(prose.locator(".column-resize-handle").first()).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const plugin = editor.state.plugins.find((p) =>
      (p as unknown as { key: string }).key.includes("tableColumnResizing"),
    )!;
    const Plugin = editor.state.plugins[0].constructor as typeof import("@tiptap/pm/state").Plugin;
    let reject = true;
    editor.registerPlugin(
      new Plugin({
        filterTransaction: (tr) => {
          if (reject && tr.getMeta(plugin)?.setDragging) {
            reject = false;
            throw new Error("planned resize rejection");
          }
          return true;
        },
      }),
    );
    const tracked = new Set<EventListenerOrEventListenerObject>();
    const add = window.addEventListener,
      remove = window.removeEventListener;
    window.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "mousemove" || type === "mouseup") tracked.add(listener);
      return add.call(window, type, listener, options);
    } as typeof window.addEventListener;
    window.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      tracked.delete(listener);
      return remove.call(window, type, listener, options);
    } as typeof window.removeEventListener;
    (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount = () => tracked.size;
  });
  await page.mouse.down();
  await page.mouse.up();
  expect(errors).toContain("planned resize rejection");
  expect(
    await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
  ).toBe(0);
  await page.mouse.move(x, y);
  await expect(prose.locator(".column-resize-handle").first()).toBeVisible();
  await page.mouse.down();
  expect(
    await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
  ).toBe(2);
  await page.mouse.up();
  expect(
    await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
  ).toBe(0);
});

for (const axis of ["行", "列"] as const) {
  for (const mode of [
    "replace",
    "focus",
    "selection",
    "readonly",
    "focus-selection",
    "focus-readonly",
    "focus-direct",
    "focus-controller",
  ] as const) {
    test(`${axis} selection tolerates synchronous ${mode} reentry`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(process.env.SEMLO_TEST_ORIGIN!);
      await page.addScriptTag({
        type: "module",
        content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
        window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
      `,
      });
      await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
      await page.locator("#table-navigation-test td").first().hover();
      const handle = page.getByRole("button", { name: `选择第 1 ${axis}` });
      await expect(handle).toBeVisible();
      const box = await handle.boundingBox();
      if (!box) throw new Error("Missing selection handle");
      await page.evaluate((mode) => {
        const controller = window.__semloRequireFixture("tableNavigationEditor");
        let done = false;
        const reenter = () => {
          if (done) return;
          done = true;
          (window as unknown as { reentryTriggered: boolean }).reentryTriggered = true;
          if (mode === "replace" || mode === "focus") controller.setContent("<p>替换</p>");
          if (mode === "selection" || mode === "focus-selection")
            controller.editor.commands.setTextSelection(controller.editor.state.doc.content.size - 1);
          if (mode === "readonly" || mode === "focus-readonly") controller.setEditable(false);
          if (mode === "focus-direct") controller.editor.destroy();
          if (mode === "focus-controller") controller.destroy();
        };
        if (
          mode === "focus" ||
          mode === "focus-selection" ||
          mode === "focus-readonly" ||
          mode === "focus-direct" ||
          mode === "focus-controller"
        )
          controller.editor.view.dom.addEventListener("focus", reenter, { once: true });
        else
          controller.editor.on("transaction", ({ transaction }) => {
            if (transaction.selection.toJSON().type === "cell") reenter();
          });
      }, mode);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      expect(await page.evaluate(() => (window as unknown as { reentryTriggered?: boolean }).reentryTriggered)).toBe(
        true,
      );
      if (mode === "replace" || mode === "focus")
        await expect(page.locator("#table-navigation-test .semlo-editor-prose")).toHaveText("替换");
      if (mode === "selection" || mode === "focus-selection")
        expect(
          await page.evaluate(
            () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.textContent,
          ),
        ).toBe("后文");
      if (mode === "readonly" || mode === "focus-readonly")
        expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isEditable)).toBe(
          false,
        );
      if (mode === "focus-direct" || mode === "focus-controller")
        expect(
          await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isDestroyed),
        ).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test("code navigation discards its selection marker after synchronous document replacement", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("tableNavigationEditor");
    const editor = controller.editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    let done = false;
    editor.on("transaction", ({ transaction }) => {
      if (done || transaction.selection.$from.parent.type.name !== "codeBlock") return;
      done = true;
      controller.setContent("<table><tbody><tr><td>A</td><td><pre><code>omega</code></pre></td></tr></tbody></table>");
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "codeBlock") position = pos;
      });
      editor.commands.setTextSelection({ from: position + 1, to: position + 6 });
    });
  });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("omega");
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.type.name,
    ),
  ).toBe("codeBlock");
  await expect(page.locator("#table-navigation-test pre code")).toHaveText("omega");
});

for (const mode of ["selection", "readonly", "direct", "controller"] as const) {
  test(`code navigation stops safely when ${mode} occurs in the selection transaction`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
    `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    await page.evaluate((mode) => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      const editor = controller.editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
      let done = false;
      editor.on("transaction", ({ transaction }) => {
        if (done || transaction.selection.$from.parent.type.name !== "codeBlock") return;
        done = true;
        if (mode === "selection") editor.commands.setTextSelection(transaction.selection.from);
        if (mode === "readonly") controller.setEditable(false);
        if (mode === "direct") editor.destroy();
        if (mode === "controller") controller.destroy();
      });
    }, mode);
    await page.keyboard.press("Tab");
    if (mode === "direct" || mode === "controller") {
      expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isDestroyed)).toBe(
        true,
      );
    } else {
      if (mode === "readonly")
        await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").setEditable(true));
      await page.keyboard.press("Shift+Tab");
      expect(
        await page.evaluate(
          () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.type.name,
        ),
      ).toBe("codeBlock");
    }
    expect(errors).toEqual([]);
  });
}

for (const framework of ["react", "vue", "solid"] as const) {
  for (const mode of ["start", "active"] as const) {
    test(`${framework} unmount during ${mode} resize leaves no window listeners`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
      await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
      await page.evaluate(() =>
        window
          .__semloRequireFixture("dynamicEditor")
          .controller.setContent("<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>"),
      );
      const host = page.locator("#dynamic-editor");
      const box = await host.getByRole("cell", { name: "A", exact: true }).boundingBox();
      if (!box) throw new Error("Missing table cell");
      await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
      await expect(host.locator(".column-resize-handle").first()).toBeVisible();
      await page.evaluate((mode) => {
        const fixture = window.__semloRequireFixture("dynamicEditor");
        const editor = fixture.controller.editor;
        const plugin = editor.state.plugins.find((p) =>
          (p as unknown as { key: string }).key.includes("tableColumnResizing"),
        );
        if (!plugin) throw new Error("Missing column resize plugin");
        const tracked = new Set<EventListenerOrEventListenerObject>();
        const add = window.addEventListener,
          remove = window.removeEventListener;
        window.addEventListener = function (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) {
          if (type === "mousemove" || type === "mouseup") tracked.add(listener);
          return add.call(window, type, listener, options);
        } as typeof window.addEventListener;
        window.removeEventListener = function (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | EventListenerOptions,
        ) {
          tracked.delete(listener);
          return remove.call(window, type, listener, options);
        } as typeof window.removeEventListener;
        (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount = () => tracked.size;
        editor.on("transaction", ({ transaction }) => {
          if (mode === "start" && transaction.getMeta(plugin)?.setDragging) fixture.destroy();
        });
      }, mode);
      await page.mouse.down();
      if (mode === "active") {
        await page.mouse.move(box.x + box.width + 25, box.y + box.height / 2, { steps: 4 });
        expect(
          await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
        ).toBe(2);
        await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
      }
      await expect(host).toHaveCount(0);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.isDestroyed),
      ).toBe(true);
      expect(
        await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
      ).toBe(0);
      await page.mouse.up();
      expect(errors).toEqual([]);
    });
  }
}

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} unmount during row selection leaves no page errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .controller.setContent(
          "<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>",
        ),
    );
    const host = page.locator("#dynamic-editor");
    await host.getByRole("cell", { name: "A", exact: true }).hover();
    const handle = page.getByRole("button", { name: "选择第 1 行" });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (!box) throw new Error("Missing row handle");
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      fixture.controller.editor.on("transaction", ({ transaction }) => {
        if (transaction.selection.toJSON().type === "cell") fixture.destroy();
      });
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(host).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.isDestroyed)).toBe(
      true,
    );
    await page.mouse.up();
    expect(errors).toEqual([]);
  });
}

for (const axis of ["行", "列"] as const) {
  test(`host document replacement during ${axis} drag is preserved`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A1</td><td>A2</td><td>A3</td></tr><tr><td>B1</td><td>B2</td><td>B3</td></tr><tr><td>C1</td><td>C2</td><td>C3</td></tr></tbody></table>' })
    `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    await page.locator("#table-navigation-test td").first().hover();
    const from = page.getByRole("button", { name: `选择第 2 ${axis}` });
    const to = page.getByRole("button", { name: `选择第 3 ${axis}` });
    await expect(from).toBeVisible();
    await expect(to).toBeVisible();
    const source = await from.boundingBox(),
      target = await to.boundingBox();
    if (!source || !target) throw new Error("Missing selection handles");
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      let done = false;
      controller.editor.on("transaction", ({ transaction }) => {
        if (done || !transaction.docChanged) return;
        done = true;
        controller.setContent("<p>宿主新文档</p>");
      });
    });
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      axis === "行" ? target.x + target.width / 2 : target.x + target.width - 2,
      axis === "行" ? target.y + target.height - 2 : target.y + target.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(page.locator("#table-navigation-test .semlo-editor-prose")).toHaveText("宿主新文档");
    expect(errors).toEqual([]);
  });
}

test("multiple browser bundles register table code boundary only once", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
  await page.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
  await page.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
  expect(errors).toEqual([]);
});

for (const framework of ["core", "react", "vue", "solid"] as const) {
  test(`${framework} table code boundary preserves its type across bundles and serialization`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
    await page.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
    await page.evaluate(async (framework) => {
      await window.__semloRequireFixture("mountDynamicEditor")("react");
      await window.__semloRequireFixture("mountCodePreferencesFixture")(framework, "bundle-secondary");
      const first = window.__semloRequireFixture("dynamicEditor").controller;
      const second = window.__semloRequireValue(
        window.__semloRequireFixture("codePreferencesFixtures")["bundle-secondary"],
        "fixture",
      ).controller;
      const content = "<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>";
      first.setContent(content);
      second.setContent(content);
      const paragraph = document.querySelector("#dynamic-editor td p")!;
      first.editor.view.focus();
      first.editor.commands.setTextSelection(first.editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    }, framework);
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    await page.evaluate(() => {
      const first = window.__semloRequireFixture("dynamicEditor").controller.editor;
      (window as unknown as { firstBoundaryType: Function }).firstBoundaryType = first.state.selection.constructor;
      const second = window.__semloRequireValue(
        window.__semloRequireFixture("codePreferencesFixtures")["bundle-secondary"],
        "fixture",
      ).controller.editor;
      const paragraph = document.querySelector("#bundle-secondary td p")!;
      second.view.focus();
      second.commands.setTextSelection(second.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    const result = await page.evaluate(() => {
      const editor = window.__semloRequireValue(
        window.__semloRequireFixture("codePreferencesFixtures")["bundle-secondary"],
        "fixture",
      ).controller.editor;
      const selection = editor.state.selection;
      const State = editor.state.constructor as typeof import("@tiptap/pm/state").EditorState;
      const decoded = State.fromJSON(
        { schema: editor.state.schema, plugins: editor.state.plugins },
        editor.state.toJSON(),
      ).selection;
      const firstType = (window as unknown as { firstBoundaryType: Function }).firstBoundaryType;
      const result = {
        type: selection.toJSON().type,
        sameAcrossBundles: firstType === selection.constructor,
        sameAfterDecode: decoded.constructor === selection.constructor,
        equalAfterDecode: decoded.eq(selection),
      };
      editor.view.dispatch(editor.state.tr.setSelection(decoded.getBookmark().resolve(editor.state.doc)));
      return result;
    });
    expect(result).toEqual({
      type: "semloEditorTableCodeBoundary",
      sameAcrossBundles: true,
      sameAfterDecode: true,
      equalAfterDecode: true,
    });
    await page.keyboard.type("x");
    await expect(page.locator("#bundle-secondary td").last().locator("pre code")).toHaveText("alpha");
    await expect(page.locator("#bundle-secondary td").last().locator("p")).toHaveText("x");
    await expect(page.locator("#dynamic-editor td").last().locator("pre code")).toHaveText("alpha");
    await expect(page.locator("#dynamic-editor td").last().locator("p")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("browser bundles also initialize when the preferences entry loads first", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/tests/controlled.js", (route) => route.abort());
  await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
  await page.unroute("**/tests/controlled.js");
  await page.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
  await page.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
  await page.addScriptTag({ type: "module", url: "/tests/controlled.js" });
  await page.waitForFunction(() => Boolean(window.mountDynamicEditor));
  await page.evaluate(async () => {
    await window.__semloRequireFixture("mountCodePreferencesFixture")("core", "pref-first");
    await window.__semloRequireFixture("mountDynamicEditor")("react");
  });
  await page.evaluate(() => {
    const first = window.__semloRequireValue(
      window.__semloRequireFixture("codePreferencesFixtures")["pref-first"],
      "fixture",
    ).controller;
    const second = window.__semloRequireFixture("dynamicEditor").controller;
    const content = "<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>";
    first.setContent(content);
    second.setContent(content);
    const paragraph = document.querySelector("#pref-first td p")!;
    first.editor.view.focus();
    first.editor.commands.setTextSelection(first.editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => {
    const first = window.__semloRequireValue(
      window.__semloRequireFixture("codePreferencesFixtures")["pref-first"],
      "fixture",
    ).controller.editor;
    (window as unknown as { firstBoundaryType: Function }).firstBoundaryType = first.state.selection.constructor;
    const second = window.__semloRequireFixture("dynamicEditor").controller.editor;
    const paragraph = document.querySelector("#dynamic-editor td p")!;
    second.view.focus();
    second.commands.setTextSelection(second.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("dynamicEditor").controller.editor;
    const selection = editor.state.selection;
    const State = editor.state.constructor as typeof import("@tiptap/pm/state").EditorState;
    const decoded = State.fromJSON(
      { schema: editor.state.schema, plugins: editor.state.plugins },
      editor.state.toJSON(),
    ).selection;
    const firstType = (window as unknown as { firstBoundaryType: Function }).firstBoundaryType;
    const result = {
      type: selection.toJSON().type,
      sameAcrossBundles: firstType === selection.constructor,
      sameAfterDecode: decoded.constructor === selection.constructor,
      equalAfterDecode: decoded.eq(selection),
    };
    editor.view.dispatch(editor.state.tr.setSelection(decoded.getBookmark().resolve(editor.state.doc)));
    return result;
  });
  expect(result).toEqual({
    type: "semloEditorTableCodeBoundary",
    sameAcrossBundles: true,
    sameAfterDecode: true,
    equalAfterDecode: true,
  });
  await page.keyboard.type("x");
  await expect(page.locator("#dynamic-editor td").last().locator("pre code")).toHaveText("alpha");
  await expect(page.locator("#dynamic-editor td").last().locator("p")).toHaveText("x");
  await expect(page.locator("#pref-first td").last().locator("p")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} controller destruction after table drag unmount is safe`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .controller.setContent("<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>"),
    );
    const host = page.locator("#dynamic-editor");
    const box = await host.getByRole("cell", { name: "A", exact: true }).boundingBox();
    if (!box) throw new Error("Missing table cell");
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    await expect(host.locator(".column-resize-handle").first()).toBeVisible();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 25, box.y + box.height / 2, { steps: 4 });
    const result = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      const controller = fixture.controller;
      fixture.destroy();
      try {
        controller.destroy();
        return { destroyed: controller.editor.isDestroyed, error: null };
      } catch (error) {
        return {
          destroyed: controller.editor.isDestroyed,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
    await page.mouse.up();
    expect(result).toEqual({ destroyed: true, error: null });
    expect(errors).toEqual([]);
  });
}

test("table boundary registration and state stay isolated across iframes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
  await page.evaluate(() => {
    for (const name of ["table-frame-one", "table-frame-two"]) {
      const frame = document.createElement("iframe");
      frame.id = name;
      frame.name = name;
      frame.src = "/tests/controlled.html";
      frame.style.cssText = "width:800px;height:400px";
      document.body.append(frame);
    }
  });
  await expect
    .poll(() => Boolean(page.frame({ name: "table-frame-one" }) && page.frame({ name: "table-frame-two" })))
    .toBe(true);
  const first = page.frame({ name: "table-frame-one" });
  const second = page.frame({ name: "table-frame-two" });
  if (!first || !second) throw new Error("Missing table iframes");
  for (const frame of [first, second]) {
    await frame.waitForFunction(() => Boolean(window.mountDynamicEditor));
    await frame.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
    await frame.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
    await frame.evaluate(async () => {
      await window.__semloRequireFixture("mountDynamicEditor")("react");
      const editor = window.__semloRequireFixture("dynamicEditor").controller.editor;
      window
        .__semloRequireFixture("dynamicEditor")
        .controller.setContent(
          "<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>",
        );
      const paragraph = document.querySelector("#dynamic-editor td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    await frame.evaluate(() => {
      const editor = window.__semloRequireFixture("dynamicEditor").controller.editor;
      (window as unknown as { frameBoundaryType: Function }).frameBoundaryType = editor.state.selection.constructor;
    });
  }
  const classesDiffer = await page.evaluate(() => {
    const first = document.querySelector<HTMLIFrameElement>("#table-frame-one")!.contentWindow as unknown as {
      frameBoundaryType: Function;
    };
    const second = document.querySelector<HTMLIFrameElement>("#table-frame-two")!.contentWindow as unknown as {
      frameBoundaryType: Function;
    };
    return first.frameBoundaryType !== second.frameBoundaryType;
  });
  expect(classesDiffer).toBe(true);
  await page.keyboard.type("x");
  await expect(page.frameLocator("#table-frame-two").locator("#dynamic-editor td").last().locator("p")).toHaveText("x");
  await expect(page.frameLocator("#table-frame-one").locator("#dynamic-editor td").last().locator("p")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("toolbar survives host destruction during history boundary", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, outline: false, content: '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.locator("#table-navigation-test td").first().click();
  const toolbar = page.getByRole("toolbar", { name: "表格工具栏" });
  await expect(toolbar).toBeVisible();
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("tableNavigationEditor");
    let changed = false;
    controller.editor.on("transaction", ({ transaction }) => {
      if (changed) controller.destroy();
      else if (transaction.docChanged) changed = true;
    });
  });
  await toolbar.getByRole("button", { name: "隐藏边框" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isDestroyed)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

for (const cleanupThrows of [false, true]) {
  test(`table toolbar rolls back failed setup (cleanup throws: ${cleanupThrows})`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const setupError = new Error('toolbar observer failure')
        const cleanupError = new Error('toolbar listener cleanup failure')
        const OriginalObserver = window.ResizeObserver
        let cleanupThrown = false
        const tracked = []
        const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
        document.addEventListener = function(type, callback, options) {
          if (['outside', 'keydown', 'schedulePosition'].includes(callback.name)) tracked.push({type, callback, removed: false})
          return add(type, callback, options)
        }
        document.removeEventListener = function(type, callback, options) {
          tracked.filter(item => item.type === type && item.callback === callback).forEach(item => item.removed = true)
          const result = remove(type, callback, options)
          if (${cleanupThrows} && !cleanupThrown && type === 'pointerdown' && callback.name === 'outside' && new Error().stack?.includes('runCleanupSteps') && new Error().stack?.includes('mountTableToolbar')) { cleanupThrown = true; throw cleanupError }
          return result
        }
        window.ResizeObserver = class extends OriginalObserver {
          observe(target, options) {
            if ((target.matches('table') || target.querySelector('table')) && new Error().stack?.includes('mountTableToolbar')) throw setupError
            return super.observe(target, options)
          }
        }
        const existingToolbars = new Set(document.querySelectorAll('.semlo-editor-table-toolbar'))
        const host = document.createElement('div'); document.body.append(host)
        let caught
        try { createEditor({element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>'}) } catch (error) { caught = error }
        window.tableToolbarSetupProbe = {
          original: caught === setupError,
          aggregate: caught instanceof AggregateError,
          cause: caught instanceof AggregateError && caught.cause === setupError && caught.errors[0] === setupError,
          cleanup: caught instanceof AggregateError && caught.errors[1] === cleanupError,
          active: tracked.filter(item => !item.removed).length,
          shell: host.children.length,
          toolbars: [...document.querySelectorAll('.semlo-editor-table-toolbar')].filter(toolbar => !existingToolbars.has(toolbar)).length,
          baselineIntact: [...existingToolbars].every(toolbar => toolbar.isConnected),
        }
      `,
    });
    await page.waitForFunction(() =>
      Boolean((window as unknown as { tableToolbarSetupProbe?: unknown }).tableToolbarSetupProbe),
    );
    const result = await page.evaluate(
      () => (window as unknown as { tableToolbarSetupProbe: unknown }).tableToolbarSetupProbe,
    );
    expect(result).toEqual({
      original: !cleanupThrows,
      aggregate: cleanupThrows,
      cause: cleanupThrows,
      cleanup: cleanupThrows,
      active: 0,
      shell: 0,
      toolbars: 0,
      baselineIntact: true,
    });
  });
}

for (const mode of ["destroy", "unmount", "throws"] as const) {
  test(`table toolbar cleans up when host ${mode}`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const tracked = []
        const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
        document.addEventListener = function(type, callback, options) {
          if (new Error().stack?.includes('mountTableToolbar')) tracked.push({type, callback, removed: false})
          return add(type, callback, options)
        }
        document.removeEventListener = function(type, callback, options) {
          tracked.filter(item => item.type === type && item.callback === callback).forEach(item => item.removed = true)
          return remove(type, callback, options)
        }
        const existingToolbars = new Set(document.querySelectorAll('.semlo-editor-table-toolbar'))
        const host = document.createElement('div'); document.body.append(host)
        const failure = new Error('host destroy failure')
        const controller = createEditor({element: host, content: '<table><tbody><tr><td>A</td></tr></tbody></table>'})
        if ('${mode}' === 'throws') controller.editor.on('destroy', () => { throw failure })
        const before = tracked.filter(item => !item.removed).length
        let caught
        try {
          if ('${mode}' === 'unmount') controller.editor.unmount()
          controller.destroy(); controller.destroy()
        } catch (error) { caught = error }
        window.tableToolbarDestroyProbe = {
          before, active: tracked.filter(item => !item.removed).length,
          toolbars: [...document.querySelectorAll('.semlo-editor-table-toolbar')].filter(toolbar => !existingToolbars.has(toolbar)).length,
          baselineIntact: [...existingToolbars].every(toolbar => toolbar.isConnected),
          shell: host.children.length, original: caught === failure,
        }
      `,
    });
    await page.waitForFunction(() =>
      Boolean((window as unknown as { tableToolbarDestroyProbe?: unknown }).tableToolbarDestroyProbe),
    );
    const result = await page.evaluate(
      () =>
        (
          window as unknown as {
            tableToolbarDestroyProbe: {
              before: number;
              active: number;
              toolbars: number;
              shell: number;
              original: boolean;
            };
          }
        ).tableToolbarDestroyProbe,
    );
    expect(result.before).toBeGreaterThan(0);
    expect(result).toEqual({
      before: result.before,
      active: 0,
      toolbars: 0,
      baselineIntact: true,
      shell: 0,
      original: mode === "throws",
    });
  });
}

for (const scenario of ["host", "partial", "partialcleanup", "hostcleanup"] as const) {
  test(`table registry cleans up a failed constructor: ${scenario}`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const seedHost = document.createElement('div'); document.body.append(seedHost)
        const seed = createEditor({element: seedHost, outline: false, toolbar: false})
        const Extension = seed.editor.extensionManager.extensions.find(extension => extension.type === 'extension').constructor
        const Plugin = seed.editor.state.plugins[0].constructor
        seed.destroy()
        const baseline = new Set(document.querySelectorAll('.semlo-editor-table-edges'))
        const hostError = new Error('host constructor failure'), setupError = new Error('listener install failure'), cleanupError = new Error('listener cleanup failure')
        let cleanupThrown = false
        const tracked = []
        const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
        document.addEventListener = function(type, callback, options) {
          if (['partial','partialcleanup'].includes('${scenario}') && type === 'pointercancel' && callback.name === 'cancel') throw setupError
          if (['pointerup','pointercancel'].includes(type) && options === true) tracked.push({type, callback, removed: false})
          return add(type, callback, options)
        }
        document.removeEventListener = function(type, callback, options) {
          tracked.filter(item => item.type === type && item.callback === callback && options === true).forEach(item => item.removed = true)
          const result = remove(type, callback, options)
          if (!cleanupThrown && type === 'pointerup' && callback.name === 'pointerUp' && ('${scenario}' === 'partialcleanup' || ('${scenario}' === 'hostcleanup' && new Error().stack?.includes('closeViewDisposers')))) { cleanupThrown = true; throw cleanupError }
          return result
        }
        const host = document.createElement('div'); document.body.append(host)
        const fail = Extension.create({name:'tableRegistryHostFailure', priority:1, addProseMirrorPlugins() {return [new Plugin({view() {throw hostError}})]}})
        let caught
        try { createEditor({element:host, extensions:[fail]}) } catch (error) { caught = error }
        const expected = ['host','hostcleanup'].includes('${scenario}') ? hostError : setupError
        const double = ['partialcleanup','hostcleanup'].includes('${scenario}')
        window.tableRegistryFailureProbe = {
          correct: double ? caught instanceof AggregateError && caught.cause === expected && caught.errors[0] === expected && caught.errors[1] === cleanupError : caught === expected,
          active: tracked.filter(item => !item.removed).length,
          shell: host.children.length,
          overlays: [...document.querySelectorAll('.semlo-editor-table-edges')].filter(node => !baseline.has(node)).length,
          baselineIntact: [...baseline].every(node => node.isConnected),
        }
      `,
    });
    await page.waitForFunction(() =>
      Boolean((window as unknown as { tableRegistryFailureProbe?: unknown }).tableRegistryFailureProbe),
    );
    const result = await page.evaluate(
      () => (window as unknown as { tableRegistryFailureProbe: unknown }).tableRegistryFailureProbe,
    );
    expect(result).toEqual({ correct: true, active: 0, shell: 0, overlays: 0, baselineIntact: true });
  });
}

for (const crossFrame of [false, true]) {
  test(`table registry keeps editors isolated across ${crossFrame ? "documents" : "instances"}`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const watch = doc => {
          const records = [], add = doc.addEventListener.bind(doc), remove = doc.removeEventListener.bind(doc)
          doc.addEventListener = function(type, callback, options) {
            if (type === 'pointercancel' && callback.name === 'cancel' && options === true) records.push({callback, removed:false})
            return add(type, callback, options)
          }
          doc.removeEventListener = function(type, callback, options) {
            if (type === 'pointercancel' && options === true) records.filter(item => item.callback === callback).forEach(item => item.removed = true)
            return remove(type, callback, options)
          }
          return () => records.filter(item => !item.removed).length
        }
        const mainCount = watch(document)
        const frame = ${crossFrame} ? document.createElement('iframe') : null
        if (frame) document.body.append(frame)
        const otherDocument = frame ? frame.contentDocument : document
        const otherCount = frame ? watch(otherDocument) : mainCount
        const mainBaseline = new Set(document.querySelectorAll('.semlo-editor-table-edges'))
        const otherBaseline = frame ? new Set(otherDocument.querySelectorAll('.semlo-editor-table-edges')) : mainBaseline
        const oneHost = document.createElement('div'); document.body.append(oneHost)
        const twoHost = otherDocument.createElement('div'); otherDocument.body.append(twoHost)
        const one = createEditor({element:oneHost, outline:false}), two = createEditor({element:twoHost, outline:false})
        const before = [mainCount(), otherCount()]
        one.destroy(); one.destroy()
        const afterOne = [mainCount(), otherCount()]
        two.destroy(); two.destroy()
        const afterBoth = [mainCount(), otherCount()]
        window.tableRegistryIsolationProbe = {
          before, afterOne, afterBoth,
          mainExtra: [...document.querySelectorAll('.semlo-editor-table-edges')].filter(node => !mainBaseline.has(node)).length,
          otherExtra: [...otherDocument.querySelectorAll('.semlo-editor-table-edges')].filter(node => !otherBaseline.has(node)).length,
          baselineIntact: [...mainBaseline, ...otherBaseline].every(node => node.isConnected),
        }
      `,
    });
    await page.waitForFunction(() =>
      Boolean((window as unknown as { tableRegistryIsolationProbe?: unknown }).tableRegistryIsolationProbe),
    );
    const result = await page.evaluate(
      () => (window as unknown as { tableRegistryIsolationProbe: unknown }).tableRegistryIsolationProbe,
    );
    expect(result).toEqual({
      before: crossFrame ? [1, 1] : [2, 2],
      afterOne: crossFrame ? [0, 1] : [1, 1],
      afterBoth: [0, 0],
      mainExtra: 0,
      otherExtra: 0,
      baselineIntact: true,
    });
  });
}

for (const axis of ["行", "列"] as const) {
  test(`host beforeTransaction replacement is rejected during ${axis} selection`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
  `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    await page.locator("#table-navigation-test td").first().hover();
    const handle = page.getByRole("button", { name: `选择第 1 ${axis}` });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (!box) throw new Error("Missing selection handle");
    const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      let done = false;
      controller.editor.on("beforeTransaction", ({ transaction }) => {
        if (done || transaction.selection.toJSON().type !== "cell") return;
        done = true;
        try {
          controller.setContent("<p>宿主新文档</p>");
        } catch (error) {
          Reflect.set(window, "tableRejection", (error as Error).name);
        }
      });
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    expect(await page.evaluate(() => Reflect.get(window, "tableRejection"))).toBe("ReentrantTransactionError");
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
      before,
    );
    expect(errors).toEqual([]);
  });
}

test("host beforeTransaction replacement is rejected during resize-start", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; host.style.width = '520px'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const cell = page.locator("#table-navigation-test td").first();
  const box = await cell.boundingBox();
  if (!box) throw new Error("Missing cell");
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
  await expect(page.locator("#table-navigation-test .column-resize-handle").first()).toBeVisible();
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("tableNavigationEditor");
    const editor = controller.editor;
    const plugin = editor.state.plugins.find((p) =>
      (p as unknown as { key: string }).key.includes("tableColumnResizing"),
    )!;
    let done = false;
    editor.on("beforeTransaction", ({ transaction }) => {
      if (!done && transaction.getMeta(plugin)?.setDragging) {
        done = true;
        try {
          controller.setContent("<p>宿主新文档</p>");
        } catch (error) {
          Reflect.set(window, "tableRejection", (error as Error).name);
        }
      }
    });
    const tracked = new Set<EventListenerOrEventListenerObject>();
    const add = window.addEventListener,
      remove = window.removeEventListener;
    window.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "mousemove" || type === "mouseup") tracked.add(listener);
      return add.call(window, type, listener, options);
    } as typeof window.addEventListener;
    window.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      tracked.delete(listener);
      return remove.call(window, type, listener, options);
    } as typeof window.removeEventListener;
    (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount = () => tracked.size;
  });
  await page.mouse.down();
  const started = await page.evaluate(() => ({
    rejected: Reflect.get(window, "tableRejection"),
    json: window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json,
  }));
  expect(started).toEqual({ rejected: "ReentrantTransactionError", json: before });
  await page.mouse.up();
  const result = await page.evaluate(() => ({
    rejected: Reflect.get(window, "tableRejection"),
    json: window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json,
    listeners: (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount(),
  }));
  // 启动被中止后，松开鼠标也不能写入列宽。
  expect(result).toEqual({ rejected: "ReentrantTransactionError", json: before, listeners: 0 });
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} host beforeTransaction replacement is rejected during row selection`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .controller.setContent(
          "<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>",
        ),
    );
    const before = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    const host = page.locator("#dynamic-editor");
    await host.getByRole("cell", { name: "A", exact: true }).hover();
    const handle = page.getByRole("button", { name: "选择第 1 行" });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (!box) throw new Error("Missing row handle");
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("dynamicEditor").controller;
      let done = false;
      controller.editor.on("beforeTransaction", ({ transaction }) => {
        if (done || transaction.selection.toJSON().type !== "cell") return;
        done = true;
        try {
          controller.setContent("<p>宿主新文档</p>");
        } catch (error) {
          Reflect.set(window, "tableRejection", (error as Error).name);
        }
      });
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    expect(await page.evaluate(() => Reflect.get(window, "tableRejection"))).toBe("ReentrantTransactionError");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json),
    ).toEqual(before);
    expect(errors).toEqual([]);
  });
}

for (const axis of ["行", "列"] as const) {
  test(`host beforeTransaction replacement is rejected during ${axis} drag`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A1</td><td>A2</td><td>A3</td></tr><tr><td>B1</td><td>B2</td><td>B3</td></tr><tr><td>C1</td><td>C2</td><td>C3</td></tr></tbody></table>' })
    `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    const beforeCells = await page.locator("#table-navigation-test td").allTextContents();
    await page.locator("#table-navigation-test td").first().hover();
    const from = page.getByRole("button", { name: `选择第 2 ${axis}` });
    const to = page.getByRole("button", { name: `选择第 3 ${axis}` });
    await expect(from).toBeVisible();
    await expect(to).toBeVisible();
    const source = await from.boundingBox(),
      target = await to.boundingBox();
    if (!source || !target) throw new Error("Missing selection handles");
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      let done = false;
      controller.editor.on("beforeTransaction", ({ transaction }) => {
        if (done || !transaction.docChanged) return;
        done = true;
        try {
          controller.setContent("<p>宿主新文档</p>");
        } catch (error) {
          Reflect.set(window, "tableRejection", (error as Error).name);
        }
      });
    });
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      axis === "行" ? target.x + target.width / 2 : target.x + target.width - 2,
      axis === "行" ? target.y + target.height - 2 : target.y + target.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    expect(await page.evaluate(() => Reflect.get(window, "tableRejection"))).toBe("ReentrantTransactionError");
    const afterCells = await page.locator("#table-navigation-test td").allTextContents();
    expect(afterCells).not.toEqual(beforeCells);
    expect(afterCells.sort()).toEqual(["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]);
    await expect(page.locator(".semlo-editor-table-edge-indicator")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

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
