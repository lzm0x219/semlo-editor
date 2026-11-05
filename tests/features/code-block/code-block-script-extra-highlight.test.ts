import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("R, Perl, Lua and Haskell use observed token colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const inputs = [
    ["r", 'greet <- function(name) {\n  message <- paste("Hello", name)\n  print(message) # greeting\n}\n'],
    ["perl", 'use strict;\nmy $name = "Ada";\nsub greet {\n  print "Hello $name\\n"; # greeting\n}\n'],
    ["lua", 'local user = { name = "Ada" }\nfunction greet(user)\n  print("Hello " .. user.name) -- greeting\nend\n'],
    [
      "haskell",
      'module Main where\n\ngreet :: String -> String\ngreet name = "Hello " ++ name\n\nmain = putStrLn (greet "Ada") -- greeting\n',
    ],
  ];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='script-extra-colors';document.body.prepend(host)
      const inputs=${JSON.stringify(inputs)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.scriptExtraProbe=createEditor({element:host,outline:false,content:{type:'doc',content:inputs.flatMap(([language,text])=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text}]})))}})
    `,
  });
  const cards = page.locator("#script-extra-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(225, 0, 35)", "rgb(35, 41, 48)", "rgb(0, 47, 109)"],
    ["rgb(215, 58, 73)", "rgb(35, 41, 48)", "rgb(102, 153, 0)"],
    ["rgb(40, 105, 201)", "rgb(53, 53, 53)", "rgb(247, 128, 0)"],
    ["rgb(211, 113, 227)", "rgb(240, 99, 114)", "rgb(139, 197, 111)"],
    ["rgb(209, 141, 240)", "rgb(90, 222, 202)", "rgb(243, 195, 132)"],
    ["rgb(216, 126, 48)", "rgb(204, 204, 204)", "rgb(98, 136, 84)"],
  ];
  await expect(cards).toHaveCount(24);
  for (let i = 0; i < 24; i++) {
    const card = cards.nth(i),
      theme = i % 6,
      language = Math.floor(i / 6);
    const tokens = [
      card
        .locator(".semlo-editor-syntax-keyword")
        .getByText(["function", "use", "local", "module"][language], { exact: true }),
      card
        .locator(".semlo-editor-syntax-variable")
        .getByText(["greet", "$name", "user", "greet"][language], { exact: true })
        .first(),
      card
        .locator(".semlo-editor-syntax-string")
        .getByText(['"Hello"', '"Ada"', '"Ada"', '"Hello "'][language], { exact: true })
        .first(),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[theme][j]);
      await expect(token).toHaveCSS("font-style", theme === 4 && j < 2 ? "italic" : "normal");
    }
  }
});

test("large R, Perl, Lua and Haskell fall back without changing source", () => {
  for (const language of ["r", "perl", "lua", "haskell"] as const) {
    const source = 'name = "Ada"\nprint(name) # greeting\n'.repeat(500);
    expect(highlightCodeSyntax(source, language)).toBeNull();
    const root = codeLowlight.highlight(language, source);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});
