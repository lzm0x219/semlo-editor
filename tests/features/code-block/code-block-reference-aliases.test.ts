import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Git and KaTeX use the observed reference syntax aliases", async ({ page }) => {
  const git = "git commit --message 'hello'";
  const katex = String.raw`\textbf{Hello} $x + y$`;
  expect(codeLowlight.highlight("git", git)).toEqual(codeLowlight.highlight("shell", git));
  expect(codeLowlight.highlight("katex", katex)).toEqual(codeLowlight.highlight("stex", katex));
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='reference-aliases';document.body.prepend(host)
      const inputs=[['git',${JSON.stringify(git)}],['katex',${JSON.stringify(katex)}]]
      window.aliasProbe=createEditor({element:host,outline:false,content:{type:'doc',content:inputs.map(([language,text])=>({type:'codeBlock',attrs:{language,theme:'light'},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#reference-aliases .semlo-editor-code-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator(".semlo-editor-syntax-builtin").getByText("git", { exact: true })).toHaveCSS(
    "color",
    "rgb(111, 66, 193)",
  );
  await expect(
    cards.nth(0).locator(".semlo-editor-syntax-attribute").getByText("--message", { exact: true }),
  ).toHaveCSS("color", "rgb(111, 66, 193)");
  await expect(
    cards
      .nth(1)
      .locator(".semlo-editor-syntax-tag")
      .getByText(String.raw`\textbf`, { exact: true }),
  ).toHaveCSS("color", "rgb(34, 134, 58)");
  await expect(cards.nth(1).locator(".semlo-editor-syntax-stex-variable").getByText("x", { exact: true })).toHaveCSS(
    "color",
    "rgb(0, 92, 197)",
  );
});
