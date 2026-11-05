import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Swift and Ruby definitions and values use observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const inputs = [
    [
      "swift",
      'import Foundation\nstruct User { let name: String }\nfunc greet(_ user: User) -> String {\n  let message = "Hello \\(user.name)"\n  print(message) // greeting\n  return message\n}',
    ],
    [
      "ruby",
      'class User\n  attr_reader :name\n  def initialize(name)\n    @name = name\n  end\n  def greet\n    puts "Hello #{@name}" # greeting\n  end\nend',
    ],
  ];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='swift-ruby-colors';document.body.prepend(host)
      const inputs=${JSON.stringify(inputs)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.swiftRubyProbe=createEditor({element:host,outline:false,content:{type:'doc',content:inputs.flatMap(([language,text])=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text}]})))}})
    `,
  });
  const cards = page.locator("#swift-ruby-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(161, 48, 0)", "rgb(0, 79, 180)", "rgb(140, 72, 231)"],
    ["rgb(161, 48, 0)", "rgb(153, 0, 85)", "rgb(0, 92, 197)"],
    ["rgb(144, 32, 204)", "rgb(247, 128, 0)", "rgb(53, 53, 53)"],
    ["rgb(235, 191, 111)", "rgb(218, 152, 92)", "rgb(67, 176, 245)"],
    ["rgb(121, 169, 255)", "rgb(255, 69, 113)", "rgb(121, 169, 255)"],
    ["rgb(255, 196, 90)", "rgb(165, 120, 180)", "rgb(255, 196, 90)"],
  ];
  await expect(cards).toHaveCount(12);
  for (let i = 0; i < 12; i++) {
    const card = cards.nth(i),
      theme = i % 6;
    const definition = card
      .locator(".semlo-editor-syntax-definition")
      .getByText(i < 6 ? "greet" : "initialize", { exact: true });
    const atom = card.locator(".semlo-editor-syntax-atom").getByText(i < 6 ? "_" : ":name", { exact: true });
    const property = card
      .locator(".semlo-editor-syntax-property")
      .getByText(i < 6 ? ".name" : "@name", { exact: true })
      .first();
    for (const [j, token] of [definition, atom, property].entries()) {
      await expect(token).toHaveCSS("color", colors[theme][j]);
      await expect(token).toHaveCSS("font-style", theme === 4 && j !== 1 ? "italic" : "normal");
    }
  }
});

test("large Swift and Ruby fall back before parsing without changing source", () => {
  for (const language of ["swift", "ruby"] as const) {
    const source = 'class User { let name: String; func greet() { print("Hello") } }\n'.repeat(500);
    expect(highlightCodeSyntax(source, language)).toBeNull();
    const root = codeLowlight.highlight(language, source);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});
