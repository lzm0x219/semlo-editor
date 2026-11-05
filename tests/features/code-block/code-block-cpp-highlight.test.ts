import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("C++ preprocessor, types and definitions use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    '#include <iostream>\nstruct User { std::string name; };\nint main() {\n  const User user{"Ada"};\n  std::cout << user.name << std::endl; // greeting\n  return 0;\n}';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='cpp-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.cppProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'cpp',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#cpp-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(125, 89, 89)", "rgb(0, 79, 180)", "rgb(161, 48, 0)"],
    ["rgb(31, 127, 154)", "rgb(102, 153, 0)", "rgb(34, 134, 58)", "rgb(161, 48, 0)"],
    ["rgb(53, 53, 53)", "rgb(125, 89, 89)", "rgb(83, 83, 83)", "rgb(144, 32, 204)"],
    ["rgb(29, 184, 196)", "rgb(139, 197, 111)", "rgb(29, 184, 196)", "rgb(235, 191, 111)"],
    ["rgb(188, 230, 102)", "rgb(125, 89, 89)", "rgb(188, 230, 102)", "rgb(121, 169, 255)"],
    ["rgb(204, 204, 204)", "rgb(180, 85, 85)", "rgb(255, 196, 90)", "rgb(255, 196, 90)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-meta").getByText("#include", { exact: true }),
      card.locator(".semlo-editor-syntax-special-string").getByText("<iostream>", { exact: true }),
      card.locator(".semlo-editor-syntax-type").getByText("User", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-definition").getByText("main", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j >= 2 ? "italic" : "normal");
    }
  }
});

test("large C++ falls back before parsing without changing its source", () => {
  const source = '#include <iostream>\nint main() { std::cout << "Hello"; return 0; }\n'.repeat(500);
  expect(highlightCodeSyntax(source, "cpp")).toBeNull();
  const root = codeLowlight.highlight("cpp", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
