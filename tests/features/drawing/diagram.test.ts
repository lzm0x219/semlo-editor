import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    diagramEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'diagram-test'
      document.body.prepend(host)
      window.diagramEditor = createEditor({ element: host, outline: false, content: '<p>正文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.diagramEditor));
  return page.locator("#diagram-test");
}

async function insertFromMenu(page: Page, host: ReturnType<Page["locator"]>) {
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const menu = page.getByRole("dialog", { name: "插入内容" });
  await menu.getByLabel("搜索插入内容").fill("文本绘图");
  await menu.locator('[data-command="diagram"]').click();
  const diagram = host.locator(".semlo-editor-diagram");
  await expect(diagram).toBeVisible();
  return diagram;
}

async function selectLanguage(diagram: ReturnType<Page["locator"]>, language: string) {
  await diagram.getByRole("button", { name: "绘图语言" }).click();
  await diagram.getByRole("menu", { name: "绘图语言" }).getByRole("menuitem", { name: language }).click();
}

async function waitForDiagram(page: Page, diagram: ReturnType<Page["locator"]>, label: string) {
  const element = await diagram.elementHandle();
  await page.waitForFunction(
    (node) => {
      const error = node?.querySelector(".semlo-editor-diagram-error");
      return (
        !!node?.querySelector(".semlo-editor-diagram-preview-content svg") || (error && !error.hasAttribute("hidden"))
      );
    },
    element,
    { timeout: 30_000 },
  );
  const details = await diagram.evaluate((node) => ({
    language: node.querySelector(".semlo-editor-diagram-language")?.textContent,
    source: node.querySelector<HTMLTextAreaElement>(".semlo-editor-diagram-input")?.value,
    error: node.querySelector(".semlo-editor-diagram-error")?.textContent,
    hasSvg: !!node.querySelector(".semlo-editor-diagram-preview-content svg"),
  }));
  if (!details.hasSvg) throw new Error(`${label}: ${JSON.stringify(details)}`);
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("text diagrams can be inserted, switched, resized and maximized", async ({ page }) => {
  const host = await mount(page);
  const diagram = await insertFromMenu(page, host);
  const input = diagram.getByLabel("绘图代码");
  const preview = diagram.getByRole("region", { name: "绘图预览" });
  await expect(input).toHaveValue("");
  await expect(diagram.getByRole("button", { name: "绘图语言" })).toHaveText("PlantUML");
  await expect(preview).toBeVisible();
  await input.fill("Alice -> Bob");
  await selectLanguage(diagram, "Mermaid");
  await expect(input).toHaveValue("Alice -> Bob");
  await diagram.getByRole("button", { name: "模板" }).click();
  await diagram.getByRole("menuitem", { name: "Flow Chart" }).click();
  await expect(input).toHaveValue(/flowchart TD/);
  expect(await page.evaluate(() => window.__semloRequireFixture("diagramEditor").editor.commands.undo())).toBe(true);
  await expect(input).toHaveValue("Alice -> Bob");
  expect(await page.evaluate(() => window.__semloRequireFixture("diagramEditor").editor.commands.redo())).toBe(true);
  await expect(input).toHaveValue(/flowchart TD/);
  await diagram.getByRole("button", { name: "预览" }).click();
  await expect(preview).toBeHidden();
  await input.press("Meta+p");
  await expect(preview).toBeVisible();

  const handle = diagram.getByRole("separator", { name: "调整文本绘图高度" });
  await expect(handle).toHaveAttribute("aria-valuenow", "300");
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await expect(handle).toHaveAttribute("aria-valuenow", "310");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("Missing diagram resize handle");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 + 60);
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "370");
  await diagram.getByRole("button", { name: "最大化文本绘图" }).click();
  await expect(diagram).toHaveClass(/semlo-editor-diagram-fullscreen-active/);
  await expect(diagram.getByRole("button", { name: "返回文档" })).toBeVisible();
  await diagram.getByRole("button", { name: "返回文档" }).click();
  await expect(diagram).not.toHaveClass(/semlo-editor-diagram-fullscreen-active/);
  await diagram.getByRole("button", { name: "最大化文本绘图" }).click();
  await page.keyboard.press("Escape");
  await expect(diagram).not.toHaveClass(/semlo-editor-diagram-fullscreen-active/);
});

test("the maximize control stays outside the card when space allows and works in a narrow editor", async ({ page }) => {
  const host = await mount(page);
  const diagram = await insertFromMenu(page, host);
  const button = diagram.getByRole("button", { name: "最大化文本绘图" });
  const cardBox = await diagram.boundingBox();
  const buttonBox = await button.boundingBox();
  if (!cardBox || !buttonBox) throw new Error("Missing diagram control geometry");
  const gap = buttonBox.x - (cardBox.x + cardBox.width);
  expect(gap).toBeGreaterThanOrEqual(5);
  expect(gap).toBeLessThan(13);

  await page.setViewportSize({ width: 360, height: 720 });
  const narrowBox = await button.boundingBox();
  if (!narrowBox) throw new Error("Missing maximize control in narrow viewport");
  expect(narrowBox.x).toBeGreaterThanOrEqual(0);
  expect(narrowBox.x + narrowBox.width).toBeLessThanOrEqual(360);
  await button.click();
  await expect(diagram.getByRole("button", { name: "返回文档" })).toBeVisible();
  await diagram.getByRole("button", { name: "返回文档" }).click();
  await expect(diagram).not.toHaveClass(/semlo-editor-diagram-fullscreen-active/);
});

test("source and settings survive HTML and JSON round trips and respect read-only mode", async ({ page }) => {
  const host = await mount(page);
  const diagram = await insertFromMenu(page, host);
  await selectLanguage(diagram, "Mermaid");
  const source = 'flowchart TD\n  A["<示例> & \\\"引号\\\""] --> B[完成]';
  await diagram.getByLabel("绘图代码").fill(source);
  const original = await page.evaluate(() => window.__semloRequireFixture("diagramEditor").getSnapshot());
  expect(original.html).toContain("data-semlo-editor-diagram");
  for (const content of [original.html, original.json]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("diagramEditor").setContent("<p>临时</p>");
      window.__semloRequireFixture("diagramEditor").setContent(value);
    }, content);
    expect((await page.evaluate(() => window.__semloRequireFixture("diagramEditor").getSnapshot())).json).toEqual(
      original.json,
    );
    await expect(host.getByLabel("绘图代码")).toHaveValue(source);
  }
  await page.evaluate(() => window.__semloRequireFixture("diagramEditor").setEditable(false));
  await expect(host.getByLabel("绘图代码")).toHaveAttribute("readonly", "");
  await expect(host.getByRole("button", { name: "绘图语言" })).toBeDisabled();
  await expect(host.getByRole("button", { name: "模板" })).toBeDisabled();
  await host.getByRole("button", { name: "最大化文本绘图" }).click();
  await expect(host.locator(".semlo-editor-diagram")).toHaveClass(/semlo-editor-diagram-fullscreen-active/);
  await page.evaluate(() => window.__semloRequireFixture("diagramEditor").destroy());
  await expect(host.locator(".semlo-editor-diagram")).toHaveCount(0);
});

test("editing diagram source is undoable without deleting the card", async ({ page }) => {
  const host = await mount(page);
  const diagram = await insertFromMenu(page, host);
  const input = diagram.getByLabel("绘图代码");
  await input.focus();
  await input.fill("@startuml\nAlice -> Bob: hello\n@enduml");
  expect(await diagram.locator(".semlo-editor-diagram-highlight").textContent()).toBe(
    "@startuml\nAlice -> Bob: hello\n@enduml",
  );
  await expect(diagram.locator(".semlo-editor-diagram-token-keyword").first()).toHaveText("@startuml");
  await input.press("Meta+z");
  await expect(diagram).toBeVisible();
  await expect(input).toHaveValue("");
  await input.press("Meta+Shift+z");
  await expect(input).toHaveValue("@startuml\nAlice -> Bob: hello\n@enduml");
});

test("toolbar and slash insertion focus the new diagram without changing earlier cards", async ({ page }) => {
  const host = await mount(page);
  const first = await insertFromMenu(page, host);
  const firstInput = first.getByLabel("绘图代码");
  await expect(firstInput).toBeFocused();
  await firstInput.fill("@startuml\nAlice -> Bob: first\n@enduml");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("diagramEditor").editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
  });
  await host.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("/wbht");
  const menu = page.getByRole("listbox", { name: "插入内容" });
  await expect(menu.getByRole("option", { name: /文本绘图/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const diagrams = host.locator(".semlo-editor-diagram");
  await expect(diagrams).toHaveCount(2);
  const secondInput = diagrams.last().getByLabel("绘图代码");
  await expect(secondInput).toBeFocused();
  await page.keyboard.type("new source");
  await expect(secondInput).toHaveValue("new source");
  await expect(diagrams.first().getByLabel("绘图代码")).toHaveValue("@startuml\nAlice -> Bob: first\n@enduml");
});

test("the four supported syntaxes render locally and stale results do not replace newer source", async ({ page }) => {
  const host = await mount(page);
  const diagram = await insertFromMenu(page, host);
  const input = diagram.getByLabel("绘图代码");
  const preview = diagram.getByRole("region", { name: "绘图预览" });
  const examples = [
    ["PlantUML", "@startuml\nAlice -> Bob: hello\n@enduml", "Alice"],
    ["Mermaid", "flowchart TD\n  A[甲] --> B[乙]", "甲"],
    ["Flowchart", "start=>start: 开始\nend=>end: 结束\nstart->end", "开始"],
    ["Graphviz", "digraph G { first -> second }", "first"],
  ] as const;
  for (const [language, source, text] of examples) {
    if (language !== "PlantUML") await selectLanguage(diagram, language);
    await input.fill(source);
    await waitForDiagram(page, diagram, language);
    await expect(preview.locator("svg")).toHaveCount(1);
    await expect(preview).toContainText(text);
    await expect(preview.locator("script, foreignObject")).toHaveCount(0);
  }
  await selectLanguage(diagram, "Mermaid");
  await input.fill("flowchart TD\n  A[旧结果] --> B[旧]");
  await input.fill("flowchart TD\n  A[新结果] --> B[新]");
  await expect(preview).toContainText("新结果", { timeout: 30_000 });
  await expect(preview).not.toContainText("旧结果");
  await input.fill("this is not a valid diagram");
  await expect(diagram.locator(".semlo-editor-diagram-error")).toBeVisible({ timeout: 30_000 });
  await expect(input).toHaveValue("this is not a valid diagram");
});

test("each built-in diagram template produces a preview", async ({ page }) => {
  const host = await mount(page);
  const diagram = await insertFromMenu(page, host);
  const preview = diagram.getByRole("region", { name: "绘图预览" });
  const groups = [
    [
      "PlantUML",
      [
        "时序图 (Timing)",
        "序列图 (Sequence)",
        "用例图 (Use Case)",
        "类图 (Class)",
        "流程图 (Flow)",
        "活动图 (Activity)",
        "组件图 (Component)",
        "状态图 (State)",
        "对象图 (Object)",
      ],
    ],
    [
      "Mermaid",
      ["Flow Chart", "Sequence Diagram", "Class Diagram", "State Diagram", "ER Diagram", "Gantt", "Pie Chart"],
    ],
    ["Flowchart", ["Flowchart"]],
    ["Graphviz", ["Finite State Machine"]],
  ] as const;
  for (const [language, labels] of groups) {
    if (language !== "PlantUML") await selectLanguage(diagram, language);
    for (const label of labels) {
      await diagram.getByRole("button", { name: "模板" }).click();
      await diagram.getByRole("menuitem", { name: label, exact: true }).click();
      await waitForDiagram(page, diagram, `${language}: ${label}`);
      await expect(preview.locator("svg")).toHaveCount(1);
      await expect(diagram.locator(".semlo-editor-diagram-error")).toBeHidden();
    }
  }
});

test("a diagram survives switching between Vue, React and SolidJS adapters", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const host = page.locator("#editor-host");
  const diagram = await insertFromMenu(page, host);
  await selectLanguage(diagram, "Mermaid");
  const source = "flowchart LR\n  A[想法] --> B[文档]";
  await diagram.getByLabel("绘图代码").fill(source);
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    await expect(host.getByLabel("绘图代码")).toHaveValue(source);
    await expect(host.getByRole("button", { name: "绘图语言" })).toHaveText("Mermaid");
  }
});
