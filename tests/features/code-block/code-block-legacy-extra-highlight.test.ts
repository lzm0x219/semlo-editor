import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Erlang and Fortran use observed token colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const inputs = [
    [
      "erlang",
      '-module(greeting).\n-export([hello/1]).\nhello(Name) ->\n    io:format("Hello ~s~n", [Name]). % greeting\n',
    ],
    [
      "fortran",
      'program hello\n  implicit none\n  character(len=20) :: name\n  name = "Ada"\n  print *, "Hello ", name ! greeting\nend program hello\n',
    ],
  ];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='legacy-extra-colors';document.body.prepend(host)
      const inputs=${JSON.stringify(inputs)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.legacyExtraProbe=createEditor({element:host,outline:false,content:{type:'doc',content:inputs.flatMap(([language,text])=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text}]})))}})
    `,
  });
  const cards = page.locator("#legacy-extra-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(35, 41, 48)", "rgb(0, 47, 109)", "rgb(0, 79, 180)", "rgb(225, 0, 35)"],
    ["rgb(35, 41, 48)", "rgb(102, 153, 0)", "rgb(111, 66, 193)", "rgb(215, 58, 73)"],
    ["rgb(53, 53, 53)", "rgb(247, 128, 0)", "rgb(102, 136, 0)", "rgb(40, 105, 201)"],
    ["rgb(240, 99, 114)", "rgb(139, 197, 111)", "rgb(218, 152, 92)", "rgb(211, 113, 227)"],
    ["rgb(90, 222, 202)", "rgb(243, 195, 132)", "rgb(188, 230, 102)", "rgb(209, 141, 240)"],
    ["rgb(204, 204, 204)", "rgb(98, 136, 84)", "rgb(204, 204, 204)", "rgb(216, 126, 48)"],
  ];
  await expect(cards).toHaveCount(12);
  for (let i = 0; i < 12; i++) {
    const card = cards.nth(i),
      theme = i % 6,
      erlang = i < 6;
    const variable = card
      .locator(".semlo-editor-syntax-variable")
      .getByText(erlang ? "Name" : "name", { exact: true })
      .first();
    const string = card
      .locator(".semlo-editor-syntax-string")
      .getByText(erlang ? '"Hello ~s~n"' : '"Ada"', { exact: true });
    const marker = erlang
      ? card.locator(".semlo-editor-syntax-attribute").getByText("-module", { exact: true })
      : card.locator(".semlo-editor-syntax-keyword").getByText("program", { exact: true }).first();
    for (const [j, token] of [variable, string, marker].entries()) {
      await expect(token).toHaveCSS("color", colors[theme][j === 2 ? (erlang ? 2 : 3) : j]);
      await expect(token).toHaveCSS("font-style", theme === 4 && j !== 1 ? "italic" : "normal");
    }
  }
});

test("large Erlang and Fortran fall back without changing source", () => {
  for (const language of ["erlang", "fortran"] as const) {
    const source = 'program hello\n  name = "Ada"\n  print *, name\nend program hello\n'.repeat(500);
    expect(highlightCodeSyntax(source, language)).toBeNull();
    const root = codeLowlight.highlight(language, source);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});
