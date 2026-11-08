import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type { renderDiagram } from "../../../packages/core/src/features/drawing/diagram/render";
import type { diagramTemplates } from "../../../packages/core/src/features/drawing/diagram/templates";
import type { createEditor } from "../../../packages/core/src/index";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";

declare global {
  interface Window {
    guardRenderDiagram: typeof renderDiagram;
    guardDiagramTemplates: typeof diagramTemplates;
    guardCreateEditor: typeof createEditor;
  }
}

let origin: string;
let closeServer: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer(
    "./tests/fixtures/drawing/diagram-global-guard-fixture.ts",
  ));
});
afterAll(async () => closeServer?.());

test("宿主已持有绘图全局状态时明确拒绝且不触碰已有值", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.guardRenderDiagram === "function");
  const result = await page.evaluate(async () => {
    const keys = [
      "PLANTUML_VIZ",
      "__plantumlVizInstance",
      "__plantumlVizError",
      "__plantumlVizWaiting",
      "__pl_script_state",
      "PLANTUML_STDLIB_LOADER",
      "PLANTUML_FILE_LOADER",
      "PLANTUML_DEBUG",
      "_measureCanvas",
      "_measureCtx",
    ];
    const results = [];
    for (const key of keys) {
      const marker = { host: key };
      Object.defineProperty(window, key, { value: marker, writable: false, configurable: true });
      const error = await window.guardRenderDiagram("plantuml", "@startuml\nA -> B\n@enduml", document).then(
        () => "",
        (reason: Error) => reason.message,
      );
      results.push({ error, unchanged: Reflect.get(window, key) === marker });
      Reflect.deleteProperty(window, key);
    }
    let getterCalls = 0;
    Object.defineProperty(window, "PLANTUML_VIZ", {
      configurable: true,
      get: () => {
        getterCalls++;
        return undefined;
      },
    });
    const accessorError = await window.guardRenderDiagram("plantuml", "@startuml\nA -> B\n@enduml", document).then(
      () => "",
      (reason: Error) => reason.message,
    );
    Reflect.deleteProperty(window, "PLANTUML_VIZ");
    const inherited = { host: "prototype" };
    Object.defineProperty(Window.prototype, "PLANTUML_VIZ", { value: inherited, configurable: true });
    const inheritedError = await window.guardRenderDiagram("plantuml", "@startuml\nA -> B\n@enduml", document).then(
      () => "",
      (reason: Error) => reason.message,
    );
    const inheritedUnchanged = Reflect.get(window, "PLANTUML_VIZ") === inherited;
    Reflect.deleteProperty(Window.prototype, "PLANTUML_VIZ");
    Object.defineProperty(window, "__plantumlVizError", { value: undefined, writable: true, configurable: true });
    const emptyErrorState = await window.guardRenderDiagram("plantuml", "@startuml\nA -> B\n@enduml", document).then(
      () => "",
      (reason: Error) => reason.message,
    );
    const errorStateUnchanged = Object.hasOwn(window, "__plantumlVizError");
    return {
      results,
      getterCalls,
      accessorError,
      inheritedError,
      inheritedUnchanged,
      emptyErrorState,
      errorStateUnchanged,
    };
  });
  for (const item of result.results)
    expect(item).toEqual({ error: "页面已使用 PlantUML 全局状态，无法安全渲染；请隔离宿主绘图引擎", unchanged: true });
  expect(result.getterCalls).toBe(0);
  expect(result.accessorError).toContain("无法安全渲染");
  expect(result.inheritedError).toContain("无法安全渲染");
  expect(result.inheritedUnchanged).toBe(true);
  expect(result.emptyErrorState).toContain("无法安全渲染");
  expect(result.errorStateUnchanged).toBe(true);
});

test("正常和失败绘图后清理自身测量状态，后续绘图仍可使用", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.guardRenderDiagram === "function");
  const result = await page.evaluate(async () => {
    Object.defineProperty(window, "PLANTUML_VIZ", {
      value: undefined,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    const first = await window.guardRenderDiagram("plantuml", "@startuml\nAlice -> Bob\n@enduml", document);
    const error = await window.guardRenderDiagram("plantuml", "@startuml\ninvalid !!!\n@enduml", document).then(
      () => "",
      (reason: Error) => reason.message,
    );
    const second = await window.guardRenderDiagram("plantuml", "@startuml\nCarol -> Dave\n@enduml", document);
    const descriptor = Object.getOwnPropertyDescriptor(window, "PLANTUML_VIZ");
    return {
      first: first.includes("Alice"),
      second: second.includes("Carol"),
      error: Boolean(error),
      descriptor: {
        value: descriptor?.value,
        writable: descriptor?.writable,
        configurable: descriptor?.configurable,
        enumerable: descriptor?.enumerable,
      },
      canvas: Object.hasOwn(window, "_measureCanvas"),
      context: Object.hasOwn(window, "_measureCtx"),
    };
  });
  expect(result).toEqual({
    first: true,
    second: true,
    error: true,
    descriptor: { value: undefined, writable: true, configurable: true, enumerable: false },
    canvas: false,
    context: false,
  });
});

test("多编辑器并发调用与 PlantUML 内置模板保持可用", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.guardRenderDiagram === "function");
  const result = await page.evaluate(async () => {
    const [first, second] = await Promise.all([
      window.guardRenderDiagram("plantuml", "@startuml\nFirst -> One\n@enduml", document),
      window.guardRenderDiagram("plantuml", "@startuml\nSecond -> Two\n@enduml", document),
    ]);
    const templates = [];
    for (const [name, source] of window.guardDiagramTemplates.plantuml) {
      const svg = await window.guardRenderDiagram("plantuml", source, document);
      templates.push({ name, rendered: svg.startsWith("<svg") });
    }
    return { first: first.includes("First"), second: second.includes("Second"), templates };
  });
  expect(result.first).toBe(true);
  expect(result.second).toBe(true);
  expect(result.templates.length).toBeGreaterThan(0);
  expect(result.templates.every((template) => template.rendered)).toBe(true);
});

test("销毁并重挂载一个编辑器不会干扰另一个编辑器的绘图", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.guardCreateEditor === "function");
  await page.evaluate(() => {
    const create = (id: string, label: string) => {
      const element = document.createElement("div");
      element.id = id;
      document.body.append(element);
      return window.guardCreateEditor({
        element,
        toolbar: false,
        outline: false,
        content: {
          type: "doc",
          content: [
            {
              type: "semloEditorDiagram",
              attrs: {
                language: "plantuml",
                source: `@startuml\n${label} -> Other\n@enduml`,
                preview: true,
              },
            },
          ],
        },
      });
    };
    const first = create("first-editor", "First");
    const second = create("second-editor", "Second");
    first.destroy();
    Reflect.set(window, "guardEditors", { second, first: create("remounted-editor", "Remounted") });
  });
  await expect(page.locator("#first-editor .semlo-editor-diagram")).toHaveCount(0);
  await expect(page.locator("#second-editor .semlo-editor-diagram-preview-content")).toContainText("Second", {
    timeout: 30_000,
  });
  await expect(page.locator("#remounted-editor .semlo-editor-diagram-preview-content")).toContainText("Remounted", {
    timeout: 30_000,
  });
  const destroyed = await page.evaluate(() => {
    const editors = Reflect.get(window, "guardEditors") as {
      first: ReturnType<typeof createEditor>;
      second: ReturnType<typeof createEditor>;
    };
    editors.first.destroy();
    editors.second.destroy();
    return [editors.first.editor.isDestroyed, editors.second.editor.isDestroyed];
  });
  expect(destroyed).toEqual([true, true]);
});

test("PlantUML 仍然拒绝外部加载并清理导出的外部链接", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.guardRenderDiagram === "function");
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("diagram.invalid")) requests.push(request.url());
  });
  const result = await page.evaluate(async () => {
    const failure = await window
      .guardRenderDiagram("plantuml", "@startuml\n!include https://diagram.invalid/secret\n@enduml", document)
      .then(
        () => "",
        (reason: Error) => reason.message,
      );
    const svg = await window.guardRenderDiagram(
      "plantuml",
      '@startuml\nactor "Person" as A [[https://diagram.invalid/link]]\nA -> A: hi\n@enduml',
      document,
    );
    return { failure, svg };
  });
  expect(result.failure).toContain("外部绘图资源");
  expect(result.svg).not.toContain("diagram.invalid");
  expect(requests).toEqual([]);
});

test("清理时保留宿主中途替换的 getter 和属性描述符", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.guardRenderDiagram === "function");
  const result = await page.evaluate(async () => {
    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.measureText;
    let getterCalls = 0;
    let injected = false;
    prototype.measureText = function (text) {
      if (!injected) {
        injected = true;
        Object.defineProperty(window, "_measureCanvas", {
          configurable: true,
          get: () => {
            getterCalls++;
            throw new Error("宿主 getter 不应被读取");
          },
        });
        const descriptor = Object.getOwnPropertyDescriptor(window, "_measureCtx")!;
        Object.defineProperty(window, "_measureCtx", { ...descriptor, enumerable: false });
      }
      return original.call(this, text);
    };
    try {
      const svg = await window.guardRenderDiagram("plantuml", "@startuml\nAlice -> Bob\n@enduml", document);
      const canvas = Object.getOwnPropertyDescriptor(window, "_measureCanvas");
      const context = Object.getOwnPropertyDescriptor(window, "_measureCtx");
      return {
        svg: svg.includes("Alice"),
        injected,
        getterCalls,
        keptGetter: typeof canvas?.get === "function",
        keptDescriptor: context?.enumerable === false,
        vizRemoved: !Object.hasOwn(window, "__plantumlVizInstance"),
      };
    } finally {
      prototype.measureText = original;
      Reflect.deleteProperty(window, "_measureCanvas");
      Reflect.deleteProperty(window, "_measureCtx");
    }
  });
  expect(result).toEqual({
    svg: true,
    injected: true,
    getterCalls: 0,
    keptGetter: true,
    keptDescriptor: true,
    vizRemoved: true,
  });
});
