import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("HTML and embedded CSS/JavaScript use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    '<!doctype html>\n<div class="card" data-id="42">Hello <strong>world</strong></div>\n<style>.card { color: red; }</style>\n<script>const name = "Ada"; console.log(name);</script>';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='html-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.htmlProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'html',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#html-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(0, 79, 180)", "rgb(0, 79, 180)", "rgb(0, 47, 109)", "rgb(161, 48, 0)", "rgb(0, 79, 180)"],
    [
      "rgb(31, 127, 154)",
      "rgb(34, 134, 58)",
      "rgb(111, 66, 193)",
      "rgb(102, 153, 0)",
      "rgb(161, 48, 0)",
      "rgb(153, 0, 85)",
    ],
    [
      "rgb(53, 53, 53)",
      "rgb(83, 83, 83)",
      "rgb(102, 136, 0)",
      "rgb(247, 128, 0)",
      "rgb(144, 32, 204)",
      "rgb(247, 128, 0)",
    ],
    [
      "rgb(29, 184, 196)",
      "rgb(29, 184, 196)",
      "rgb(218, 152, 92)",
      "rgb(139, 197, 111)",
      "rgb(235, 191, 111)",
      "rgb(218, 152, 92)",
    ],
    [
      "rgb(188, 230, 102)",
      "rgb(188, 230, 102)",
      "rgb(188, 230, 102)",
      "rgb(243, 195, 132)",
      "rgb(121, 169, 255)",
      "rgb(255, 69, 113)",
    ],
    [
      "rgb(204, 204, 204)",
      "rgb(255, 196, 90)",
      "rgb(204, 204, 204)",
      "rgb(98, 136, 84)",
      "rgb(255, 196, 90)",
      "rgb(165, 120, 180)",
    ],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-meta").getByText("<!doctype html>", { exact: true }),
      card.locator(".semlo-editor-syntax-tag").getByText("div", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-attribute").getByText("class", { exact: true }),
      card.locator(".semlo-editor-syntax-string").getByText('"card"', { exact: true }),
      card.locator(".semlo-editor-syntax-definition").getByText("card", { exact: true }),
      card.locator(".semlo-editor-syntax-atom").getByText("red", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && (j === 1 || j === 2 || j === 4) ? "italic" : "normal");
    }
    await expect(card.locator(".semlo-editor-syntax-definition").getByText("name", { exact: true })).toHaveCSS(
      "color",
      colors[i][4],
    );
  }
});

test("large HTML falls back before parsing without changing its source", () => {
  const source = '<div class="card"><strong>Hello</strong></div>\n'.repeat(500);
  expect(highlightCodeSyntax(source, "html")).toBeNull();
  const root = codeLowlight.highlight("html", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
