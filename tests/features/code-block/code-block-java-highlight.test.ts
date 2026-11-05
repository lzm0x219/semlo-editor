import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Java modifiers, definitions and types use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    '// greeting\npublic class User {\n  private final String name;\n  public User(String name) { this.name = name; }\n  public String greet() { return "Hello " + name; }\n}';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='java-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.javaProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'java',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#java-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(225, 0, 35)", "rgb(161, 48, 0)", "rgb(0, 79, 180)", "rgb(38, 44, 49)"],
    ["rgb(215, 58, 73)", "rgb(161, 48, 0)", "rgb(34, 134, 58)", "rgb(38, 38, 38)"],
    ["rgb(40, 105, 201)", "rgb(144, 32, 204)", "rgb(83, 83, 83)", "rgb(54, 54, 54)"],
    ["rgb(211, 113, 227)", "rgb(235, 191, 111)", "rgb(29, 184, 196)", "rgb(169, 178, 192)"],
    ["rgb(209, 141, 240)", "rgb(121, 169, 255)", "rgb(188, 230, 102)", "rgb(212, 222, 236)"],
    ["rgb(216, 126, 48)", "rgb(255, 196, 90)", "rgb(255, 196, 90)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-keyword").getByText("public", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-definition").getByText("User", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-type").getByText("String", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-punctuation").getByText("{", { exact: true }).first(),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j < 3 ? "italic" : "normal");
    }
    await expect(card.locator(".semlo-editor-syntax-keyword").getByText("this", { exact: true })).toHaveCSS(
      "color",
      colors[i][0],
    );
  }
});

test("large Java falls back before parsing without changing its source", () => {
  const source =
    'public class User { private final String name; public String greet() { return "Hello " + name; } }\n'.repeat(500);
  expect(highlightCodeSyntax(source, "java")).toBeNull();
  const root = codeLowlight.highlight("java", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
