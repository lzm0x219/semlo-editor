import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("ArkTS type, variable and property colors match the observed sample", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='arkts-probe';document.body.prepend(host)
    const text='let value: number = 42; console.log(value);'
    window.arktsProbe=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'arkts',theme:'dark'},content:[{type:'text',text}]}]}})
  `,
  });
  const code = page.locator("#arkts-probe code");
  await expect(code.locator(".semlo-editor-syntax-keyword").getByText("let", { exact: true })).toHaveCSS(
    "color",
    "rgb(211, 113, 227)",
  );
  await expect(code.locator(".semlo-editor-syntax-definition").getByText("value", { exact: true })).toHaveCSS(
    "color",
    "rgb(235, 191, 111)",
  );
  await expect(code.locator(".semlo-editor-syntax-type").getByText("number", { exact: true })).toHaveCSS(
    "color",
    "rgb(29, 184, 196)",
  );
  await expect(code.locator(".semlo-editor-syntax-number").getByText("42", { exact: true })).toHaveCSS(
    "color",
    "rgb(218, 152, 92)",
  );
  await expect(code.locator(".semlo-editor-syntax-variable").getByText("console", { exact: true })).toHaveCSS(
    "color",
    "rgb(240, 99, 114)",
  );
  await expect(code.locator(".semlo-editor-syntax-property").getByText("log", { exact: true })).toHaveCSS(
    "color",
    "rgb(67, 176, 245)",
  );
});

test("ArkTS generic syntax remains TypeScript rather than JSX", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='arkts-generic';document.body.prepend(host)
    const text='const id = <T>(x: T): T => x;'
    window.arktsProbe=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'arkts',theme:'dark'},content:[{type:'text',text}]}]}})
  `,
  });
  const code = page.locator("#arkts-generic code");
  await expect(code).toHaveText("const id = <T>(x: T): T => x;");
  await expect(code.locator(".semlo-editor-syntax-type").getByText("T", { exact: true })).toHaveCount(3);
  await expect(code.locator(".semlo-editor-syntax-definition").getByText("x", { exact: true })).toHaveCount(1);
  await expect(code.locator(".semlo-editor-syntax-variable").getByText("x", { exact: true })).toHaveCount(1);
});

test("shorthand properties and destructured aliases keep their observed colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='binding-probe';document.body.prepend(host)
    const text='const { name: alias, age } = user;'
    window.arktsProbe=createEditor({element:host,outline:false,content:{type:'doc',content:['jsx','tsx','arkts'].map(language=>({type:'codeBlock',attrs:{language,theme:'dark'},content:[{type:'text',text}]}))}})
  `,
  });
  const cards = page.locator("#binding-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const code = cards.nth(i).locator("code");
    await expect(code.locator(".semlo-editor-syntax-property").getByText("name", { exact: true })).toHaveCSS(
      "color",
      "rgb(67, 176, 245)",
    );
    await expect(code.locator(".semlo-editor-syntax-definition").getByText("alias", { exact: true })).toHaveCSS(
      "color",
      "rgb(235, 191, 111)",
    );
    await expect(code.locator(".semlo-editor-syntax-property").getByText("age", { exact: true })).toHaveCSS(
      "color",
      "rgb(67, 176, 245)",
    );
  }
});
