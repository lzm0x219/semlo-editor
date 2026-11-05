import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Shell and Bash use observed command, flag and variable colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='shell-colors';document.body.prepend(host)
    const text='echo "$USER"\\nif [ -f "$file" ]; then\\n  printf "%s" "$file"\\nfi'
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.shellProbe=createEditor({element:host,outline:false,content:{type:'doc',content:['shell','bash'].flatMap(language=>themes.map(theme=>({type:'codeBlock',attrs:{language,theme},content:[{type:'text',text}]})))}})
  `,
  });
  const cards = page.locator("#shell-colors .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(161, 48, 0)", "rgb(0, 79, 180)"],
    ["rgb(111, 66, 193)", "rgb(161, 48, 0)", "rgb(111, 66, 193)"],
    ["rgb(40, 105, 201)", "rgb(144, 32, 204)", "rgb(102, 136, 0)"],
    ["rgb(67, 176, 245)", "rgb(235, 191, 111)", "rgb(218, 152, 92)"],
    ["rgb(255, 212, 0)", "rgb(121, 169, 255)", "rgb(188, 230, 102)"],
    ["rgb(204, 204, 204)", "rgb(255, 196, 90)", "rgb(204, 204, 204)"],
  ];
  await expect(cards).toHaveCount(12);
  for (let i = 0; i < 12; i++) {
    const card = cards.nth(i),
      theme = i % 6;
    const builtin = card.locator(".semlo-editor-syntax-builtin").getByText("echo", { exact: true });
    const variable = card.locator(".semlo-editor-syntax-definition").getByText("$USER", { exact: true });
    const flag = card.locator(".semlo-editor-syntax-attribute").getByText("-f", { exact: true });
    await expect(builtin).toHaveCSS("color", colors[theme][0]);
    await expect(variable).toHaveCSS("color", colors[theme][1]);
    await expect(flag).toHaveCSS("color", colors[theme][2]);
    await expect(builtin).toHaveCSS("font-style", theme === 4 ? "italic" : "normal");
    await expect(variable).toHaveCSS("font-style", theme === 4 ? "italic" : "normal");
  }
});

test("large Shell source is preserved whether semantic parsing finishes or falls back", () => {
  const source = 'echo "$USER"\nif [ -f "$file" ]; then echo "$file"; fi\n'.repeat(7000);
  const root = codeLowlight.highlight("shell", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});

test("dense Shell blocks use bounded semantic highlighting before fallback", () => {
  const source = 'echo "$USER"\nif [ -f "$file" ]; then echo "$file"; fi\n'.repeat(700);
  expect(highlightCodeSyntax(source, "shell")).toBeNull();
  const root = codeLowlight.highlight("shell", source);
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
});

test("Shell shebang and heredoc use observed six-theme colors", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='shell-heredoc';document.body.prepend(host)
    const text='#!/bin/bash\\ncat <<EOF\\nHello $USER\\nEOF'
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.shellProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'shell',theme},content:[{type:'text',text}]}))}})
  `,
  });
  const cards = page.locator("#shell-heredoc .semlo-editor-code-card");
  const colors = [
    ["rgb(0, 79, 180)", "rgb(125, 89, 89)"],
    ["rgb(31, 127, 154)", "rgb(102, 153, 0)"],
    ["rgb(53, 53, 53)", "rgb(125, 89, 89)"],
    ["rgb(29, 184, 196)", "rgb(139, 197, 111)"],
    ["rgb(188, 230, 102)", "rgb(125, 89, 89)"],
    ["rgb(204, 204, 204)", "rgb(180, 85, 85)"],
  ];
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    await expect(card.locator(".semlo-editor-syntax-meta").getByText("#!/bin/bash", { exact: true })).toHaveCSS(
      "color",
      colors[i][0],
    );
    const heredoc = card.locator(".semlo-editor-syntax-special-string").getByText("Hello $USER", { exact: true });
    await expect(heredoc).toHaveCSS("color", colors[i][1]);
    await expect(heredoc).toHaveCSS("font-style", "normal");
  }
});
