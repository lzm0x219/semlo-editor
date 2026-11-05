import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("SQL keywords, values and punctuation use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    "-- active users\nSELECT u.name, COUNT(*) AS total\nFROM users AS u\nWHERE u.active = true AND u.score >= 42\nGROUP BY u.name\nORDER BY total DESC;";
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='sql-colors';document.body.prepend(host)
      const text=${JSON.stringify(source)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.sqlProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'sql',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#sql-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(225, 0, 35)", "rgb(0, 79, 180)", "rgb(38, 44, 49)", "rgb(0, 79, 180)"],
    ["rgb(215, 58, 73)", "rgb(153, 0, 85)", "rgb(38, 38, 38)", "rgb(0, 92, 197)"],
    ["rgb(40, 105, 201)", "rgb(247, 128, 0)", "rgb(54, 54, 54)", "rgb(102, 136, 0)"],
    ["rgb(211, 113, 227)", "rgb(218, 152, 92)", "rgb(169, 178, 192)", "rgb(218, 152, 92)"],
    ["rgb(209, 141, 240)", "rgb(255, 69, 113)", "rgb(212, 222, 236)", "rgb(255, 133, 99)"],
    ["rgb(216, 126, 48)", "rgb(165, 120, 180)", "rgb(204, 204, 204)", "rgb(113, 159, 197)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-keyword").getByText("SELECT", { exact: true }),
      card.locator(".semlo-editor-syntax-atom").getByText("true", { exact: true }),
      card.locator(".semlo-editor-syntax-punctuation").getByText(",", { exact: true }),
      card.locator(".semlo-editor-syntax-number").getByText("42", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j === 0 ? "italic" : "normal");
    }
  }
});

test("large SQL falls back before parsing without changing its source", () => {
  const source = "SELECT name FROM users WHERE active = true AND score >= 42;\n".repeat(500);
  expect(highlightCodeSyntax(source, "sql")).toBeNull();
  const root = codeLowlight.highlight("sql", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
