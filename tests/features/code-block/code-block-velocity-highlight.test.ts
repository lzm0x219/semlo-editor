import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Velocity macros, references, strings and comments match observed theme tokens", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='velocity-colors';document.body.prepend(host)
    const text='#macro(greet $who)\\n#set($msg = "Hi $who") ## note\\n#foreach($item in $list)\\n$!{item.name}\\n#end\\n#end'
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.velocityProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'velocity',theme},content:[{type:'text',text}]}))}})
  `,
  });
  const cards = page.locator("#velocity-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(225, 0, 35)", "rgb(35, 41, 48)", "rgb(0, 47, 109)", "rgb(108, 119, 130)"],
    ["rgb(215, 58, 73)", "rgb(35, 41, 48)", "rgb(102, 153, 0)", "rgb(106, 115, 125)"],
    ["rgb(40, 105, 201)", "rgb(53, 53, 53)", "rgb(247, 128, 0)", "rgb(0, 169, 97)"],
    ["rgb(211, 113, 227)", "rgb(240, 99, 114)", "rgb(139, 197, 111)", "rgb(126, 132, 143)"],
    ["rgb(209, 141, 240)", "rgb(90, 222, 202)", "rgb(243, 195, 132)", "rgb(94, 120, 119)"],
    ["rgb(216, 126, 48)", "rgb(204, 204, 204)", "rgb(98, 136, 84)", "rgb(112, 112, 112)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const keyword = card.locator(".semlo-editor-syntax-keyword").getByText("#macro", { exact: true });
    const variable = card.locator(".semlo-editor-syntax-variable").getByText("$!{item.name}", { exact: true });
    const str = card.locator(".semlo-editor-syntax-string").getByText('"Hi ', { exact: true });
    const comment = card.locator(".semlo-editor-syntax-comment").getByText("## note", { exact: true });
    for (const [locator, color] of [
      [keyword, colors[i][0]],
      [variable, colors[i][1]],
      [str, colors[i][2]],
      [comment, colors[i][3]],
    ] as const)
      await expect(locator).toHaveCSS("color", color);
    await expect(keyword).toHaveCSS("font-style", i === 4 ? "italic" : "normal");
    await expect(variable).toHaveCSS("font-style", i === 4 ? "italic" : "normal");
    await expect(comment).toHaveCSS("font-style", "normal");
    await expect(card.locator(".semlo-editor-syntax-variable").getByText("$who", { exact: true })).toHaveCount(2);
  }
});

test("long Velocity source remains complete whether parsing completes or falls back", () => {
  const source = "#if($user) Hello $user.name #else No user #end\n".repeat(7000);
  const root = codeLowlight.highlight("velocity", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});

test("Velocity unparsed blocks and comments retain observed token types", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='velocity-meta';document.body.prepend(host)
    const text='#[[ raw $name ]]#\\n#* comment *#'
    window.velocityProbe=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'velocity',theme:'dark'},content:[{type:'text',text}]}]}})
  `,
  });
  const code = page.locator("#velocity-meta code");
  await expect(code.locator(".semlo-editor-syntax-meta").getByText("#[[ raw $name ]]#", { exact: true })).toHaveCSS(
    "color",
    "rgb(29, 184, 196)",
  );
  await expect(code.locator(".semlo-editor-syntax-comment").getByText("#* comment *#", { exact: true })).toHaveCSS(
    "color",
    "rgb(126, 132, 143)",
  );
  await expect(code.locator(".semlo-editor-syntax-variable").getByText("$name", { exact: true })).toHaveCount(0);
});
