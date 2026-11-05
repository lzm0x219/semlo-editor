import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("JavaScript definitions, properties and punctuation use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    "// User greeting\nconst person = { name: 'Ada', active: true };\nfunction greet({name}) {\n  const pattern = /hello/i;\n  return person.name + name;\n}\nconsole.log(greet(person));";
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='javascript-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.javascriptProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'javascript',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#javascript-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(161, 48, 0)", "rgb(140, 72, 231)", "rgb(38, 44, 49)", "rgb(125, 89, 89)"],
    ["rgb(161, 48, 0)", "rgb(0, 92, 197)", "rgb(38, 38, 38)", "rgb(102, 153, 0)"],
    ["rgb(144, 32, 204)", "rgb(53, 53, 53)", "rgb(54, 54, 54)", "rgb(125, 89, 89)"],
    ["rgb(235, 191, 111)", "rgb(67, 176, 245)", "rgb(169, 178, 192)", "rgb(139, 197, 111)"],
    ["rgb(121, 169, 255)", "rgb(121, 169, 255)", "rgb(212, 222, 236)", "rgb(125, 89, 89)"],
    ["rgb(255, 196, 90)", "rgb(255, 196, 90)", "rgb(204, 204, 204)", "rgb(180, 85, 85)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-definition").getByText("person", { exact: true }),
      card.locator(".semlo-editor-syntax-property").getByText("name", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-punctuation").getByText("{", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-regex").getByText("/hello/i", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j < 2 ? "italic" : "normal");
    }
  }
});

test("large JavaScript falls back before parsing without changing its source", () => {
  const source = "const person = { name: 'Ada' }; function greet() { return person.name; }\n".repeat(500);
  expect(highlightCodeSyntax(source, "javascript")).toBeNull();
  const root = codeLowlight.highlight("javascript", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
