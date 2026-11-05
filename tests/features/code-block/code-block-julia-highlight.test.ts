import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Julia sample follows observed colors across themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = 'function greet(name)\n  println("Hello, $name") # hi\nend\n';
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='julia-probe';document.body.prepend(host)
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.juliaProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'julia',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
  `,
  });
  const colors = [
    ["rgb(225, 0, 35)", "rgb(161, 48, 0)", "rgb(35, 41, 48)", "rgb(0, 47, 109)"],
    ["rgb(215, 58, 73)", "rgb(161, 48, 0)", "rgb(35, 41, 48)", "rgb(102, 153, 0)"],
    ["rgb(40, 105, 201)", "rgb(144, 32, 204)", "rgb(53, 53, 53)", "rgb(247, 128, 0)"],
    ["rgb(211, 113, 227)", "rgb(235, 191, 111)", "rgb(240, 99, 114)", "rgb(139, 197, 111)"],
    ["rgb(209, 141, 240)", "rgb(121, 169, 255)", "rgb(90, 222, 202)", "rgb(243, 195, 132)"],
    ["rgb(216, 126, 48)", "rgb(255, 196, 90)", "rgb(204, 204, 204)", "rgb(98, 136, 84)"],
  ];
  const cards = page.locator("#julia-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-keyword").getByText("function", { exact: true }),
      card.locator(".semlo-editor-syntax-definition").getByText("greet", { exact: true }),
      card.locator(".semlo-editor-syntax-variable").getByText("name", { exact: true }),
      card.locator(".semlo-editor-syntax-string").getByText('"Hello, $name"', { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j !== 3 ? "italic" : "normal");
    }
  }
});

test("large Julia falls back without changing source", () => {
  const source = 'function greet(name)\n  println("Hello, $name") # hi\nend\n'.repeat(500);
  expect(highlightCodeSyntax(source, "julia")).toBeNull();
  const root = codeLowlight.highlight("julia", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
