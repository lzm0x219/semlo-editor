import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Kotlin, Dart and Scala use observed token colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const inputs = [
    [
      "kotlin",
      'data class User(val name: String)\nfun greet(user: User): String {\n  println("Hello ${user.name}")\n  return user.name\n}',
    ],
    ["dart", 'class User {\n  final String name;\n  User(this.name);\n  void greet() { print("Hello $name"); }\n}'],
    [
      "scala",
      "case class User(name: String)\nobject Main {\n  def greet(user: User): String = {\n    println(user.name)\n    user.name\n  }\n}",
    ],
  ];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='clike-extra-colors';document.body.prepend(host)
      const inputs=${JSON.stringify(inputs)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.clikeExtraProbe=createEditor({element:host,outline:false,content:{type:'doc',content:inputs.flatMap(([language,text])=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text}]})))}})
    `,
  });
  const cards = page.locator("#clike-extra-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(225, 0, 35)", "rgb(0, 79, 180)", "rgb(35, 41, 48)"],
    ["rgb(215, 58, 73)", "rgb(34, 134, 58)", "rgb(35, 41, 48)"],
    ["rgb(40, 105, 201)", "rgb(83, 83, 83)", "rgb(53, 53, 53)"],
    ["rgb(211, 113, 227)", "rgb(29, 184, 196)", "rgb(240, 99, 114)"],
    ["rgb(209, 141, 240)", "rgb(188, 230, 102)", "rgb(90, 222, 202)"],
    ["rgb(216, 126, 48)", "rgb(255, 196, 90)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(18);
  for (let i = 0; i < 18; i++) {
    const card = cards.nth(i),
      theme = i % 6,
      language = Math.floor(i / 6);
    const tokens = [
      card.locator(".semlo-editor-syntax-keyword").getByText("class", { exact: true }),
      card
        .locator(".semlo-editor-syntax-type")
        .getByText(language === 1 ? "User" : "String", { exact: true })
        .first(),
      card
        .locator(".semlo-editor-syntax-variable")
        .getByText(language === 0 ? "user" : "name", { exact: true })
        .first(),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[theme][j]);
      await expect(token).toHaveCSS("font-style", theme === 4 ? "italic" : "normal");
    }
  }
});

test("large Kotlin, Dart and Scala fall back without changing source", () => {
  for (const language of ["kotlin", "dart", "scala"] as const) {
    const source = 'class User { String name; void greet() { print("Hello"); } }\n'.repeat(500);
    expect(highlightCodeSyntax(source, language)).toBeNull();
    const root = codeLowlight.highlight(language, source);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});
