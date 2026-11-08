import { Node, type NodeViewRendererProps } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";

import { createAttachmentResize } from "../media/attachment/resize";
import type { ContentChoice, ContentPickerProvider } from "./yuque-content-picker";

type ReferenceMode = "title" | "card" | "embedded";
interface ReferenceOptions {
  getProvider(): ContentPickerProvider | null | undefined;
  onError(error: unknown): void;
}

const dataAttribute = "data-semlo-editor-content-reference";
const defaultHeight = 460;
const icons: Record<ReferenceMode, string> = {
  title: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M12 6v12m-4 0h8"/></svg>',
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h7"/></svg>',
  embedded:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 8h18"/></svg>',
};
const openIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4h7v7m0-7-9 9"/><path d="M19 14v5H5V5h5"/></svg>';
const linkIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/></svg>';
const documentIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M7 7h10M7 11h10M7 15h7"/></svg>';
const tableIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';

function validateString(value: unknown): void {
  if (typeof value !== "string" || value.length > 4096) throw new Error("内容引用属性无效");
}
function validateKind(value: unknown): void {
  if (value !== "document" && value !== "table") throw new Error("内容引用类型无效");
}
function validateMode(value: unknown): void {
  if (value !== "title" && value !== "card" && value !== "embedded") throw new Error("内容引用展示方式无效");
}
function validateHeight(value: unknown): void {
  if (!Number.isInteger(value) || (value as number) < 160 || (value as number) > 1600)
    throw new Error("内容引用高度无效");
}
function readPayload(element: HTMLElement): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(decodeURIComponent(element.getAttribute(dataAttribute) ?? ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error("内容引用数据损坏", { cause: error });
  }
}
function safeURL(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
function yuqueEmbedURL(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "www.yuque.com" && url.hostname !== "yuque.com") ||
      url.port ||
      url.search ||
      url.hash ||
      !/^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)
    )
      return null;
    url.searchParams.set("view", "doc_embed");
    url.searchParams.set("theme", "default");
    url.hash = "default";
    return url.href;
  } catch {
    return null;
  }
}
function choiceFrom(attrs: Record<string, unknown>): ContentChoice {
  return {
    id: String(attrs.id),
    title: String(attrs.title),
    href: String(attrs.href),
    kind: attrs.kind as ContentChoice["kind"],
    ...(attrs.description ? { description: String(attrs.description) } : {}),
  };
}

function createReferenceView(
  { node: initial, editor, view, getPos }: NodeViewRendererProps,
  options: ReferenceOptions,
) {
  const doc = view.dom.ownerDocument;
  const dom = doc.createElement("span");
  dom.className = "semlo-editor-content-reference";
  dom.contentEditable = "false";
  const link = doc.createElement("a");
  link.className = "semlo-editor-content-reference-link";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const icon = doc.createElement("span");
  icon.className = "semlo-editor-content-reference-icon";
  icon.innerHTML = documentIcon;
  const text = doc.createElement("span");
  text.className = "semlo-editor-content-reference-text";
  const title = doc.createElement("span");
  title.className = "semlo-editor-content-reference-title";
  const description = doc.createElement("span");
  description.className = "semlo-editor-content-reference-description";
  text.append(title, description);
  link.append(icon, text);
  const preview = doc.createElement("span");
  preview.className = "semlo-editor-content-reference-preview";
  preview.setAttribute("role", "region");
  preview.setAttribute("aria-label", "内容嵌入预览");
  const status = doc.createElement("span");
  status.className = "semlo-editor-content-reference-status";
  status.setAttribute("role", "status");
  preview.append(status);
  const tools = doc.createElement("span");
  tools.className = "semlo-editor-content-reference-tools";
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "内容引用操作");
  const convert = doc.createElement("button");
  convert.type = "button";
  convert.setAttribute("aria-label", "转换为链接");
  convert.title = "转换为链接";
  convert.innerHTML = linkIcon;
  tools.append(convert);
  const modes = (["title", "card", "embedded"] as const).map((mode) => {
    const button = doc.createElement("button");
    button.type = "button";
    const label = mode === "title" ? "标题" : mode === "card" ? "卡片" : "嵌入";
    button.setAttribute("aria-label", `内容显示为${label}`);
    button.title = label;
    button.dataset.referenceMode = mode;
    button.innerHTML = icons[mode];
    tools.append(button);
    return button;
  });
  const open = doc.createElement("a");
  open.setAttribute("aria-label", "打开原文");
  open.title = "打开原文";
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.innerHTML = openIcon;
  tools.append(open);
  dom.append(link, preview, tools);

  let node = initial;
  let selected = false;
  let destroyed = false;
  let generation = 0;
  let resolving = false;
  let frame: HTMLIFrameElement | undefined;
  let frameKey = "";
  let frameProvider: ContentPickerProvider | null | undefined;
  const position = () => {
    if (destroyed || editor.isDestroyed || editor.view !== view || !dom.isConnected) return undefined;
    const pos = getPos();
    return typeof pos === "number" && view.state.doc.nodeAt(pos)?.eq(node) ? pos : undefined;
  };
  const clearFrame = () => {
    generation++;
    frame?.removeAttribute("src");
    frame?.remove();
    frame = undefined;
    frameKey = "";
    frameProvider = undefined;
  };
  const commit = (attrs: Record<string, unknown>, document: object = view.state.doc) => {
    const pos = position();
    if (pos === undefined || !editor.isEditable || view.state.doc !== document) return;
    if (Object.entries(attrs).every(([key, value]) => node.attrs[key] === value)) return;
    const transaction = closeHistory(view.state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
    if (view.state.selection instanceof NodeSelection && view.state.selection.from === pos)
      transaction.setSelection(NodeSelection.create(transaction.doc, pos));
    view.dispatch(transaction);
    if (position() !== undefined && editor.state.doc.eq(transaction.doc))
      view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    if (position() !== undefined) paint();
  };
  const resize = createAttachmentResize({
    doc,
    live: () => position() !== undefined && editor.isEditable && node.attrs.displayMode === "embedded",
    height: () => node.attrs.previewHeight,
    document: () => view.state.doc,
    paint: (height) => {
      preview.style.height = `${height}px`;
    },
    commit: (height, document) => commit({ previewHeight: height }, document),
  });
  resize.element.setAttribute("aria-label", "调整内容预览高度");
  dom.append(resize.element);
  const positionTools = () => {
    if (!selected || position() === undefined) return;
    const rect = dom.getBoundingClientRect();
    const width = doc.documentElement.clientWidth;
    const left = Math.max(8, Math.min(rect.left + (rect.width - tools.offsetWidth) / 2, width - tools.offsetWidth - 8));
    tools.style.left = `${left - rect.left}px`;
    const below = rect.top - tools.offsetHeight - 8 < 8;
    tools.style.top = below ? "calc(100% + 8px)" : "auto";
    tools.style.bottom = below ? "auto" : "calc(100% + 8px)";
  };
  const loadPreview = () => {
    const provider = options.getProvider();
    const choice = choiceFrom(node.attrs);
    const key = JSON.stringify(choice);
    if (frameKey === key && frameProvider === provider) return;
    clearFrame();
    frameKey = key;
    frameProvider = provider;
    const ticket = generation;
    status.textContent = "正在加载内容…";
    status.hidden = false;
    queueMicrotask(() => {
      if (ticket !== generation || position() === undefined || node.attrs.displayMode !== "embedded") return;
      const sourceDocument = view.state.doc;
      const sourceNode = node;
      let url: string | null = null;
      let allowSameOrigin = false;
      try {
        resolving = true;
        const resolver = provider?.resolveEmbed;
        if (!resolver && yuqueEmbedURL(choice.href)) {
          status.textContent = "语雀预览需要宿主配置，请打开原文";
          return;
        }
        const value = resolver ? resolver.call(provider, choice) : null;
        if (value && typeof value === "object") {
          url = safeURL(value.url);
          allowSameOrigin = value.allowSameOrigin === true;
        } else url = safeURL(value);
      } catch (error) {
        if (ticket === generation && position() !== undefined) options.onError(error);
      } finally {
        resolving = false;
      }
      if (ticket !== generation || position() === undefined || options.getProvider() !== provider) return;
      if (view.state.doc !== sourceDocument || node !== sourceNode) {
        status.textContent = "预览目标已变化，请重新选择展示方式";
        return;
      }
      if (!url) {
        status.textContent = "无法预览，请打开原文";
        return;
      }
      if (
        allowSameOrigin &&
        (!doc.location?.origin || doc.location.origin === "null" || new URL(url).origin === doc.location.origin)
      ) {
        status.textContent = "无法安全预览，请打开原文";
        return;
      }
      const next = doc.createElement("iframe");
      next.className = "semlo-editor-content-reference-frame";
      next.title = `内容预览：${choice.title}`;
      next.referrerPolicy = "no-referrer";
      next.setAttribute(
        "sandbox",
        `allow-scripts allow-forms allow-popups${allowSameOrigin ? " allow-same-origin" : ""}`,
      );
      next.addEventListener("load", () => {
        if (ticket === generation && frame === next && position() !== undefined) status.hidden = true;
      });
      next.addEventListener("error", () => {
        if (ticket === generation && frame === next && position() !== undefined) {
          clearFrame();
          status.hidden = false;
          status.textContent = "预览加载失败，请打开原文";
        }
      });
      frame = next;
      next.src = url;
      preview.append(next);
    });
  };
  const paint = () => {
    const mode = node.attrs.displayMode as ReferenceMode;
    const url = safeURL(node.attrs.href);
    dom.dataset.displayMode = mode;
    icon.innerHTML = node.attrs.kind === "table" ? tableIcon : documentIcon;
    title.textContent = node.attrs.title || "内容";
    description.textContent = node.attrs.description;
    description.hidden = !node.attrs.description || mode === "title";
    if (url) {
      link.href = url;
      open.href = url;
      open.removeAttribute("aria-disabled");
      open.removeAttribute("tabindex");
    } else {
      link.removeAttribute("href");
      open.removeAttribute("href");
      open.setAttribute("aria-disabled", "true");
      open.tabIndex = -1;
    }
    tools.hidden = !selected || !editor.isEditable;
    convert.disabled = !url || !view.state.schema.marks.link;
    modes.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.referenceMode === mode)));
    preview.hidden = mode !== "embedded";
    if (mode === "embedded") {
      preview.style.height = `${node.attrs.previewHeight}px`;
      loadPreview();
    } else clearFrame();
    resize.update(mode === "embedded" && editor.isEditable);
    positionTools();
  };
  const onClick = (event: MouseEvent) => {
    if (!editor.isEditable) return;
    event.preventDefault();
    const pos = position();
    if (pos === undefined) return;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).setMeta("addToHistory", false));
    if (position() === pos) view.focus();
  };
  const onMode = (event: Event) => {
    resize.cancel();
    commit({ displayMode: (event.currentTarget as HTMLButtonElement).dataset.referenceMode });
  };
  const onConvert = () => {
    const pos = position();
    const href = safeURL(node.attrs.href);
    const mark = view.state.schema.marks.link;
    if (pos === undefined || !editor.isEditable || !href || !mark) return;
    const text = view.state.schema.text(node.attrs.title || "内容", [mark.create({ href })]);
    const transaction = closeHistory(view.state.tr.replaceWith(pos, pos + node.nodeSize, text));
    view.dispatch(transaction);
    if (!editor.isDestroyed && editor.view === view && editor.state.doc.eq(transaction.doc)) {
      view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
      view.focus();
    }
  };
  const preventSelection = (event: MouseEvent) => event.preventDefault();
  const onEditable = () => {
    resize.cancel();
    if (position() !== undefined) paint();
  };
  const onProvider = () => {
    clearFrame();
    if (resolving) {
      status.hidden = false;
      status.textContent = "预览服务已变化，请重新选择展示方式";
      return;
    }
    if (position() !== undefined) paint();
  };
  const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
    if (transaction.docChanged) resize.cancel();
  };
  link.addEventListener("click", onClick);
  convert.addEventListener("mousedown", preventSelection);
  convert.addEventListener("click", onConvert);
  modes.forEach((button) => {
    button.addEventListener("mousedown", preventSelection);
    button.addEventListener("click", onMode);
  });
  view.dom.addEventListener("semlo-editor:editable", onEditable);
  view.dom.addEventListener("semlo-editor:yuque-content-provider", onProvider);
  editor.on("transaction", onTransaction);
  paint();
  return {
    dom,
    update(next: typeof node) {
      if (next.type !== node.type) return false;
      if (!next.eq(node)) resize.cancel();
      node = next;
      paint();
      return true;
    },
    selectNode() {
      selected = true;
      dom.classList.add("ProseMirror-selectednode");
      tools.hidden = !editor.isEditable;
      doc.defaultView?.addEventListener("resize", positionTools);
      doc.addEventListener("scroll", positionTools, true);
      queueMicrotask(positionTools);
    },
    deselectNode() {
      selected = false;
      dom.classList.remove("ProseMirror-selectednode");
      tools.hidden = true;
      doc.defaultView?.removeEventListener("resize", positionTools);
      doc.removeEventListener("scroll", positionTools, true);
    },
    stopEvent(event: Event) {
      return !event.type.startsWith("drag") && event.type !== "drop" && dom.contains(event.target as globalThis.Node);
    },
    ignoreMutation: () => true,
    destroy() {
      destroyed = true;
      clearFrame();
      resize.destroy();
      link.removeEventListener("click", onClick);
      convert.removeEventListener("mousedown", preventSelection);
      convert.removeEventListener("click", onConvert);
      modes.forEach((button) => {
        button.removeEventListener("mousedown", preventSelection);
        button.removeEventListener("click", onMode);
      });
      view.dom.removeEventListener("semlo-editor:editable", onEditable);
      view.dom.removeEventListener("semlo-editor:yuque-content-provider", onProvider);
      editor.off("transaction", onTransaction);
      doc.defaultView?.removeEventListener("resize", positionTools);
      doc.removeEventListener("scroll", positionTools, true);
    },
  };
}

export const ContentReference = Node.create<ReferenceOptions>({
  name: "semloEditorContentReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return { getProvider: () => undefined, onError: () => {} };
  },
  addAttributes() {
    return Object.fromEntries(
      [
        ["id", "", validateString],
        ["title", "", validateString],
        ["href", "", validateString],
        ["kind", "document", validateKind],
        ["description", "", validateString],
        ["displayMode", "embedded", validateMode],
        ["previewHeight", defaultHeight, validateHeight],
      ].map(([name, fallback, validate]) => [
        name,
        {
          default: fallback,
          rendered: false,
          parseHTML: (element: HTMLElement) => readPayload(element)[name as string] ?? fallback,
          validate,
        },
      ]),
    );
  },
  parseHTML() {
    return [{ tag: `span[${dataAttribute}]`, priority: 100 }];
  },
  renderText({ node }) {
    return node.attrs.title || "内容";
  },
  renderHTML({ node }) {
    const href = safeURL(node.attrs.href);
    return [
      "span",
      { [dataAttribute]: encodeURIComponent(JSON.stringify(node.attrs)) },
      ["a", href ? { href, target: "_blank", rel: "noopener noreferrer" } : {}, node.attrs.title || "内容"],
    ];
  },
  addNodeView() {
    return (props) => createReferenceView(props, this.options);
  },
});
