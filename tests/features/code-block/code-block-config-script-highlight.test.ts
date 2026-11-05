import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

const cases = [
  {
    language: "matlab",
    source: "function y = square(x)\n  y = x.^2; % square\nend\n",
    samples: [
      [
        { text: "function", color: "rgb(35, 41, 48)", font: "normal" },
        { text: ".^", color: "rgb(225, 0, 35)", font: "normal" },
        { text: "2", color: "rgb(0, 79, 180)", font: "normal" },
      ],
      [
        { text: "function", color: "rgb(35, 41, 48)", font: "normal" },
        { text: ".^", color: "rgb(225, 0, 35)", font: "normal" },
        { text: "2", color: "rgb(0, 92, 197)", font: "normal" },
      ],
      [
        { text: "function", color: "rgb(53, 53, 53)", font: "normal" },
        { text: ".^", color: "rgb(40, 105, 201)", font: "normal" },
        { text: "2", color: "rgb(102, 136, 0)", font: "normal" },
      ],
      [
        { text: "function", color: "rgb(240, 99, 114)", font: "normal" },
        { text: ".^", color: "rgb(29, 184, 196)", font: "normal" },
        { text: "2", color: "rgb(218, 152, 92)", font: "normal" },
      ],
      [
        { text: "function", color: "rgb(90, 222, 202)", font: "italic" },
        { text: ".^", color: "rgb(209, 141, 240)", font: "normal" },
        { text: "2", color: "rgb(255, 133, 99)", font: "normal" },
      ],
      [
        { text: "function", color: "rgb(204, 204, 204)", font: "normal" },
        { text: ".^", color: "rgb(204, 204, 204)", font: "normal" },
        { text: "2", color: "rgb(113, 159, 197)", font: "normal" },
      ],
    ],
  },
  {
    language: "pascal",
    source: "program Hello;\nbegin\n  writeln('Hello'); { greeting }\nend.\n",
    samples: [
      [
        { text: "program", color: "rgb(225, 0, 35)", font: "normal" },
        { text: "Hello", color: "rgb(35, 41, 48)", font: "normal" },
        { text: "'Hello'", color: "rgb(0, 47, 109)", font: "normal" },
      ],
      [
        { text: "program", color: "rgb(215, 58, 73)", font: "normal" },
        { text: "Hello", color: "rgb(35, 41, 48)", font: "normal" },
        { text: "'Hello'", color: "rgb(102, 153, 0)", font: "normal" },
      ],
      [
        { text: "program", color: "rgb(40, 105, 201)", font: "normal" },
        { text: "Hello", color: "rgb(53, 53, 53)", font: "normal" },
        { text: "'Hello'", color: "rgb(247, 128, 0)", font: "normal" },
      ],
      [
        { text: "program", color: "rgb(211, 113, 227)", font: "normal" },
        { text: "Hello", color: "rgb(240, 99, 114)", font: "normal" },
        { text: "'Hello'", color: "rgb(139, 197, 111)", font: "normal" },
      ],
      [
        { text: "program", color: "rgb(209, 141, 240)", font: "italic" },
        { text: "Hello", color: "rgb(90, 222, 202)", font: "italic" },
        { text: "'Hello'", color: "rgb(243, 195, 132)", font: "normal" },
      ],
      [
        { text: "program", color: "rgb(216, 126, 48)", font: "normal" },
        { text: "Hello", color: "rgb(204, 204, 204)", font: "normal" },
        { text: "'Hello'", color: "rgb(98, 136, 84)", font: "normal" },
      ],
    ],
  },
  {
    language: "powershell",
    source: '$name = "Semlo"\nWrite-Host "Hello $name" # hi\n',
    samples: [
      [
        { text: "$name", color: "rgb(35, 41, 48)", font: "normal" },
        { text: "=", color: "rgb(225, 0, 35)", font: "normal" },
        { text: '"Semlo"', color: "rgb(0, 47, 109)", font: "normal" },
      ],
      [
        { text: "$name", color: "rgb(35, 41, 48)", font: "normal" },
        { text: "=", color: "rgb(225, 0, 35)", font: "normal" },
        { text: '"Semlo"', color: "rgb(102, 153, 0)", font: "normal" },
      ],
      [
        { text: "$name", color: "rgb(53, 53, 53)", font: "normal" },
        { text: "=", color: "rgb(40, 105, 201)", font: "normal" },
        { text: '"Semlo"', color: "rgb(247, 128, 0)", font: "normal" },
      ],
      [
        { text: "$name", color: "rgb(240, 99, 114)", font: "normal" },
        { text: "=", color: "rgb(29, 184, 196)", font: "normal" },
        { text: '"Semlo"', color: "rgb(139, 197, 111)", font: "normal" },
      ],
      [
        { text: "$name", color: "rgb(90, 222, 202)", font: "italic" },
        { text: "=", color: "rgb(209, 141, 240)", font: "normal" },
        { text: '"Semlo"', color: "rgb(243, 195, 132)", font: "normal" },
      ],
      [
        { text: "$name", color: "rgb(204, 204, 204)", font: "normal" },
        { text: "=", color: "rgb(204, 204, 204)", font: "normal" },
        { text: '"Semlo"', color: "rgb(98, 136, 84)", font: "normal" },
      ],
    ],
  },
  {
    language: "protobuf",
    source: 'syntax = "proto3";\nmessage Person { string name = 1; }\n',
    samples: [
      [
        { text: "syntax", color: "rgb(225, 0, 35)", font: "normal" },
        { text: "Person", color: "rgb(35, 41, 48)", font: "normal" },
        { text: '"proto3"', color: "rgb(0, 47, 109)", font: "normal" },
      ],
      [
        { text: "syntax", color: "rgb(215, 58, 73)", font: "normal" },
        { text: "Person", color: "rgb(35, 41, 48)", font: "normal" },
        { text: '"proto3"', color: "rgb(102, 153, 0)", font: "normal" },
      ],
      [
        { text: "syntax", color: "rgb(40, 105, 201)", font: "normal" },
        { text: "Person", color: "rgb(53, 53, 53)", font: "normal" },
        { text: '"proto3"', color: "rgb(247, 128, 0)", font: "normal" },
      ],
      [
        { text: "syntax", color: "rgb(211, 113, 227)", font: "normal" },
        { text: "Person", color: "rgb(240, 99, 114)", font: "normal" },
        { text: '"proto3"', color: "rgb(139, 197, 111)", font: "normal" },
      ],
      [
        { text: "syntax", color: "rgb(209, 141, 240)", font: "italic" },
        { text: "Person", color: "rgb(90, 222, 202)", font: "italic" },
        { text: '"proto3"', color: "rgb(243, 195, 132)", font: "normal" },
      ],
      [
        { text: "syntax", color: "rgb(216, 126, 48)", font: "normal" },
        { text: "Person", color: "rgb(204, 204, 204)", font: "normal" },
        { text: '"proto3"', color: "rgb(98, 136, 84)", font: "normal" },
      ],
    ],
  },
  {
    language: "tcl",
    source: 'set name "Semlo"\nputs "Hello $name" ;# hi\n',
    samples: [
      [
        { text: "set", color: "rgb(225, 0, 35)", font: "normal" },
        { text: "$name", color: "rgb(35, 41, 48)", font: "normal" },
        { text: "# hi", color: "rgb(108, 119, 130)", font: "normal" },
      ],
      [
        { text: "set", color: "rgb(215, 58, 73)", font: "normal" },
        { text: "$name", color: "rgb(35, 41, 48)", font: "normal" },
        { text: "# hi", color: "rgb(106, 115, 125)", font: "normal" },
      ],
      [
        { text: "set", color: "rgb(40, 105, 201)", font: "normal" },
        { text: "$name", color: "rgb(53, 53, 53)", font: "normal" },
        { text: "# hi", color: "rgb(0, 169, 97)", font: "normal" },
      ],
      [
        { text: "set", color: "rgb(211, 113, 227)", font: "normal" },
        { text: "$name", color: "rgb(240, 99, 114)", font: "normal" },
        { text: "# hi", color: "rgb(126, 132, 143)", font: "normal" },
      ],
      [
        { text: "set", color: "rgb(209, 141, 240)", font: "italic" },
        { text: "$name", color: "rgb(90, 222, 202)", font: "italic" },
        { text: "# hi", color: "rgb(94, 120, 119)", font: "normal" },
      ],
      [
        { text: "set", color: "rgb(216, 126, 48)", font: "normal" },
        { text: "$name", color: "rgb(204, 204, 204)", font: "normal" },
        { text: "# hi", color: "rgb(112, 112, 112)", font: "normal" },
      ],
    ],
  },
  {
    language: "vbnet",
    source: 'Module Program\n  Sub Main()\n    Console.WriteLine("Hello")\n  End Sub\nEnd Module\n',
    samples: [
      [
        { text: "Module", color: "rgb(225, 0, 35)", font: "normal" },
        { text: "Program", color: "rgb(35, 41, 48)", font: "normal" },
        { text: '"Hello"', color: "rgb(0, 47, 109)", font: "normal" },
      ],
      [
        { text: "Module", color: "rgb(215, 58, 73)", font: "normal" },
        { text: "Program", color: "rgb(35, 41, 48)", font: "normal" },
        { text: '"Hello"', color: "rgb(102, 153, 0)", font: "normal" },
      ],
      [
        { text: "Module", color: "rgb(40, 105, 201)", font: "normal" },
        { text: "Program", color: "rgb(53, 53, 53)", font: "normal" },
        { text: '"Hello"', color: "rgb(247, 128, 0)", font: "normal" },
      ],
      [
        { text: "Module", color: "rgb(211, 113, 227)", font: "normal" },
        { text: "Program", color: "rgb(240, 99, 114)", font: "normal" },
        { text: '"Hello"', color: "rgb(139, 197, 111)", font: "normal" },
      ],
      [
        { text: "Module", color: "rgb(209, 141, 240)", font: "italic" },
        { text: "Program", color: "rgb(90, 222, 202)", font: "italic" },
        { text: '"Hello"', color: "rgb(243, 195, 132)", font: "normal" },
      ],
      [
        { text: "Module", color: "rgb(216, 126, 48)", font: "normal" },
        { text: "Program", color: "rgb(204, 204, 204)", font: "normal" },
        { text: '"Hello"', color: "rgb(98, 136, 84)", font: "normal" },
      ],
    ],
  },
];

test("configuration and scripting languages use observed sample colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='rest-probe';document.body.prepend(host)
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    const cases=${JSON.stringify(cases)}
    window.restProbe=createEditor({element:host,outline:false,content:{type:'doc',content:cases.flatMap(({language,source})=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text:source}]})))}})
  `,
  });
  const cards = page.locator("#rest-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(cases.length * 6);
  for (const [i, entry] of cases.entries()) {
    for (let theme = 0; theme < 6; theme++) {
      const card = cards.nth(i * 6 + theme);
      for (const sample of entry.samples[theme]) {
        const token = card.locator('[class*="semlo-editor-syntax-"]').getByText(sample.text, { exact: true }).first();
        await expect(token).toHaveCSS("color", sample.color);
        await expect(token).toHaveCSS("font-style", sample.font);
      }
    }
  }
});

test("large configuration and scripting samples fall back without changing source", () => {
  for (const { language, source } of cases) {
    const large = source.repeat(500);
    expect(
      highlightCodeSyntax(large, language as "matlab" | "pascal" | "powershell" | "protobuf" | "tcl" | "vbnet"),
    ).toBeNull();
    const root = codeLowlight.highlight(language, large);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(large);
  }
});
