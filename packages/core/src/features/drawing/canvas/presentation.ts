import { CANVAS_DEFAULT_HEIGHT, canvasHeight } from "./height";
import { kindFrom } from "./model";

const attribute = "data-semlo-editor-presentation";

function readPresentation(element: HTMLElement): Record<string, unknown> | null {
  const value = element.getAttribute(attribute);
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error("画布展示数据损坏", { cause: error });
  }
}

export function supportedCanvasHeight(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(number) && number >= 80 && number <= 2000;
}

export function supportedCanvasKind(value: unknown): boolean {
  return value === "board" || value === "flowchart" || value === "uml";
}

export function supportedCanvasViewport(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const viewport = value as Record<string, unknown>;
  return (
    typeof viewport.zoom === "number" &&
    Number.isFinite(viewport.zoom) &&
    viewport.zoom >= 10 &&
    viewport.zoom <= 200 &&
    typeof viewport.x === "number" &&
    Number.isFinite(viewport.x) &&
    typeof viewport.y === "number" &&
    Number.isFinite(viewport.y)
  );
}

export function readPresentationHeight(element: HTMLElement): unknown {
  const original = readPresentation(element);
  const height = element.getAttribute("data-height");
  if (original) {
    if (!Object.hasOwn(original, "height")) throw new Error("画布展示数据缺少高度");
    if (height === null || height === String(canvasHeight(original.height))) return original.height;
  }
  if (height === null || height === "") return CANVAS_DEFAULT_HEIGHT;
  return supportedCanvasHeight(height) ? Number(height) : height;
}

export function readPresentationKind(element: HTMLElement): unknown {
  const original = readPresentation(element);
  const kind = element.getAttribute("data-kind");
  if (original) {
    if (!Object.hasOwn(original, "kind")) throw new Error("画布展示数据缺少类型");
    if (kind === null || kind === kindFrom(original.kind)) return original.kind;
  }
  return kind || "board";
}

export function presentationPayload(height: unknown, kind?: unknown): string | null {
  if (height === canvasHeight(height) && (kind === undefined || kind === kindFrom(kind))) return null;
  return encodeURIComponent(JSON.stringify(kind === undefined ? { height } : { height, kind }));
}
