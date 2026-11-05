import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Markdown heading and delimiters follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = "# Heading\n\n**bold** and `code`\n> quote\n\n- [x] task\n[link](https://example.com)\n";
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='markdown-probe';document.body.prepend(host)
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.markdownProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
  `,
  });
  const colors = [
    ["rgb(35, 41, 48)", "rgb(0, 79, 180)"],
    ["rgb(0, 0, 255)", "rgb(31, 127, 154)"],
    ["rgb(53, 53, 53)", "rgb(53, 53, 53)"],
    ["rgb(169, 178, 192)", "rgb(29, 184, 196)"],
    ["rgb(212, 222, 236)", "rgb(188, 230, 102)"],
    ["rgb(204, 204, 204)", "rgb(204, 204, 204)"],
  ];
  const cards = page.locator("#markdown-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const heading = card.locator(".semlo-editor-syntax-markdown-heading").getByText("Heading", { exact: true });
    const marker = card.locator(".semlo-editor-syntax-meta").getByText("#", { exact: true });
    const emphasis = card.locator(".semlo-editor-syntax-meta").getByText("**", { exact: true }).first();
    const link = card.locator(".semlo-editor-syntax-meta").getByText("[", { exact: true }).last();
    await expect(heading).toHaveCSS("color", colors[i][0]);
    await expect(heading).toHaveClass(/\bhljs-section\b/);
    for (const token of [marker, emphasis, link]) {
      await expect(token).toHaveCSS("color", colors[i][1]);
      await expect(token).toHaveCSS("font-style", "normal");
    }
  }
  const result = highlightCodeSyntax(source, "markdown");
  expect(result?.children.some((child) => child.type === "text" && child.value.includes("bold"))).toBe(true);
});

test("large or unsupported fenced Markdown falls back without changing source", () => {
  for (const source of [
    "# Heading\n".repeat(2000),
    "~~~graphql\ntype Query {}\n~~~\n",
    "> ```graphql\n> type Query {}\n> ```\n",
    "- ```graphql\n  type Query {}\n  ```\n",
    "```\nplain code\n```\n",
    "```css\n" + ".box { color: red; }\n".repeat(300) + "```\n",
  ]) {
    expect(highlightCodeSyntax(source, "markdown")).toBeNull();
    const root = codeLowlight.highlight("markdown", source);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});

test("Markdown Go fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = '```go\npackage main\nfunc main() { fmt.Println("hi") }\n```\n';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-go-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.markdownGoProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
    `,
  });
  const colors = [
    ["rgb(225, 0, 35)", "rgb(35, 41, 48)", "rgb(0, 79, 180)", "rgb(0, 47, 109)"],
    ["rgb(215, 58, 73)", "rgb(35, 41, 48)", "rgb(0, 92, 197)", "rgb(102, 153, 0)"],
    ["rgb(40, 105, 201)", "rgb(53, 53, 53)", "rgb(102, 136, 0)", "rgb(247, 128, 0)"],
    ["rgb(211, 113, 227)", "rgb(240, 99, 114)", "rgb(218, 152, 92)", "rgb(139, 197, 111)"],
    ["rgb(209, 141, 240)", "rgb(90, 222, 202)", "rgb(255, 133, 99)", "rgb(243, 195, 132)"],
    ["rgb(216, 126, 48)", "rgb(204, 204, 204)", "rgb(113, 159, 197)", "rgb(98, 136, 84)"],
  ];
  const cards = page.locator("#markdown-go-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      [".semlo-editor-syntax-keyword", "package"],
      [".semlo-editor-syntax-variable", "fmt"],
      [".semlo-editor-syntax-number", "."],
      [".semlo-editor-syntax-string", '"hi"'],
    ];
    for (const [index, [selector, value]] of tokens.entries()) {
      const token = card.locator(selector).getByText(value, { exact: true }).first();
      await expect(token).toHaveCSS("color", colors[i][index]);
      await expect(token).toHaveCSS("font-style", i === 4 && index < 2 ? "italic" : "normal");
    }
  }
});

test("Markdown SQL fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = "```sql\nSELECT name FROM users WHERE id = 3;\n```\n";
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-sql-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.markdownSqlProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
    `,
  });
  const colors = [
    ["rgb(225, 0, 35)", "rgb(225, 0, 35)", "rgb(0, 79, 180)", "rgb(38, 44, 49)"],
    ["rgb(215, 58, 73)", "rgb(225, 0, 35)", "rgb(0, 92, 197)", "rgb(38, 38, 38)"],
    ["rgb(40, 105, 201)", "rgb(40, 105, 201)", "rgb(102, 136, 0)", "rgb(54, 54, 54)"],
    ["rgb(211, 113, 227)", "rgb(29, 184, 196)", "rgb(218, 152, 92)", "rgb(169, 178, 192)"],
    ["rgb(209, 141, 240)", "rgb(209, 141, 240)", "rgb(255, 133, 99)", "rgb(212, 222, 236)"],
    ["rgb(216, 126, 48)", "rgb(204, 204, 204)", "rgb(113, 159, 197)", "rgb(204, 204, 204)"],
  ];
  const cards = page.locator("#markdown-sql-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      [".semlo-editor-syntax-keyword", "SELECT"],
      [".semlo-editor-syntax-operator", "="],
      [".semlo-editor-syntax-number", "3"],
      [".semlo-editor-syntax-punctuation", ";"],
    ];
    for (const [index, [selector, value]] of tokens.entries()) {
      const token = card.locator(selector).getByText(value, { exact: true }).first();
      await expect(token).toHaveCSS("color", colors[i][index]);
      await expect(token).toHaveCSS("font-style", i === 4 && index === 0 ? "italic" : "normal");
    }
  }
});

test("Markdown Bash fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = '```bash\necho "$USER"\n```\n';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-bash-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.markdownBashProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
    `,
  });
  const colors = [
    ["rgb(0, 79, 180)", "rgb(161, 48, 0)", "rgb(0, 47, 109)"],
    ["rgb(111, 66, 193)", "rgb(161, 48, 0)", "rgb(102, 153, 0)"],
    ["rgb(40, 105, 201)", "rgb(144, 32, 204)", "rgb(247, 128, 0)"],
    ["rgb(67, 176, 245)", "rgb(235, 191, 111)", "rgb(139, 197, 111)"],
    ["rgb(255, 212, 0)", "rgb(121, 169, 255)", "rgb(243, 195, 132)"],
    ["rgb(204, 204, 204)", "rgb(255, 196, 90)", "rgb(98, 136, 84)"],
  ];
  const cards = page.locator("#markdown-bash-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      [".semlo-editor-syntax-builtin", "echo"],
      [".semlo-editor-syntax-definition", "$USER"],
      [".semlo-editor-syntax-string", '"'],
    ];
    for (const [index, [selector, value]] of tokens.entries()) {
      const token = card.locator(selector).getByText(value, { exact: true }).first();
      await expect(token).toHaveCSS("color", colors[i][index]);
      await expect(token).toHaveCSS("font-style", i === 4 && index < 2 ? "italic" : "normal");
    }
  }
});

test("SQL, Bash, CSS and JavaScript fence mappings do not bleed into one another", () => {
  const source =
    '```js\nconst x = 3\n```\n```css\n.box { color: red; }\n```\n> ```sh\n> echo "$USER"\n> ```\n```sql\nSELECT name FROM users;\n```\n';
  const root = highlightCodeSyntax(source, "markdown");
  expect(root).not.toBeNull();
  if (!root) throw new Error("Expected embedded highlighting");
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
  for (const [value, className] of [
    ["x", "semlo-editor-syntax-definition"],
    ["red", "semlo-editor-syntax-atom"],
    ["echo", "semlo-editor-syntax-builtin"],
    ["$USER", "semlo-editor-syntax-definition"],
    ["SELECT", "semlo-editor-syntax-keyword"],
  ]) {
    expect(
      root.children.some(
        (node) => node.type === "element" && text(node) === value && node.properties.className.includes(className),
      ),
    ).toBe(true);
  }
});

test("Markdown CSS fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = "```css\n.box { color: red; }\n```\n";
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-css-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.markdownCssProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
    `,
  });
  const colors = [
    ["rgb(161, 48, 0)", "rgb(140, 72, 231)", "rgb(0, 79, 180)"],
    ["rgb(161, 48, 0)", "rgb(0, 92, 197)", "rgb(153, 0, 85)"],
    ["rgb(144, 32, 204)", "rgb(53, 53, 53)", "rgb(247, 128, 0)"],
    ["rgb(235, 191, 111)", "rgb(67, 176, 245)", "rgb(218, 152, 92)"],
    ["rgb(121, 169, 255)", "rgb(121, 169, 255)", "rgb(255, 69, 113)"],
    ["rgb(255, 196, 90)", "rgb(255, 196, 90)", "rgb(165, 120, 180)"],
  ];
  const cards = page.locator("#markdown-css-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      [".semlo-editor-syntax-definition", "box"],
      [".semlo-editor-syntax-property", "color"],
      [".semlo-editor-syntax-atom", "red"],
    ];
    for (const [index, [selector, value]] of tokens.entries()) {
      const token = card.locator(selector).getByText(value, { exact: true });
      await expect(token).toHaveCSS("color", colors[i][index]);
      await expect(token).toHaveCSS("font-style", i === 4 && index < 2 ? "italic" : "normal");
    }
  }
});

test("CSS fence mapping stays local alongside JavaScript and nested prefixes", () => {
  const sources = [
    "```js\nconst x = 3\n```\n```css\n.box { color: red; }\n```\n",
    "> ```css\n> .box { color: red; }\n> ```\n",
  ];
  for (const source of sources) {
    const root = highlightCodeSyntax(source, "markdown");
    expect(root).not.toBeNull();
    if (!root) throw new Error("Expected embedded CSS highlighting");
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
    expect(
      root.children.some(
        (node) =>
          node.type === "element" &&
          text(node) === "red" &&
          node.properties.className.includes("semlo-editor-syntax-atom"),
      ),
    ).toBe(true);
    if (source.startsWith("```js")) {
      expect(
        root.children.some(
          (node) =>
            node.type === "element" &&
            text(node) === "x" &&
            node.properties.className.includes("semlo-editor-syntax-definition"),
        ),
      ).toBe(true);
    }
  }
});

test("Markdown Rust and HTML fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const sources = ["```rust\nfn main() { let x: i32 = 3; }\n```\n", '```html\n<div class="box">hi</div>\n```\n'];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-rusthtml-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.markdownRustHtmlProbe=createEditor({element:host,outline:false,content:{type:'doc',content:${JSON.stringify(sources)}.flatMap(text=>themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text}]})))}})
    `,
  });
  const colors = [
    ["rgb(225, 0, 35)", "rgb(161, 48, 0)", "rgb(0, 79, 180)", "rgb(0, 79, 180)", "rgb(0, 47, 109)"],
    ["rgb(215, 58, 73)", "rgb(161, 48, 0)", "rgb(34, 134, 58)", "rgb(111, 66, 193)", "rgb(102, 153, 0)"],
    ["rgb(40, 105, 201)", "rgb(144, 32, 204)", "rgb(83, 83, 83)", "rgb(102, 136, 0)", "rgb(247, 128, 0)"],
    ["rgb(211, 113, 227)", "rgb(235, 191, 111)", "rgb(29, 184, 196)", "rgb(218, 152, 92)", "rgb(139, 197, 111)"],
    ["rgb(209, 141, 240)", "rgb(121, 169, 255)", "rgb(188, 230, 102)", "rgb(188, 230, 102)", "rgb(243, 195, 132)"],
    ["rgb(216, 126, 48)", "rgb(255, 196, 90)", "rgb(255, 196, 90)", "rgb(204, 204, 204)", "rgb(98, 136, 84)"],
  ];
  const cards = page.locator("#markdown-rusthtml-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(12);
  for (let i = 0; i < 12; i++) {
    const card = cards.nth(i);
    const theme = i % 6;
    const html = i >= 6;
    const tokens = html
      ? ([
          [".semlo-editor-syntax-tag", "div", 2],
          [".semlo-editor-syntax-attribute", "class", 3],
          [".semlo-editor-syntax-string", '"box"', 4],
        ] as const)
      : ([
          [".semlo-editor-syntax-keyword", "fn", 0],
          [".semlo-editor-syntax-definition", "main", 1],
          [".semlo-editor-syntax-type", "i32", 2],
        ] as const);
    for (const [selector, value, color] of tokens) {
      const token = card.locator(selector).getByText(value, { exact: true }).first();
      await expect(token).toHaveCSS("color", colors[theme][color]);
      await expect(token).toHaveCSS("font-style", theme === 4 && color !== 4 ? "italic" : "normal");
    }
  }
});

test("Markdown TypeScript and Python fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const sources = ["```typescript\nconst count: number = 3\n```\n", "```python\ndef add(x):\n  return x + 3\n```\n"];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-tspy-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.markdownTspyProbe=createEditor({element:host,outline:false,content:{type:'doc',content:${JSON.stringify(sources)}.flatMap(text=>themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text}]})))}})
    `,
  });
  const colors = [
    ["rgb(225, 0, 35)", "rgb(161, 48, 0)", "rgb(0, 79, 180)", "rgb(35, 41, 48)"],
    ["rgb(215, 58, 73)", "rgb(161, 48, 0)", "rgb(34, 134, 58)", "rgb(35, 41, 48)"],
    ["rgb(40, 105, 201)", "rgb(144, 32, 204)", "rgb(83, 83, 83)", "rgb(53, 53, 53)"],
    ["rgb(211, 113, 227)", "rgb(235, 191, 111)", "rgb(29, 184, 196)", "rgb(240, 99, 114)"],
    ["rgb(209, 141, 240)", "rgb(121, 169, 255)", "rgb(188, 230, 102)", "rgb(90, 222, 202)"],
    ["rgb(216, 126, 48)", "rgb(255, 196, 90)", "rgb(255, 196, 90)", "rgb(204, 204, 204)"],
  ];
  const cards = page.locator("#markdown-tspy-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(12);
  for (let i = 0; i < 12; i++) {
    const card = cards.nth(i);
    const theme = i % 6;
    const python = i >= 6;
    const tokens = [
      [".semlo-editor-syntax-keyword", python ? "def" : "const", 0],
      [".semlo-editor-syntax-definition", python ? "add" : "count", 1],
      [python ? ".semlo-editor-syntax-variable" : ".semlo-editor-syntax-type", python ? "x" : "number", python ? 3 : 2],
    ] as const;
    for (const [selector, value, color] of tokens) {
      const token = card.locator(selector).getByText(value, { exact: true }).first();
      await expect(token).toHaveCSS("color", colors[theme][color]);
      await expect(token).toHaveCSS("font-style", theme === 4 ? "italic" : "normal");
    }
  }
});

test("Markdown JSON fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = '```json\n{"count": 3}\n```\n';
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-json-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.markdownJsonProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
    `,
  });
  const colors = [
    ["rgb(140, 72, 231)", "rgb(0, 79, 180)", "rgb(38, 44, 49)", "rgb(0, 79, 180)"],
    ["rgb(0, 92, 197)", "rgb(0, 92, 197)", "rgb(38, 38, 38)", "rgb(31, 127, 154)"],
    ["rgb(53, 53, 53)", "rgb(102, 136, 0)", "rgb(54, 54, 54)", "rgb(53, 53, 53)"],
    ["rgb(67, 176, 245)", "rgb(218, 152, 92)", "rgb(169, 178, 192)", "rgb(29, 184, 196)"],
    ["rgb(121, 169, 255)", "rgb(255, 133, 99)", "rgb(212, 222, 236)", "rgb(188, 230, 102)"],
    ["rgb(255, 196, 90)", "rgb(113, 159, 197)", "rgb(204, 204, 204)", "rgb(204, 204, 204)"],
  ];
  const cards = page.locator("#markdown-json-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      [".semlo-editor-syntax-property", '"count"'],
      [".semlo-editor-syntax-number", "3"],
      [".semlo-editor-syntax-punctuation", "{"],
      [".semlo-editor-syntax-meta", "```"],
    ];
    for (const [index, [selector, value]] of tokens.entries()) {
      const token = card.locator(selector).getByText(value, { exact: true }).first();
      await expect(token).toHaveCSS("color", colors[i][index]);
      await expect(token).toHaveCSS("font-style", i === 4 && index === 0 ? "italic" : "normal");
    }
    await expect(card.locator(".semlo-editor-syntax-punctuation").getByText(":", { exact: true })).toHaveCSS(
      "color",
      colors[i][2],
    );
  }
});

test("Markdown JavaScript fences follow observed syntax colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source = "# Heading\n\n```js\nconst x = 3\n```\n";
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-fence-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.markdownFenceProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
    `,
  });
  const colors = [
    ["rgb(225, 0, 35)", "rgb(161, 48, 0)", "rgb(225, 0, 35)", "rgb(0, 79, 180)", "rgb(0, 79, 180)"],
    ["rgb(215, 58, 73)", "rgb(161, 48, 0)", "rgb(225, 0, 35)", "rgb(0, 92, 197)", "rgb(31, 127, 154)"],
    ["rgb(40, 105, 201)", "rgb(144, 32, 204)", "rgb(40, 105, 201)", "rgb(102, 136, 0)", "rgb(53, 53, 53)"],
    ["rgb(211, 113, 227)", "rgb(235, 191, 111)", "rgb(29, 184, 196)", "rgb(218, 152, 92)", "rgb(29, 184, 196)"],
    ["rgb(209, 141, 240)", "rgb(121, 169, 255)", "rgb(209, 141, 240)", "rgb(255, 133, 99)", "rgb(188, 230, 102)"],
    ["rgb(216, 126, 48)", "rgb(255, 196, 90)", "rgb(204, 204, 204)", "rgb(113, 159, 197)", "rgb(204, 204, 204)"],
  ];
  const cards = page.locator("#markdown-fence-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    const tokens = [
      [".semlo-editor-syntax-keyword", "const"],
      [".semlo-editor-syntax-definition", "x"],
      [".semlo-editor-syntax-operator", "="],
      [".semlo-editor-syntax-number", "3"],
      [".semlo-editor-syntax-meta", "```"],
    ];
    for (const [index, [selector, value]] of tokens.entries()) {
      const token = card.locator(selector).getByText(value, { exact: true }).first();
      await expect(token).toHaveCSS("color", colors[i][index]);
      await expect(token).toHaveCSS("font-style", i === 4 && index < 2 ? "italic" : "normal");
    }
  }
});

test("supported fences retain nested prefixes and the complete source", () => {
  for (const source of [
    "> ```js\n> const x = 3\n> ```\n",
    "- ```javascript\n  const x = 3\n  ```\n",
    "> ```py\n> def add(x):\n>   return x + 3\n> ```\n",
    "- ```ts\n  const count: number = 3\n  ```\n",
    '> ```json\n> {"count": 3}\n> ```\n',
    "> ```rs\n> fn main() {}\n> ```\n",
    '- ```htm\n  <div class="box">hi</div>\n  ```\n',
    '> ```go\n> func main() { fmt.Println("hi") }\n> ```\n',
  ]) {
    const root = highlightCodeSyntax(source, "markdown");
    expect(root).not.toBeNull();
    if (!root) throw new Error("Expected embedded highlighting");
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});

test("Markdown C-like fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const samples: { source: string; tokens: [string, string][] }[] = [
    {
      source: "```java\nclass Main { int x = 3; }\n```\n",
      tokens: [
        ["class", "keyword"],
        ["Main", "definition"],
        ["{", "punctuation"],
        ["int", "type"],
        ["x", "definition"],
        ["=", "operator"],
        ["3", "number"],
        [";", "punctuation"],
        ["}", "punctuation"],
      ],
    },
    {
      source: "```c\nint main() { return 3; }\n```\n",
      tokens: [
        ["int", "type"],
        ["main", "definition"],
        ["return", "keyword"],
        ["3", "number"],
      ],
    },
    {
      source: "```cpp\nint main() { return 3; }\n```\n",
      tokens: [
        ["int", "type"],
        ["main", "definition"],
        ["(", "punctuation"],
        [")", "punctuation"],
        ["{", "punctuation"],
        ["return", "keyword"],
        ["3", "number"],
        ["}", "punctuation"],
      ],
    },
    {
      source: "```c#\nclass Main { int x = 3; }\n```\n",
      tokens: [
        ["class", "keyword"],
        ["Main", "definition"],
        ["int", "type"],
        ["x", "variable"],
        ["=", "operator"],
        ["3", "number"],
      ],
    },
  ];
  const expected: Record<string, string[][]> = {
    keyword: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(215, 58, 73)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(211, 113, 227)", "normal"],
      ["rgb(209, 141, 240)", "italic"],
      ["rgb(216, 126, 48)", "normal"],
    ],
    definition: [
      ["rgb(161, 48, 0)", "normal"],
      ["rgb(161, 48, 0)", "normal"],
      ["rgb(144, 32, 204)", "normal"],
      ["rgb(235, 191, 111)", "normal"],
      ["rgb(121, 169, 255)", "italic"],
      ["rgb(255, 196, 90)", "normal"],
    ],
    punctuation: [
      ["rgb(38, 44, 49)", "normal"],
      ["rgb(38, 38, 38)", "normal"],
      ["rgb(54, 54, 54)", "normal"],
      ["rgb(169, 178, 192)", "normal"],
      ["rgb(212, 222, 236)", "normal"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    type: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(34, 134, 58)", "normal"],
      ["rgb(83, 83, 83)", "normal"],
      ["rgb(29, 184, 196)", "normal"],
      ["rgb(188, 230, 102)", "italic"],
      ["rgb(255, 196, 90)", "normal"],
    ],
    operator: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(29, 184, 196)", "normal"],
      ["rgb(209, 141, 240)", "normal"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    number: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(0, 92, 197)", "normal"],
      ["rgb(102, 136, 0)", "normal"],
      ["rgb(218, 152, 92)", "normal"],
      ["rgb(255, 133, 99)", "normal"],
      ["rgb(113, 159, 197)", "normal"],
    ],
    variable: [
      ["rgb(35, 41, 48)", "normal"],
      ["rgb(35, 41, 48)", "normal"],
      ["rgb(53, 53, 53)", "normal"],
      ["rgb(240, 99, 114)", "normal"],
      ["rgb(90, 222, 202)", "italic"],
      ["rgb(204, 204, 204)", "normal"],
    ],
  };
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-clike-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      const samples=${JSON.stringify(samples)}
      window.markdownClikeProbe=createEditor({element:host,outline:false,content:{type:'doc',content:samples.flatMap(sample=>themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:sample.source}]})))}})
    `,
  });
  const cards = page.locator("#markdown-clike-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(samples.length * 6);
  for (const [sampleIndex, sample] of samples.entries()) {
    for (let i = 0; i < 6; i++) {
      const card = cards.nth(sampleIndex * 6 + i);
      for (const [value, selector] of sample.tokens) {
        const element = card.locator(`.semlo-editor-syntax-${selector}`).getByText(value, { exact: true }).first();
        await expect(element).toHaveCSS("color", expected[selector][i][0]);
        await expect(element).toHaveCSS("font-style", expected[selector][i][1]);
      }
    }
  }
});

test("C-like fence aliases coexist with other fenced languages and preserve source", () => {
  const aliases = ["c", "h", "ino", "cpp", "c++", "cc", "cxx", "hpp", "h++", "hh", "hxx", "java", "c#", "cs"];
  const source =
    aliases.map((alias) => `\`\`\`${alias}\nint main() { return 3; }\n\`\`\`\n`).join("") +
    '```css\n.box { color: red; }\n```\n```sh\necho "$USER"\n```\n';
  const root = highlightCodeSyntax(source, "markdown");
  expect(root).not.toBeNull();
  if (!root) throw new Error("Expected embedded highlighting");
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
  expect(
    root.children.filter(
      (node) =>
        node.type === "element" &&
        text(node) === "return" &&
        node.properties.className.includes("semlo-editor-syntax-keyword"),
    ),
  ).toHaveLength(aliases.length);
  for (const [value, className] of [
    ["red", "semlo-editor-syntax-atom"],
    ["$USER", "semlo-editor-syntax-definition"],
  ]) {
    expect(
      root.children.some(
        (node) => node.type === "element" && text(node) === value && node.properties.className.includes(className),
      ),
    ).toBe(true);
  }
});

test("Markdown Swift and Kotlin fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const samples: { source: string; tokens: [string, string][] }[] = [
    {
      source: '```swift\nlet name: String = "hi"\nprint(name)\n```\n',
      tokens: [
        ["let", "keyword"],
        ["name", "definition"],
        [":", "punctuation"],
        ["String", "type"],
        ["=", "operator"],
        ['"hi"', "string"],
        ["print", "variable"],
        ["(", "punctuation"],
        ["name", "variable"],
        [")", "punctuation"],
      ],
    },
    {
      source: '```kotlin\nval name: String = "hi"\nprintln(name)\n```\n',
      tokens: [
        ["val", "keyword"],
        ["name", "definition"],
        ["String", "type"],
        ["=", "operator"],
        ['"hi"', "string"],
        ["println", "variable"],
        ["name", "variable"],
      ],
    },
  ];
  const expected: Record<string, string[][]> = {
    keyword: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(215, 58, 73)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(211, 113, 227)", "normal"],
      ["rgb(209, 141, 240)", "italic"],
      ["rgb(216, 126, 48)", "normal"],
    ],
    definition: [
      ["rgb(161, 48, 0)", "normal"],
      ["rgb(161, 48, 0)", "normal"],
      ["rgb(144, 32, 204)", "normal"],
      ["rgb(235, 191, 111)", "normal"],
      ["rgb(121, 169, 255)", "italic"],
      ["rgb(255, 196, 90)", "normal"],
    ],
    punctuation: [
      ["rgb(38, 44, 49)", "normal"],
      ["rgb(38, 38, 38)", "normal"],
      ["rgb(54, 54, 54)", "normal"],
      ["rgb(169, 178, 192)", "normal"],
      ["rgb(212, 222, 236)", "normal"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    type: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(34, 134, 58)", "normal"],
      ["rgb(83, 83, 83)", "normal"],
      ["rgb(29, 184, 196)", "normal"],
      ["rgb(188, 230, 102)", "italic"],
      ["rgb(255, 196, 90)", "normal"],
    ],
    operator: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(29, 184, 196)", "normal"],
      ["rgb(209, 141, 240)", "normal"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    string: [
      ["rgb(0, 47, 109)", "normal"],
      ["rgb(102, 153, 0)", "normal"],
      ["rgb(247, 128, 0)", "normal"],
      ["rgb(139, 197, 111)", "normal"],
      ["rgb(243, 195, 132)", "normal"],
      ["rgb(98, 136, 84)", "normal"],
    ],
    variable: [
      ["rgb(35, 41, 48)", "normal"],
      ["rgb(35, 41, 48)", "normal"],
      ["rgb(53, 53, 53)", "normal"],
      ["rgb(240, 99, 114)", "normal"],
      ["rgb(90, 222, 202)", "italic"],
      ["rgb(204, 204, 204)", "normal"],
    ],
  };
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-swift-kotlin-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      const samples=${JSON.stringify(samples)}
      window.markdownSwiftKotlinProbe=createEditor({element:host,outline:false,content:{type:'doc',content:samples.flatMap(sample=>themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:sample.source}]})))}})
    `,
  });
  const cards = page.locator("#markdown-swift-kotlin-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(samples.length * 6);
  for (const [sampleIndex, sample] of samples.entries()) {
    for (let i = 0; i < 6; i++) {
      const card = cards.nth(sampleIndex * 6 + i);
      for (const [value, selector] of sample.tokens) {
        const element = card.locator(`.semlo-editor-syntax-${selector}`).getByText(value, { exact: true }).first();
        await expect(element).toHaveCSS("color", expected[selector][i][0]);
        await expect(element).toHaveCSS("font-style", expected[selector][i][1]);
      }
    }
  }
});

test("Swift, Kotlin and kt fences preserve mixed Markdown source", () => {
  const source =
    "```swift\nlet swiftValue = 3\n```\n```kt\nval kotlinValue = 3\n```\n```css\n.box { color: red; }\n```\n";
  const root = highlightCodeSyntax(source, "markdown");
  expect(root).not.toBeNull();
  if (!root) throw new Error("Expected embedded highlighting");
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
  for (const value of ["swiftValue", "kotlinValue"]) {
    expect(
      root.children.some(
        (node) =>
          node.type === "element" &&
          text(node) === value &&
          node.properties.className.includes("semlo-editor-syntax-definition"),
      ),
    ).toBe(true);
  }
  expect(
    root.children.some(
      (node) =>
        node.type === "element" &&
        text(node) === "red" &&
        node.properties.className.includes("semlo-editor-syntax-atom"),
    ),
  ).toBe(true);
});

test("Markdown YAML and TOML fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const samples: { source: string; tokens: [string, string][] }[] = [
    {
      source: "```yaml\nname: demo\nenabled: true\ncount: 3\n```\n",
      tokens: [
        ["name", "atom"],
        ["enabled", "atom"],
        ["true", "keyword"],
        ["count", "atom"],
        ["3", "number"],
      ],
    },
    {
      source: '```toml\nname = "demo"\nenabled = true\ncount = 3\n```\n',
      tokens: [
        ["name", "property"],
        ['"demo"', "string"],
        ["enabled", "property"],
        ["true", "atom"],
        ["count", "property"],
        ["3", "number"],
      ],
    },
  ];
  const expected: Record<string, string[][]> = {
    atom: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(153, 0, 85)", "normal"],
      ["rgb(247, 128, 0)", "normal"],
      ["rgb(218, 152, 92)", "normal"],
      ["rgb(255, 69, 113)", "normal"],
      ["rgb(165, 120, 180)", "normal"],
    ],
    keyword: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(215, 58, 73)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(211, 113, 227)", "normal"],
      ["rgb(209, 141, 240)", "italic"],
      ["rgb(216, 126, 48)", "normal"],
    ],
    number: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(0, 92, 197)", "normal"],
      ["rgb(102, 136, 0)", "normal"],
      ["rgb(218, 152, 92)", "normal"],
      ["rgb(255, 133, 99)", "normal"],
      ["rgb(113, 159, 197)", "normal"],
    ],
    property: [
      ["rgb(140, 72, 231)", "normal"],
      ["rgb(0, 92, 197)", "normal"],
      ["rgb(53, 53, 53)", "normal"],
      ["rgb(67, 176, 245)", "normal"],
      ["rgb(121, 169, 255)", "italic"],
      ["rgb(255, 196, 90)", "normal"],
    ],
    string: [
      ["rgb(0, 47, 109)", "normal"],
      ["rgb(102, 153, 0)", "normal"],
      ["rgb(247, 128, 0)", "normal"],
      ["rgb(139, 197, 111)", "normal"],
      ["rgb(243, 195, 132)", "normal"],
      ["rgb(98, 136, 84)", "normal"],
    ],
  };
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-yaml-toml-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      const samples=${JSON.stringify(samples)}
      window.markdownYamlTomlProbe=createEditor({element:host,outline:false,content:{type:'doc',content:samples.flatMap(sample=>themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:sample.source}]})))}})
    `,
  });
  const cards = page.locator("#markdown-yaml-toml-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(samples.length * 6);
  for (const [sampleIndex, sample] of samples.entries()) {
    for (let i = 0; i < 6; i++) {
      const card = cards.nth(sampleIndex * 6 + i);
      for (const [value, selector] of sample.tokens) {
        const element = card.locator(`.semlo-editor-syntax-${selector}`).getByText(value, { exact: true }).first();
        await expect(element).toHaveCSS("color", expected[selector][i][0]);
        await expect(element).toHaveCSS("font-style", expected[selector][i][1]);
      }
    }
  }
});

test("YAML and TOML mappings stay scoped across mixed fences and preserve source", () => {
  const source =
    '> ```yml\n> enabled: true\n> ```\n```toml\nenabled = true\n```\n```js\nconst enabled = true\n```\n```css\n.box { color: red; }\n```\n```sh\necho "$USER"\n```\n```sql\nSELECT name FROM users;\n```\n';
  const root = highlightCodeSyntax(source, "markdown");
  expect(root).not.toBeNull();
  if (!root) throw new Error("Expected embedded highlighting");
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
  for (const [value, className] of [
    ["enabled", "semlo-editor-syntax-atom"],
    ["enabled", "semlo-editor-syntax-property"],
    ["true", "semlo-editor-syntax-keyword"],
    ["true", "semlo-editor-syntax-atom"],
    ["red", "semlo-editor-syntax-atom"],
    ["$USER", "semlo-editor-syntax-definition"],
    ["SELECT", "semlo-editor-syntax-keyword"],
  ]) {
    expect(
      root.children.some(
        (node) => node.type === "element" && text(node) === value && node.properties.className.includes(className),
      ),
    ).toBe(true);
  }
  for (const language of ["yaml", "yml", "toml"]) {
    expect(highlightCodeSyntax(`\`\`\`${language}\n` + "name: value\n".repeat(500) + "```\n", "markdown")).toBeNull();
  }
});

test("Markdown XML and Ruby fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const samples: { source: string; tokens: [string, string][] }[] = [
    {
      source: '```ruby\nclass Main\n  def greet\n    puts "hi"\n  end\nend\n```\n',
      tokens: [
        ["class", "keyword"],
        ["Main", "type"],
        ["def", "keyword"],
        ["greet", "definition"],
        ["puts", "variable"],
        ['"hi"', "string"],
        ["end", "keyword"],
        ["end", "keyword"],
      ],
    },
    {
      source: '```xml\n<item name="x">hello</item>\n```\n',
      tokens: [
        ["<", "punctuation"],
        ["item", "type"],
        ["name", "attribute"],
        ["=", "operator"],
        ['"x"', "string"],
        [">", "punctuation"],
        ["</", "punctuation"],
        ["item", "type"],
        [">", "punctuation"],
      ],
    },
  ];
  const expected: Record<string, string[][]> = {
    keyword: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(215, 58, 73)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(211, 113, 227)", "normal"],
      ["rgb(209, 141, 240)", "italic"],
      ["rgb(216, 126, 48)", "normal"],
    ],
    type: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(34, 134, 58)", "normal"],
      ["rgb(83, 83, 83)", "normal"],
      ["rgb(29, 184, 196)", "normal"],
      ["rgb(188, 230, 102)", "italic"],
      ["rgb(255, 196, 90)", "normal"],
    ],
    definition: [
      ["rgb(161, 48, 0)", "normal"],
      ["rgb(161, 48, 0)", "normal"],
      ["rgb(144, 32, 204)", "normal"],
      ["rgb(235, 191, 111)", "normal"],
      ["rgb(121, 169, 255)", "italic"],
      ["rgb(255, 196, 90)", "normal"],
    ],
    variable: [
      ["rgb(35, 41, 48)", "normal"],
      ["rgb(35, 41, 48)", "normal"],
      ["rgb(53, 53, 53)", "normal"],
      ["rgb(240, 99, 114)", "normal"],
      ["rgb(90, 222, 202)", "italic"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    string: [
      ["rgb(0, 47, 109)", "normal"],
      ["rgb(102, 153, 0)", "normal"],
      ["rgb(247, 128, 0)", "normal"],
      ["rgb(139, 197, 111)", "normal"],
      ["rgb(243, 195, 132)", "normal"],
      ["rgb(98, 136, 84)", "normal"],
    ],
    punctuation: [
      ["rgb(38, 44, 49)", "normal"],
      ["rgb(38, 38, 38)", "normal"],
      ["rgb(54, 54, 54)", "normal"],
      ["rgb(169, 178, 192)", "normal"],
      ["rgb(212, 222, 236)", "normal"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    attribute: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(111, 66, 193)", "normal"],
      ["rgb(102, 136, 0)", "normal"],
      ["rgb(218, 152, 92)", "normal"],
      ["rgb(188, 230, 102)", "italic"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    operator: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(29, 184, 196)", "normal"],
      ["rgb(209, 141, 240)", "normal"],
      ["rgb(204, 204, 204)", "normal"],
    ],
  };
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-xml-ruby-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      const samples=${JSON.stringify(samples)}
      window.markdownXmlRubyProbe=createEditor({element:host,outline:false,content:{type:'doc',content:samples.flatMap(sample=>themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:sample.source}]})))}})
    `,
  });
  const cards = page.locator("#markdown-xml-ruby-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(samples.length * 6);
  for (const [sampleIndex, sample] of samples.entries()) {
    for (let i = 0; i < 6; i++) {
      const card = cards.nth(sampleIndex * 6 + i);
      for (const [value, selector] of sample.tokens) {
        const element = card.locator(`.semlo-editor-syntax-${selector}`).getByText(value, { exact: true }).first();
        await expect(element).toHaveCSS("color", expected[selector][i][0]);
        await expect(element).toHaveCSS("font-style", expected[selector][i][1]);
      }
    }
  }
});

test("XML and Ruby aliases stay scoped in mixed fences and preserve source", () => {
  const aliases = ["xml", "xsl", "xsd", "svg"];
  const source =
    aliases.map((alias) => `\`\`\`${alias}\n<item>hello</item>\n\`\`\`\n`).join("") +
    "> ```rb\n> class Main\n> end\n> ```\n```yml\nenabled: true\n```\n```toml\nenabled = true\n```\n```html\n<div>hello</div>\n```\n";
  const root = highlightCodeSyntax(source, "markdown");
  expect(root).not.toBeNull();
  if (!root) throw new Error("Expected embedded highlighting");
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
  expect(
    root.children.filter(
      (node) =>
        node.type === "element" &&
        text(node) === "item" &&
        node.properties.className.includes("semlo-editor-syntax-type"),
    ),
  ).toHaveLength(8);
  for (const [value, className] of [
    ["Main", "semlo-editor-syntax-type"],
    ["enabled", "semlo-editor-syntax-atom"],
    ["enabled", "semlo-editor-syntax-property"],
    ["div", "semlo-editor-syntax-tag"],
  ]) {
    expect(
      root.children.some(
        (node) => node.type === "element" && text(node) === value && node.properties.className.includes(className),
      ),
    ).toBe(true);
  }
  for (const language of [...aliases, "ruby", "rb"]) {
    expect(
      highlightCodeSyntax(`\`\`\`${language}\n` + "a very long line\n".repeat(400) + "```\n", "markdown"),
    ).toBeNull();
  }
});

test("Markdown six additional language fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const samples: { source: string; tokens: [string, string][] }[] = [
    {
      source: '```scala\nval name: String = "hi"\nprintln(name)\n```\n',
      tokens: [
        ["val", "keyword"],
        ["name", "definition"],
        ["String", "type"],
        ["=", "operator"],
        ['"hi"', "string"],
        ["println", "keyword"],
        ["name", "variable"],
      ],
    },
    {
      source: '```dart\nfinal String name = "hi";\nprint(name);\n```\n',
      tokens: [
        ["final", "keyword"],
        ["String", "variable"],
        ["name", "variable"],
        ["=", "operator"],
        ['"hi"', "string"],
        ["print", "variable"],
        ["name", "variable"],
      ],
    },
    {
      source: "```objectivec\nint main() { return 3; }\n```\n",
      tokens: [
        ["int", "type"],
        ["main", "definition"],
        ["return", "keyword"],
        ["3", "number"],
      ],
    },
    {
      source: '```groovy\ndef name = "hi"\nprintln(name)\n```\n',
      tokens: [
        ["def", "keyword"],
        ["name", "variable"],
        ["=", "operator"],
        ['"hi"', "string"],
        ["println", "variable"],
        ["name", "variable"],
      ],
    },
    {
      source: "```r\nx <- c(1, 2, 3)\nmean(x)\n```\n",
      tokens: [
        ["x", "variable"],
        ["<-", "operator"],
        ["c", "variable"],
        ["1", "number"],
        ["2", "number"],
        ["3", "number"],
        ["mean", "variable"],
        ["x", "variable"],
      ],
    },
    {
      source: '```perl\nmy $name = "hi";\nprint $name;\n```\n',
      tokens: [
        ["my", "definition"],
        ["$name", "variable"],
        ["=", "operator"],
        ['"hi"', "string"],
        ["print", "keyword"],
        ["$name", "variable"],
      ],
    },
  ];
  const expected: Record<string, string[][]> = {
    keyword: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(215, 58, 73)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(211, 113, 227)", "normal"],
      ["rgb(209, 141, 240)", "italic"],
      ["rgb(216, 126, 48)", "normal"],
    ],
    definition: [
      ["rgb(161, 48, 0)", "normal"],
      ["rgb(161, 48, 0)", "normal"],
      ["rgb(144, 32, 204)", "normal"],
      ["rgb(235, 191, 111)", "normal"],
      ["rgb(121, 169, 255)", "italic"],
      ["rgb(255, 196, 90)", "normal"],
    ],
    type: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(34, 134, 58)", "normal"],
      ["rgb(83, 83, 83)", "normal"],
      ["rgb(29, 184, 196)", "normal"],
      ["rgb(188, 230, 102)", "italic"],
      ["rgb(255, 196, 90)", "normal"],
    ],
    operator: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(29, 184, 196)", "normal"],
      ["rgb(209, 141, 240)", "normal"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    string: [
      ["rgb(0, 47, 109)", "normal"],
      ["rgb(102, 153, 0)", "normal"],
      ["rgb(247, 128, 0)", "normal"],
      ["rgb(139, 197, 111)", "normal"],
      ["rgb(243, 195, 132)", "normal"],
      ["rgb(98, 136, 84)", "normal"],
    ],
    variable: [
      ["rgb(35, 41, 48)", "normal"],
      ["rgb(35, 41, 48)", "normal"],
      ["rgb(53, 53, 53)", "normal"],
      ["rgb(240, 99, 114)", "normal"],
      ["rgb(90, 222, 202)", "italic"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    number: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(0, 92, 197)", "normal"],
      ["rgb(102, 136, 0)", "normal"],
      ["rgb(218, 152, 92)", "normal"],
      ["rgb(255, 133, 99)", "normal"],
      ["rgb(113, 159, 197)", "normal"],
    ],
  };
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-stream-six-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      const samples=${JSON.stringify(samples)}
      window.markdownStreamSixProbe=createEditor({element:host,outline:false,content:{type:'doc',content:samples.flatMap(sample=>themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:sample.source}]})))}})
    `,
  });
  const cards = page.locator("#markdown-stream-six-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(samples.length * 6);
  for (const [sampleIndex, sample] of samples.entries()) {
    for (let i = 0; i < 6; i++) {
      const card = cards.nth(sampleIndex * 6 + i);
      for (const [value, selector] of sample.tokens) {
        const element = card.locator(`.semlo-editor-syntax-${selector}`).getByText(value, { exact: true }).first();
        await expect(element).toHaveCSS("color", expected[selector][i][0]);
        await expect(element).toHaveCSS("font-style", expected[selector][i][1]);
      }
    }
  }
});

test("additional language aliases preserve source and coexist with specialized fences", () => {
  const source =
    "> ```m\n> int main() { return 3; }\n> ```\n```gradle\ndef value = 3\n```\n```pl\nmy $name = 3;\n```\n```pm\nmy $other = 3;\n```\n```R\nx <- 3\n```\n```yaml\nenabled: true\n```\n```xml\n<item />\n```\n";
  const root = highlightCodeSyntax(source, "markdown");
  expect(root).not.toBeNull();
  if (!root) throw new Error("Expected embedded highlighting");
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
  for (const [value, className] of [
    ["main", "semlo-editor-syntax-definition"],
    ["def", "semlo-editor-syntax-keyword"],
    ["$name", "semlo-editor-syntax-variable"],
    ["$other", "semlo-editor-syntax-variable"],
    ["x", "semlo-editor-syntax-variable"],
    ["enabled", "semlo-editor-syntax-atom"],
    ["item", "semlo-editor-syntax-type"],
  ]) {
    expect(
      root.children.some(
        (node) => node.type === "element" && text(node) === value && node.properties.className.includes(className),
      ),
    ).toBe(true);
  }
});

test("Markdown five additional language fences follow observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const samples: { source: string; tokens: [string, string][] }[] = [
    {
      source: "```julia\nx = [1, 2, 3]\nprintln(x)\n```\n",
      tokens: [
        ["x", "variable"],
        ["=", "operator"],
        ["1", "number"],
        ["2", "number"],
        ["3", "number"],
        ["println", "variable"],
        ["x", "variable"],
      ],
    },
    {
      source: '```haskell\nmain = putStrLn "hi"\n```\n',
      tokens: [
        ["main", "variable"],
        ["=", "keyword"],
        ["putStrLn", "variable"],
        ['"hi"', "string"],
      ],
    },
    {
      source: '```lua\nlocal name = "hi"\nprint(name)\n```\n',
      tokens: [
        ["local", "keyword"],
        ["name", "variable"],
        ['"hi"', "string"],
        ["print", "variable"],
        ["name", "variable"],
      ],
    },
    {
      source: '```powershell\n$name = "hi"\nWrite-Host $name\n```\n',
      tokens: [
        ["$name", "variable"],
        ["=", "operator"],
        ['"hi"', "string"],
        ["Write-Host", "variable"],
        ["$name", "variable"],
      ],
    },
    {
      source: "```dockerfile\nFROM node:20\nRUN npm install\n```\n",
      tokens: [
        ["FROM", "keyword"],
        ["RUN", "keyword"],
      ],
    },
  ];
  const expected: Record<string, string[][]> = {
    variable: [
      ["rgb(35, 41, 48)", "normal"],
      ["rgb(35, 41, 48)", "normal"],
      ["rgb(53, 53, 53)", "normal"],
      ["rgb(240, 99, 114)", "normal"],
      ["rgb(90, 222, 202)", "italic"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    operator: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(29, 184, 196)", "normal"],
      ["rgb(209, 141, 240)", "normal"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    number: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(0, 92, 197)", "normal"],
      ["rgb(102, 136, 0)", "normal"],
      ["rgb(218, 152, 92)", "normal"],
      ["rgb(255, 133, 99)", "normal"],
      ["rgb(113, 159, 197)", "normal"],
    ],
    keyword: [
      ["rgb(225, 0, 35)", "normal"],
      ["rgb(215, 58, 73)", "normal"],
      ["rgb(40, 105, 201)", "normal"],
      ["rgb(211, 113, 227)", "normal"],
      ["rgb(209, 141, 240)", "italic"],
      ["rgb(216, 126, 48)", "normal"],
    ],
    string: [
      ["rgb(0, 47, 109)", "normal"],
      ["rgb(102, 153, 0)", "normal"],
      ["rgb(247, 128, 0)", "normal"],
      ["rgb(139, 197, 111)", "normal"],
      ["rgb(243, 195, 132)", "normal"],
      ["rgb(98, 136, 84)", "normal"],
    ],
  };
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-stream-five-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      const samples=${JSON.stringify(samples)}
      window.markdownStreamFiveProbe=createEditor({element:host,outline:false,content:{type:'doc',content:samples.flatMap(sample=>themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:sample.source}]})))}})
    `,
  });
  const cards = page.locator("#markdown-stream-five-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(samples.length * 6);
  for (const [sampleIndex, sample] of samples.entries()) {
    for (let i = 0; i < 6; i++) {
      const card = cards.nth(sampleIndex * 6 + i);
      for (const [value, selector] of sample.tokens) {
        const element = card.locator(`.semlo-editor-syntax-${selector}`).getByText(value, { exact: true }).first();
        await expect(element).toHaveCSS("color", expected[selector][i][0]);
        await expect(element).toHaveCSS("font-style", expected[selector][i][1]);
      }
    }
  }
});

test("five additional language aliases preserve mixed Markdown source", () => {
  const source =
    "> ```jl\n> x = 3\n> ```\n```hs\nmain = 3\n```\n```ps1\n$one = 1\n```\n```psd1\n$two = 2\n```\n```psm1\n$three = 3\n```\n```Dockerfile\nFROM node:20\n```\n```xml\n<item />\n```\n";
  const root = highlightCodeSyntax(source, "markdown");
  expect(root).not.toBeNull();
  if (!root) throw new Error("Expected embedded highlighting");
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
  for (const [value, className] of [
    ["x", "semlo-editor-syntax-variable"],
    ["main", "semlo-editor-syntax-variable"],
    ["$one", "semlo-editor-syntax-variable"],
    ["$two", "semlo-editor-syntax-variable"],
    ["$three", "semlo-editor-syntax-variable"],
    ["FROM", "semlo-editor-syntax-keyword"],
    ["item", "semlo-editor-syntax-type"],
  ]) {
    expect(
      root.children.some(
        (node) => node.type === "element" && text(node) === value && node.properties.className.includes(className),
      ),
    ).toBe(true);
  }
});

test("multiline YAML, TOML, XML and Ruby fences preserve observed token boundaries", () => {
  const cases = [
    {
      source: '```yaml\n# config\napp:\n  port: 8080\n  flags: [true, false]\n  text: "hello"\n```\n',
      expected: [
        ["```", "semlo-editor-syntax-meta"],
        ["# config", "semlo-editor-syntax-comment"],
        ["app", "semlo-editor-syntax-atom"],
        [":", "semlo-editor-syntax-meta"],
        ["  port", "semlo-editor-syntax-atom"],
        [": ", "semlo-editor-syntax-meta"],
        ["8080", "semlo-editor-syntax-number"],
        ["  flags", "semlo-editor-syntax-atom"],
        [": [", "semlo-editor-syntax-meta"],
        [",", "semlo-editor-syntax-meta"],
        ["]", "semlo-editor-syntax-meta"],
        ["  text", "semlo-editor-syntax-atom"],
        [": ", "semlo-editor-syntax-meta"],
        ['"hello"', "semlo-editor-syntax-string"],
        ["```", "semlo-editor-syntax-meta"],
      ],
    },
    {
      source: '```toml\n# config\n[app]\nport = 8080\nflags = [true, false]\ntext = "hello"\n```\n',
      expected: [
        ["```", "semlo-editor-syntax-meta"],
        ["# config", "semlo-editor-syntax-comment"],
        ["[app]", "semlo-editor-syntax-atom"],
        ["port", "semlo-editor-syntax-property"],
        ["8080", "semlo-editor-syntax-number"],
        ["flags", "semlo-editor-syntax-property"],
        ["[", "semlo-editor-syntax-punctuation"],
        ["true", "semlo-editor-syntax-atom"],
        ["false", "semlo-editor-syntax-atom"],
        ["]", "semlo-editor-syntax-punctuation"],
        ["text", "semlo-editor-syntax-property"],
        ['"hello"', "semlo-editor-syntax-string"],
        ["```", "semlo-editor-syntax-meta"],
      ],
    },
    {
      source: '```xml\n<?xml version="1.0"?>\n<!-- item -->\n<app enabled="true"><port>8080</port></app>\n```\n',
      expected: [
        ["```", "semlo-editor-syntax-meta"],
        ['<?xml version="1.0"?>', "semlo-editor-syntax-meta"],
        ["<!-- item -->", "semlo-editor-syntax-comment"],
        ["<", "semlo-editor-syntax-punctuation"],
        ["app", "semlo-editor-syntax-type"],
        ["enabled", "semlo-editor-syntax-attribute"],
        ["=", "semlo-editor-syntax-operator"],
        ['"true"', "semlo-editor-syntax-string"],
        [">", "semlo-editor-syntax-punctuation"],
        ["<", "semlo-editor-syntax-punctuation"],
        ["port", "semlo-editor-syntax-type"],
        [">", "semlo-editor-syntax-punctuation"],
        ["</", "semlo-editor-syntax-punctuation"],
        ["port", "semlo-editor-syntax-type"],
        [">", "semlo-editor-syntax-punctuation"],
        ["</", "semlo-editor-syntax-punctuation"],
        ["app", "semlo-editor-syntax-type"],
        [">", "semlo-editor-syntax-punctuation"],
        ["```", "semlo-editor-syntax-meta"],
      ],
    },
    {
      source: '```ruby\n# greeting\nclass Greeter\n  def hello(name)\n    puts "Hello #{name}"\n  end\nend\n```\n',
      expected: [
        ["```", "semlo-editor-syntax-meta"],
        ["# greeting", "semlo-editor-syntax-comment"],
        ["class", "semlo-editor-syntax-keyword"],
        ["Greeter", "semlo-editor-syntax-type"],
        ["def", "semlo-editor-syntax-keyword"],
        ["hello", "semlo-editor-syntax-definition"],
        ["name", "semlo-editor-syntax-variable"],
        ["puts", "semlo-editor-syntax-variable"],
        ['"Hello #{', "semlo-editor-syntax-string"],
        ["name", "semlo-editor-syntax-variable"],
        ['}"', "semlo-editor-syntax-string"],
        ["end", "semlo-editor-syntax-keyword"],
        ["end", "semlo-editor-syntax-keyword"],
        ["```", "semlo-editor-syntax-meta"],
      ],
    },
  ];
  for (const sample of cases) {
    const root = highlightCodeSyntax(sample.source, "markdown");
    expect(root).not.toBeNull();
    if (!root) throw new Error("Expected embedded highlighting");
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(sample.source);
    const tokens = root.children
      .filter((node) => node.type === "element")
      .map((node) => {
        if (node.type !== "element") throw new Error("Expected a token");
        return [text(node), node.properties.className[0]];
      });
    expect(tokens).toEqual(sample.expected);
  }
});

test("JavaScript templates and Python f-strings in Markdown follow observed theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const samples = [
    '```js\nconst name = "Ada"; const greeting = `Hi ${name}`;\n```\n',
    '```python\nname = "Ada"\ngreeting = f"Hi {name}"\n```\n',
  ];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='markdown-interpolated-probe';document.body.prepend(host)
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      const samples=${JSON.stringify(samples)}
      window.markdownInterpolatedProbe=createEditor({element:host,outline:false,content:{type:'doc',content:samples.flatMap(sample=>themes.map(theme=>({type:'codeBlock',attrs:{language:'markdown',theme},content:[{type:'text',text:sample}]})))}})
    `,
  });
  const colors = [
    "rgb(125, 89, 89)",
    "rgb(102, 153, 0)",
    "rgb(125, 89, 89)",
    "rgb(139, 197, 111)",
    "rgb(125, 89, 89)",
    "rgb(180, 85, 85)",
  ];
  const cards = page.locator("#markdown-interpolated-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(12);
  for (let sample = 0; sample < samples.length; sample++) {
    for (let theme = 0; theme < 6; theme++) {
      const card = cards.nth(sample * 6 + theme);
      const special = card.locator(".semlo-editor-syntax-special-string").first();
      await expect(special).toHaveCSS("color", colors[theme]);
      await expect(special).toHaveCSS("font-style", "normal");
      await expect(card.locator(".semlo-editor-syntax-string").getByText('"Ada"', { exact: true })).toHaveCount(1);
    }
  }
});

test("interpolated string mappings stay within their fences and preserve large and mixed sources", () => {
  const source =
    '> ```ts\n> const greeting: string = `Hi ${name}`\n> ```\n```py\ngreeting = f"Hi {name}"\n```\n```ruby\nputs "Hi #{name}"\n```\n```yaml\nname: "Ada"\n```\n';
  const root = highlightCodeSyntax(source, "markdown");
  expect(root).not.toBeNull();
  if (!root) throw new Error("Expected embedded highlighting");
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
  for (const value of ["`Hi ", 'f"Hi ']) {
    expect(
      root.children.some(
        (node) =>
          node.type === "element" &&
          text(node) === value &&
          node.properties.className.includes("semlo-editor-syntax-special-string"),
      ),
    ).toBe(true);
  }
  expect(
    root.children.some(
      (node) =>
        node.type === "element" &&
        text(node) === '"Hi #{' &&
        node.properties.className.includes("semlo-editor-syntax-string"),
    ),
  ).toBe(true);
  const large = "```js\n// " + "x".repeat(7000) + "\n```\n";
  expect(highlightCodeSyntax(large, "markdown")).not.toBeNull();
});
