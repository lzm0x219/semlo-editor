import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    lessProbe?: EditorController;
  }
}

test("Less follows the observed CSS mode without changing its stored language", async ({ page }) => {
  const source = "@primary: #333;\n.card { color: @primary; &:hover { color: red; } }";
  expect(codeLowlight.highlight("less", source)).toEqual(codeLowlight.highlight("css", source));
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='less-reference';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      window.lessProbe=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'less',theme:'light'},content:[{type:'text',text}]}]}})
    `,
  });
  const card = page.locator("#less-reference .semlo-editor-code-card");
  await expect(card.locator(".semlo-editor-syntax-keyword").getByText("@primary", { exact: true }).first()).toHaveCSS(
    "color",
    "rgb(215, 58, 73)",
  );
  await expect(card.locator(".semlo-editor-syntax-definition").getByText("card", { exact: true })).toHaveCSS(
    "color",
    "rgb(161, 48, 0)",
  );
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("lessProbe").getSnapshot().json.content?.[0].attrs?.language,
    ),
  ).toBe("less");
});
