import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Go tokens use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    'package main\n\nimport "fmt"\n\ntype User struct { Name string }\n\nfunc main() {\n  user := User{Name: "Ada"}\n  fmt.Println(user.Name) // greeting\n}';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='go-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.goProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'go',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#go-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(225, 0, 35)", "rgb(35, 41, 48)", "rgb(0, 47, 109)", "rgb(0, 79, 180)"],
    ["rgb(215, 58, 73)", "rgb(35, 41, 48)", "rgb(102, 153, 0)", "rgb(0, 92, 197)"],
    ["rgb(40, 105, 201)", "rgb(53, 53, 53)", "rgb(247, 128, 0)", "rgb(102, 136, 0)"],
    ["rgb(211, 113, 227)", "rgb(240, 99, 114)", "rgb(139, 197, 111)", "rgb(218, 152, 92)"],
    ["rgb(209, 141, 240)", "rgb(90, 222, 202)", "rgb(243, 195, 132)", "rgb(255, 133, 99)"],
    ["rgb(216, 126, 48)", "rgb(204, 204, 204)", "rgb(98, 136, 84)", "rgb(113, 159, 197)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-keyword").getByText("package", { exact: true }),
      card.locator(".semlo-editor-syntax-variable").getByText("main", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-string").getByText('"fmt"', { exact: true }),
      card.locator(".semlo-editor-syntax-number").getByText(".", { exact: true }).first(),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j < 2 ? "italic" : "normal");
    }
  }
});

test("dense Go source falls back without changing its text", () => {
  const source = 'package main\nfunc main() { user := User{Name: "Ada"}; fmt.Println(user.Name) }\n'.repeat(1000);
  expect(highlightCodeSyntax(source, "go")).toBeNull();
  const root = codeLowlight.highlight("go", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
