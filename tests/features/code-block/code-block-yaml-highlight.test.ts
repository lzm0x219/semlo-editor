import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("YAML keys and scalars use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    '# app config\nname: "Semlo"\nenabled: true\ncount: 42\nitems:\n  - one\n  - two\nurl: https://example.com\n';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='yaml-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.yamlProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'yaml',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#yaml-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(0, 79, 180)", "rgb(225, 0, 35)", "rgb(0, 47, 109)"],
    ["rgb(153, 0, 85)", "rgb(31, 127, 154)", "rgb(215, 58, 73)", "rgb(102, 153, 0)"],
    ["rgb(247, 128, 0)", "rgb(53, 53, 53)", "rgb(40, 105, 201)", "rgb(247, 128, 0)"],
    ["rgb(218, 152, 92)", "rgb(29, 184, 196)", "rgb(211, 113, 227)", "rgb(139, 197, 111)"],
    ["rgb(255, 69, 113)", "rgb(188, 230, 102)", "rgb(209, 141, 240)", "rgb(243, 195, 132)"],
    ["rgb(165, 120, 180)", "rgb(204, 204, 204)", "rgb(216, 126, 48)", "rgb(98, 136, 84)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-atom").getByText("name", { exact: true }),
      card.locator(".semlo-editor-syntax-meta").first(),
      card.locator(".semlo-editor-syntax-keyword").getByText("true", { exact: true }),
      card.locator(".semlo-editor-syntax-string").getByText('"Semlo"', { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j === 2 ? "italic" : "normal");
    }
  }
});

test("large YAML falls back before parsing without changing its source", () => {
  const source = 'name: "Semlo"\nenabled: true\nitems:\n  - one\n  - two\n'.repeat(500);
  expect(highlightCodeSyntax(source, "yaml")).toBeNull();
  const root = codeLowlight.highlight("yaml", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
