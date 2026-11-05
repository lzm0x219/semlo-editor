import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Diff sample follows observed colors across themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = "diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-old\n+new\n";
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='diff-probe';document.body.prepend(host)
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.diffProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'diff',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
  `,
  });
  const meta = [
    "rgb(0, 79, 180)",
    "rgb(31, 127, 154)",
    "rgb(53, 53, 53)",
    "rgb(29, 184, 196)",
    "rgb(188, 230, 102)",
    "rgb(204, 204, 204)",
  ];
  const cards = page.locator("#diff-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-diff-deleted").getByText("-old", { exact: true }),
      card.locator(".semlo-editor-syntax-diff-inserted").getByText("+new", { exact: true }),
      card.locator(".semlo-editor-syntax-meta").getByText("@@ -1 +1 @@", { exact: true }),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", ["rgb(221, 68, 68)", "rgb(34, 153, 34)", meta[i]][j]);
      await expect(token).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(token).toHaveCSS("font-style", "normal");
    }
  }
});

test("large Diff falls back without changing source", () => {
  const source = "--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-old\n+new\n".repeat(500);
  expect(highlightCodeSyntax(source, "diff")).toBeNull();
  const root = codeLowlight.highlight("diff", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
