import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("CMake sample follows observed colors across themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    "cmake_minimum_required(VERSION 3.20)\nproject(Semlo)\nset(CMAKE_CXX_STANDARD 20)\nadd_executable(app main.cpp)\n";
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='cmake-probe';document.body.prepend(host)
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.cmakeProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'cmake',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
  `,
  });
  const colors = [
    ["rgb(161, 48, 0)", "rgb(38, 44, 49)", "rgb(0, 79, 180)"],
    ["rgb(161, 48, 0)", "rgb(38, 38, 38)", "rgb(0, 92, 197)"],
    ["rgb(144, 32, 204)", "rgb(54, 54, 54)", "rgb(102, 136, 0)"],
    ["rgb(235, 191, 111)", "rgb(169, 178, 192)", "rgb(218, 152, 92)"],
    ["rgb(121, 169, 255)", "rgb(212, 222, 236)", "rgb(255, 133, 99)"],
    ["rgb(255, 196, 90)", "rgb(204, 204, 204)", "rgb(113, 159, 197)"],
  ];
  const cards = page.locator("#cmake-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-definition").getByText("cmake_minimum_required", { exact: true }),
      card.locator(".semlo-editor-syntax-punctuation").getByText("(", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-number").getByText("3", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j === 0 ? "italic" : "normal");
    }
  }
});

test("large CMake falls back without changing source", () => {
  const source = "cmake_minimum_required(VERSION 3.20)\nproject(Semlo)\n".repeat(500);
  expect(highlightCodeSyntax(source, "cmake")).toBeNull();
  const root = codeLowlight.highlight("cmake", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
