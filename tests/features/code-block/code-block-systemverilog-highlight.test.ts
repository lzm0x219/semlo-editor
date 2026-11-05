import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("SystemVerilog tokens use observed colors and fonts in six code themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const text =
    "module counter(input logic clk, input logic rst, output logic [7:0] count);\n  always_ff @(posedge clk) begin\n    if (rst) count <= 8'b0;\n    else count <= count + 1;\n  end\nendmodule // counter";
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='systemverilog-colors';document.body.prepend(host)
      const text=${JSON.stringify(text)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.verilogProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'systemverilog',theme},content:[{type:'text',text}]}))}})
    `,
  });
  const cards = page.locator("#systemverilog-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(225, 0, 35)", "rgb(35, 41, 48)", "rgb(0, 79, 180)", "rgb(0, 79, 180)"],
    ["rgb(215, 58, 73)", "rgb(35, 41, 48)", "rgb(0, 92, 197)", "rgb(31, 127, 154)"],
    ["rgb(40, 105, 201)", "rgb(53, 53, 53)", "rgb(102, 136, 0)", "rgb(53, 53, 53)"],
    ["rgb(211, 113, 227)", "rgb(240, 99, 114)", "rgb(218, 152, 92)", "rgb(29, 184, 196)"],
    ["rgb(209, 141, 240)", "rgb(90, 222, 202)", "rgb(255, 133, 99)", "rgb(188, 230, 102)"],
    ["rgb(216, 126, 48)", "rgb(204, 204, 204)", "rgb(113, 159, 197)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      card.locator(".semlo-editor-syntax-keyword").getByText("module", { exact: true }),
      card.locator(".semlo-editor-syntax-variable").getByText("counter", { exact: true }),
      card.locator(".semlo-editor-syntax-number").getByText("7", { exact: true }),
      card.locator(".semlo-editor-syntax-meta").getByText("=", { exact: true }).first(),
    ];
    for (const [j, token] of tokens.entries()) {
      await expect(token).toHaveCSS("color", colors[i][j]);
      await expect(token).toHaveCSS("font-style", i === 4 && j < 2 ? "italic" : "normal");
    }
  }
});

test("dense SystemVerilog source falls back without rewriting content", () => {
  const source = "module counter(input logic clk); always_ff @(posedge clk) count <= count + 1; endmodule\n".repeat(
    1000,
  );
  expect(highlightCodeSyntax(source, "systemverilog")).toBeNull();
  const root = codeLowlight.highlight("systemverilog", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});
