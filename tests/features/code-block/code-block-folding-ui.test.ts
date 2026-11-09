import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    foldUi?: EditorController;
    foldNested?: EditorController;
    foldLong?: EditorController;
    foldWrap?: EditorController;
    foldLanguage?: EditorController;
    foldKeyboard?: EditorController;
    foldReadonly?: EditorController;
    foldUndo?: EditorController;
  }
}

test("fold, persist, keep logical numbers and edit outside", async ({ page }) => {
  page.setDefaultTimeout(5000);
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='fold-ui';document.body.prepend(host)
    window.foldUi=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'function test() {\\n  return 1;\\n}\\nconst next=2;'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldUi));
  const card = page.locator("#fold-ui .semlo-editor-code-card");
  await expect(card.getByRole("button", { name: "折叠第 1 行代码" })).toBeVisible();
  await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  await expect(card.locator(".semlo-editor-code-fold-number")).toHaveText(["1", "4"]);
  let snapshot = await page.evaluate(() => window.__semloRequireFixture("foldUi").getSnapshot());
  expect(snapshot.json.content?.[0].attrs?.folds).toEqual([{ from: 17, to: 30 }]);
  expect(snapshot.json.content?.[0].content?.[0].text).toContain("return 1;");
  await page.evaluate((html) => window.__semloRequireFixture("foldUi").setContent(html), snapshot.html);
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("foldUi").editor.commands.insertContentAt(1, "//x"));
  snapshot = await page.evaluate(() => window.__semloRequireFixture("foldUi").getSnapshot());
  expect(snapshot.json.content?.[0].attrs?.folds).toEqual([{ from: 20, to: 33 }]);
  expect(await page.evaluate(() => window.__semloRequireFixture("foldUi").editor.commands.undo())).toBe(true);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("foldUi").getSnapshot())).json.content?.[0].attrs?.folds,
  ).toEqual([{ from: 17, to: 30 }]);
  await card.locator(".semlo-editor-code-fold-placeholder").click();
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toHaveCount(0);
});

test("nested folds survive outer collapse and work with line numbers disabled", async ({ page }) => {
  page.setDefaultTimeout(5000);
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-nested';document.body.prepend(host)
    window.foldNested=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript',wordWrap:true},content:[{type:'text',text:'function outer() {\\n  if (true) {\\n    return 1;\\n  }\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldNested));
  const card = page.locator("#fold-nested .semlo-editor-code-card");
  await card.getByRole("button", { name: "折叠第 2 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-number")).toHaveText(["1", "2", "5"]);
  await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-number")).toHaveText(["1"]);
  await card.getByRole("button", { name: "展开第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-number")).toHaveText(["1", "2", "5"]);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("foldNested").getSnapshot())).json.content?.[0].attrs
      ?.folds,
  ).toHaveLength(1);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("foldNested")
      .editor.commands.updateAttributes("codeBlock", { showLineNumbers: false }),
  );
  await expect(card.locator(".semlo-editor-code-numbers")).toBeHidden();
  await expect(card.getByRole("button", { name: "展开第 2 行代码" })).toBeVisible();
  await card.getByRole("button", { name: "展开第 2 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toHaveCount(0);
});

test("long blocks offer folding near their end", async ({ page }) => {
  page.setDefaultTimeout(7000);
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-long';document.body.prepend(host)
    const text=Array.from({length:3000},(_,i)=>i===2990?'function last() {':i===2991?'return 1;':i===2992?'}':'const x'+i+' = 1;').join('\\n')
    window.foldLong=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLong));
  const card = page.locator("#fold-long .semlo-editor-code-card");
  await card
    .locator("code")
    .evaluate((el) =>
      window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 100),
    );
  const last = card.getByRole("button", { name: "折叠第 2991 行代码" });
  await expect(last).toBeVisible();
  await last.click();
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
});

test("wrapped folded lines keep gutter aligned after resizing", async ({ page }) => {
  page.setDefaultTimeout(7000);
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-wrap';host.style.width='300px';document.body.prepend(host)
    const text='function veryLongFunctionNameThatWrapsToAnotherLine(argumentOne, argumentTwo) {\\n  return 1;\\n}\\nconst next = 2;'
    window.foldWrap=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript',wordWrap:true},content:[{type:'text',text}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldWrap));
  const card = page.locator("#fold-wrap .semlo-editor-code-card");
  await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-number")).toHaveText(["1", "4"]);
  const aligned = async () =>
    await card.evaluate((el) => {
      const labels = [...el.querySelectorAll(".semlo-editor-code-fold-number")].map(
        (x) => x.getBoundingClientRect().top,
      );
      const tokens = [...el.querySelectorAll("code .hljs-keyword")]
        .filter((x) => getComputedStyle(x).display !== "none")
        .map((x) => x.getBoundingClientRect().top);
      return Math.abs(labels[1] - tokens[tokens.length - 1]);
    });
  expect(await aligned()).toBeLessThan(2);
  await page.locator("#fold-wrap").evaluate((el) => (el.style.width = "220px"));
  await expect.poll(aligned).toBeLessThan(2);
  await page.locator("#fold-wrap").evaluate((el) => {
    el.style.transform = "scale(.8)";
    el.style.transformOrigin = "top left";
  });
  await expect.poll(aligned).toBeLessThan(2);
});

test("a saved fold remains expandable after switching to plain text", async ({ page }) => {
  page.setDefaultTimeout(5000);
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-language';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript',folds:[{from:17,to:30}]},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLanguage));
  const card = page.locator("#fold-language .semlo-editor-code-card");
  await page.evaluate(() =>
    window.__semloRequireFixture("foldLanguage").editor.commands.updateAttributes("codeBlock", { language: null }),
  );
  await card.getByRole("button", { name: "展开第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "折叠第 1 行代码" })).toHaveCount(0);
});

test("folding by keyboard retains a usable focus target", async ({ page }) => {
  page.setDefaultTimeout(5000);
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-keyboard';document.body.prepend(host)
    window.foldKeyboard=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldKeyboard));
  const card = page.locator("#fold-keyboard .semlo-editor-code-card");
  const button = card.getByRole("button", { name: "折叠第 1 行代码" });
  await button.focus();
  await button.press("Enter");
  const expanded = card.getByRole("button", { name: "展开第 1 行代码" });
  await expect(expanded).toBeFocused();
  await expanded.press("Enter");
  await expect(card.getByRole("button", { name: "折叠第 1 行代码" })).toBeFocused();
});

test("read-only folding is transient and never changes the saved document", async ({ page }) => {
  page.setDefaultTimeout(5000);
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-readonly';document.body.prepend(host)
    window.foldReadonly=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldReadonly));
  const card = page.locator("#fold-readonly .semlo-editor-code-card");
  const before = await page.evaluate(() => window.__semloRequireFixture("foldReadonly").getSnapshot().json);
  await page.evaluate(() => window.__semloRequireFixture("foldReadonly").setEditable(false));
  await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldReadonly").getSnapshot().json)).toEqual(before);
  await card.getByRole("button", { name: "展开第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("foldReadonly").getSnapshot().json)).toEqual(before);
  await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("foldReadonly").setEditable(true));
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("foldReadonly").getSnapshot().json)).toEqual(before);
});

test("replacing all code and undo restores the previous fold", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');document.body.prepend(host)
    window.foldUndo=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript',folds:[{from:17,to:30}]},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldUndo));
  await page.evaluate(() =>
    window.__semloRequireFixture("foldUndo").editor.commands.insertContentAt({ from: 1, to: 32 }, "replacement"),
  );
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("foldUndo").getSnapshot())).json.content?.[0].attrs?.folds,
  ).toEqual([]);
  expect(await page.evaluate(() => window.__semloRequireFixture("foldUndo").editor.commands.undo())).toBe(true);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("foldUndo").getSnapshot())).json.content?.[0].attrs?.folds,
  ).toEqual([{ from: 17, to: 30 }]);
  await page.evaluate(() => window.__semloRequireFixture("foldUndo").editor.commands.setTextSelection(22));
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("foldUndo").getSnapshot())).json.content?.[0].attrs?.folds,
  ).toEqual([]);
});

test("SQL creates no new fold controls but retains a fold saved in another language", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'; const host=document.createElement('div');host.id='fold-sql';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript',folds:[{from:17,to:30}]},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLanguage));
  const card = page.locator("#fold-sql .semlo-editor-code-card");
  await page.evaluate(() =>
    window.__semloRequireFixture("foldLanguage").editor.commands.updateAttributes("codeBlock", { language: "sql" }),
  );
  await card.getByRole("button", { name: "展开第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "折叠第 1 行代码" })).toHaveCount(0);
});

test("PHP fold controls track whether the source starts with a PHP tag", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'; const host=document.createElement('div');host.id='fold-php';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'php'},content:[{type:'text',text:'function demo() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLanguage));
  const card = page.locator("#fold-php .semlo-editor-code-card");
  await expect(card.getByRole("button", { name: "折叠第 1 行代码" })).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.insertContentAt(1, "<?php\n"));
  await expect(card.getByRole("button", { name: "折叠第 2 行代码" })).toHaveCount(0);
});

test("arrow keys cross a folded placeholder without opening it", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-arrows';host.style.marginTop='120px';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLanguage));
  const card = page.locator("#fold-arrows .semlo-editor-code-card");
  await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await card.locator("code").click();
  const position = () => page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.selection.from);
  await page.keyboard.press("End");
  await expect.poll(position).toBe(32);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(position).toBe(31);
  for (let i = 0; i < 18; i++) await page.keyboard.press("ArrowLeft");
  await expect.poll(position).toBeLessThan(31);
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
});

for (const key of ["Backspace", "Shift+Backspace"]) {
  test(`${key} at the end of a fold edits hidden text and remains undoable`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-backspace';host.style.marginTop='120px';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
    });
    await page.waitForFunction(() => Boolean(window.foldLanguage));
    const card = page.locator("#fold-backspace .semlo-editor-code-card");
    await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
    await card.locator("code").click();
    await page.keyboard.press("End");
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.selection.from))
      .toBe(32);
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.selection.from))
      .toBe(31);
    await page.keyboard.press(key);
    const text = () =>
      page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.doc.firstChild?.textContent);
    await expect.poll(text).toBe("function test() {\n  return 1;}");
    await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
    expect(await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.undo())).toBe(true);
    await expect.poll(text).toBe("function test() {\n  return 1;\n}");
    await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("foldLanguage").getSnapshot())).json.content?.[0].attrs
        ?.folds,
    ).toEqual([{ from: 17, to: 30 }]);
  });
}

test("forward delete at the beginning of a fold edits one hidden character", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-delete';host.style.marginTop='120px';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript',folds:[{from:17,to:30}]},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLanguage));
  const card = page.locator("#fold-delete .semlo-editor-code-card");
  await card.locator("code").click();
  await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.setTextSelection(18));
  await page.keyboard.press("Delete");
  const text = () =>
    page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.doc.firstChild?.textContent);
  await expect.poll(text).toBe("function test() {  return 1;\n}");
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.undo())).toBe(true);
  await expect.poll(text).toBe("function test() {\n  return 1;\n}");
});

test("backspace at a folded boundary removes an entire emoji grapheme", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-emoji';host.style.marginTop='120px';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'function t() {\\n👩‍💻}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLanguage));
  const card = page.locator("#fold-emoji .semlo-editor-code-card");
  await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await card.locator("code").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  const text = () =>
    page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.doc.firstChild?.textContent);
  await expect.poll(text).toBe("function t() {\n}");
  expect(await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.undo())).toBe(true);
  await expect.poll(text).toBe("function t() {\n👩‍💻}");
});

test("word backspace at a folded boundary deletes only the adjacent group", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-word';host.style.marginTop='120px';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'function t() {\\n  return apple}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLanguage));
  const card = page.locator("#fold-word .semlo-editor-code-card");
  await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await card.locator("code").click();
  await page.keyboard.press("End");
  const position = () => page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.selection.from);
  const length = await page.evaluate(
    () => window.__semloRequireFixture("foldLanguage").editor.state.doc.firstChild!.content.size,
  );
  await expect.poll(position).toBe(length + 1);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(position).toBe(length);
  await page.keyboard.press("Alt+Backspace");
  const text = () =>
    page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.doc.firstChild?.textContent);
  await expect.poll(text).toBe("function t() {\n  return }");
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.undo())).toBe(true);
  await expect.poll(text).toBe("function t() {\n  return apple}");
});

test("line backspace across a fold follows the visible line boundary", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-line-delete';host.style.marginTop='120px';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLanguage));
  const card = page.locator("#fold-line-delete .semlo-editor-code-card");
  await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await card.locator("code").click();
  await page.keyboard.press("End");
  const position = () => page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.selection.from);
  await expect.poll(position).toBe(32);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(position).toBe(31);
  await page.keyboard.press("Meta+Backspace");
  const text = () =>
    page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.doc.firstChild?.textContent);
  try {
    await expect.poll(text).toBe("}");
  } catch (error) {
    throw new Error(
      "[DEBUG-fold-line] " +
        JSON.stringify({
          text: await text(),
          position: await position(),
          platform: await page.evaluate(() => navigator.platform),
        }),
      { cause: error },
    );
  }
  expect(await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.undo())).toBe(true);
  await expect.poll(text).toBe("function test() {\n  return 1;\n}");
});

for (const [input, expected] of [
  ["function test() {\n  return 1;\n}", "function test() {\n  return 1;}"],
  ["function test() {\n  return apple;}", "function test() {\n  return apple}"],
]) {
  test(`word backspace respects a folded ${input.includes(";\n}") ? "newline" : "punctuation"} boundary`, async ({
    page,
  }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-word-boundary';host.style.marginTop='120px';document.body.prepend(host)
      window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:${JSON.stringify(input)}}]}]}})
    `,
    });
    await page.waitForFunction(() => Boolean(window.foldLanguage));
    const card = page.locator("#fold-word-boundary .semlo-editor-code-card");
    await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
    await card.locator("code").click();
    await page.keyboard.press("End");
    const position = () =>
      page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.selection.from);
    await expect.poll(position).toBe(input.length + 1);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(position).toBe(input.length);
    await page.keyboard.press("Alt+Backspace");
    await expect
      .poll(() =>
        page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.doc.firstChild?.textContent),
      )
      .toBe(expected);
    await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  });
}

test("shift delete at a folded boundary removes the visible line", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-shift-delete';host.style.marginTop='120px';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript',folds:[{from:17,to:30}]},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLanguage));
  const card = page.locator("#fold-shift-delete .semlo-editor-code-card");
  await card.locator("code").click();
  await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.setTextSelection(18));
  await page.keyboard.press("Shift+Delete");
  const text = () =>
    page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.doc.firstChild?.textContent);
  await expect.poll(text).toBe("  return 1;\n}");
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.undo())).toBe(true);
  await expect.poll(text).toBe("function test() {\n  return 1;\n}");
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
});

test("shift delete at the folded end removes the closing line", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='fold-shift-delete';host.style.marginTop='120px';document.body.prepend(host)
    window.foldLanguage=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript',folds:[{from:17,to:30}]},content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.foldLanguage));
  const card = page.locator("#fold-shift-delete .semlo-editor-code-card");
  await card.locator("code").click();
  await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.setTextSelection(31));
  await page.keyboard.press("Shift+Delete");
  const text = () =>
    page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.state.doc.firstChild?.textContent);
  try {
    await expect.poll(text).toBe("function test() {\n  return 1;\n");
  } catch (error) {
    throw new Error(
      "[DEBUG-fold-shift] " +
        JSON.stringify({
          text: await text(),
          selection: await page.evaluate(() =>
            window.__semloRequireFixture("foldLanguage").editor.state.selection.toJSON(),
          ),
          platform: await page.evaluate(() => navigator.platform),
        }),
      { cause: error },
    );
  }
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldLanguage").editor.commands.undo())).toBe(true);
  await expect.poll(text).toBe("function test() {\n  return 1;\n}");
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
});
