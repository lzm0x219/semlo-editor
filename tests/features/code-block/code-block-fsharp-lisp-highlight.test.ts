import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("F# and Lisp samples use observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const inputs = [
    ["fsharp", "let square x = x * x"],
    ["lisp", "(defun add (a b) (+ a b))"],
  ];
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='fsharp-lisp-probe';document.body.prepend(host)
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    const inputs=${JSON.stringify(inputs)}
    window.fsharpLispProbe=createEditor({element:host,outline:false,content:{type:'doc',content:inputs.flatMap(([language,text])=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text}]})))}})
  `,
  });
  const colors = [
    ["rgb(225, 0, 35)", "rgb(35, 41, 48)", "rgb(225, 0, 35)", "rgb(38, 44, 49)"],
    ["rgb(215, 58, 73)", "rgb(35, 41, 48)", "rgb(225, 0, 35)", "rgb(38, 38, 38)"],
    ["rgb(40, 105, 201)", "rgb(53, 53, 53)", "rgb(40, 105, 201)", "rgb(54, 54, 54)"],
    ["rgb(211, 113, 227)", "rgb(240, 99, 114)", "rgb(29, 184, 196)", "rgb(169, 178, 192)"],
    ["rgb(209, 141, 240)", "rgb(90, 222, 202)", "rgb(209, 141, 240)", "rgb(212, 222, 236)"],
    ["rgb(216, 126, 48)", "rgb(204, 204, 204)", "rgb(204, 204, 204)", "rgb(204, 204, 204)"],
  ];
  const cards = page.locator("#fsharp-lisp-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(12);
  for (let i = 0; i < 12; i++) {
    const card = cards.nth(i),
      theme = i % 6,
      fsharp = i < 6;
    const tokens = [
      card.locator(".semlo-editor-syntax-keyword").getByText(fsharp ? "let" : "defun", { exact: true }),
      card.locator(".semlo-editor-syntax-variable").getByText(fsharp ? "square" : "add", { exact: true }),
      card
        .locator(fsharp ? ".semlo-editor-syntax-operator" : ".semlo-editor-syntax-punctuation")
        .getByText(fsharp ? "=" : "(", { exact: true })
        .first(),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[theme][j === 2 && !fsharp ? 3 : j]);
      await expect(token).toHaveCSS("font-style", theme === 4 && j < 2 ? "italic" : "normal");
    }
  }
});

test("large F# and Lisp fall back without changing source", () => {
  for (const language of ["fsharp", "lisp"] as const) {
    const source = "(defun add (a b) (+ a b))\n".repeat(500);
    expect(highlightCodeSyntax(source, language)).toBeNull();
    const root = codeLowlight.highlight(language, source);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});
