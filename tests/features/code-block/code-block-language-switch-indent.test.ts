import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    codeSwitchEditor?: EditorController;
  }
}

test("switching a language reindents code separately from undo; plain text keeps it", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'code-switch'; host.style.width = '800px'; host.style.marginTop = '120px'; document.body.prepend(host)
    window.codeSwitchEditor = createEditor({ element: host, outline: false, content: {
      type:'doc', content:[{type:'codeBlock',attrs:{language:'javascript',indentWidth:8},
      content:[{type:'text',text:'def demo():\\n       return 1'}]}] } })
  `,
  });
  await page.waitForFunction(() => Boolean(window.codeSwitchEditor));
  const card = page.locator("#code-switch .semlo-editor-code-card");
  async function choose(name: string) {
    await card.hover();
    await card.getByRole("button", { name: "代码语言" }).click();
    await card.getByRole("combobox", { name: "搜索代码语言" }).fill(name);
    await page.getByRole("option", { name, exact: true }).click();
  }
  const text = () =>
    page.evaluate(() => window.__semloRequireFixture("codeSwitchEditor").editor.state.doc.firstChild?.textContent);
  await choose("Plain Text");
  expect(await text()).toBe("def demo():\n       return 1");
  await choose("Python");
  await expect.poll(text).toBe("def demo():\n    return 1");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeSwitchEditor").editor.commands.undo())).toBe(true);
  expect(await text()).toBe("def demo():\n       return 1");
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("codeSwitchEditor").getSnapshot())).json.content?.[0].attrs
      ?.language,
  ).toBe("python");
  await choose("Python");
  await expect.poll(text).toBe("def demo():\n    return 1");
});

test("language reindent keeps folded code folded and undo restores its previous text", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'code-switch-fold'; host.style.width = '800px'; host.style.marginTop = '120px'; document.body.prepend(host)
    window.codeSwitchEditor = createEditor({ element: host, outline: false, content: {
      type:'doc', content:[{type:'codeBlock',attrs:{language:'javascript',indentWidth:8},
      content:[{type:'text',text:'function test() {\\n       return 1;\\n}'}]}] } })
  `,
  });
  await page.waitForFunction(() => Boolean(window.codeSwitchEditor));
  const card = page.locator("#code-switch-fold .semlo-editor-code-card");
  await card.getByRole("button", { name: "折叠第 1 行代码" }).click();
  await card.hover();
  await card.getByRole("button", { name: "代码语言" }).click();
  await card.getByRole("combobox", { name: "搜索代码语言" }).fill("TypeScript");
  await page.getByRole("option", { name: "TypeScript", exact: true }).click();
  const text = () =>
    page.evaluate(() => window.__semloRequireFixture("codeSwitchEditor").editor.state.doc.firstChild?.textContent);
  await expect.poll(text).toBe("function test() {\n  return 1;\n}");
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("codeSwitchEditor").editor.commands.undo())).toBe(true);
  expect(await text()).toBe("function test() {\n       return 1;\n}");
  await expect(card.locator(".semlo-editor-code-fold-placeholder")).toBeVisible();
});

test("changing indentation settings reindents the existing code", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'code-setting-indent'; host.style.width = '800px'; host.style.marginTop = '120px'; document.body.prepend(host)
    window.codeSwitchEditor = createEditor({ element: host, outline: false, content: {
      type:'doc', content:[{type:'codeBlock',attrs:{language:'javascript'},
      content:[{type:'text',text:'function test() {\\n  return 1;\\n}'}]}] } })
  `,
  });
  await page.waitForFunction(() => Boolean(window.codeSwitchEditor));
  const card = page.locator("#code-setting-indent .semlo-editor-code-card");
  const text = () =>
    page.evaluate(() => window.__semloRequireFixture("codeSwitchEditor").editor.state.doc.firstChild?.textContent);
  await card.hover();
  await card.getByRole("button", { name: "代码块更多设置" }).click();
  const menu = page.getByRole("menu", { name: "代码块设置" });
  await menu.getByRole("menuitem", { name: "缩进宽度" }).click();
  await page.getByRole("menu", { name: "缩进宽度" }).getByRole("menuitemradio", { name: "8", exact: true }).click();
  await expect.poll(text).toBe("function test() {\n        return 1;\n}");
  await menu.getByRole("menuitem", { name: "缩进模式" }).click();
  await page.getByRole("menu", { name: "缩进模式" }).getByRole("menuitemradio", { name: "Tab", exact: true }).click();
  await expect.poll(text).toBe("function test() {\n\treturn 1;\n}");
});

test("reselecting GraphQL removes leading indentation", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
 import {createEditor} from '/dist/index.js'
 const host=document.createElement('div'); host.id='graphql-switch';host.style.width='800px';host.style.marginTop='120px';document.body.prepend(host)
 window.codeSwitchEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'graphql'},content:[{type:'text',text:'query {\\n  user {\\n    name\\n  }\\n}'}]}]}})
 `,
  });
  await page.waitForFunction(() => Boolean(window.codeSwitchEditor));
  const card = page.locator("#graphql-switch .semlo-editor-code-card");
  await card.hover();
  await card.getByRole("button", { name: "代码语言" }).click();
  await card.getByRole("combobox", { name: "搜索代码语言" }).fill("GraphQL");
  await page.getByRole("option", { name: "GraphQL（近似高亮）", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__semloRequireFixture("codeSwitchEditor").editor.state.doc.firstChild?.textContent),
    )
    .toBe("query {\nuser {\nname\n}\n}");
});

for (const [name, input, expected] of [
  ["C", "int main() {\n return 0;\n}", "int main() {\n    return 0;\n}"],
  ["C++", "int main() {\n return 0;\n}", "int main() {\n    return 0;\n}"],
  ["C#", "class Demo {\n void Run() {}\n}", "class Demo {\n    void Run() {}\n}"],
  ["Java", "class Demo {\n void run() {}\n}", "class Demo {\n    void run() {}\n}"],
  ["Go", "func main() {\n println(1)\n}", "func main() {\n    println(1)\n}"],
  ["Rust", 'fn main() {\n println!("x");\n}', 'fn main() {\n    println!("x");\n}'],
  ["JSON", '{\n "x": 1\n}', '{\n  "x": 1\n}'],
  ["CSS", ".box {\n color: red;\n}", ".box {\n  color: red;\n}"],
  ["HTML", "<div>\n <span>x</span>\n</div>", "<div>\n  <span>x</span>\n</div>"],
  ["YAML", "root:\n       child:\n          name: x", "root:\n       child:\n          name: x"],
  ["Ruby", "def demo\n       return 1\nend", "def demo\n  return 1\nend"],
  ["XML", "<root>\n       <item>x</item>\n</root>", "<root>\n  <item>x</item>\n</root>"],
  ["Bash", "if true; then\n       echo yes\nfi", "if true; then\n       echo yes\nfi"],
  ["PHP", "function demo() {\n       return 1;\n}", "function demo() {\n  return 1;\n}"],
  ["PHP", "<?php\nfunction demo() {\nreturn 1;\n}", "<?php\n  function demo() {\n  return 1;\n}"],
  ["PHP", "<?php\nfoo\n}", "<?php\n  foo\n  }"],
  [
    "PHP",
    "<div>\n<?php\nif ($x) {\necho 1;\n}\n?>\n</div>",
    "<div>\n  <?php\n  if ($x) {\n  echo 1;\n  }\n  ?>\n  </div>",
  ],
  [
    "PHP",
    "<?php\nif (true) {\nif (true) {\na();\n}\nb();\n}",
    "<?php\n  if (true) {\n  if (true) {\n  a();\n  }\n  b();\n}",
  ],
  [
    "SQL",
    "SELECT name,\n       email\nFROM users\nWHERE active = 1",
    "SELECT name,\n       email\nFROM users\nWHERE active = 1",
  ],
  [
    "SQL",
    "SELECT *\nFROM (\n       SELECT id\n       FROM users\n) AS t",
    "SELECT *\nFROM (\n  SELECT id\n  FROM users\n) AS t",
  ],
  [
    "PHP",
    "<?php\nfunction demo() {\nif (true) {\necho 1;\n}\n}",
    "<?php\n  function demo() {\n  if (true) {\n  echo 1;\n  }\n  }",
  ],
  [
    "PHP",
    "<?php echo 1; ?>\nfunction demo() {\n       return 1;\n}",
    "<?php echo 1; ?>\nfunction demo() {\nreturn 1;\n}",
  ],
  [
    "PHP",
    "<?php\nfunction demo() {\nreturn 1;\n}\n?>\ntext",
    "<?php\n  function demo() {\n  return 1;\n  }\n  ?>\n  text",
  ],
  ["PHP", 'function demo() {\n       return "<?";\n}', 'function demo() {\n  return "<?";\n}'],
]) {
  test(`selecting ${name} follows observed indentation: ${input.slice(0, 40).replaceAll("\n", " ")}`, async ({
    page,
  }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='format-width';host.style.width='800px';host.style.marginTop='120px';document.body.prepend(host)
      window.codeSwitchEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:null,indentWidth:8},content:[{type:'text',text:${JSON.stringify(input)}}]}]}})
    `,
    });
    await page.waitForFunction(() => Boolean(window.codeSwitchEditor));
    const card = page.locator("#format-width .semlo-editor-code-card");
    await card.hover();
    await card.getByRole("button", { name: "代码语言" }).click();
    await card.getByRole("combobox", { name: "搜索代码语言" }).fill(name);
    await page.getByRole("option", { name, exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__semloRequireFixture("codeSwitchEditor").editor.state.doc.firstChild?.textContent),
      )
      .toBe(expected);
    if (name === "PHP" && input.startsWith("<?php")) {
      expect(await page.evaluate(() => window.__semloRequireFixture("codeSwitchEditor").editor.commands.undo())).toBe(
        true,
      );
      expect(
        await page.evaluate(
          () => window.__semloRequireFixture("codeSwitchEditor").editor.state.doc.firstChild?.textContent,
        ),
      ).toBe(input);
      expect(
        (await page.evaluate(() => window.__semloRequireFixture("codeSwitchEditor").getSnapshot())).json.content?.[0]
          .attrs?.language,
      ).toBe("php");
    }
  });
}

test("SQL automatic indentation preserves continuation indentation", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host=document.createElement('div');host.id='sql-auto';host.style.width='800px';host.style.marginTop='120px';document.body.prepend(host)
    window.codeSwitchEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'sql'},content:[{type:'text',text:'SELECT name,\\n       email\\nFROM users\\nWHERE active = 1'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.codeSwitchEditor));
  const card = page.locator("#sql-auto .semlo-editor-code-card");
  await card.hover();
  await card.getByRole("button", { name: "代码块更多设置" }).click();
  await page.getByRole("menuitem", { name: "自动缩进", exact: true }).click();
  await expect(card.locator("code")).toHaveText("SELECT name,\n       email\nFROM users\nWHERE active = 1");
});

test("PHP automatic indentation follows the observed tagged nested example", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='php-auto';host.style.width='800px';host.style.marginTop='120px';document.body.prepend(host)
    window.codeSwitchEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'php'},content:[{type:'text',text:'<?php\\nfunction demo() {\\nif (true) {\\necho 1;\\n}\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.codeSwitchEditor));
  const card = page.locator("#php-auto .semlo-editor-code-card");
  await card.hover();
  await card.getByRole("button", { name: "代码块更多设置" }).click();
  await page.getByRole("menuitem", { name: "自动缩进", exact: true }).click();
  await expect(card.locator("code")).toHaveText("<?php\n  function demo() {\n  if (true) {\n  echo 1;\n  }\n  }");
});

test("GraphQL automatic indentation follows the observed menu behavior", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js'
    const host=document.createElement('div');host.id='graphql-auto';host.style.width='800px';host.style.marginTop='120px';document.body.prepend(host)
    window.codeSwitchEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'graphql'},content:[{type:'text',text:'query {\\n  user {\\n    name\\n  }\\n}'}]}]}})
  `,
  });
  await page.waitForFunction(() => Boolean(window.codeSwitchEditor));
  const card = page.locator("#graphql-auto .semlo-editor-code-card");
  await card.hover();
  await card.getByRole("button", { name: "代码块更多设置" }).click();
  await page.getByRole("menuitem", { name: "自动缩进", exact: true }).click();
  await expect(card.locator("code")).toHaveText("query {\nuser {\nname\n}\n}");
});
