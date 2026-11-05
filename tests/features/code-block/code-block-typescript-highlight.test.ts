import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("TypeScript types and definitions use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    "interface User { name: string; active: boolean }\ntype Result<T> = { data: T };\nconst user: User = { name: 'Ada', active: true };\nfunction greet(person: User): string { return person.name; }";
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='typescript-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.typescriptProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'typescript',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#typescript-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(140, 72, 231)", "rgb(161, 48, 0)", "rgb(38, 44, 49)"],
    ["rgb(34, 134, 58)", "rgb(0, 92, 197)", "rgb(161, 48, 0)", "rgb(38, 38, 38)"],
    ["rgb(83, 83, 83)", "rgb(53, 53, 53)", "rgb(144, 32, 204)", "rgb(54, 54, 54)"],
    ["rgb(29, 184, 196)", "rgb(67, 176, 245)", "rgb(235, 191, 111)", "rgb(169, 178, 192)"],
    ["rgb(188, 230, 102)", "rgb(121, 169, 255)", "rgb(121, 169, 255)", "rgb(212, 222, 236)"],
    ["rgb(255, 196, 90)", "rgb(255, 196, 90)", "rgb(255, 196, 90)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-type").getByText("User", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-property").getByText("name", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-definition").getByText("user", { exact: true }),
      card.locator(".semlo-editor-syntax-punctuation").getByText("{", { exact: true }).first(),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j < 3 ? "italic" : "normal");
    }
  }
});

test("large TypeScript falls back before parsing without changing its source", () => {
  const source = "interface User { name: string }; const user: User = { name: 'Ada' };\n".repeat(500);
  expect(highlightCodeSyntax(source, "typescript")).toBeNull();
  const root = codeLowlight.highlight("typescript", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
