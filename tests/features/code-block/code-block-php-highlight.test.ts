import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("tagged and untagged PHP use observed grammar and theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const code = 'class User { public function greet(string $name): string { return "Hello $name"; } }';
  const values = [`<?php\n${code}`, code];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='php-colors';document.body.prepend(host)
      const values=${JSON.stringify(values)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.phpProbe=createEditor({element:host,outline:false,content:{type:'doc',content:values.flatMap(text=>themes.map(theme=>({type:'codeBlock',attrs:{language:'php',theme},content:[{type:'text',text}]})))}})
    `,
  });
  const cards = page.locator("#php-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(225, 0, 35)", "rgb(0, 79, 180)", "rgb(35, 41, 48)", "rgb(0, 47, 109)", "rgb(161, 48, 0)"],
    ["rgb(215, 58, 73)", "rgb(34, 134, 58)", "rgb(35, 41, 48)", "rgb(102, 153, 0)", "rgb(161, 48, 0)"],
    ["rgb(40, 105, 201)", "rgb(83, 83, 83)", "rgb(53, 53, 53)", "rgb(247, 128, 0)", "rgb(144, 32, 204)"],
    ["rgb(211, 113, 227)", "rgb(29, 184, 196)", "rgb(240, 99, 114)", "rgb(139, 197, 111)", "rgb(235, 191, 111)"],
    ["rgb(209, 141, 240)", "rgb(188, 230, 102)", "rgb(90, 222, 202)", "rgb(243, 195, 132)", "rgb(121, 169, 255)"],
    ["rgb(216, 126, 48)", "rgb(255, 196, 90)", "rgb(204, 204, 204)", "rgb(98, 136, 84)", "rgb(255, 196, 90)"],
  ];
  await expect(cards).toHaveCount(12);
  for (let i = 0; i < 12; i++) {
    const card = cards.nth(i),
      theme = i % 6;
    const tokens = [
      card.locator(".semlo-editor-syntax-keyword").getByText("public", { exact: true }),
      card.locator(".semlo-editor-syntax-type").getByText("string", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-variable").getByText("$name", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-string").getByText('"Hello', { exact: false }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[theme][j]);
      await expect(token).toHaveCSS("font-style", theme === 4 && j < 3 ? "italic" : "normal");
    }
    const classKeyword = card.locator(".semlo-editor-syntax-keyword").getByText("class", { exact: true });
    if (i < 6) await expect(classKeyword).toHaveCount(0);
    else {
      await expect(classKeyword).toHaveCount(1);
      await expect(card.locator(".semlo-editor-syntax-definition").getByText("User", { exact: true })).toHaveCSS(
        "color",
        colors[theme][4],
      );
    }
  }
});

test("large PHP falls back before parsing without changing its source", () => {
  const source = 'function greet(string $name): string { return "Hello $name"; }\n'.repeat(500);
  expect(highlightCodeSyntax(source, "php")).toBeNull();
  const root = codeLowlight.highlight("php", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
