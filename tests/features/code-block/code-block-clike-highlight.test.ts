import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("C and C# use observed token colors in six code themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const inputs = [
    ["c", '#include <stdio.h>\nint main(void) {\n  int n = 42;\n  printf("%d", n); // value\n  return 0;\n}'],
    [
      "csharp",
      'using System;\npublic class User {\n  public string Name { get; set; }\n  public void Greet() { Console.WriteLine("Hello"); }\n}',
    ],
  ];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='clike-colors';document.body.prepend(host)
      const inputs=${JSON.stringify(inputs)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.clikeProbe=createEditor({element:host,outline:false,content:{type:'doc',content:inputs.flatMap(([language,text])=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text}]})))}})
    `,
  });
  const cards = page.locator("#clike-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(161, 48, 0)", "rgb(0, 79, 180)"],
    ["rgb(34, 134, 58)", "rgb(161, 48, 0)", "rgb(31, 127, 154)"],
    ["rgb(83, 83, 83)", "rgb(144, 32, 204)", "rgb(53, 53, 53)"],
    ["rgb(29, 184, 196)", "rgb(235, 191, 111)", "rgb(29, 184, 196)"],
    ["rgb(188, 230, 102)", "rgb(121, 169, 255)", "rgb(188, 230, 102)"],
    ["rgb(255, 196, 90)", "rgb(255, 196, 90)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(12);
  for (let i = 0; i < 12; i++) {
    const card = cards.nth(i),
      theme = i % 6;
    const type = card
      .locator(".semlo-editor-syntax-type")
      .getByText(i < 6 ? "int" : "string", { exact: true })
      .first();
    const definition = card
      .locator(".semlo-editor-syntax-definition")
      .getByText(i < 6 ? "main" : "User", { exact: true });
    await expect(type).toHaveCSS("color", colors[theme][0]);
    await expect(definition).toHaveCSS("color", colors[theme][1]);
    await expect(type).toHaveCSS("font-style", theme === 4 ? "italic" : "normal");
    await expect(definition).toHaveCSS("font-style", theme === 4 ? "italic" : "normal");
    if (i < 6)
      await expect(
        card.locator(".semlo-editor-syntax-meta").getByText("#include <stdio.h>", { exact: true }),
      ).toHaveCSS("color", colors[theme][2]);
  }
});

test("large C and C# fall back before parsing without changing source", () => {
  for (const language of ["c", "csharp"] as const) {
    const source = 'int main() { int n = 42; printf("%d", n); return 0; }\n'.repeat(500);
    expect(highlightCodeSyntax(source, language)).toBeNull();
    const root = codeLowlight.highlight(language, source);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});
