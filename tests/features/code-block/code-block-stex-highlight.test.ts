import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("sTeX tokens use observed colors and fonts in six code themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const text = String.raw`% comment
\begin{equation}
  E = mc^2 + \frac{a}{b}
\end{equation}
\textbf{Hello} $x + y$`;
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='stex-colors';document.body.prepend(host)
      const text=${JSON.stringify(text)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.stexProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'stex',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#stex-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(0, 79, 180)", "rgb(161, 48, 0)"],
    ["rgb(34, 134, 58)", "rgb(153, 0, 85)", "rgb(0, 92, 197)"],
    ["rgb(83, 83, 83)", "rgb(247, 128, 0)", "rgb(53, 53, 53)"],
    ["rgb(29, 184, 196)", "rgb(218, 152, 92)", "rgb(240, 99, 114)"],
    ["rgb(188, 230, 102)", "rgb(255, 69, 113)", "rgb(90, 222, 202)"],
    ["rgb(255, 196, 90)", "rgb(165, 120, 180)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-tag").getByText(String.raw`\begin`, { exact: true }),
      card.locator(".semlo-editor-syntax-atom").getByText("equation", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-stex-variable").getByText("x", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      const italic = (j === 2 && (i === 3 || i === 4)) || (i === 4 && j === 0);
      await expect(token).toHaveCSS("font-style", italic ? "italic" : "normal");
    }
  }
});

test("dense sTeX falls back without altering source", () => {
  const source = String.raw`\begin{equation} $x + y$ \frac{a}{b} \end{equation}`.repeat(1000);
  expect(highlightCodeSyntax(source, "stex")).toBeNull();
  const root = codeLowlight.highlight("stex", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
