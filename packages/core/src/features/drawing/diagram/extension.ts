import { Node, type Editor, type Range } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { renderDiagram } from "./render";
import { diagramHeight, diagramLanguage, diagramLanguages, diagramTemplates } from "./templates";

function highlightSource(element: HTMLElement, source: string, language: string) {
  const doc = element.ownerDocument;
  element.replaceChildren();
  if (language !== "plantuml") {
    element.textContent = source;
    return;
  }
  const tokens =
    /@(?:start|end)\w+|\b(?:actor|participant|activate|deactivate|autonumber|note|class|object|state|start|stop|if|then|else|endif|as|is)\b|"[^"\n]*"/g;
  let position = 0;
  for (const match of source.matchAll(tokens)) {
    const index = match.index;
    element.append(doc.createTextNode(source.slice(position, index)));
    const span = doc.createElement("span");
    span.className = match[0].startsWith('"')
      ? "semlo-editor-diagram-token-string"
      : "semlo-editor-diagram-token-keyword";
    span.textContent = match[0];
    element.append(span);
    position = index + match[0].length;
  }
  element.append(doc.createTextNode(source.slice(position)));
}

/** Insert one diagram and focus its editor after the surrounding menu has closed. */
export function insertDiagram(editor: Editor, range?: Range): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const probe = editor.can().chain().focus();
  if (range) probe.deleteRange(range);
  if (!probe.insertContent({ type: "semloEditorDiagram" }).run()) return false;

  const previous = new Set<ProseMirrorNode>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "semloEditorDiagram") previous.add(node);
  });
  const chain = editor.chain().focus();
  if (range) chain.deleteRange(range);
  if (!chain.insertContent({ type: "semloEditorDiagram" }).run()) return false;
  let inserted: ProseMirrorNode | undefined;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "semloEditorDiagram" && !previous.has(node)) inserted = node;
  });
  if (!inserted) return true;

  const doc = editor.view.dom.ownerDocument;
  const focusInserted = () => {
    if (editor.isDestroyed || !editor.isEditable) return;
    const active = doc.activeElement;
    if (active && active !== doc.body && !editor.view.dom.contains(active)) return;
    let position: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node === inserted) position = pos;
    });
    if (position === undefined) return;
    const dom = editor.view.nodeDOM(position);
    if (dom?.nodeType === 1)
      (dom as Element).querySelector<HTMLTextAreaElement>(".semlo-editor-diagram-input")?.focus();
  };
  if (doc.defaultView) doc.defaultView.requestAnimationFrame(focusInserted);
  else queueMicrotask(focusInserted);
  return true;
}

/** Text diagrams remain editable data; rendering is performed only in the node view. */
export const Diagram = Node.create({
  name: "semloEditorDiagram",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      source: {
        default: "",
        rendered: false,
        parseHTML: (element) => element.querySelector("pre code")?.textContent ?? "",
      },
      language: {
        default: "plantuml",
        rendered: false,
        parseHTML: (element) => diagramLanguage(element.getAttribute("data-language")),
      },
      height: {
        default: 300,
        rendered: false,
        parseHTML: (element) => diagramHeight(element.getAttribute("data-height")),
      },
      preview: {
        default: true,
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-preview") !== "false",
      },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-semlo-editor-diagram]", priority: 100 }];
  },
  renderText() {
    return "";
  },
  renderHTML({ node }) {
    return [
      "figure",
      {
        "data-semlo-editor-diagram": "",
        "data-language": diagramLanguage(node.attrs.language),
        "data-height": diagramHeight(node.attrs.height),
        "data-preview": String(node.attrs.preview !== false),
        class: "semlo-editor-diagram-export",
      },
      ["pre", ["code", String(node.attrs.source ?? "")]],
    ];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const win = doc.defaultView;
      const dom = doc.createElement("div");
      dom.className = "semlo-editor-diagram";
      dom.dataset.type = "semloEditorDiagram";
      dom.contentEditable = "false";

      const returnBar = doc.createElement("div");
      returnBar.className = "semlo-editor-diagram-return-bar";
      const returnButton = doc.createElement("button");
      returnButton.type = "button";
      returnButton.className = "semlo-editor-diagram-return";
      returnButton.textContent = "‹ 返回文档";
      returnButton.setAttribute("aria-label", "返回文档");
      returnBar.append(returnButton);
      const header = doc.createElement("div");
      header.className = "semlo-editor-diagram-header";
      const title = doc.createElement("span");
      title.className = "semlo-editor-diagram-title";
      title.textContent = "文本绘图";
      const actions = doc.createElement("div");
      actions.className = "semlo-editor-diagram-actions";
      const language = doc.createElement("button");
      language.type = "button";
      language.className = "semlo-editor-diagram-language";
      language.setAttribute("aria-label", "绘图语言");
      language.setAttribute("aria-haspopup", "menu");
      const template = doc.createElement("button");
      template.type = "button";
      template.className = "semlo-editor-diagram-template";
      template.textContent = "模板";
      template.setAttribute("aria-haspopup", "menu");
      const togglePreview = doc.createElement("button");
      togglePreview.type = "button";
      togglePreview.className = "semlo-editor-diagram-toggle-preview";
      togglePreview.textContent = "预览";
      togglePreview.title = "预览 ⌘/Ctrl P";
      const fullscreen = doc.createElement("button");
      fullscreen.type = "button";
      fullscreen.className = "semlo-editor-diagram-fullscreen";
      fullscreen.textContent = "⛶";
      fullscreen.setAttribute("aria-label", "最大化文本绘图");
      actions.append(language, template, togglePreview, fullscreen);
      header.append(title, actions);

      const body = doc.createElement("div");
      body.className = "semlo-editor-diagram-body";
      const editorPane = doc.createElement("div");
      editorPane.className = "semlo-editor-diagram-editor";
      const numbers = doc.createElement("pre");
      numbers.className = "semlo-editor-diagram-lines";
      numbers.setAttribute("aria-hidden", "true");
      const highlight = doc.createElement("pre");
      highlight.className = "semlo-editor-diagram-highlight";
      highlight.setAttribute("aria-hidden", "true");
      const highlightedCode = doc.createElement("code");
      highlight.append(highlightedCode);
      const input = doc.createElement("textarea");
      input.className = "semlo-editor-diagram-input";
      input.setAttribute("aria-label", "绘图代码");
      input.setAttribute("spellcheck", "false");
      input.wrap = "off";
      editorPane.append(numbers, highlight, input);
      const result = doc.createElement("div");
      result.className = "semlo-editor-diagram-preview";
      result.setAttribute("aria-label", "绘图预览");
      result.setAttribute("role", "region");
      const resultContent = doc.createElement("div");
      resultContent.className = "semlo-editor-diagram-preview-content";
      const error = doc.createElement("div");
      error.className = "semlo-editor-diagram-error";
      error.setAttribute("role", "status");
      error.hidden = true;
      result.append(resultContent, error);
      body.append(editorPane, result);
      const resize = doc.createElement("div");
      resize.className = "semlo-editor-diagram-resize";
      resize.tabIndex = 0;
      resize.setAttribute("role", "separator");
      resize.setAttribute("aria-label", "调整文本绘图高度");
      resize.setAttribute("aria-orientation", "horizontal");
      resize.setAttribute("aria-valuemin", "160");
      resize.setAttribute("aria-valuemax", "1000");
      dom.append(returnBar, header, body, resize);

      let current = initial;
      let destroyed = false;
      let inFullscreen = false;
      let menu: HTMLElement | null = null;
      let menuKind: "language" | "template" | null = null;
      let frame: number | undefined;
      let renderVersion = 0;
      let renderKey = "";
      let resizeStart: { y: number; height: number; pointer: number } | null = null;

      const updateAttrs = (attrs: Record<string, unknown>, separateHistory = false) => {
        if (destroyed || !editor.isEditable) return;
        const position = getPos();
        if (typeof position !== "number") return;
        const found = view.state.doc.nodeAt(position);
        if (!found || found.type !== current.type) return;
        if (Object.entries(attrs).every(([name, value]) => found.attrs[name] === value)) return;
        const transaction = view.state.tr.setNodeMarkup(position, undefined, { ...found.attrs, ...attrs });
        view.dispatch(separateHistory ? closeHistory(transaction) : transaction);
        if (separateHistory) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
      };

      const closeMenu = () => {
        menu?.remove();
        menu = null;
        menuKind = null;
        language.setAttribute("aria-expanded", "false");
        template.setAttribute("aria-expanded", "false");
      };
      const openMenu = (kind: "language" | "template") => {
        if (!editor.isEditable) return;
        if (menuKind === kind) {
          closeMenu();
          return;
        }
        closeMenu();
        menuKind = kind;
        const panel = doc.createElement("div");
        panel.className = "semlo-editor-diagram-menu";
        panel.setAttribute("role", "menu");
        panel.setAttribute("aria-label", kind === "language" ? "绘图语言" : "绘图模板");
        const trigger = kind === "language" ? language : template;
        trigger.setAttribute("aria-expanded", "true");
        const items =
          kind === "language"
            ? diagramLanguages.map(([value, label]) => ({ value, label }))
            : diagramTemplates[diagramLanguage(current.attrs.language)].map(([label, value]) => ({ value, label }));
        for (const { value, label } of items) {
          const item = doc.createElement("button");
          item.type = "button";
          item.setAttribute("role", "menuitem");
          item.textContent = label;
          if (kind === "language" && value === diagramLanguage(current.attrs.language))
            item.setAttribute("aria-current", "true");
          item.addEventListener("click", () => {
            if (kind === "language") updateAttrs({ language: diagramLanguage(value) }, true);
            else updateAttrs({ source: value }, true);
            closeMenu();
            input.focus();
          });
          panel.append(item);
        }
        panel.addEventListener("keydown", (event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End", "Escape"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            closeMenu();
            trigger.focus();
            return;
          }
          const buttons = Array.from(panel.querySelectorAll("button"));
          const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : event.key === "ArrowDown"
                  ? (index + 1) % buttons.length
                  : (index - 1 + buttons.length) % buttons.length;
          buttons[next]?.focus();
        });
        menu = panel;
        actions.append(panel);
        const triggerRect = trigger.getBoundingClientRect();
        const actionsRect = actions.getBoundingClientRect();
        panel.style.right = `${Math.max(0, actionsRect.right - triggerRect.right)}px`;
      };

      const scheduleRender = () => {
        const source = String(current.attrs.source ?? "");
        const selected = diagramLanguage(current.attrs.language);
        const nextKey = `${selected}\0${source}\0${current.attrs.preview !== false}`;
        if (nextKey === renderKey) return;
        renderKey = nextKey;
        const version = ++renderVersion;
        if (frame !== undefined && win) win.clearTimeout(frame);
        frame = undefined;
        resultContent.replaceChildren();
        error.hidden = true;
        if (!source.trim() || current.attrs.preview === false) return;
        const run = async () => {
          frame = undefined;
          try {
            const svg = await renderDiagram(selected, source, doc);
            if (destroyed || version !== renderVersion) return;
            resultContent.innerHTML = svg;
            error.hidden = true;
          } catch (reason) {
            if (destroyed || version !== renderVersion) return;
            resultContent.replaceChildren();
            error.textContent = reason instanceof Error ? reason.message : "绘图渲染失败";
            error.hidden = false;
          }
        };
        if (win) frame = win.setTimeout(() => void run(), 180);
        else void run();
      };
      const paint = () => {
        if (destroyed) return;
        const source = String(current.attrs.source ?? "");
        if (input.value !== source) input.value = source;
        numbers.textContent = Array.from(
          { length: Math.max(1, source.split("\n").length) },
          (_, index) => index + 1,
        ).join("\n");
        const value = diagramLanguage(current.attrs.language);
        highlightSource(highlightedCode, source, value);
        language.textContent = diagramLanguages.find(([name]) => name === value)?.[1] ?? "PlantUML";
        language.disabled = !editor.isEditable;
        template.disabled = !editor.isEditable;
        togglePreview.disabled = !editor.isEditable;
        input.readOnly = !editor.isEditable;
        resize.tabIndex = editor.isEditable && !inFullscreen ? 0 : -1;
        resize.setAttribute("aria-disabled", String(!editor.isEditable || inFullscreen));
        resize.setAttribute("aria-valuenow", String(diagramHeight(current.attrs.height)));
        const showPreview = current.attrs.preview !== false;
        result.hidden = !showPreview;
        togglePreview.setAttribute("aria-pressed", String(showPreview));
        dom.classList.toggle("semlo-editor-diagram-preview-hidden", !showPreview);
        if (!resizeStart) body.style.height = `${diagramHeight(current.attrs.height)}px`;
        scheduleRender();
      };

      const stopResizing = (commit: boolean) => {
        if (!resizeStart) return;
        const height = diagramHeight(body.getBoundingClientRect().height);
        resizeStart = null;
        doc.removeEventListener("pointermove", resizeMove, true);
        doc.removeEventListener("pointerup", resizeEnd, true);
        doc.removeEventListener("pointercancel", resizeCancel, true);
        if (commit) updateAttrs({ height }, true);
        else paint();
      };
      const resizeMove = (event: PointerEvent) => {
        if (!resizeStart || event.pointerId !== resizeStart.pointer) return;
        body.style.height = `${diagramHeight(resizeStart.height + event.clientY - resizeStart.y)}px`;
      };
      const resizeEnd = (event: PointerEvent) => {
        if (event.pointerId === resizeStart?.pointer) stopResizing(true);
      };
      const resizeCancel = (event: PointerEvent) => {
        if (event.pointerId === resizeStart?.pointer) stopResizing(false);
      };
      resize.addEventListener("pointerdown", (event) => {
        if (!editor.isEditable || inFullscreen || event.button !== 0) return;
        event.preventDefault();
        resizeStart = { y: event.clientY, height: diagramHeight(current.attrs.height), pointer: event.pointerId };
        doc.addEventListener("pointermove", resizeMove, true);
        doc.addEventListener("pointerup", resizeEnd, true);
        doc.addEventListener("pointercancel", resizeCancel, true);
      });
      resize.addEventListener("keydown", (event) => {
        if (!editor.isEditable || inFullscreen || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        updateAttrs(
          { height: diagramHeight(diagramHeight(current.attrs.height) + (event.key === "ArrowUp" ? -10 : 10)) },
          true,
        );
      });

      language.addEventListener("click", () => openMenu("language"));
      template.addEventListener("click", () => openMenu("template"));
      togglePreview.addEventListener("click", () => {
        if (editor.isEditable) updateAttrs({ preview: current.attrs.preview === false }, true);
      });
      const setFullscreen = (value: boolean) => {
        if (resizeStart) stopResizing(false);
        inFullscreen = value;
        dom.classList.toggle("semlo-editor-diagram-fullscreen-active", value);
        fullscreen.setAttribute("aria-label", value ? "退出最大化文本绘图" : "最大化文本绘图");
        paint();
      };
      fullscreen.addEventListener("click", () => setFullscreen(!inFullscreen));
      returnButton.addEventListener("click", () => setFullscreen(false));
      input.addEventListener("scroll", () => {
        numbers.scrollTop = input.scrollTop;
        highlight.scrollTop = input.scrollTop;
        highlight.scrollLeft = input.scrollLeft;
      });
      input.addEventListener("focus", () => {
        if (!destroyed && editor.isEditable) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
      });
      input.addEventListener("input", () => updateAttrs({ source: input.value }));
      input.addEventListener("keydown", (event) => {
        const command = event.metaKey || event.ctrlKey;
        const key = event.key.toLowerCase();
        if (command && key === "p") {
          event.preventDefault();
          if (editor.isEditable) updateAttrs({ preview: current.attrs.preview === false }, true);
        } else if (command && (key === "z" || key === "y")) {
          event.preventDefault();
          if (key === "y" || event.shiftKey) editor.commands.redo();
          else editor.commands.undo();
        } else if (event.key === "Tab" && editor.isEditable && !event.shiftKey) {
          event.preventDefault();
          input.setRangeText("  ", input.selectionStart, input.selectionEnd, "end");
          updateAttrs({ source: input.value });
        }
      });
      const outside = (event: Event) => {
        if (menu && !actions.contains(event.target as globalThis.Node)) closeMenu();
      };
      const keydown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        if (menu) {
          event.preventDefault();
          closeMenu();
        } else if (inFullscreen) {
          event.preventDefault();
          setFullscreen(false);
        }
      };
      const editableChanged = () => {
        if (!editor.isEditable) {
          closeMenu();
          stopResizing(false);
        }
        paint();
      };
      doc.addEventListener("pointerdown", outside, true);
      doc.addEventListener("keydown", keydown, true);
      view.dom.addEventListener("semlo-editor:editable", editableChanged);
      paint();
      return {
        dom,
        update(node) {
          if (node.type !== current.type) return false;
          current = node;
          paint();
          return true;
        },
        selectNode() {
          dom.classList.add("is-selected");
        },
        deselectNode() {
          dom.classList.remove("is-selected");
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy() {
          destroyed = true;
          renderVersion++;
          if (frame !== undefined && win) win.clearTimeout(frame);
          closeMenu();
          stopResizing(false);
          doc.removeEventListener("pointerdown", outside, true);
          doc.removeEventListener("keydown", keydown, true);
          view.dom.removeEventListener("semlo-editor:editable", editableChanged);
        },
      };
    };
  },
});
