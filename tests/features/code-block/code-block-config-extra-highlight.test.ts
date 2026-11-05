import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Dockerfile, Nginx and HTTP use observed token colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const inputs = [
    [
      "dockerfile",
      '# app image\nFROM node:22\nWORKDIR /app\nCOPY package.json ./\nRUN npm install\nCMD ["npm", "start"]\n',
    ],
    [
      "nginx",
      "# server\nserver {\n  listen 80;\n  server_name example.com;\n  location / { proxy_pass http://127.0.0.1:3000; }\n}\n",
    ],
    [
      "http",
      "GET /users HTTP/1.1\nHost: example.com\nAccept: application/json\n\nHTTP/1.1 200 OK\nContent-Type: application/json\n",
    ],
  ];
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='config-extra-colors';document.body.prepend(host)
      const inputs=${JSON.stringify(inputs)}
      const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
      window.configExtraProbe=createEditor({element:host,outline:false,content:{type:'doc',content:inputs.flatMap(([language,text])=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text}]})))}})
    `,
  });
  const cards = page.locator("#config-extra-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(225, 0, 35)", "rgb(0, 47, 109)", "rgb(108, 119, 130)", "rgb(125, 89, 89)"],
    ["rgb(215, 58, 73)", "rgb(102, 153, 0)", "rgb(106, 115, 125)", "rgb(102, 153, 0)"],
    ["rgb(40, 105, 201)", "rgb(247, 128, 0)", "rgb(0, 169, 97)", "rgb(125, 89, 89)"],
    ["rgb(211, 113, 227)", "rgb(139, 197, 111)", "rgb(126, 132, 143)", "rgb(139, 197, 111)"],
    ["rgb(209, 141, 240)", "rgb(243, 195, 132)", "rgb(94, 120, 119)", "rgb(125, 89, 89)"],
    ["rgb(216, 126, 48)", "rgb(98, 136, 84)", "rgb(112, 112, 112)", "rgb(180, 85, 85)"],
  ];
  await expect(cards).toHaveCount(18);
  for (let i = 0; i < 18; i++) {
    const card = cards.nth(i),
      theme = i % 6,
      language = Math.floor(i / 6);
    const keyword = card
      .locator(".semlo-editor-syntax-keyword")
      .getByText(["FROM", "server", "GET"][language], { exact: true });
    const value =
      language === 0
        ? card.locator(".semlo-editor-syntax-string").getByText('"npm"', { exact: true })
        : language === 1
          ? card.locator(".semlo-editor-syntax-comment").getByText("# server", { exact: true })
          : card.locator(".semlo-editor-syntax-special-string").getByText("/users", { exact: true });
    await expect(keyword).toHaveCSS("color", colors[theme][0]);
    await expect(keyword).toHaveCSS("font-style", theme === 4 ? "italic" : "normal");
    await expect(value).toHaveCSS("color", colors[theme][language + 1]);
    await expect(value).toHaveCSS("font-style", "normal");
  }
});

test("large Dockerfile, Nginx and HTTP fall back without changing source", () => {
  for (const language of ["dockerfile", "nginx", "http"] as const) {
    const source = "GET /users HTTP/1.1\nHost: example.com\nAccept: application/json\n".repeat(500);
    expect(highlightCodeSyntax(source, language)).toBeNull();
    const root = codeLowlight.highlight(language, source);
    const text = (node: (typeof root.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
    expect(root.children.map(text).join("")).toBe(source);
  }
});
