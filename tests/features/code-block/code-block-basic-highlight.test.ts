import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Basic tokens use the observed VBScript colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = '10 REM greeting\n20 INPUT X\n30 IF X = 3 THEN PRINT "OK"\n40 GOTO 10\n50 DIM A(5)\n60 LET A = 42\n';
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='basic-probe';document.body.prepend(host)
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.basicProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'basic',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
  `,
  });
  const colors = [
    [
      "rgb(0, 79, 180)",
      "rgb(108, 119, 130)",
      "rgb(35, 41, 48)",
      "rgb(225, 0, 35)",
      "rgb(225, 0, 35)",
      "rgb(0, 47, 109)",
      "rgb(38, 44, 49)",
    ],
    [
      "rgb(0, 92, 197)",
      "rgb(106, 115, 125)",
      "rgb(35, 41, 48)",
      "rgb(215, 58, 73)",
      "rgb(225, 0, 35)",
      "rgb(102, 153, 0)",
      "rgb(38, 38, 38)",
    ],
    [
      "rgb(102, 136, 0)",
      "rgb(0, 169, 97)",
      "rgb(53, 53, 53)",
      "rgb(40, 105, 201)",
      "rgb(40, 105, 201)",
      "rgb(247, 128, 0)",
      "rgb(54, 54, 54)",
    ],
    [
      "rgb(218, 152, 92)",
      "rgb(126, 132, 143)",
      "rgb(240, 99, 114)",
      "rgb(211, 113, 227)",
      "rgb(29, 184, 196)",
      "rgb(139, 197, 111)",
      "rgb(169, 178, 192)",
    ],
    [
      "rgb(255, 133, 99)",
      "rgb(94, 120, 119)",
      "rgb(90, 222, 202)",
      "rgb(209, 141, 240)",
      "rgb(209, 141, 240)",
      "rgb(243, 195, 132)",
      "rgb(212, 222, 236)",
    ],
    [
      "rgb(113, 159, 197)",
      "rgb(112, 112, 112)",
      "rgb(204, 204, 204)",
      "rgb(216, 126, 48)",
      "rgb(204, 204, 204)",
      "rgb(98, 136, 84)",
      "rgb(204, 204, 204)",
    ],
  ];
  const cards = page.locator("#basic-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      [".semlo-editor-syntax-number", "10"],
      [".semlo-editor-syntax-comment", "REM greeting"],
      [".semlo-editor-syntax-variable", "INPUT"],
      [".semlo-editor-syntax-keyword", "IF"],
      [".semlo-editor-syntax-operator", "="],
      [".semlo-editor-syntax-string", '"OK"'],
      [".semlo-editor-syntax-punctuation", "("],
    ];
    for (const [index, [selector, value]] of tokens.entries()) {
      const token = card.locator(selector).getByText(value, { exact: true }).first();
      await expect(token).toHaveCSS("color", colors[i][index]);
      await expect(token).toHaveCSS("font-style", i === 4 && (index === 2 || index === 3) ? "italic" : "normal");
    }
    for (const value of ["PRINT", "GOTO"]) {
      await expect(card.locator(".semlo-editor-syntax-variable").getByText(value, { exact: true })).toHaveCSS(
        "color",
        colors[i][2],
      );
    }
  }
});

test("large Basic input falls back without altering source", () => {
  const source = "10 PRINT 42\n".repeat(1500);
  expect(highlightCodeSyntax(source, "basic")).toBeNull();
  const root = codeLowlight.highlight("basic", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
