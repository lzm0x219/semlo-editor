import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("XML declarations, tags and entities use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    '<?xml version="1.0"?>\n<!-- greeting -->\n<user id="42" active="true"><name>Ada &amp; Co</name></user>';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='xml-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.xmlProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'xml',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#xml-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(0, 79, 180)", "rgb(0, 79, 180)", "rgb(0, 47, 109)"],
    ["rgb(31, 127, 154)", "rgb(34, 134, 58)", "rgb(111, 66, 193)", "rgb(102, 153, 0)"],
    ["rgb(53, 53, 53)", "rgb(83, 83, 83)", "rgb(102, 136, 0)", "rgb(247, 128, 0)"],
    ["rgb(29, 184, 196)", "rgb(29, 184, 196)", "rgb(218, 152, 92)", "rgb(139, 197, 111)"],
    ["rgb(188, 230, 102)", "rgb(188, 230, 102)", "rgb(188, 230, 102)", "rgb(243, 195, 132)"],
    ["rgb(204, 204, 204)", "rgb(255, 196, 90)", "rgb(204, 204, 204)", "rgb(98, 136, 84)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-meta").getByText('<?xml version="1.0"?>', { exact: true }),
      card.locator(".semlo-editor-syntax-tag").getByText("user", { exact: true }).first(),
      card.locator(".semlo-editor-syntax-attribute").getByText("id", { exact: true }),
      card.locator(".semlo-editor-syntax-string").getByText("&amp;", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && (j === 1 || j === 2) ? "italic" : "normal");
    }
    await expect(card.locator(".semlo-editor-syntax-string").getByText('"42"', { exact: true })).toHaveCSS(
      "color",
      colors[i][3],
    );
  }
});

test("large XML falls back before parsing without changing its source", () => {
  const source = '<user id="42"><name>Ada &amp; Co</name></user>\n'.repeat(500);
  expect(highlightCodeSyntax(source, "xml")).toBeNull();
  const root = codeLowlight.highlight("xml", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
