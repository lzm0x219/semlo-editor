import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Makefile assignment, targets and variables use observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = "CC = gcc\nCFLAGS := -O2\n.PHONY: all clean\nall: main.o\n\t$(CC) -o app main.o\n# note\n";
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='makefile-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.makefileProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'makefile',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
    `,
  });
  const colors = [
    ["rgb(161, 48, 0)", "rgb(161, 48, 0)", "rgb(225, 0, 35)", "rgb(225, 0, 35)", "rgb(108, 119, 130)"],
    ["rgb(0, 92, 197)", "rgb(161, 48, 0)", "rgb(215, 58, 73)", "rgb(225, 0, 35)", "rgb(106, 115, 125)"],
    ["rgb(53, 53, 53)", "rgb(144, 32, 204)", "rgb(40, 105, 201)", "rgb(40, 105, 201)", "rgb(0, 169, 97)"],
    ["rgb(240, 99, 114)", "rgb(235, 191, 111)", "rgb(211, 113, 227)", "rgb(29, 184, 196)", "rgb(126, 132, 143)"],
    ["rgb(90, 222, 202)", "rgb(121, 169, 255)", "rgb(209, 141, 240)", "rgb(209, 141, 240)", "rgb(94, 120, 119)"],
    ["rgb(204, 204, 204)", "rgb(255, 196, 90)", "rgb(216, 126, 48)", "rgb(204, 204, 204)", "rgb(112, 112, 112)"],
  ];
  const cards = page.locator("#makefile-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      [".semlo-editor-syntax-make-variable", "CC"],
      [".semlo-editor-syntax-definition", "all"],
      [".semlo-editor-syntax-keyword", ".PHONY"],
      [".semlo-editor-syntax-operator", ":"],
      [".semlo-editor-syntax-comment", "# note"],
    ];
    for (const [index, [selector, value]] of tokens.entries()) {
      const token = card.locator(selector).getByText(value, { exact: true }).first();
      await expect(token).toHaveCSS("color", colors[i][index]);
      const italic = (i === 3 && index === 0) || (i === 4 && index < 3);
      await expect(token).toHaveCSS("font-style", italic ? "italic" : "normal");
    }
    await expect(card.locator(".semlo-editor-syntax-make-variable").getByText("$(CC)", { exact: true })).toHaveCSS(
      "color",
      colors[i][0],
    );
    await expect(card.locator(".semlo-editor-syntax-definition").getByText("CFLAGS", { exact: true })).toHaveCSS(
      "color",
      colors[i][1],
    );
  }
});

test("unsupported forms preserve source and long Makefiles use the existing fallback", () => {
  const source =
    "A=1\nB += two\nC ?= three\nexport NAME = value\ninclude common.mk\n# note\nfoo bar: dep\n\t@echo $(A) ${B} $@\n";
  const root = highlightCodeSyntax(source, "makefile");
  expect(root).not.toBeNull();
  if (!root) throw new Error("Expected Makefile highlighting");
  type HighlightNode = (typeof root.children)[number] | ReturnType<typeof codeLowlight.highlight>["children"][number];
  const text = (node: HighlightNode): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
  for (const name of ["B", "C", "export", "include", "foo", "bar"]) {
    expect(root.children.some((node) => node.type === "element" && text(node) === name)).toBe(false);
  }
  const large = "all: build\n\t$(CC) -o app main.o\n".repeat(500);
  expect(highlightCodeSyntax(large, "makefile")).toBeNull();
  const fallback = codeLowlight.highlight("makefile", large);
  expect(fallback.children.map(text).join("")).toBe(large);
  for (const complex of ["A = first \\\n  second\n", "A = $(outer $(inner))\n", "define MESSAGE\nhello\nendef\n"]) {
    expect(highlightCodeSyntax(complex, "makefile")).toBeNull();
    expect(codeLowlight.highlight("makefile", complex).children.map(text).join("")).toBe(complex);
  }
});
