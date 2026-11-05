import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    jsxProbe?: EditorController;
  }
}

test("JSX expression tokens use the observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='jsx-probe';document.body.prepend(host)
    const text='const App = () => <div className="box">Hello {name}</div>;'
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.jsxProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'jsx',theme},content:[{type:'text',text}]}))}})
  `,
  });
  const cards = page.locator("#jsx-probe .semlo-editor-code-card");
  const colors = [
    ["rgb(35, 41, 48)", "rgb(0, 79, 180)"],
    ["rgb(35, 41, 48)", "rgb(111, 66, 193)"],
    ["rgb(53, 53, 53)", "rgb(102, 136, 0)"],
    ["rgb(240, 99, 114)", "rgb(218, 152, 92)"],
    ["rgb(90, 222, 202)", "rgb(188, 230, 102)"],
    ["rgb(204, 204, 204)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(colors.length);
  for (let i = 0; i < colors.length; i++) {
    const card = cards.nth(i);
    await expect(card.locator(".semlo-editor-syntax-variable").getByText("name", { exact: true })).toHaveCSS(
      "color",
      colors[i][0],
    );
    await expect(card.locator(".semlo-editor-syntax-attribute").getByText("className", { exact: true })).toHaveCSS(
      "color",
      colors[i][1],
    );
    for (const selector of [
      ".semlo-editor-syntax-keyword",
      ".semlo-editor-syntax-definition",
      ".semlo-editor-syntax-variable",
      ".semlo-editor-syntax-tag",
      ".semlo-editor-syntax-attribute",
    ]) {
      await expect(card.locator(selector).first()).toHaveCSS("font-style", i === 4 ? "italic" : "normal");
    }
  }
});

test("TSX retains nested expressions and source text", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='tsx-probe';document.body.prepend(host)
    const text='const App = ({name}: Props) => <div>{name.toUpperCase()}</div>;'
    window.jsxProbe=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'tsx',theme:'dark'},content:[{type:'text',text}]}]}})
  `,
  });
  const code = page.locator("#tsx-probe code");
  await expect(code).toHaveText("const App = ({name}: Props) => <div>{name.toUpperCase()}</div>;");
  await expect(code.locator(".semlo-editor-syntax-variable").getByText("name", { exact: true })).toHaveCount(1);
  await expect(code.locator(".semlo-editor-syntax-property").getByText("name", { exact: true })).toHaveCSS(
    "color",
    "rgb(67, 176, 245)",
  );
  await expect(code.locator(".semlo-editor-syntax-type").getByText("Props", { exact: true })).toHaveCSS(
    "color",
    "rgb(29, 184, 196)",
  );
});

test("JSX component attributes and nested expressions follow Yuque tokens", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='nested-jsx';document.body.prepend(host)
    window.jsxProbe=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'jsx',theme:'dark'},content:[{type:'text',text:'const A = () => <Widget value={data.name}>{ok ? <span>YES</span> : null}</Widget>;'}]}]}})
  `,
  });
  const code = page.locator("#nested-jsx code");
  await expect(code.locator(".semlo-editor-syntax-tag").getByText("Widget", { exact: true })).toHaveCount(2);
  await expect(code.locator(".semlo-editor-syntax-attribute").getByText("value", { exact: true })).toHaveCSS(
    "color",
    "rgb(218, 152, 92)",
  );
  await expect(code.locator(".semlo-editor-syntax-variable").getByText("data", { exact: true })).toHaveCSS(
    "color",
    "rgb(240, 99, 114)",
  );
  await expect(code.locator(".semlo-editor-syntax-property").getByText("name", { exact: true })).toHaveCSS(
    "color",
    "rgb(67, 176, 245)",
  );
  await expect(code.locator(".semlo-editor-syntax-keyword").getByText("null", { exact: true })).toHaveCSS(
    "color",
    "rgb(211, 113, 227)",
  );
});

test("editing, folding, and undo preserve JSX expressions", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='edit-jsx';document.body.prepend(host)
    window.jsxProbe=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'jsx',theme:'dark'},content:[{type:'text',text:'function App() {\\n  return <div>{name}</div>;\\n}'}]}]}})
  `,
  });
  const card = page.locator("#edit-jsx .semlo-editor-code-card");
  await expect(card.locator(".semlo-editor-syntax-variable").getByText("name", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("jsxProbe").editor;
    const text = editor.state.doc.firstChild!.textContent;
    editor.view.focus();
    editor.commands.setTextSelection(text.indexOf("name") + 5);
  });
  await page.keyboard.type("X");
  await expect(card.locator(".semlo-editor-syntax-variable").getByText("nameX", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  await page.getByRole("button", { name: "展开第 1 行代码" }).click();
  await expect(card.locator(".semlo-editor-syntax-variable").getByText("nameX", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("jsxProbe").editor.commands.undo());
  await expect(card.locator(".semlo-editor-syntax-variable").getByText("name", { exact: true })).toBeVisible();
});

test("JSX literals, regex, and comments use observed colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='jsx-literals';document.body.prepend(host)
    const text='const n = 42; const el = <div disabled={true}>Hi</div>; // note\\nconst regex = /abc/g;'
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.jsxProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'jsx',theme},content:[{type:'text',text}]}))}})
  `,
  });
  const cards = page.locator("#jsx-literals .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(38, 44, 49)", "rgb(108, 119, 130)", "rgb(125, 89, 89)"],
    ["rgb(0, 92, 197)", "rgb(38, 38, 38)", "rgb(106, 115, 125)", "rgb(102, 153, 0)"],
    ["rgb(102, 136, 0)", "rgb(54, 54, 54)", "rgb(0, 169, 97)", "rgb(125, 89, 89)"],
    ["rgb(218, 152, 92)", "rgb(169, 178, 192)", "rgb(126, 132, 143)", "rgb(139, 197, 111)"],
    ["rgb(255, 133, 99)", "rgb(212, 222, 236)", "rgb(94, 120, 119)", "rgb(125, 89, 89)"],
    ["rgb(113, 159, 197)", "rgb(204, 204, 204)", "rgb(112, 112, 112)", "rgb(180, 85, 85)"],
  ];
  const selectors = [
    ".semlo-editor-syntax-number",
    ".semlo-editor-syntax-bool",
    ".semlo-editor-syntax-comment",
    ".semlo-editor-syntax-regex",
  ];
  for (let i = 0; i < colors.length; i++)
    for (let j = 0; j < selectors.length; j++) {
      const token = cards.nth(i).locator(selectors[j]);
      await expect(token).toHaveCSS("color", colors[i][j]);
      if (j === 2) await expect(token).toHaveCSS("font-style", "normal");
    }
});

test("JSX event callbacks retain expression and attribute colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='jsx-event';document.body.prepend(host)
      const text='const App = () => <button onClick={() => setN(n + 1)} disabled={n === 0}>+</button>;'
      window.jsxProbe=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'jsx',theme:'dark'},content:[{type:'text',text}]}]}})
    `,
  });
  const code = page.locator("#jsx-event code");
  await expect(code.locator(".semlo-editor-syntax-attribute").getByText("onClick", { exact: true })).toHaveCSS(
    "color",
    "rgb(218, 152, 92)",
  );
  await expect(code.locator(".semlo-editor-syntax-variable").getByText("setN", { exact: true })).toHaveCSS(
    "color",
    "rgb(240, 99, 114)",
  );
  await expect(code.locator(".semlo-editor-syntax-operator").getByText("===", { exact: true })).toHaveCSS(
    "color",
    "rgb(29, 184, 196)",
  );
});

test("Night Owl italicizes TSX properties and types but not punctuation", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='tsx-night';document.body.prepend(host)
    const text='const App = ({name}: Props) => <div>{name.toUpperCase()}</div>;'
    window.jsxProbe=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'tsx',theme:'night-owl'},content:[{type:'text',text}]}]}})
  `,
  });
  const code = page.locator("#tsx-night code");
  await expect(code.locator(".semlo-editor-syntax-property").getByText("toUpperCase", { exact: true })).toHaveCSS(
    "font-style",
    "italic",
  );
  await expect(code.locator(".semlo-editor-syntax-type").getByText("Props", { exact: true })).toHaveCSS(
    "font-style",
    "italic",
  );
  await expect(code.locator(".semlo-editor-syntax-operator").first()).toHaveCSS("font-style", "normal");
});
