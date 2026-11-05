import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Cypher tokens use observed colors in six code themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='cypher-colors';document.body.prepend(host)
      const text='MATCH (p:Person {name: $name})-[:KNOWS]->(friend)\\nWHERE p.age >= 18 AND friend.active = true // comment'
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.cypherProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'cypher',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#cypher-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(38, 44, 49)", "rgb(35, 41, 48)", "rgb(161, 48, 0)"],
    ["rgb(153, 0, 85)", "rgb(38, 38, 38)", "rgb(35, 41, 48)", "rgb(161, 48, 0)"],
    ["rgb(247, 128, 0)", "rgb(54, 54, 54)", "rgb(53, 53, 53)", "rgb(144, 32, 204)"],
    ["rgb(218, 152, 92)", "rgb(169, 178, 192)", "rgb(240, 99, 114)", "rgb(235, 191, 111)"],
    ["rgb(255, 69, 113)", "rgb(212, 222, 236)", "rgb(90, 222, 202)", "rgb(121, 169, 255)"],
    ["rgb(165, 120, 180)", "rgb(204, 204, 204)", "rgb(204, 204, 204)", "rgb(255, 196, 90)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const atom = card.locator(".semlo-editor-syntax-atom").getByText("p:Person", { exact: true });
    const punctuation = card.locator(".semlo-editor-syntax-punctuation").getByText("(", { exact: true }).first();
    const variable = card.locator(".semlo-editor-syntax-variable").getByText("$name", { exact: true });
    const definition = card.locator(".semlo-editor-syntax-definition").getByText("AND", { exact: true });
    for (const [j, token] of [atom, punctuation, variable, definition].entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j >= 2 ? "italic" : "normal");
    }
  }
});

test("dense Cypher source stays intact when semantic highlighting falls back", () => {
  const source = "MATCH (p:Person {name: $name})-[:KNOWS]->(friend) RETURN friend.name\n".repeat(1000);
  expect(highlightCodeSyntax(source, "cypher")).toBeNull();
  const root = codeLowlight.highlight("cypher", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
