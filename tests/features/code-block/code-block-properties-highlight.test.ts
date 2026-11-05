import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Properties sample follows observed colors across themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = "# settings\n[app]\nname=Semlo\nenabled=true\npath: /tmp/data\n";
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='properties-probe';document.body.prepend(host)
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.propertiesProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'properties',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
  `,
  });
  const colors = [
    ["rgb(108, 119, 130)", "rgb(35, 41, 48)", "rgb(161, 48, 0)"],
    ["rgb(106, 115, 125)", "rgb(0, 0, 255)", "rgb(161, 48, 0)"],
    ["rgb(0, 169, 97)", "rgb(53, 53, 53)", "rgb(144, 32, 204)"],
    ["rgb(126, 132, 143)", "rgb(169, 178, 192)", "rgb(235, 191, 111)"],
    ["rgb(94, 120, 119)", "rgb(212, 222, 236)", "rgb(121, 169, 255)"],
    ["rgb(112, 112, 112)", "rgb(204, 204, 204)", "rgb(255, 196, 90)"],
  ];
  const cards = page.locator("#properties-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-comment").getByText("# settings", { exact: true }),
      card.locator(".semlo-editor-syntax-properties-header").getByText("[app]", { exact: true }),
      card.locator(".semlo-editor-syntax-definition").getByText("name", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j === 2 ? "italic" : "normal");
      await expect(token).toHaveCSS("font-weight", "400");
    }
  }
});

test("Properties values stay unhighlighted", () => {
  const root = highlightCodeSyntax("name=Semlo\n", "properties");
  expect(root?.children.some((child) => child.type === "text" && child.value.includes("Semlo"))).toBe(true);
});

test("large Properties falls back without changing source", () => {
  const source = "# settings\n[app]\nname=Semlo\nenabled=true\npath: /tmp/data\n".repeat(500);
  expect(highlightCodeSyntax(source, "properties")).toBeNull();
  const root = codeLowlight.highlight("properties", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
