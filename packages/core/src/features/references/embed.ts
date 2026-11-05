import { Node, type Editor, type Range } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";

import { canConvertEmbedToBookmark, convertEmbedToBookmark } from "./embed-bookmark";
import { embedProviders, isEmbedProvider, resolveEmbed, type EmbedProvider } from "./embed-providers";

/** Insert an empty card and focus only that new card once its menu is gone. */
export function insertEmbed(editor: Editor, provider: EmbedProvider, range?: Range): boolean {
  if (editor.isDestroyed || !editor.isEditable || !isEmbedProvider(provider)) return false;
  const content = { type: "semloEditorEmbed", attrs: { provider } };
  const probe = editor.can().chain().focus();
  if (range) probe.deleteRange(range);
  if (!probe.insertContent(content).run()) return false;

  const previous = new Set<ProseMirrorNode>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "semloEditorEmbed") previous.add(node);
  });
  const chain = editor.chain().focus();
  if (range) chain.deleteRange(range);
  if (!chain.insertContent(content).run()) return false;
  let inserted: ProseMirrorNode | undefined;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "semloEditorEmbed" && !previous.has(node)) inserted = node;
  });
  if (!inserted) return true;
  const selection = editor.state.selection;
  const doc = editor.view.dom.ownerDocument;
  const focusInserted = () => {
    if (editor.isDestroyed || !editor.isEditable || !editor.state.selection.eq(selection)) return;
    const active = doc.activeElement;
    if (active && active !== doc.body && active !== editor.view.dom) return;
    let position: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node === inserted) position = pos;
    });
    if (position === undefined) return;
    const dom = editor.view.nodeDOM(position);
    if (dom?.nodeType === 1) (dom as Element).querySelector<HTMLInputElement>(".semlo-editor-embed-input")?.focus();
  };
  if (doc.defaultView) doc.defaultView.requestAnimationFrame(focusInserted);
  else queueMicrotask(focusInserted);
  return true;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readRawEmbedAttribute(element: HTMLElement, key: "provider" | "url" | "draft"): unknown {
  const payload = element.getAttribute("data-semlo-embed-raw");
  if (payload === null) return element.getAttribute(`data-${key}`) ?? "";
  try {
    const value: unknown = JSON.parse(decodeURIComponent(payload));
    if (!value || typeof value !== "object" || Array.isArray(value) || !(key in value)) throw new Error();
    return (value as Record<string, unknown>)[key];
  } catch {
    throw new Error("嵌入内容数据无法解析，请检查原始内容");
  }
}

// Material Design Icons, Copyright Google LLC, Apache-2.0:
// licenses/MATERIAL-ICONS-LICENSE.txt. Paths are normalized and transparent backgrounds omitted.
const toolbarIcons = {
  link: "M17 7h-4v2h4c1.65 0 3 1.35 3 3s-1.35 3-3 3h-4v2h4c2.76 0 5-2.24 5-5s-2.24-5-5-5zm-6 8H7c-1.65 0-3-1.35-3-3s1.35-3 3-3h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-2zm-3-4h8v2H8z",
  title: "M5 4v3h5.5v12h3V7H19V4H5z",
  card: "M19 5v14H5V5h14m0-2H5C3.9 3 3 3.9 3 5v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM14 17H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z",
  embed: "M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm0 14H5V8h14v10z",
  open: "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
} as const;

function setToolbarIcon(element: HTMLElement, label: string, icon: keyof typeof toolbarIcons, tooltip = label) {
  element.setAttribute("aria-label", label);
  element.title = tooltip;
  const svg = element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", toolbarIcons[icon]);
  svg.append(path);
  element.append(svg);
}

/**
 * The document stores links, never iframe markup. Rendering validates and
 * reconstructs the iframe URL again even when content came from JSON or HTML.
 */
export const SemloEditorEmbed = Node.create({
  name: "semloEditorEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      provider: {
        default: "",
        rendered: false,
        parseHTML: (element) => readRawEmbedAttribute(element, "provider"),
      },
      url: {
        default: "",
        rendered: false,
        parseHTML: (element) => readRawEmbedAttribute(element, "url"),
      },
      draft: {
        default: "",
        rendered: false,
        parseHTML: (element) => readRawEmbedAttribute(element, "draft"),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-semlo-editor-embed]",
        priority: 100,
        getAttrs: (element: HTMLElement) => {
          if (!element.hasAttribute("data-semlo-embed-raw")) return {};
          const attrs: Record<string, null> = {};
          for (const key of ["provider", "url", "draft"] as const)
            if (readRawEmbedAttribute(element, key) === null) attrs[key] = null;
          return attrs;
        },
      },
    ];
  },
  renderText({ node }) {
    return resolveEmbed(node.attrs.provider, node.attrs.url)?.url ?? stringValue(node.attrs.draft);
  },
  renderHTML({ node }) {
    const provider = isEmbedProvider(node.attrs.provider) ? node.attrs.provider : "";
    const target = resolveEmbed(provider, node.attrs.url);
    const label = provider ? embedProviders[provider].label : "嵌入内容";
    const attrs = {
      "data-semlo-editor-embed": "",
      "data-provider": provider,
      "data-url": target?.url ?? "",
      "data-draft": stringValue(node.attrs.draft),
      "data-semlo-embed-raw": encodeURIComponent(
        JSON.stringify({ provider: node.attrs.provider, url: node.attrs.url, draft: node.attrs.draft }),
      ),
      class: "semlo-editor-embed-export",
    };
    return target
      ? ["figure", attrs, ["a", { href: target.url, rel: "noopener noreferrer", target: "_blank" }, target.url]]
      : ["figure", attrs, label];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("div");
      dom.className = "semlo-editor-embed";
      dom.dataset.type = "semloEditorEmbed";
      dom.contentEditable = "false";

      const form = doc.createElement("form");
      form.className = "semlo-editor-embed-form";
      const input = doc.createElement("input");
      input.className = "semlo-editor-embed-input";
      input.type = "url";
      input.setAttribute("autocomplete", "off");
      input.setAttribute("spellcheck", "false");
      const example = doc.createElement("button");
      example.type = "button";
      example.className = "semlo-editor-embed-example";
      example.textContent = "查看示例";
      const submit = doc.createElement("button");
      submit.type = "submit";
      submit.className = "semlo-editor-embed-submit";
      submit.textContent = "确定";
      form.noValidate = true;
      form.append(input, example, submit);
      const error = doc.createElement("div");
      error.className = "semlo-editor-embed-error";
      error.setAttribute("role", "status");
      error.textContent = "暂不支持显示该网站内容";
      error.hidden = true;

      const preview = doc.createElement("div");
      preview.className = "semlo-editor-embed-preview";
      const select = doc.createElement("button");
      select.type = "button";
      select.className = "semlo-editor-embed-select";
      select.setAttribute("aria-label", "选择嵌入内容");
      const toolbar = doc.createElement("div");
      toolbar.className = "semlo-editor-embed-toolbar";
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "嵌入内容操作");
      const convert = doc.createElement("button");
      convert.type = "button";
      setToolbarIcon(convert, "转换为链接", "link");
      const title = doc.createElement("button");
      title.type = "button";
      setToolbarIcon(title, "标题", "title", "标题（需要远程内容服务）");
      const card = doc.createElement("button");
      card.type = "button";
      setToolbarIcon(card, "卡片", "card", "卡片（需要远程内容服务）");
      const embed = doc.createElement("button");
      embed.type = "button";
      setToolbarIcon(embed, "嵌入", "embed");
      embed.disabled = true;
      embed.setAttribute("aria-pressed", "true");
      const open = doc.createElement("a");
      setToolbarIcon(open, "打开链接", "open");
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      toolbar.append(convert, title, card, embed, open);
      preview.append(select);
      dom.append(form, error, preview, toolbar);

      let current = initial;
      let selected = false;
      let destroyed = false;
      let composingInput = false;
      let invalid = false;
      let player: HTMLIFrameElement | HTMLVideoElement | null = null;
      let playerURL = "";

      const removePlayer = () => {
        if (player?.tagName === "VIDEO") (player as HTMLVideoElement).pause();
        player?.remove();
        player = null;
        playerURL = "";
      };

      const updateAttrs = (attrs: Record<string, unknown>, separateHistory = false) => {
        if (destroyed || !editor.isEditable) return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const node = view.state.doc.nodeAt(pos);
        if (!node || node.type !== current.type) return;
        if (Object.entries(attrs).every(([key, value]) => node.attrs[key] === value)) return;
        const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
        view.dispatch(separateHistory ? closeHistory(tr) : tr);
        if (separateHistory) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
      };
      const paint = () => {
        if (destroyed) return;
        const provider = isEmbedProvider(current.attrs.provider) ? current.attrs.provider : null;
        dom.dataset.provider = provider ?? "";
        const definition = provider ? embedProviders[provider] : null;
        const target = resolveEmbed(provider, current.attrs.url);
        const draft = stringValue(current.attrs.draft);
        const untrustedURL = target ? "" : stringValue(current.attrs.url);
        if (input.value !== (draft || untrustedURL)) input.value = draft || untrustedURL;
        input.placeholder = definition?.placeholder ?? "链接暂不支持";
        input.setAttribute("aria-label", (definition?.label ?? "嵌入") + "链接");
        input.readOnly = !editor.isEditable;
        example.hidden = provider === "taobao" || provider === "jinshuju";
        example.disabled = !editor.isEditable || !definition;
        submit.disabled = !editor.isEditable || !definition;
        form.hidden = !!target;
        error.hidden = !invalid && !(untrustedURL && !draft);
        preview.hidden = !target;
        toolbar.hidden = !target || !selected || !editor.isEditable;
        select.hidden = !target || selected || !editor.isEditable;
        convert.disabled = !editor.isEditable || !view.state.schema.marks.link;
        title.disabled = !editor.isEditable || !canConvertEmbedToBookmark(editor, "inline");
        card.disabled = !editor.isEditable || !canConvertEmbedToBookmark(editor, "block");
        if (!target) {
          removePlayer();
          open.removeAttribute("href");
          return;
        }
        open.href = target.url;
        if (playerURL !== target.embedUrl || (provider === "taobao") !== (player?.tagName === "VIDEO")) {
          removePlayer();
          if (provider === "taobao") {
            const video = doc.createElement("video");
            video.controls = true;
            video.preload = "metadata";
            video.playsInline = true;
            video.setAttribute("aria-label", "淘宝视频");
            player = video;
          } else {
            const iframe = doc.createElement("iframe");
            iframe.title = (definition?.label ?? "第三方") + "嵌入内容";
            const sameOrigin = doc.location?.origin === new URL(target.embedUrl).origin;
            iframe.setAttribute(
              "sandbox",
              "allow-scripts allow-forms allow-popups" +
                (sameOrigin ? "" : " allow-same-origin") +
                (provider === "figma" && !sameOrigin ? " allow-storage-access-by-user-activation" : ""),
            );
            iframe.setAttribute("allow", "fullscreen; picture-in-picture");
            iframe.setAttribute("allowfullscreen", "");
            iframe.referrerPolicy = "strict-origin-when-cross-origin";
            player = iframe;
          }
          player.className = "semlo-editor-embed-frame";
          player.src = target.embedUrl;
          playerURL = target.embedUrl;
          preview.prepend(player);
        }
      };

      input.addEventListener("compositionstart", () => {
        composingInput = true;
      });
      input.addEventListener("compositionend", () => {
        composingInput = false;
      });
      input.addEventListener("blur", () => {
        composingInput = false;
      });
      input.addEventListener("input", () => {
        if (!editor.isEditable) return;
        invalid = false;
        updateAttrs({ draft: stringValue(input.value), url: "" });
        paint();
      });
      input.addEventListener("focus", () => {
        if (!destroyed && editor.isEditable) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
      });
      input.addEventListener("keydown", (event) => {
        if (composingInput || event.isComposing || event.keyCode === 229) return;
        if ((event.metaKey || event.ctrlKey) && ["z", "y"].includes(event.key.toLowerCase())) {
          event.preventDefault();
          if (event.key.toLowerCase() === "y" || event.shiftKey) editor.commands.redo();
          else editor.commands.undo();
        }
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!editor.isEditable || composingInput) return;
        const target = resolveEmbed(current.attrs.provider, input.value);
        if (!target) {
          invalid = true;
          paint();
          input.focus();
          return;
        }
        invalid = false;
        updateAttrs({ url: target.url, draft: "" }, true);
      });
      example.addEventListener("click", () => {
        if (!editor.isEditable || !isEmbedProvider(current.attrs.provider)) return;
        const target = resolveEmbed(current.attrs.provider, embedProviders[current.attrs.provider].example);
        if (!target) return;
        invalid = false;
        updateAttrs({ url: target.url, draft: "" }, true);
      });
      select.addEventListener("mousedown", (event) => event.preventDefault());
      select.addEventListener("click", () => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (typeof pos !== "number" || view.state.doc.nodeAt(pos)?.type !== current.type) return;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        view.focus();
      });
      convert.addEventListener("mousedown", (event) => event.preventDefault());
      for (const button of [title, card]) button.addEventListener("mousedown", (event) => event.preventDefault());
      title.addEventListener("click", () => {
        const pos = getPos();
        if (typeof pos === "number") convertEmbedToBookmark(editor, pos, "inline");
      });
      card.addEventListener("click", () => {
        const pos = getPos();
        if (typeof pos === "number") convertEmbedToBookmark(editor, pos, "block");
      });
      convert.addEventListener("click", () => {
        if (!editor.isEditable) return;
        const pos = getPos();
        const target = resolveEmbed(current.attrs.provider, current.attrs.url);
        const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        const { paragraph } = view.state.schema.nodes;
        const { link } = view.state.schema.marks;
        if (typeof pos !== "number" || !node || node.type !== current.type || !target || !paragraph || !link) return;
        const linkURL = ["youku", "codepen"].includes(current.attrs.provider) ? target.embedUrl : target.url;
        const text = view.state.schema.text(linkURL, [link.create({ href: linkURL })]);
        view.dispatch(closeHistory(view.state.tr.replaceWith(pos, pos + node.nodeSize, paragraph.create(null, text))));
        view.focus();
      });
      const editableChanged = () => {
        if (!editor.isEditable) composingInput = false;
        paint();
      };
      const documentReplaced = () => {
        composingInput = false;
      };
      view.dom.addEventListener("semlo-editor:document-replace", documentReplaced);
      view.dom.addEventListener("semlo-editor:editable", editableChanged);
      view.dom.addEventListener("semlo-editor:embed-metadata", editableChanged);
      paint();
      return {
        dom,
        update(node) {
          if (node.type !== current.type) return false;
          current = node;
          invalid = false;
          paint();
          return true;
        },
        selectNode() {
          selected = true;
          dom.classList.add("is-selected");
          paint();
        },
        deselectNode() {
          selected = false;
          dom.classList.remove("is-selected");
          paint();
        },
        stopEvent(event) {
          return (
            form.contains(event.target as globalThis.Node) ||
            toolbar.contains(event.target as globalThis.Node) ||
            select.contains(event.target as globalThis.Node) ||
            !!player?.contains(event.target as globalThis.Node)
          );
        },
        ignoreMutation: () => true,
        destroy() {
          destroyed = true;
          view.dom.removeEventListener("semlo-editor:document-replace", documentReplaced);
          view.dom.removeEventListener("semlo-editor:editable", editableChanged);
          view.dom.removeEventListener("semlo-editor:embed-metadata", editableChanged);
          removePlayer();
        },
      };
    };
  },
});
