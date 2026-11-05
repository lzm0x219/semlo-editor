import { expect, test } from "@rstest/playwright";

import { codeLowlight } from "../../../packages/core/src/features/code-block/languages";
import { highlightCodeSyntax } from "../../../packages/core/src/features/code-block/syntax-highlight";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Vue template, script and style match observed colors in six themes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const source =
    '<template>\n  <button class="action" @click="count++">{{ count }}</button>\n</template>\n<script setup lang="ts">\nimport { ref } from "vue"\nconst count = ref(0)\n</script>\n<style scoped>\n.action { color: red; }\n</style>\n';
  const tokens = [
    ["<", "punctuation"],
    ["template", "tag"],
    [">", "punctuation"],
    ["button", "tag"],
    ["class", "attribute"],
    ["=", "operator"],
    ['"action"', "string"],
    ["@click", "attribute"],
    ['"count++"', "string"],
    ["{{", "punctuation"],
    ["count", "variable"],
    ["}}", "punctuation"],
    ["</", "punctuation"],
    ["script", "tag"],
    ["setup", "attribute"],
    ["lang", "attribute"],
    ['"ts"', "string"],
    ["import", "keyword"],
    ["{", "punctuation"],
    ["ref", "definition"],
    ["}", "punctuation"],
    ["from", "keyword"],
    ['"vue"', "string"],
    ["const", "keyword"],
    ["count", "definition"],
    ["ref", "variable"],
    ["(", "punctuation"],
    ["0", "number"],
    [")", "punctuation"],
    ["style", "tag"],
    ["scoped", "attribute"],
    ["action", "definition"],
    ["color", "property"],
    [":", "punctuation"],
    ["red", "atom"],
    [";", "punctuation"],
  ];
  const expected: Record<string, string[][]> = {
    punctuation: [
      ["rgb(38, 44, 49)", "normal"],
      ["rgb(38, 38, 38)", "normal"],
      ["rgb(54, 54, 54)", "normal"],
      ["rgb(169, 178, 192)", "normal"],
      ["rgb(212, 222, 236)", "normal"],
      ["rgb(204, 204, 204)", "normal"],
    ],
    tag: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(34, 134, 58)", "normal"],
      ["rgb(83, 83, 83)", "normal"],
      ["rgb(29, 184, 196)", "normal"],
      ["rgb(188, 230, 102)", "italic"],
      ["rgb(255, 196, 90)", "normal"],
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
    atom: [
      ["rgb(0, 79, 180)", "normal"],
      ["rgb(153, 0, 85)", "normal"],
      ["rgb(247, 128, 0)", "normal"],
      ["rgb(218, 152, 92)", "normal"],
      ["rgb(255, 69, 113)", "normal"],
      ["rgb(165, 120, 180)", "normal"],
    ],
  };
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='vue-probe';document.body.prepend(host)
    const themes=['light-pro','light','bracket-lights-pro','dark','night-owl','darcula']
    window.vueProbe=createEditor({element:host,outline:false,content:{type:'doc',content:themes.map(theme=>({type:'codeBlock',attrs:{language:'vue',theme},content:[{type:'text',text:${JSON.stringify(source)}}]}))}})
  `,
  });
  const cards = page.locator("#vue-probe .semlo-editor-code-card");
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const card = cards.nth(i);
    for (const [value, selector] of tokens) {
      const token = card.locator(`.semlo-editor-syntax-${selector}`).getByText(value, { exact: true }).first();
      await expect(token).toHaveCSS("color", expected[selector][i][0]);
      await expect(token).toHaveCSS("font-style", expected[selector][i][1]);
    }
  }
});

test("Vue highlighting preserves source and falls back for unsupported or large input", () => {
  const source =
    '<template><div v-if="visible" :class="active" @click.stop="go()">{{ user.name }} / {{ count }}</div></template>\n<script setup lang="ts">const count: number = 1</script>';
  const root = highlightCodeSyntax(source, "vue");
  expect(root).not.toBeNull();
  if (!root) throw new Error("Expected Vue highlighting");
  const text = (node: (typeof root.children)[number]): string =>
    node.type === "text" ? node.value : node.type === "element" ? node.children.map(text).join("") : "";
  expect(root.children.map(text).join("")).toBe(source);
  for (const [value, className] of [
    ["v-if", "semlo-editor-syntax-attribute"],
    [":class", "semlo-editor-syntax-attribute"],
    ["@click.stop", "semlo-editor-syntax-attribute"],
    ["user", "semlo-editor-syntax-variable"],
    ["name", "semlo-editor-syntax-property"],
    ["number", "semlo-editor-syntax-type"],
  ]) {
    expect(
      root.children.some(
        (node) => node.type === "element" && text(node) === value && node.properties.className.includes(className),
      ),
    ).toBe(true);
  }
  for (const value of [
    '<template><div :[key]="value" /></template>',
    "<template>{{ count</template>",
    "<template>{{ a < b }}</template>",
    "<template>" + "x".repeat(6001) + "</template>",
  ]) {
    expect(highlightCodeSyntax(value, "vue")).toBeNull();
    const fallback = codeLowlight.highlight("vue", value);
    const fallbackText = (node: (typeof fallback.children)[number]): string =>
      node.type === "text" ? node.value : node.type === "element" ? node.children.map(fallbackText).join("") : "";
    expect(fallback.children.map(fallbackText).join("")).toBe(value);
  }
});
