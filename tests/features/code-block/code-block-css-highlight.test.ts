import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("CSS selectors, properties and values use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    '/* card */\n.card:hover {\n  color: #ff3366;\n  display: flex;\n  padding: 12px;\n  font-family: "Inter", sans-serif;\n}';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='css-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.cssProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'css',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#css-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(161, 48, 0)", "rgb(140, 72, 231)", "rgb(38, 44, 49)", "rgb(0, 79, 180)"],
    ["rgb(161, 48, 0)", "rgb(0, 92, 197)", "rgb(38, 38, 38)", "rgb(153, 0, 85)"],
    ["rgb(144, 32, 204)", "rgb(53, 53, 53)", "rgb(54, 54, 54)", "rgb(247, 128, 0)"],
    ["rgb(235, 191, 111)", "rgb(67, 176, 245)", "rgb(169, 178, 192)", "rgb(218, 152, 92)"],
    ["rgb(121, 169, 255)", "rgb(121, 169, 255)", "rgb(212, 222, 236)", "rgb(255, 69, 113)"],
    ["rgb(255, 196, 90)", "rgb(255, 196, 90)", "rgb(204, 204, 204)", "rgb(165, 120, 180)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-definition").getByText("card", { exact: true }),
      card.locator(".semlo-editor-syntax-property").getByText("color", { exact: true }),
      card.locator(".semlo-editor-syntax-punctuation").getByText("#ff3366", { exact: true }),
      card.locator(".semlo-editor-syntax-atom").getByText("flex", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j < 2 ? "italic" : "normal");
    }
  }
});

test("large CSS falls back before parsing without changing its source", () => {
  const source = ".card:hover { color: #ff3366; display: flex; padding: 12px; }\n".repeat(500);
  expect(highlightCodeSyntax(source, "css")).toBeNull();
  const root = codeLowlight.highlight("css", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
