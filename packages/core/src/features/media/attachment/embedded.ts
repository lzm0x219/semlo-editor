import type { readAttachmentPresentation } from "./presentation";
import type { AttachmentInfo, AttachmentOptions, AttachmentPreviewAttempt } from "./preview";

type Key = { file: string; owner: unknown; resolver: unknown };
interface EmbeddedContext {
  doc: Document;
  options: AttachmentOptions;
  live(): boolean;
  presentation(): ReturnType<typeof readAttachmentPresentation>;
  fileKey(): string;
  info(): AttachmentInfo | null;
  name(): string;
  resolve(): AttachmentPreviewAttempt;
  open(): void;
}

// 跨源地址也可能重定向回宿主；始终保留不透明源，不同时开放脚本与宿主同源权限。
const viewerSandbox = "allow-scripts allow-forms allow-popups allow-downloads";

const rawDocumentTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function isRawDocument(url: string, info: AttachmentInfo | null, doc: Document): boolean {
  if (!info) return false;
  const type = info.mimeType.split(";", 1)[0].trim().toLowerCase();
  if (!rawDocumentTypes.has(type) && !/\.(pdf|docx?|xlsx?|pptx?)$/i.test(info.name.trim())) return false;
  try {
    return new URL(url, doc.baseURI).href === new URL(info.href, doc.baseURI).href;
  } catch {
    return false;
  }
}

export function createAttachmentEmbedded(context: EmbeddedContext) {
  const { doc, options } = context;
  const element = doc.createElement("span");
  element.className = "semlo-editor-attachment-embedded";
  element.setAttribute("role", "region");
  element.setAttribute("aria-label", "附件嵌入预览");
  element.hidden = true;
  const fallback = doc.createElement("span");
  fallback.className = "semlo-editor-attachment-embedded-status";
  const status = doc.createElement("span");
  status.setAttribute("role", "status");
  const retry = doc.createElement("button");
  retry.type = "button";
  retry.textContent = "重新加载预览";
  retry.setAttribute("aria-label", "重新加载附件预览");
  retry.hidden = true;
  const openExternal = doc.createElement("button");
  openExternal.type = "button";
  openExternal.textContent = "在新页面打开";
  openExternal.setAttribute("aria-label", "在新页面预览附件");
  openExternal.hidden = true;
  fallback.append(status, retry, openExternal);
  element.append(fallback);
  let frame: HTMLIFrameElement | null = null;
  let removeFrameEvents: (() => void) | undefined;
  let key: Key | null = null;
  let generation = 0;
  let destroyed = false;
  const eligible = () => {
    const settings = context.presentation();
    return !destroyed && context.live() && settings.supported && settings.mode === "embedded";
  };
  const clearFrame = () => {
    removeFrameEvents?.();
    removeFrameEvents = undefined;
    const previous = frame;
    frame = null;
    previous?.removeAttribute("src");
    previous?.remove();
  };
  const message = (text: string, canRetry: boolean, external = false) => {
    fallback.hidden = false;
    status.textContent = text;
    retry.hidden = !canRetry;
    openExternal.hidden = !external;
  };
  const currentKey = (): Key => ({
    file: context.fileKey(),
    owner: options.getPreviewOwner(),
    resolver: options.getPreviewResolver(),
  });
  const sameKey = (a: Key | null, b: Key) => a?.file === b.file && a.owner === b.owner && a.resolver === b.resolver;
  const update = () => {
    const settings = context.presentation();
    if (!settings.supported || settings.mode !== "embedded" || destroyed || options.views?.disposed) {
      generation++;
      key = null;
      clearFrame();
      element.hidden = true;
      return;
    }
    element.hidden = false;
    element.style.height = `${settings.height}px`;
    const next = currentKey();
    if (sameKey(key, next)) return;
    generation++;
    const ticket = generation;
    key = next;
    clearFrame();
    message("正在加载附件预览…", false);
    queueMicrotask(() => {
      if (ticket !== generation || !eligible()) return;
      // 清除旧阅读页之后才调用宿主；同步换服务或销毁不能留住旧 iframe。
      const result = context.resolve();
      if (ticket !== generation || !eligible() || !sameKey(key, currentKey())) return;
      if (result.status === "stale") {
        message("预览目标已变化，请重新加载。", true);
        return;
      }
      if (result.status === "failed") {
        message(result.error instanceof Error ? result.error.message : "附件预览失败", true);
        options.onError(result.error);
        return;
      }
      // 原始 PDF/Office 地址不是阅读服务；不让受沙箱限制的内置插件停留在永久加载状态。
      if (isRawDocument(result.url, context.info(), doc)) {
        message("此附件暂时无法在文档内预览，可在新页面打开。", false, true);
        return;
      }
      const nextFrame = doc.createElement("iframe");
      nextFrame.className = "semlo-editor-attachment-frame";
      nextFrame.title = `附件预览：${context.name()}`;
      nextFrame.referrerPolicy = "no-referrer";
      nextFrame.setAttribute("sandbox", viewerSandbox);
      const loaded = () => {
        if (frame === nextFrame && ticket === generation && eligible()) fallback.hidden = true;
      };
      const failed = () => {
        if (frame !== nextFrame || ticket !== generation || !eligible()) return;
        clearFrame();
        message("附件预览加载失败", true);
        options.onError(new Error("附件预览加载失败"));
      };
      nextFrame.addEventListener("load", loaded);
      nextFrame.addEventListener("error", failed);
      removeFrameEvents = () => {
        nextFrame.removeEventListener("load", loaded);
        nextFrame.removeEventListener("error", failed);
      };
      frame = nextFrame;
      nextFrame.src = result.url;
      element.append(nextFrame);
    });
  };
  const invalidate = (reentrant = false) => {
    generation++;
    key = null;
    clearFrame();
    if (reentrant && eligible()) {
      // 不自动重复调用正在同步更换配置的解析器，避免微任务重入循环。
      key = currentKey();
      message("预览服务已变化，请重新加载。", true);
    } else update();
  };
  const onRetry = () => invalidate();
  retry.addEventListener("click", onRetry);
  const onOpenExternal = () => context.open();
  openExternal.addEventListener("click", onOpenExternal);
  return {
    element,
    update,
    invalidate,
    paintHeight(height: number) {
      element.style.height = `${height}px`;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation++;
      key = null;
      clearFrame();
      retry.removeEventListener("click", onRetry);
      openExternal.removeEventListener("click", onOpenExternal);
    },
  };
}
