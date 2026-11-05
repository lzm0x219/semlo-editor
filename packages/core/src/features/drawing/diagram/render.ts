import createDOMPurify, { type WindowLike } from "dompurify";

import { renderPele } from "./pele";

export type DiagramLanguage = "plantuml" | "mermaid" | "flowchart" | "graphviz";

type PlantGlobals = typeof globalThis & {
  PLANTUML_VIZ?: unknown;
  __plantumlVizInstance?: unknown;
  __plantumlVizError?: unknown;
  __plantumlVizWaiting?: unknown;
  __pl_script_state?: unknown;
  _measureCanvas?: HTMLCanvasElement;
  _measureCtx?: CanvasRenderingContext2D;
  PLANTUML_STDLIB_LOADER?: (url: string, success: () => void, error: (reason: string) => void) => boolean;
  PLANTUML_FILE_LOADER?: (
    path: string,
    from: string | null,
    success: (id: string, text: string) => void,
    error: (reason: string) => void,
  ) => boolean;
};

let plantQueue: Promise<void> = Promise.resolve();
let vizPromise: Promise<import("@viz-js/viz").Viz> | undefined;

function vizInstance() {
  return (vizPromise ??= import("@viz-js/viz").then(({ instance }) => instance()));
}

function hasUnsafeCss(css: string) {
  const normalized = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (
    /\\|@(?:import|font-face|namespace|document|charset)\b|(?:expression|behavior|-moz-binding)\s*[:(]|(?:image-set|attr|src)\s*\(/i.test(
      normalized,
    )
  )
    return true;
  return /url\s*\(/i.test(normalized.replace(/url\s*\(\s*(['"]?)#[\w:.-]+\1\s*\)/gi, ""));
}

/** Check resource-bearing Mermaid/PlantUML input before the renderer touches the DOM. */
function rejectExternalResources(source: string) {
  const normalized = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([\da-f]{1,6})\s?/gi, (_match, digits: string) => String.fromCodePoint(parseInt(digits, 16)));
  if (
    /@(?:import|font-face)\b|(?:expression|behavior|-moz-binding)\s*[:(]|(?:image-set|attr|src)\s*\(/i.test(
      normalized,
    ) ||
    /url\s*\(/i.test(normalized.replace(/url\s*\(\s*(['"]?)#[\w:.-]+\1\s*\)/gi, "")) ||
    /<\s*(?:img|image)\b|!\[[^\]]*\]\s*\(|@\{[^}]*\bimg\s*:/is.test(normalized)
  ) {
    throw new Error("文本绘图暂不加载外部图片或样式资源");
  }
}

function sanitizeSvg(raw: string, ownerDocument: Document) {
  const view = ownerDocument.defaultView;
  if (!view) throw new Error("无法在当前文档中显示绘图");
  const fragment = createDOMPurify(view as unknown as WindowLike).sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: [
      "script",
      "foreignObject",
      "image",
      "iframe",
      "object",
      "embed",
      "a",
      "animate",
      "animateMotion",
      "animateTransform",
      "set",
    ],
    FORBID_ATTR: ["src", "srcset", "formaction"],
  });
  const svg = fragment.querySelector("svg");
  if (!svg) throw new Error("绘图未生成有效的 SVG");
  for (const style of svg.querySelectorAll("style")) {
    if (hasUnsafeCss(style.textContent ?? "")) style.remove();
  }
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (
        name.startsWith("on") ||
        ((name === "href" || name.endsWith(":href")) && !/^#[\w:.-]+$/.test(value)) ||
        ((name === "style" || /(?:url|image-set|attr|src)\s*\(/i.test(value) || value.includes("\\")) &&
          hasUnsafeCss(value))
      ) {
        element.removeAttributeNode(attribute);
      }
    }
  }
  return svg.outerHTML;
}

function plantUmlError(svg: string, ownerDocument: Document) {
  const view = ownerDocument.defaultView;
  if (!view) return null;
  const document = new view.DOMParser().parseFromString(svg, "image/svg+xml");
  const lines = Array.from(document.querySelectorAll("text"));
  if (
    !lines.some((line) => line.textContent?.startsWith("PlantUML version ")) ||
    !lines.some((line) => /^\[From .+\(line \d+\)/.test(line.textContent?.trim() ?? ""))
  )
    return null;
  const message = lines.find((line) => line.getAttribute("fill")?.toLowerCase() === "#ff0000")?.textContent?.trim();
  return message || "PlantUML 语法错误";
}

async function renderPlantUml(source: string, ownerDocument: Document) {
  rejectExternalResources(source);
  if (/^\s*!(?:include\w*|import|theme)\b/im.test(source)) throw new Error("不支持加载外部绘图资源");
  const render = async () => {
    const [plantuml, viz, localViz] = await Promise.all([
      import("@plantuml/core"),
      import("@viz-js/viz"),
      vizInstance(),
    ]);
    const scope = globalThis as PlantGlobals;
    // 引擎使用页面全局变量，无法判断宿主何时同时读写；已有值时拒绝覆盖。
    const guardedGlobals = [
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
    // 引擎会主动删除 __plantumlVizError，已有属性无法区分引擎删除和宿主删除。
    if (
      guardedGlobals.some((key) => {
        let target: object | null = scope;
        while (target) {
          const descriptor = Object.getOwnPropertyDescriptor(target, key);
          if (descriptor)
            return (
              !("value" in descriptor) ||
              descriptor.value !== undefined ||
              (target === scope && (!descriptor.configurable || key === "__plantumlVizError"))
            );
          target = Object.getPrototypeOf(target) as object | null;
        }
        return false;
      })
    )
      throw new Error("页面已使用 PlantUML 全局状态，无法安全渲染；请隔离宿主绘图引擎");
    const measureCanvas = ownerDocument.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");
    if (!measureContext) throw new Error("无法初始化绘图所需的文字测量环境");
    const blockedStdlib: NonNullable<PlantGlobals["PLANTUML_STDLIB_LOADER"]> = (_url, _success, error) => {
      error("不支持加载外部绘图资源");
      return true;
    };
    const blockedFile: NonNullable<PlantGlobals["PLANTUML_FILE_LOADER"]> = (_path, _from, _success, error) => {
      error("不支持加载外部绘图资源");
      return true;
    };
    const overrides = {
      PLANTUML_VIZ: viz,
      __plantumlVizInstance: localViz,
      __plantumlVizError: undefined,
      __plantumlVizWaiting: undefined,
      __pl_script_state: Object.create(null) as object,
      PLANTUML_STDLIB_LOADER: blockedStdlib,
      PLANTUML_FILE_LOADER: blockedFile,
      _measureCanvas: measureCanvas,
      _measureCtx: measureContext,
    } as const;
    const previous = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(scope, key)]));
    try {
      for (const [key, value] of Object.entries(overrides))
        Object.defineProperty(scope, key, { value, writable: true, configurable: true, enumerable: true });
      const svg = await new Promise<string>((resolve, reject) => {
        plantuml.renderToString(source.split(/\r?\n/), resolve, (message) => reject(new Error(String(message))));
      });
      const message = plantUmlError(svg, ownerDocument);
      if (message) throw new Error(message);
      return svg;
    } finally {
      for (const [key, descriptor] of previous) {
        const current = Object.getOwnPropertyDescriptor(scope, key);
        if (
          !current ||
          !("value" in current) ||
          current.value !== overrides[key as keyof typeof overrides] ||
          !current.configurable ||
          !current.writable ||
          !current.enumerable
        )
          continue;
        if (descriptor) Object.defineProperty(scope, key, descriptor);
        else Reflect.deleteProperty(scope, key);
      }
    }
  };
  const result = plantQueue.then(render, render);
  plantQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}

async function renderFlowchart(source: string, ownerDocument: Document) {
  rejectExternalResources(source);
  const { default: flowchart } = await import("flowchart.js");
  const chart = flowchart.parse(source);
  if (!(chart as typeof chart & { start?: unknown }).start) throw new Error("无法解析流程图，请检查节点和连接");
  const documentForRender = typeof document === "undefined" ? ownerDocument : document;
  const holder = documentForRender.createElement("div");
  holder.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none";
  documentForRender.body.append(holder);
  try {
    chart.drawSVG(holder);
    const svg = holder.querySelector("svg");
    if (!svg) throw new Error("流程图未生成有效的 SVG");
    return svg.outerHTML;
  } finally {
    holder.remove();
  }
}

export async function renderDiagram(
  language: DiagramLanguage,
  source: string,
  ownerDocument: Document,
): Promise<string> {
  if (!source.trim()) throw new Error("请输入绘图代码");
  let svg: string;
  switch (language) {
    case "plantuml":
      svg = await renderPlantUml(source, ownerDocument);
      break;
    case "mermaid":
      rejectExternalResources(source);
      svg = await renderPele(source);
      break;
    case "flowchart":
      svg = await renderFlowchart(source, ownerDocument);
      break;
    case "graphviz":
      svg = (await vizInstance()).renderString(source, { format: "svg" });
      break;
    default:
      throw new Error("不支持的绘图语言");
  }
  return sanitizeSvg(svg, ownerDocument);
}
