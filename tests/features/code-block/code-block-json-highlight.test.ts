import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("JSON tokens use observed colors in six code themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = '{\n  "name": "Ada",\n  "active": true,\n  "count": 42,\n  "meta": null,\n  "tags": ["a", "b"]\n}';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='json-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.jsonProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'json',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#json-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(140, 72, 231)", "rgb(0, 47, 109)", "rgb(38, 44, 49)", "rgb(225, 0, 35)"],
    ["rgb(0, 92, 197)", "rgb(102, 153, 0)", "rgb(38, 38, 38)", "rgb(215, 58, 73)"],
    ["rgb(53, 53, 53)", "rgb(247, 128, 0)", "rgb(54, 54, 54)", "rgb(40, 105, 201)"],
    ["rgb(67, 176, 245)", "rgb(139, 197, 111)", "rgb(169, 178, 192)", "rgb(211, 113, 227)"],
    ["rgb(121, 169, 255)", "rgb(243, 195, 132)", "rgb(212, 222, 236)", "rgb(209, 141, 240)"],
    ["rgb(255, 196, 90)", "rgb(98, 136, 84)", "rgb(204, 204, 204)", "rgb(216, 126, 48)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-property").getByText('"name"', { exact: true }),
      card.locator(".semlo-editor-syntax-string").getByText('"Ada"', { exact: true }),
      card.locator(".semlo-editor-syntax-punctuation").getByText("{", { exact: true }),
      card.locator(".semlo-editor-syntax-keyword").getByText("null", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && (j === 0 || j === 3) ? "italic" : "normal");
    }
    await expect(card.locator(".semlo-editor-syntax-bool").getByText("true", { exact: true })).toHaveCSS(
      "color",
      colors[i][2],
    );
  }
});

test("large JSON falls back before parsing without changing its source", () => {
  const source = `[${'{"name":"Ada","active":true,"count":42},'.repeat(500)}null]`;
  expect(highlightCodeSyntax(source, "json")).toBeNull();
  const root = codeLowlight.highlight("json", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
