import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Sass tokens use observed colors and fonts in six code themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='sass-colors';document.body.prepend(host)
      const text='$primary: #333\\n@mixin center\\n  display: flex\\n.card:hover\\n  color: $primary\\n  &:hover\\n    color: darken($primary, 10%)'
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.sassProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'sass',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#sass-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(161, 48, 0)", "rgb(38, 44, 49)", "rgb(0, 79, 180)", "rgb(161, 48, 0)", "rgb(0, 79, 180)"],
    ["rgb(0, 92, 197)", "rgb(38, 38, 38)", "rgb(153, 0, 85)", "rgb(161, 48, 0)", "rgb(34, 134, 58)"],
    ["rgb(53, 53, 53)", "rgb(54, 54, 54)", "rgb(247, 128, 0)", "rgb(144, 32, 204)", "rgb(83, 83, 83)"],
    ["rgb(240, 99, 114)", "rgb(169, 178, 192)", "rgb(218, 152, 92)", "rgb(235, 191, 111)", "rgb(29, 184, 196)"],
    ["rgb(90, 222, 202)", "rgb(212, 222, 236)", "rgb(255, 69, 113)", "rgb(121, 169, 255)", "rgb(188, 230, 102)"],
    ["rgb(204, 204, 204)", "rgb(204, 204, 204)", "rgb(165, 120, 180)", "rgb(255, 196, 90)", "rgb(255, 196, 90)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-sass-variable").getByText("$primary", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-punctuation").getByText("#333", { exact: true }),
      card.locator(".semlo-editor-syntax-atom").getByText("mixin", { exact: true }),
      card.locator(".semlo-editor-syntax-definition").getByText("flex", { exact: true }),
      card.locator(".semlo-editor-syntax-tag").getByText("color", { exact: true }).first(),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      const italic = (j === 0 && (i === 3 || i === 4)) || (i === 4 && (j === 3 || j === 4));
      await expect(token).toHaveCSS("font-style", italic ? "italic" : "normal");
    }
  }
});

test("large Sass source falls back before parsing and remains intact", () => {
  const source = "$primary: #333\n.card:hover\n  color: $primary\n".repeat(500);
  expect(highlightCodeSyntax(source, "sass")).toBeNull();
  const root = codeLowlight.highlight("sass", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
