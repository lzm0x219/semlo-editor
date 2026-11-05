import { expect, test, type Page } from "@rstest/playwright";

import type { DiagramLanguage } from "../../../packages/core/src/features/drawing/diagram/render";
import { diagramTemplates } from "../../../packages/core/src/features/drawing/diagram/templates";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    renderTestDiagram?(language: DiagramLanguage, source: string, document: Document): Promise<string>;
    diagramScriptExecuted?: boolean;
  }
}

async function prepare(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { renderDiagram } from '/dist/index.js'; window.renderTestDiagram = renderDiagram`,
  });
  await page.waitForFunction(() => typeof window.renderTestDiagram === "function");
}

for (const language of ["plantuml", "mermaid", "flowchart", "graphviz"] as const) {
  test(`${language} templates render visible local SVGs`, async ({ page }) => {
    await prepare(page);
    for (const [name, source] of diagramTemplates[language]) {
      const svg = await page.evaluate(
        ([kind, text]) => window.__semloRequireFixture("renderTestDiagram").bind(window)(kind, text, document),
        [language, source] as const,
      );
      await page.evaluate((markup) => {
        const host = document.createElement("div");
        host.id = "diagram-render-test";
        host.innerHTML = markup;
        document.body.append(host);
      }, svg);
      const diagram = page.locator("#diagram-render-test svg");
      await expect(diagram, name).toBeVisible();
      expect(await diagram.locator("path,rect,polygon,ellipse,circle,line,text").count(), name).toBeGreaterThan(0);
      expect(await diagram.locator("text").count(), name).toBeGreaterThan(0);
      const bounds = await diagram.boundingBox();
      const geometry = await diagram.evaluate((element) => {
        const svg = element as SVGSVGElement;
        const box = svg.getBBox();
        return {
          width: box.width,
          height: box.height,
          sizing: Boolean(svg.getAttribute("viewBox") || (svg.getAttribute("width") && svg.getAttribute("height"))),
          hasGeometry: Array.from(svg.querySelectorAll("path,rect,polygon,ellipse,circle,line")).some((shape) =>
            ["d", "width", "height", "points", "r", "rx", "x1", "y1"].some((attribute) =>
              shape.hasAttribute(attribute),
            ),
          ),
        };
      });
      expect(bounds?.width, name).toBeGreaterThan(0);
      expect(bounds?.height, name).toBeGreaterThan(0);
      expect(geometry, name).toMatchObject({ sizing: true, hasGeometry: true });
      expect(geometry.width, name).toBeGreaterThan(0);
      expect(geometry.height, name).toBeGreaterThan(0);
      await page.locator("#diagram-render-test").evaluate((element) => element.remove());
    }
  });
}

test("multiple Mermaid diagrams use distinct SVG IDs", async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const render = window.__semloRequireFixture("renderTestDiagram").bind(window);
    const source = "flowchart LR\n accTitle: 示例\n A --> B";
    const first = await render("mermaid", source, document);
    const second = await render("mermaid", source, document);
    const parse = (svg: string) => {
      const host = document.createElement("div");
      host.innerHTML = svg;
      return Array.from(host.querySelectorAll("[id]"), (element) => element.id);
    };
    return [parse(first), parse(second)];
  });
  expect(result[0].length).toBeGreaterThan(0);
  expect(result[1].length).toBeGreaterThan(0);
  expect(result[0].filter((id) => result[1].includes(id))).toEqual([]);
});

test("invalid diagrams report an error for each supported language", async ({ page }) => {
  await prepare(page);
  const invalid: Record<DiagramLanguage, string> = {
    plantuml: "@startuml\nunknown !!!\n@enduml",
    mermaid: "flowchart LR\n A -->",
    flowchart: "not a flowchart",
    graphviz: "digraph { a -> }",
  };
  for (const [language, source] of Object.entries(invalid) as Array<[DiagramLanguage, string]>) {
    const result = await page.evaluate(
      async ([kind, text]) => {
        try {
          await window.__semloRequireFixture("renderTestDiagram").bind(window)(kind, text, document);
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
      [language, source] as const,
    );
    expect(result, language).toBeTruthy();
  }
});

test("rendering refuses to overwrite host PlantUML globals", async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const scope = window as typeof window & Record<string, unknown>;
    const hostViz = { host: "viz" };
    const hostInstance = { host: "instance" };
    const hostScripts = { host: "scripts" };
    const hostLoader = () => false;
    scope.PLANTUML_VIZ = hostViz;
    scope.__plantumlVizInstance = hostInstance;
    scope.__pl_script_state = hostScripts;
    scope.PLANTUML_STDLIB_LOADER = hostLoader;
    const error = await window
      .__semloRequireFixture("renderTestDiagram")("plantuml", "@startuml\nAlice -> Bob: hello\n@enduml", document)
      .then(
        () => "",
        (reason: Error) => reason.message,
      );
    return {
      error,
      viz: scope.PLANTUML_VIZ === hostViz,
      instance: scope.__plantumlVizInstance === hostInstance,
      scripts: scope.__pl_script_state === hostScripts,
      loader: scope.PLANTUML_STDLIB_LOADER === hostLoader,
    };
  });
  expect(result).toMatchObject({
    error: "页面已使用 PlantUML 全局状态，无法安全渲染；请隔离宿主绘图引擎",
    viz: true,
    instance: true,
    scripts: true,
    loader: true,
  });
});

test("untrusted diagrams do not execute scripts, load resources or retain external links", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("semlo-editor-diagram.invalid")) externalRequests.push(request.url());
  });
  await prepare(page);
  const sources: Record<DiagramLanguage, string> = {
    plantuml: '@startuml\nactor "用户" as A [[https://semlo-editor-diagram.invalid/plant]]\nA -> A: 测试\n@enduml',
    mermaid: 'flowchart LR\n A["<img src=x onerror=window.diagramScriptExecuted=true>"] --> B',
    flowchart: "st=>start: 开始:>https://semlo-editor-diagram.invalid/flow\ne=>end: 结束\nst->e",
    graphviz: 'digraph { a [label="测试", URL="https://semlo-editor-diagram.invalid/graph"] -> b }',
  };
  for (const [language, source] of Object.entries(sources) as Array<[DiagramLanguage, string]>) {
    const result = await page.evaluate(
      async ([kind, text]) => {
        try {
          const svg = await window.__semloRequireFixture("renderTestDiagram").bind(window)(kind, text, document);
          const host = document.createElement("div");
          host.innerHTML = svg;
          document.body.append(host);
          const unsafeElements = host.querySelectorAll("script,foreignObject,image,iframe,object,embed,a").length;
          const unsafeAttributes = Array.from(host.querySelectorAll("*")).flatMap((element) =>
            Array.from(element.attributes).filter((attribute) => {
              const name = attribute.name.toLowerCase();
              return (
                name.startsWith("on") ||
                ((name === "href" || name.endsWith(":href")) && !attribute.value.startsWith("#"))
              );
            }),
          ).length;
          host.remove();
          return { unsafeElements, unsafeAttributes };
        } catch {
          return { unsafeElements: 0, unsafeAttributes: 0 };
        }
      },
      [language, source] as const,
    );
    expect(result, language).toEqual({ unsafeElements: 0, unsafeAttributes: 0 });
  }
  const blockedInclude = await page.evaluate(async () => {
    try {
      await window.__semloRequireFixture("renderTestDiagram").bind(window)(
        "plantuml",
        "@startuml\n!include https://semlo-editor-diagram.invalid/source\n@enduml",
        document,
      );
      return false;
    } catch {
      return true;
    }
  });
  expect(blockedInclude).toBe(true);
  for (const css of [
    'image-set("https://semlo-editor-diagram.invalid/image" 1x)',
    "u\\72l(https://semlo-editor-diagram.invalid/image)",
  ]) {
    const blocked = await page.evaluate(async (value) => {
      try {
        await window.__semloRequireFixture("renderTestDiagram").bind(window)(
          "mermaid",
          `flowchart LR\n A --> B\n style A fill:${value}`,
          document,
        );
        return false;
      } catch {
        return true;
      }
    }, css);
    expect(blocked, css).toBe(true);
  }
  expect(await page.evaluate(() => window.diagramScriptExecuted)).not.toBe(true);
  expect(externalRequests).toEqual([]);
});
