import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Objective-C, Groovy and GLSL use observed token colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const inputs = [
    ["objectivec", "#import <Foundation/Foundation.h>\n@interface User : NSObject\n@property NSString *name;\n@end\n"],
    ["groovy", 'class User {\n  String name\n  def greet() { println "Hello ${name}" }\n}\n'],
    [
      "glsl",
      "#version 330 core\nin vec3 position;\nuniform mat4 transform;\nvoid main() {\n  gl_Position = transform * vec4(position, 1.0);\n}\n",
    ],
  ];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='more-clike-colors';document.body.prepend(host)
      const inputs=${JSON.stringify(inputs)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.moreClikeProbe=createEditor({element:host,outline:false,content:{type:'doc',content:inputs.flatMap(([language,text])=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text}]})))}})
    `,
  });
  const cards = page.locator("#more-clike-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(225, 0, 35)", "rgb(35, 41, 48)", "rgb(0, 79, 180)", "rgb(0, 47, 109)", "rgb(0, 79, 180)"],
    ["rgb(215, 58, 73)", "rgb(35, 41, 48)", "rgb(31, 127, 154)", "rgb(102, 153, 0)", "rgb(153, 0, 85)"],
    ["rgb(40, 105, 201)", "rgb(53, 53, 53)", "rgb(53, 53, 53)", "rgb(247, 128, 0)", "rgb(247, 128, 0)"],
    ["rgb(211, 113, 227)", "rgb(240, 99, 114)", "rgb(29, 184, 196)", "rgb(139, 197, 111)", "rgb(218, 152, 92)"],
    ["rgb(209, 141, 240)", "rgb(90, 222, 202)", "rgb(188, 230, 102)", "rgb(243, 195, 132)", "rgb(255, 69, 113)"],
    ["rgb(216, 126, 48)", "rgb(204, 204, 204)", "rgb(204, 204, 204)", "rgb(98, 136, 84)", "rgb(165, 120, 180)"],
  ];
  await expect(cards).toHaveCount(18);
  for (let i = 0; i < 18; i++) {
    const card = cards.nth(i),
      theme = i % 6,
      language = Math.floor(i / 6);
    const keyword = card
      .locator(".semlo-editor-syntax-keyword")
      .getByText(["@interface", "class", "uniform"][language], { exact: true });
    const variable = card
      .locator(".semlo-editor-syntax-variable")
      .getByText(["NSObject", "User", "position"][language], { exact: true })
      .first();
    const value =
      language === 0
        ? card.locator(".semlo-editor-syntax-meta").getByText("#import <Foundation/Foundation.h>", { exact: true })
        : language === 1
          ? card.locator(".semlo-editor-syntax-string").getByText('"Hello ${', { exact: false })
          : card.locator(".semlo-editor-syntax-atom").getByText("gl_Position", { exact: true });
    for (const [j, token] of [keyword, variable, value].entries()) {
      await expect(token).toHaveCSS("color", colors[theme][j < 2 ? j : language + 2]);
      await expect(token).toHaveCSS("font-style", theme === 4 && j < 2 ? "italic" : "normal");
    }
  }
});

test("large Objective-C, Groovy and GLSL fall back without changing source", () => {
  for (const language of ["objectivec", "groovy", "glsl"] as const) {
    const source = 'class User { String name; void greet() { print("Hello"); } }\n'.repeat(500);
    expect(highlightCodeSyntax(source, language)).toBeNull();
    const root = codeLowlight.highlight(language, source);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});
