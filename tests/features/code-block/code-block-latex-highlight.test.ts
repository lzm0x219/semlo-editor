import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    latexProbe?: EditorController;
  }
}

test("LaTeX follows the observed sTeX mode without changing its stored language", async ({ page }) => {
  const source = String.raw`\textbf{Hello} $x + y$`;
  expect(codeLowlight.highlight("latex", source)).toEqual(codeLowlight.highlight("stex", source));
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='latex-reference';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      window.latexProbe=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'latex',theme:'light'},content:[{type:'text',text}]}]}})
    `,
  });
  const card = page.locator("#latex-reference .semlo-editor-code-card");
  await expect(card.locator(".semlo-editor-syntax-tag").getByText(String.raw`\textbf`, { exact: true })).toHaveCSS(
    "color",
    "rgb(34, 134, 58)",
  );
  await expect(card.locator(".semlo-editor-syntax-stex-variable").getByText("x", { exact: true })).toHaveCSS(
    "color",
    "rgb(0, 92, 197)",
  );
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("latexProbe").getSnapshot().json.content?.[0].attrs?.language,
    ),
  ).toBe("latex");
});
