import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Python definitions, properties and f-strings use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    'class User:\n    def __init__(self, name: str):\n        self.name = name\n\ndef greet(user: User) -> str:\n    message = f"Hello {user.name}"\n    print(message)  # greeting\n    return message\n';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='python-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.pythonProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'python',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#python-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(161, 48, 0)", "rgb(140, 72, 231)", "rgb(125, 89, 89)", "rgb(38, 44, 49)"],
    ["rgb(161, 48, 0)", "rgb(0, 92, 197)", "rgb(102, 153, 0)", "rgb(38, 38, 38)"],
    ["rgb(144, 32, 204)", "rgb(53, 53, 53)", "rgb(125, 89, 89)", "rgb(54, 54, 54)"],
    ["rgb(235, 191, 111)", "rgb(67, 176, 245)", "rgb(139, 197, 111)", "rgb(169, 178, 192)"],
    ["rgb(121, 169, 255)", "rgb(121, 169, 255)", "rgb(125, 89, 89)", "rgb(212, 222, 236)"],
    ["rgb(255, 196, 90)", "rgb(255, 196, 90)", "rgb(180, 85, 85)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-definition").getByText("User", { exact: true }),
      card.locator(".semlo-editor-syntax-property").getByText("name", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-special-string").getByText('f"Hello', { exact: false }),
      card.locator(".semlo-editor-syntax-punctuation").getByText("(", { exact: true }).first(),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j < 2 ? "italic" : "normal");
    }
  }
});

test("large Python falls back before parsing without changing its source", () => {
  const source = 'class User:\n    def greet(self):\n        return f"Hello {self.name}"\n'.repeat(500);
  expect(highlightCodeSyntax(source, "python")).toBeNull();
  const root = codeLowlight.highlight("python", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
