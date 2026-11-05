import { Node, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";

import { isEmbedProvider, resolveEmbed } from "./embed-providers";

export interface EmbedMetadata {
  title?: string;
  description?: string;
  iconUrl?: string;
}

/**
 * The URL is the validated embed address; the host owns retrieval and network policy.
 * When a request is invalidated during a bookmark view update or removal, its result
 * is ignored immediately; the abort signal may be delivered in the next microtask.
 */
export type EmbedMetadataResolver = (
  url: string,
  options: { signal: AbortSignal; canonicalUrl?: string },
) => Promise<EmbedMetadata | null>;
interface BookmarkOptions {
  resolveMetadata?: EmbedMetadataResolver;
}
const resolverOverrides = new WeakMap<Editor, EmbedMetadataResolver | undefined>();

/** Update one editor's integration and notify existing node views. */
export function setEmbedMetadataResolver(editor: Editor, resolver: EmbedMetadataResolver | undefined) {
  resolverOverrides.set(editor, resolver);
  if (!editor.isDestroyed) {
    const EventType = editor.view.dom.ownerDocument.defaultView?.Event ?? Event;
    editor.view.dom.dispatchEvent(new EventType("semlo-editor:embed-metadata"));
  }
}

function effectiveResolver(editor: Editor, fallback: EmbedMetadataResolver | undefined) {
  return resolverOverrides.has(editor) ? resolverOverrides.get(editor) : fallback;
}
const bounded = (value: unknown, limit: number) => (typeof value === "string" ? value.slice(0, limit) : "");
const stringValue = (value: unknown) => (typeof value === "string" ? value : "");
function readRawBookmarkAttribute(
  element: HTMLElement,
  key: "provider" | "url" | "title" | "description" | "iconUrl",
): unknown {
  const payload = element.getAttribute("data-semlo-bookmark-raw");
  if (payload === null) return element.getAttribute(`data-${key === "iconUrl" ? "icon-url" : key}`) ?? "";
  try {
    const value: unknown = JSON.parse(decodeURIComponent(payload));
    if (!value || typeof value !== "object" || Array.isArray(value) || !(key in value)) throw new Error();
    return (value as Record<string, unknown>)[key];
  } catch {
    throw new Error("书签数据无法解析，请检查原始内容");
  }
}
function safeIcon(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

/** Call after registering both bookmark nodes and configuring their resolver. */
export function canConvertEmbedToBookmark(editor: Editor, kind: "inline" | "block") {
  const name = kind === "inline" ? "semloEditorEmbedBookmarkInline" : "semloEditorEmbedBookmarkBlock";
  const extension = editor.extensionManager.extensions.find((entry) => entry.name === name);
  return (
    !!editor.schema.nodes[name] && typeof effectiveResolver(editor, extension?.options.resolveMetadata) === "function"
  );
}

export function convertEmbedToBookmark(editor: Editor, position: number, kind: "inline" | "block") {
  if (!editor.isEditable || !canConvertEmbedToBookmark(editor, kind)) return false;
  const old = editor.state.doc.nodeAt(position);
  if (!old || old.type.name !== "semloEditorEmbed") return false;
  const target = resolveEmbed(old.attrs.provider, old.attrs.url);
  if (!target) return false;
  const name = kind === "inline" ? "semloEditorEmbedBookmarkInline" : "semloEditorEmbedBookmarkBlock";
  const bookmark = editor.schema.nodes[name].create({ provider: old.attrs.provider, url: target.url });
  const replacement = kind === "inline" ? editor.schema.nodes.paragraph.create(null, bookmark) : bookmark;
  const tr = closeHistory(editor.state.tr.replaceWith(position, position + old.nodeSize, replacement));
  editor.view.dispatch(tr);
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  editor.view.focus();
  return true;
}

function bookmarkNode(kind: "inline" | "block") {
  const inline = kind === "inline";
  return Node.create<BookmarkOptions>({
    name: inline ? "semloEditorEmbedBookmarkInline" : "semloEditorEmbedBookmarkBlock",
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    selectable: true,
    draggable: !inline,
    addOptions() {
      return { resolveMetadata: undefined };
    },
    addAttributes() {
      return Object.fromEntries(
        ["provider", "url", "title", "description", "iconUrl"].map((key) => [
          key,
          {
            default: "",
            rendered: false,
            parseHTML: (element: HTMLElement) =>
              readRawBookmarkAttribute(element, key as "provider" | "url" | "title" | "description" | "iconUrl"),
          },
        ]),
      );
    },
    parseHTML() {
      return [
        {
          tag: `${inline ? "span" : "figure"}[data-semlo-editor-embed-bookmark="${kind}"]`,
          priority: 100,
          getAttrs: (element: HTMLElement) => {
            if (!element.hasAttribute("data-semlo-bookmark-raw")) return {};
            const attrs: Record<string, null> = {};
            for (const key of ["provider", "url", "title", "description", "iconUrl"] as const)
              if (readRawBookmarkAttribute(element, key) === null) attrs[key] = null;
            return attrs;
          },
        },
      ];
    },
    renderText({ node }) {
      return stringValue(node.attrs.title) || resolveEmbed(node.attrs.provider, node.attrs.url)?.embedUrl || "";
    },
    renderHTML({ node }) {
      const target = resolveEmbed(node.attrs.provider, node.attrs.url);
      const title = stringValue(node.attrs.title);
      const attrs = {
        "data-semlo-editor-embed-bookmark": kind,
        "data-provider": isEmbedProvider(node.attrs.provider) ? node.attrs.provider : "",
        "data-url": target?.url ?? "",
        "data-title": title,
        "data-description": stringValue(node.attrs.description),
        "data-icon-url": safeIcon(node.attrs.iconUrl),
        "data-semlo-bookmark-raw": encodeURIComponent(
          JSON.stringify({
            provider: node.attrs.provider,
            url: node.attrs.url,
            title: node.attrs.title,
            description: node.attrs.description,
            iconUrl: node.attrs.iconUrl,
          }),
        ),
      };
      return target
        ? [
            inline ? "span" : "figure",
            attrs,
            ["a", { href: target.embedUrl, target: "_blank", rel: "noopener noreferrer" }, title || target.embedUrl],
          ]
        : [inline ? "span" : "figure", attrs, title || "链接不可用"];
    },
    addNodeView() {
      const options = this.options;
      return ({ editor, view, node: initial, getPos }) => {
        const doc = view.dom.ownerDocument;
        const dom = doc.createElement(inline ? "span" : "div");
        dom.className = `semlo-editor-embed-bookmark semlo-editor-embed-bookmark-${kind}`;
        dom.contentEditable = "false";
        const icon = doc.createElement("img");
        icon.className = "semlo-editor-embed-bookmark-icon";
        icon.alt = "";
        const fallbackIcon = doc.createElement("span");
        fallbackIcon.className = "semlo-editor-embed-bookmark-fallback-icon";
        fallbackIcon.setAttribute("aria-hidden", "true");
        let failedIcon = "";
        icon.addEventListener("error", () => {
          failedIcon = icon.getAttribute("src") ?? "";
          icon.hidden = true;
          fallbackIcon.hidden = false;
        });
        const body = doc.createElement("span");
        body.className = "semlo-editor-embed-bookmark-body";
        const title = doc.createElement("span");
        title.className = "semlo-editor-embed-bookmark-title";
        const description = doc.createElement("span");
        description.className = "semlo-editor-embed-bookmark-description";
        const link = doc.createElement("a");
        link.className = "semlo-editor-embed-bookmark-link";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const retry = doc.createElement("button");
        retry.type = "button";
        retry.className = "semlo-editor-embed-bookmark-retry";
        retry.textContent = "重试";
        retry.hidden = true;
        body.append(title, description, link, retry);
        const toolbar = doc.createElement("span");
        toolbar.className = "semlo-editor-embed-bookmark-toolbar";
        toolbar.setAttribute("role", "toolbar");
        toolbar.setAttribute("aria-label", "书签操作");
        const toEmbed = doc.createElement("button");
        toEmbed.type = "button";
        toEmbed.textContent = "嵌入";
        const toLink = doc.createElement("button");
        toLink.type = "button";
        toLink.textContent = "转换为链接";
        const toTitle = doc.createElement("button");
        toTitle.type = "button";
        toTitle.textContent = "标题";
        const toCard = doc.createElement("button");
        toCard.type = "button";
        toCard.textContent = "卡片";
        const open = doc.createElement("a");
        open.textContent = "打开链接";
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        const edit = doc.createElement("button");
        edit.type = "button";
        edit.textContent = "编辑";
        toolbar.append(toLink, toTitle, toCard, toEmbed, open, edit);
        const editPanel = doc.createElement("span");
        editPanel.className = "semlo-editor-embed-bookmark-edit";
        editPanel.hidden = true;
        const editLabel = doc.createElement("label");
        editLabel.textContent = "标题";
        const editInput = doc.createElement("input");
        editInput.type = "text";
        editInput.setAttribute("aria-label", "标题");
        editLabel.append(editInput);
        editPanel.append(editLabel);
        toolbar.append(editPanel);
        dom.append(icon, fallbackIcon, body, toolbar);
        let current = initial;
        let selected = false;
        let destroyed = false;
        let composingTitle = false;
        let originalEditInput = "";
        let pending: AbortController | null = null;
        let attempted = "";
        let failed = false;

        const cancel = (defer = false) => {
          const previous = pending;
          pending = null;
          if (defer && previous) queueMicrotask(() => previous.abort());
          else previous?.abort();
        };
        const placeToolbar = () => {
          if (toolbar.hidden) return;
          const editorToolbar = dom.closest(".semlo-editor")?.querySelector<HTMLElement>(".semlo-editor-toolbar");
          const toolbarBottom = editorToolbar?.getBoundingClientRect().bottom ?? 0;
          const availableTop = Math.max(0, toolbarBottom);
          const height = toolbar.offsetHeight || 40;
          toolbar.classList.toggle("is-below", dom.getBoundingClientRect().top - height - 8 < availableTop);
        };
        const paint = (deferAbort = false) => {
          if (destroyed) return;
          const target = resolveEmbed(current.attrs.provider, current.attrs.url);
          const resolver = effectiveResolver(editor, options.resolveMetadata);
          const currentTitle = bounded(current.attrs.title, 500);
          const iconUrl = safeIcon(current.attrs.iconUrl);
          title.textContent = currentTitle || target?.embedUrl || "链接不可用";
          description.textContent = inline ? "" : bounded(current.attrs.description, 2000);
          description.hidden = inline || !description.textContent;
          const showIcon = !!iconUrl && iconUrl !== failedIcon;
          icon.hidden = !showIcon;
          fallbackIcon.hidden = showIcon;
          if (showIcon) {
            if (icon.getAttribute("src") !== iconUrl) icon.src = iconUrl;
          } else icon.removeAttribute("src");
          link.textContent = inline ? "" : (target?.embedUrl ?? "");
          link.hidden = inline || !target;
          if (target) link.href = target.embedUrl;
          else link.removeAttribute("href");
          toolbar.hidden = !selected || !editor.isEditable || !target;
          placeToolbar();
          toEmbed.disabled = !view.state.schema.nodes.semloEditorEmbed;
          toLink.disabled = !view.state.schema.marks.link;
          toTitle.disabled = inline || !view.state.schema.nodes.semloEditorEmbedBookmarkInline;
          toCard.disabled = !inline || !view.state.schema.nodes.semloEditorEmbedBookmarkBlock;
          if (target) open.href = target.embedUrl;
          else open.removeAttribute("href");
          retry.hidden = !failed || !editor.isEditable || !resolver || !target;
          if (!editor.isEditable || !target || !resolver || currentTitle) {
            cancel(deferAbort);
            return;
          }
          if (attempted === target.embedUrl) return;
          attempted = target.embedUrl;
          failed = false;
          retry.hidden = true;
          const controller = new AbortController();
          pending = controller;
          title.textContent = "内容加载中…";
          void Promise.resolve()
            .then(() =>
              controller.signal.aborted || destroyed || pending !== controller
                ? null
                : resolver(target.embedUrl, { signal: controller.signal, canonicalUrl: target.url }),
            )
            .then((metadata) => {
              if (controller.signal.aborted || destroyed || pending !== controller || !editor.isEditable) return;
              if (!metadata) {
                failed = true;
                return;
              }
              const pos = getPos();
              if (typeof pos !== "number") return;
              const node = view.state.doc.nodeAt(pos);
              if (!node || node.type !== current.type || node.attrs.url !== current.attrs.url || node.attrs.title)
                return;
              const attrs = {
                ...node.attrs,
                title: stringValue(metadata.title),
                description: stringValue(metadata.description),
                iconUrl: safeIcon(metadata.iconUrl),
              };
              if (!attrs.title && !attrs.description && !attrs.iconUrl) {
                failed = true;
                return;
              }
              if (pending === controller) pending = null;
              view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, attrs).setMeta("addToHistory", false));
            })
            .catch(() => {
              if (!controller.signal.aborted && pending === controller) failed = true;
            })
            .finally(() => {
              if (pending === controller) {
                pending = null;
                if (!destroyed) paint();
              }
            });
        };
        const replace = (to: "embed" | "link" | "inline" | "block") => {
          if (!editor.isEditable) return;
          const position = getPos();
          const target = resolveEmbed(current.attrs.provider, current.attrs.url);
          const node = typeof position === "number" ? view.state.doc.nodeAt(position) : null;
          if (typeof position !== "number" || !node || node.type !== current.type || !target) return;
          let replacement;
          if (to === "embed") {
            const type = view.state.schema.nodes.semloEditorEmbed;
            if (!type) return;
            replacement = type.create({ provider: node.attrs.provider, url: target.url });
          } else if (to === "link") {
            const mark = view.state.schema.marks.link;
            if (!mark) return;
            const text = view.state.schema.text(stringValue(node.attrs.title) || target.embedUrl, [
              mark.create({ href: target.embedUrl }),
            ]);
            replacement = inline ? text : view.state.schema.nodes.paragraph.create(null, text);
          } else {
            const type =
              view.state.schema.nodes[
                to === "inline" ? "semloEditorEmbedBookmarkInline" : "semloEditorEmbedBookmarkBlock"
              ];
            if (!type) return;
            const next = type.create(node.attrs);
            replacement = to === "inline" ? view.state.schema.nodes.paragraph.create(null, next) : next;
          }
          // Aborting calls host code synchronously; it can replace the document
          // or destroy the editor before this conversion starts.
          const before = view.state.doc;
          cancel();
          if (destroyed || !editor.isEditable || view.state.doc !== before || getPos() !== position) {
            attempted = "";
            if (!destroyed) paint();
            return;
          }
          const tr = closeHistory(view.state.tr.replaceRangeWith(position, position + node.nodeSize, replacement));
          view.dispatch(tr);
          if (!destroyed) {
            view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
            if (!destroyed) view.focus();
          }
        };
        for (const button of [toEmbed, toLink, toTitle, toCard, edit])
          button.addEventListener("mousedown", (event) => event.preventDefault());
        toEmbed.addEventListener("click", () => replace("embed"));
        toLink.addEventListener("click", () => replace("link"));
        toTitle.addEventListener("click", () => replace("inline"));
        toCard.addEventListener("click", () => replace("block"));
        edit.addEventListener("click", () => {
          if (!editor.isEditable) return;
          editInput.value = stringValue(current.attrs.title);
          originalEditInput = editInput.value;
          editPanel.hidden = false;
          editInput.focus();
          editInput.select();
        });
        const commitTitle = () => {
          const position = getPos();
          const node = typeof position === "number" ? view.state.doc.nodeAt(position) : null;
          if (!editor.isEditable || typeof position !== "number" || node?.type !== current.type) return;
          // 单行输入框会折叠换行；未修改时不要用显示值覆盖文档原文。
          if (editInput.value === originalEditInput) return;
          const title = stringValue(editInput.value);
          if (title !== node.attrs.title) {
            // An abort listener may change the document before the title write.
            const before = view.state.doc;
            cancel();
            if (destroyed || !editor.isEditable || view.state.doc !== before || getPos() !== position) {
              attempted = "";
              if (!destroyed) paint();
              return;
            }
            view.dispatch(closeHistory(view.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, title })));
            if (!destroyed) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
          }
        };
        editInput.addEventListener("blur", () => {
          composingTitle = false;
          if (editPanel.hidden) return;
          commitTitle();
          editPanel.hidden = true;
        });
        editInput.addEventListener("compositionstart", () => {
          composingTitle = true;
        });
        editInput.addEventListener("compositionend", () => {
          composingTitle = false;
        });
        editInput.addEventListener("keydown", (event) => {
          if (composingTitle || event.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            editPanel.hidden = true;
            view.focus();
          } else if (event.key === "Enter") {
            event.preventDefault();
            commitTitle();
            editPanel.hidden = true;
            if (!destroyed) view.focus();
          }
        });
        retry.addEventListener("mousedown", (event) => event.preventDefault());
        retry.addEventListener("click", () => {
          if (!editor.isEditable) return;
          attempted = "";
          failed = false;
          paint();
        });
        dom.addEventListener("mousedown", (event) => {
          if (
            !editor.isEditable ||
            toolbar.contains(event.target as globalThis.Node) ||
            retry.contains(event.target as globalThis.Node)
          )
            return;
          const position = getPos();
          if (typeof position !== "number" || view.state.doc.nodeAt(position)?.type !== current.type) return;
          event.preventDefault();
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)));
          view.focus();
        });
        const editableChanged = () => {
          if (!editor.isEditable) {
            cancel();
            composingTitle = false;
            editPanel.hidden = true;
          } else attempted = "";
          paint();
        };
        view.dom.addEventListener("semlo-editor:editable", editableChanged);
        const resolverChanged = () => {
          cancel();
          attempted = "";
          paint();
        };
        view.dom.addEventListener("semlo-editor:embed-metadata", resolverChanged);
        let announcedDoc: typeof view.state.doc | null = null;
        const invalidateDocumentWork = () => {
          cancel();
          attempted = "";
          failed = false;
          composingTitle = false;
          editPanel.hidden = true;
          // The same node view may survive replacement of the surrounding
          // document. Restart only after the replacement transaction finishes.
          queueMicrotask(() => {
            if (!destroyed) paint();
          });
        };
        const documentReplaced = () => {
          const before = view.state.doc;
          announcedDoc = before;
          invalidateDocumentWork();
          queueMicrotask(() => {
            if (announcedDoc === before) announcedDoc = null;
          });
        };
        view.dom.addEventListener("semlo-editor:document-replace", documentReplaced);
        const transactionReplaced = ({
          transaction,
          appendedTransactions,
        }: {
          transaction: Transaction;
          appendedTransactions: Transaction[];
        }) => {
          if (destroyed) return;
          const changes = [transaction, ...appendedTransactions];
          if (!changes.some((change) => change.docChanged)) return;
          const announced = announcedDoc === transaction.before;
          if (announced) announcedDoc = null;
          // A plugin may undo an intermediate change in an appended
          // transaction. The visible document did not change as a whole.
          if (transaction.before.eq(view.state.doc)) {
            if (announced) return;
            const position = getPos();
            if (typeof position !== "number") return;
            const beforeNode = transaction.before.nodeAt(position);
            const afterNode = view.state.doc.nodeAt(position);
            if (beforeNode === afterNode) return;
            invalidateDocumentWork();
            return;
          }
          if (!announced) {
            const position = getPos();
            if (typeof position === "number") {
              let oldPosition = position;
              for (let index = changes.length - 1; index >= 0; index--) {
                oldPosition = changes[index].mapping.invert().map(oldPosition, 1);
              }
              const beforeNode = transaction.before.nodeAt(oldPosition);
              const afterNode = view.state.doc.nodeAt(position);
              if (beforeNode !== afterNode) {
                let beforeCount = 0;
                let afterCount = 0;
                transaction.before.descendants((node) => {
                  if (node === afterNode) beforeCount++;
                });
                view.state.doc.descendants((node) => {
                  if (node === afterNode) afterCount++;
                });
                if (!afterNode || beforeCount !== 1 || afterCount !== 1) {
                  invalidateDocumentWork();
                  return;
                }
              }
            }
          }
          let invalidate = false;
          for (const change of changes) {
            if (!change.docChanged || change.before.eq(change.doc)) continue;
            let replaced = false;
            change.mapping.maps.forEach((map, index) => {
              const before = change.docs[index];
              map.forEach((oldStart, oldEnd, newStart) => {
                if (before && oldStart === 0 && oldEnd === before.content.size && newStart === 0) replaced = true;
              });
            });
            if (!replaced) continue;
            if (announced && change === transaction) continue;
            else invalidate = true;
          }
          if (invalidate) invalidateDocumentWork();
        };
        editor.on("transaction", transactionReplaced);
        doc.defaultView?.addEventListener("scroll", placeToolbar, true);
        paint();
        return {
          dom,
          update(node) {
            if (node.type !== current.type) return false;
            if (node.attrs.url !== current.attrs.url || node.attrs.provider !== current.attrs.provider) {
              cancel(true);
              attempted = "";
              failed = false;
            }
            current = node;
            // Abort listeners must run after ProseMirror finishes this view update.
            paint(true);
            return true;
          },
          selectNode() {
            selected = true;
            dom.classList.add("is-selected");
            paint();
          },
          deselectNode() {
            selected = false;
            editPanel.hidden = true;
            dom.classList.remove("is-selected");
            paint();
          },
          stopEvent: (event) =>
            toolbar.contains(event.target as globalThis.Node) ||
            link.contains(event.target as globalThis.Node) ||
            retry.contains(event.target as globalThis.Node),
          ignoreMutation: () => true,
          destroy() {
            destroyed = true;
            // ProseMirror is still updating its view here. Host abort listeners
            // may destroy the editor or dispatch another transaction.
            cancel(true);
            view.dom.removeEventListener("semlo-editor:editable", editableChanged);
            view.dom.removeEventListener("semlo-editor:embed-metadata", resolverChanged);
            view.dom.removeEventListener("semlo-editor:document-replace", documentReplaced);
            editor.off("transaction", transactionReplaced);
            doc.defaultView?.removeEventListener("scroll", placeToolbar, true);
          },
        };
      };
    },
  });
}

export const EmbedBookmarkInline = bookmarkNode("inline");
export const EmbedBookmarkBlock = bookmarkNode("block");
