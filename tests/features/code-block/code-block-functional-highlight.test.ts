import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Scheme, Clojure and OCaml use observed token colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const inputs = [
    ["scheme", '; greeting\n(define (greet name)\n  (display "Hello ")\n  (display name))\n(greet "Ada")\n'],
    ["clojure", '; greeting\n(defn greet [name]\n  (println (str "Hello " name)))\n(greet "Ada")\n'],
    ["ocaml", '(* greeting *)\nlet greet name =\n  print_endline ("Hello " ^ name)\n\nlet () = greet "Ada"\n'],
  ];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='functional-colors';document.body.prepend(host)
      const inputs=${JSON.stringify(inputs)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.functionalProbe=createEditor({element:host,outline:false,content:{type:'doc',content:inputs.flatMap(([language,text])=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text}]})))}})
    `,
  });
  const cards = page.locator("#functional-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(35, 41, 48)", "rgb(0, 47, 109)", "rgb(108, 119, 130)", "rgb(38, 44, 49)", "rgb(225, 0, 35)"],
    ["rgb(35, 41, 48)", "rgb(102, 153, 0)", "rgb(106, 115, 125)", "rgb(38, 38, 38)", "rgb(215, 58, 73)"],
    ["rgb(53, 53, 53)", "rgb(247, 128, 0)", "rgb(0, 169, 97)", "rgb(54, 54, 54)", "rgb(40, 105, 201)"],
    ["rgb(240, 99, 114)", "rgb(139, 197, 111)", "rgb(126, 132, 143)", "rgb(169, 178, 192)", "rgb(211, 113, 227)"],
    ["rgb(90, 222, 202)", "rgb(243, 195, 132)", "rgb(94, 120, 119)", "rgb(212, 222, 236)", "rgb(209, 141, 240)"],
    ["rgb(204, 204, 204)", "rgb(98, 136, 84)", "rgb(112, 112, 112)", "rgb(204, 204, 204)", "rgb(216, 126, 48)"],
  ];
  await expect(cards).toHaveCount(18);
  for (let i = 0; i < 18; i++) {
    const card = cards.nth(i),
      theme = i % 6,
      language = Math.floor(i / 6);
    const variable = card.locator(".semlo-editor-syntax-variable").getByText("greet", { exact: true }).first();
    const string = card.locator(".semlo-editor-syntax-string").getByText('"Ada"', { exact: true });
    const comment = card.locator(".semlo-editor-syntax-comment").first();
    const marker =
      language === 0
        ? card.locator(".semlo-editor-syntax-punctuation").getByText("(", { exact: true }).first()
        : card
            .locator(".semlo-editor-syntax-keyword")
            .getByText(language === 1 ? "defn" : "let", { exact: true })
            .first();
    for (const [j, token] of [variable, string, comment, marker].entries()) {
      await expect(token).toHaveCSS("color", colors[theme][j === 3 && language > 0 ? 4 : j]);
      await expect(token).toHaveCSS(
        "font-style",
        theme === 4 && (j === 0 || (j === 3 && language > 0)) ? "italic" : "normal",
      );
    }
  }
});

test("large Scheme, Clojure and OCaml fall back without changing source", () => {
  for (const language of ["scheme", "clojure", "ocaml"] as const) {
    const source = '(define (greet name) (display "Hello ") (display name))\n'.repeat(500);
    expect(highlightCodeSyntax(source, language)).toBeNull();
    const root = codeLowlight.highlight(language, source);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});
