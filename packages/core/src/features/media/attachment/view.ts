import type { NodeViewRendererProps } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { NodeSelection } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";

import { safeAttachmentURL } from "../shared/attachment-url";
import { createAttachmentEmbedded } from "./embedded";
import { attachmentEditMeta } from "./guard";
import { formatAttachmentSize, readAttachmentPresentation, type AttachmentDisplayMode } from "./presentation";
import { attachmentInfo, type AttachmentOptions, type AttachmentPreviewAttempt } from "./preview";
import { createAttachmentResize } from "./resize";

const previewIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>';
const fileIcon =
  '<svg viewBox="0 0 24 28" aria-hidden="true"><path fill="currentColor" d="M3 0h12l6 6v22H3z"/><path fill="#fff" opacity=".5" d="M15 0v6h6"/><path stroke="#fff" fill="none" d="m7 20 4-10 4 10-8-4 10 1"/></svg>';
const modeIcons: Record<AttachmentDisplayMode, string> = {
  title: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 19h16M12 8v8m-3-8h6"/></svg>',
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 10h4m3 0h5m-5 4h5"/></svg>',
  embedded:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h18M3 21h18"/><rect x="3" y="6" width="18" height="12" rx="1"/></svg>',
};

export function createAttachmentView(
  { node: initial, editor, view, getPos }: NodeViewRendererProps,
  options: AttachmentOptions,
): NodeView {
  const doc = view.dom.ownerDocument;
  const dom = doc.createElement("span");
  dom.className = "semlo-editor-attachment-view";
  dom.contentEditable = "false";
  const link = doc.createElement("a");
  link.className = "semlo-editor-attachment";
  link.setAttribute("data-semlo-editor-attachment", "");
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.tabIndex = 0;
  const label = doc.createElement("span");
  label.className = "semlo-editor-attachment-label";
  link.append(label);
  const icon = doc.createElement("span");
  icon.className = "semlo-editor-attachment-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = fileIcon;
  const size = doc.createElement("span");
  size.className = "semlo-editor-attachment-size";
  const tools = doc.createElement("span");
  tools.className = "semlo-editor-attachment-tools";
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "附件操作");
  tools.hidden = true;
  const modeButtons = (["title", "card", "embedded"] as const).map((mode) => {
    const button = doc.createElement("button");
    const name = mode === "title" ? "标题" : mode === "card" ? "卡片" : "嵌入";
    button.type = "button";
    button.setAttribute("aria-label", `附件显示为${name}`);
    button.title = name;
    button.dataset.attachmentMode = mode;
    button.innerHTML = modeIcons[mode];
    tools.append(button);
    return button;
  });
  const preview = doc.createElement("button");
  preview.type = "button";
  preview.setAttribute("aria-label", "预览附件");
  preview.title = "预览附件";
  preview.innerHTML = previewIcon;
  const download = doc.createElement("a");
  download.setAttribute("aria-label", "下载附件");
  download.title = "下载附件";
  download.target = "_blank";
  download.rel = "noopener noreferrer";
  download.innerHTML = downloadIcon;
  const inlineActions = doc.createElement("span");
  inlineActions.className = "semlo-editor-attachment-inline-actions";
  inlineActions.hidden = true;
  const inlinePreview = preview.cloneNode(true) as HTMLButtonElement;
  const inlineDownload = download.cloneNode(true) as HTMLAnchorElement;
  inlineActions.append(inlinePreview, inlineDownload);
  const downloadLabel = doc.createElement("label");
  downloadLabel.className = "semlo-editor-attachment-download-label";
  downloadLabel.title = "控制阅读界面的下载入口；文件权限由接入应用管理。";
  const allowDownload = doc.createElement("input");
  allowDownload.type = "checkbox";
  allowDownload.setAttribute("aria-label", "阅读页可下载");
  const downloadText = doc.createElement("span");
  downloadText.textContent = "阅读页可下载";
  downloadLabel.append(allowDownload, downloadText);
  const message = doc.createElement("span");
  message.className = "semlo-editor-attachment-message";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.hidden = true;
  const warning = doc.createElement("span");
  warning.className = "semlo-editor-attachment-warning";
  warning.setAttribute("role", "status");
  warning.hidden = true;
  tools.append(preview, download, downloadLabel);
  dom.append(icon, link, size, inlineActions, tools, message, warning);
  let node = initial;
  let destroyed = false;
  let resolving = false;
  let selected = false;
  let previewRevision = 0;

  const position = () => {
    if (destroyed || options.views?.disposed || editor.isDestroyed || editor.view !== view || !dom.isConnected)
      return undefined;
    const pos = getPos();
    // ProseMirror 可复用值相同的节点视图而不调用 update；激活时核对当前节点的值，回调后另以文档身份防重入。
    return typeof pos === "number" && view.state.doc.nodeAt(pos)?.eq(node) ? pos : undefined;
  };
  const positionTools = () => {
    if (!selected || position() === undefined) return;
    const bounds = dom.getBoundingClientRect();
    const width = doc.documentElement.clientWidth;
    const preferred = bounds.left + (bounds.width - tools.offsetWidth) / 2;
    const left = Math.max(8, Math.min(preferred, width - tools.offsetWidth - 8));
    tools.style.left = `${left - bounds.left}px`;
    const below = bounds.top - tools.offsetHeight - 8 < 8;
    tools.style.top = below ? "calc(100% + 8px)" : "auto";
    tools.style.bottom = below ? "auto" : "calc(100% + 8px)";
  };
  const stopPositioning = () => {
    doc.defaultView?.removeEventListener("resize", positionTools);
    doc.removeEventListener("scroll", positionTools, true);
  };
  const showError = (error: unknown) => {
    if (position() === undefined) return;
    message.textContent = error instanceof Error ? error.message : "附件预览失败";
    message.hidden = false;
    options.onError(error);
  };
  const attemptPreview = (): AttachmentPreviewAttempt => {
    const pos = position();
    if (pos === undefined || resolving) return { status: "stale" };
    const info = attachmentInfo(node);
    if (!info) {
      return { status: "failed", error: new Error("附件地址无效，无法预览") };
    }
    const source = node;
    const document = view.state.doc;
    const resolver = options.getPreviewResolver();
    const owner = options.getPreviewOwner();
    const editable = editor.isEditable;
    const revision = previewRevision;
    resolving = true;
    let url: unknown;
    let failure: unknown;
    let failed = false;
    try {
      url = resolver ? resolver({ ...info }) : info.href;
    } catch (error) {
      failure = error;
      failed = true;
    } finally {
      resolving = false;
    }
    // 宿主解析器可同步替换正文、服务或销毁实例；旧点击不能继续导航。
    if (
      position() !== pos ||
      node !== source ||
      view.state.doc !== document ||
      editor.isEditable !== editable ||
      options.getPreviewResolver() !== resolver ||
      options.getPreviewOwner() !== owner ||
      previewRevision !== revision
    )
      return { status: "stale" };
    if (failed) {
      return { status: "failed", error: failure };
    }
    const safe = safeAttachmentURL(url);
    if (!safe) {
      return { status: "failed", error: new Error(url == null ? "当前附件没有可用的预览" : "附件预览地址无效") };
    }
    return { status: "ready", url: safe };
  };
  const open = () => {
    const result = attemptPreview();
    if (result.status === "stale") return;
    if (result.status === "failed") return showError(result.error);
    message.hidden = true;
    message.textContent = "";
    doc.defaultView?.open(result.url, "_blank", "noopener,noreferrer");
  };
  const select = () => {
    const pos = position();
    if (pos === undefined || !editor.isEditable) return;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).setMeta("addToHistory", false));
    if (position() === pos) view.focus();
  };
  const presentation = () => readAttachmentPresentation(node.attrs);
  const commitAttributes = (attrs: Record<string, unknown>, expectedDocument: object = view.state.doc) => {
    const pos = position();
    if (pos === undefined || !editor.isEditable || !presentation().supported || view.state.doc !== expectedDocument)
      return;
    const source = node;
    const owner = options.getPreviewOwner();
    const next = { ...view.state.doc.nodeAt(pos)!.attrs, ...attrs };
    if (Object.entries(attrs).every(([name, value]) => node.attrs[name] === value)) return;
    const valid = () =>
      position() === pos &&
      editor.isEditable &&
      node === source &&
      view.state.doc === expectedDocument &&
      options.getPreviewOwner() === owner &&
      presentation().supported;
    try {
      const transaction = closeHistory(view.state.tr).setNodeMarkup(pos, undefined, next);
      // 原子节点的属性替换会把选区映射成文本光标；仅原本选中该附件时保留其选中工具。
      if (view.state.selection instanceof NodeSelection && view.state.selection.from === pos)
        transaction.setSelection(NodeSelection.create(transaction.doc, pos));
      transaction.setMeta(attachmentEditMeta, valid);
      view.dispatch(transaction);
      if (position() !== undefined && editor.state.doc.eq(transaction.doc))
        view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    } catch (error) {
      showError(error);
    }
    if (position() !== undefined) render();
  };
  const embedded = createAttachmentEmbedded({
    doc,
    options,
    live: () => position() !== undefined,
    presentation,
    fileKey: () => JSON.stringify(attachmentInfo(node)),
    info: () => attachmentInfo(node),
    name: () => (typeof node.attrs.name === "string" ? node.attrs.name : "附件"),
    resolve: attemptPreview,
    open,
  });
  const resize = createAttachmentResize({
    doc,
    live: () => {
      const settings = presentation();
      return position() !== undefined && editor.isEditable && settings.supported && settings.mode === "embedded";
    },
    height: () => {
      const settings = presentation();
      return settings.supported ? settings.height : 418;
    },
    document: () => view.state.doc,
    paint: (height) => embedded.paintHeight(height),
    commit: (height, document) => commitAttributes({ previewHeight: height }, document),
  });
  dom.append(embedded.element, resize.element);
  const render = () => {
    const info = attachmentInfo(node);
    const settings = presentation();
    dom.dataset.displayMode = settings.supported ? settings.mode : "unsupported";
    const block = settings.supported && settings.mode !== "title";
    inlineActions.hidden = !block;
    inlineDownload.hidden = !editor.isEditable && node.attrs.allowDownload === false;
    preview.hidden = block;
    download.hidden = block;
    allowDownload.checked = node.attrs.allowDownload !== false;
    allowDownload.disabled = !editor.isEditable || !settings.supported;
    tools.hidden = !selected || !editor.isEditable;
    const sizeText = formatAttachmentSize(node.attrs.size);
    size.textContent = sizeText ? ` (${sizeText})` : "";
    size.hidden = !sizeText || (settings.supported && settings.mode === "embedded");
    warning.hidden = settings.supported;
    warning.textContent = settings.supported ? "" : settings.message;
    modeButtons.forEach((button) => {
      button.disabled = !settings.supported || !editor.isEditable;
      button.setAttribute(
        "aria-pressed",
        String(settings.supported && button.dataset.attachmentMode === settings.mode),
      );
    });
    label.textContent = typeof node.attrs.name === "string" && node.attrs.name ? node.attrs.name : "附件";
    link.title = label.textContent;
    link.setAttribute("data-name", typeof node.attrs.name === "string" ? node.attrs.name : "");
    link.setAttribute("data-size", String(node.attrs.size));
    link.setAttribute("data-mime", typeof node.attrs.mimeType === "string" ? node.attrs.mimeType : "");
    if (info) {
      link.href = info.href;
      for (const action of [download, inlineDownload]) {
        action.href = info.href;
        action.download = info.name;
        action.removeAttribute("aria-disabled");
        action.removeAttribute("tabindex");
      }
    } else {
      link.removeAttribute("href");
      for (const action of [download, inlineDownload]) {
        action.removeAttribute("href");
        action.removeAttribute("download");
        action.setAttribute("aria-disabled", "true");
        action.tabIndex = -1;
      }
    }
    preview.disabled = !info;
    inlinePreview.disabled = !info;
    embedded.update();
    resize.update(settings.supported && settings.mode === "embedded" && editor.isEditable);
    positionTools();
  };
  const onLinkClick = (event: MouseEvent) => {
    event.preventDefault();
    if (editor.isEditable) select();
    else open();
  };
  const onLinkKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (event.key === "Enter") open();
    else select();
  };
  const preventSelection = (event: MouseEvent) => event.preventDefault();
  const onDownload = (event: MouseEvent) => {
    if (position() === undefined || !attachmentInfo(node)) event.preventDefault();
  };
  const onMode = (event: Event) => {
    resize.cancel();
    const mode = (event.currentTarget as HTMLButtonElement).dataset.attachmentMode as AttachmentDisplayMode;
    commitAttributes({ displayMode: mode });
  };
  const onDownloadPreference = () => {
    commitAttributes({ allowDownload: allowDownload.checked });
  };
  const onDecorationClick = (event: MouseEvent) => {
    if (event.target instanceof doc.defaultView!.Node && (icon.contains(event.target) || size.contains(event.target))) {
      event.preventDefault();
      if (editor.isEditable) select();
      else open();
    }
  };
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged) resize.cancel();
  };
  const onEditable = () => {
    resize.cancel();
    if (position() !== undefined) render();
  };
  link.addEventListener("click", onLinkClick);
  link.addEventListener("keydown", onLinkKey);
  preview.addEventListener("mousedown", preventSelection);
  preview.addEventListener("click", open);
  download.addEventListener("mousedown", preventSelection);
  download.addEventListener("click", onDownload);
  inlinePreview.addEventListener("mousedown", preventSelection);
  inlinePreview.addEventListener("click", open);
  inlineDownload.addEventListener("mousedown", preventSelection);
  inlineDownload.addEventListener("click", onDownload);
  allowDownload.addEventListener("change", onDownloadPreference);
  modeButtons.forEach((button) => {
    button.addEventListener("mousedown", preventSelection);
    button.addEventListener("click", onMode);
  });
  dom.addEventListener("click", onDecorationClick);
  view.dom.addEventListener("semlo-editor:editable", onEditable);
  editor.on("update", onEditable);
  editor.on("transaction", onTransaction);
  render();
  const unsubscribe = options.views?.subscribe(() => {
    previewRevision++;
    resize.cancel();
    embedded.invalidate(resolving);
  });
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false;
      if (!next.eq(node)) resize.cancel();
      node = next;
      message.hidden = true;
      render();
      return true;
    },
    selectNode() {
      selected = true;
      dom.classList.add("ProseMirror-selectednode");
      tools.hidden = !editor.isEditable;
      doc.defaultView?.addEventListener("resize", positionTools);
      doc.addEventListener("scroll", positionTools, true);
      positionTools();
      // 初次选中可能早于节点接入 DOM；微任务只读取仍属于本视图的选中节点。
      queueMicrotask(positionTools);
    },
    deselectNode() {
      selected = false;
      stopPositioning();
      dom.classList.remove("ProseMirror-selectednode");
      tools.hidden = true;
      message.hidden = true;
    },
    stopEvent(event) {
      return (
        !event.type.startsWith("drag") &&
        event.type !== "drop" &&
        event.target instanceof doc.defaultView!.Node &&
        dom.contains(event.target)
      );
    },
    ignoreMutation: () => true,
    destroy() {
      destroyed = true;
      selected = false;
      stopPositioning();
      unsubscribe?.();
      resize.destroy();
      embedded.destroy();
      link.removeEventListener("click", onLinkClick);
      link.removeEventListener("keydown", onLinkKey);
      preview.removeEventListener("mousedown", preventSelection);
      preview.removeEventListener("click", open);
      download.removeEventListener("mousedown", preventSelection);
      download.removeEventListener("click", onDownload);
      inlinePreview.removeEventListener("mousedown", preventSelection);
      inlinePreview.removeEventListener("click", open);
      inlineDownload.removeEventListener("mousedown", preventSelection);
      inlineDownload.removeEventListener("click", onDownload);
      allowDownload.removeEventListener("change", onDownloadPreference);
      modeButtons.forEach((button) => {
        button.removeEventListener("mousedown", preventSelection);
        button.removeEventListener("click", onMode);
      });
      dom.removeEventListener("click", onDecorationClick);
      view.dom.removeEventListener("semlo-editor:editable", onEditable);
      editor.off("update", onEditable);
      editor.off("transaction", onTransaction);
    },
  };
}
