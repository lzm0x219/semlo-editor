import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(({ page }) => installFixtureGuards(page));

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
