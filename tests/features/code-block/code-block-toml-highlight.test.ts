import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("TOML sections, keys and values use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    '# settings\n[package]\nname = "semlo"\nversion = "1.0"\nenabled = true\ncount = 42\nfeatures = ["editor", "code"]\n';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='toml-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.tomlProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'toml',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#toml-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(140, 72, 231)", "rgb(0, 47, 109)", "rgb(38, 44, 49)"],
    ["rgb(153, 0, 85)", "rgb(0, 92, 197)", "rgb(102, 153, 0)", "rgb(38, 38, 38)"],
    ["rgb(247, 128, 0)", "rgb(53, 53, 53)", "rgb(247, 128, 0)", "rgb(54, 54, 54)"],
    ["rgb(218, 152, 92)", "rgb(67, 176, 245)", "rgb(139, 197, 111)", "rgb(169, 178, 192)"],
    ["rgb(255, 69, 113)", "rgb(121, 169, 255)", "rgb(243, 195, 132)", "rgb(212, 222, 236)"],
    ["rgb(165, 120, 180)", "rgb(255, 196, 90)", "rgb(98, 136, 84)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-atom").getByText("[package]", { exact: true }),
      card.locator(".semlo-editor-syntax-property").getByText("name", { exact: true }),
      card.locator(".semlo-editor-syntax-string").getByText('"semlo"', { exact: true }),
      card.locator(".semlo-editor-syntax-punctuation").getByText("[", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j === 1 ? "italic" : "normal");
    }
  }
});

test("large TOML falls back before parsing without changing its source", () => {
  const source = '[package]\nname = "semlo"\nenabled = true\ncount = 42\n'.repeat(500);
  expect(highlightCodeSyntax(source, "toml")).toBeNull();
  const root = codeLowlight.highlight("toml", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
