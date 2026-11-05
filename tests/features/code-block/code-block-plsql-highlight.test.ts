import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("PL/SQL tokens use observed colors and fonts in six code themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const text =
    "DECLARE\n  v_name VARCHAR2(100) := 'Alice';\nBEGIN\n  SELECT name INTO v_name FROM users WHERE id = 42;\n  DBMS_OUTPUT.PUT_LINE(v_name);\nEND; -- comment";
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='plsql-colors';document.body.prepend(host)
      const text=${JSON.stringify(text)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.plsqlProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'plsql',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#plsql-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(0, 79, 180)", "rgb(0, 47, 109)", "rgb(38, 44, 49)"],
    ["rgb(34, 134, 58)", "rgb(0, 92, 197)", "rgb(102, 153, 0)", "rgb(38, 38, 38)"],
    ["rgb(83, 83, 83)", "rgb(102, 136, 0)", "rgb(247, 128, 0)", "rgb(54, 54, 54)"],
    ["rgb(29, 184, 196)", "rgb(218, 152, 92)", "rgb(139, 197, 111)", "rgb(169, 178, 192)"],
    ["rgb(188, 230, 102)", "rgb(255, 133, 99)", "rgb(243, 195, 132)", "rgb(212, 222, 236)"],
    ["rgb(255, 196, 90)", "rgb(113, 159, 197)", "rgb(98, 136, 84)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-type").getByText("VARCHAR2", { exact: true }),
      card.locator(".semlo-editor-syntax-number").getByText("100", { exact: true }),
      card.locator(".semlo-editor-syntax-string").getByText("'Alice'", { exact: true }),
      card.locator(".semlo-editor-syntax-punctuation").getByText("(", { exact: true }).first(),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j === 0 ? "italic" : "normal");
    }
  }
});

test("dense PL/SQL source falls back without rewriting content", () => {
  const source =
    "DECLARE v_name VARCHAR2(100) := 'Alice'; BEGIN SELECT name INTO v_name FROM users WHERE id = 42; END;\n".repeat(
      1000,
    );
  expect(highlightCodeSyntax(source, "plsql")).toBeNull();
  const root = codeLowlight.highlight("plsql", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
