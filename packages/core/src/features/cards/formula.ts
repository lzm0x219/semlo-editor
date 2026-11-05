import { Node } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import katex from "katex";

import { appendedReplacesSameNode, replacesSameNode } from "../../runtime/same-node-replacement";

function latexFromHTML(element: HTMLElement): unknown {
  const raw = element.getAttribute("data-latex-json");
  if (raw !== null) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return { invalidLatexJSON: raw };
    }
  }
  return element.getAttribute("data-latex") ?? "";
}

function latexHTMLAttrs(value: unknown): Record<string, string> {
  if (typeof value === "string") return { "data-latex": value };
  return { "data-latex-json": JSON.stringify(value) ?? "null" };
}

export const Formula = Node.create({
  name: "semloEditorFormula",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: { default: "", rendered: false, parseHTML: latexFromHTML },
      id: { default: "", rendered: false, parseHTML: (el) => el.getAttribute("data-formula-id") ?? "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-semlo-editor-formula]",
        getAttrs: (element: HTMLElement) => (latexFromHTML(element) === null ? { latex: null } : {}),
      },
    ];
  },
  renderText({ node }) {
    return typeof node.attrs.latex !== "string"
      ? "[公式数据格式无法识别]"
      : node.attrs.latex
        ? `$${node.attrs.latex}$`
        : "";
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-semlo-editor-formula": "",
        ...latexHTMLAttrs(node.attrs.latex),
        "data-formula-id": node.attrs.id,
        class: "semlo-editor-formula",
      },
      typeof node.attrs.latex !== "string"
        ? "公式数据格式无法识别"
        : node.attrs.latex
          ? `$${node.attrs.latex}$`
          : "添加 TeX 公式",
    ];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const block = initial.type.name === "semloEditorBlockFormula";
      const dom = doc.createElement(block ? "div" : "span");
      dom.className = block ? "semlo-editor-block-formula-node" : "semlo-editor-formula-node";
      dom.contentEditable = "false";
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "semlo-editor-formula";
      dom.append(button);
      let current = initial;
      let closePopup: (() => void) | undefined;
      const render = (target: HTMLElement, latex: unknown) => {
        if (typeof latex !== "string") {
          target.classList.remove("is-placeholder");
          target.classList.add("is-invalid");
          target.textContent = "公式数据格式无法识别";
          return;
        }
        if (!latex.trim()) {
          target.textContent = "添加 TeX 公式";
          target.classList.add("is-placeholder");
          return;
        }
        target.classList.remove("is-placeholder");
        try {
          target.innerHTML = katex.renderToString(latex, {
            throwOnError: true,
            trust: false,
            strict: "ignore",
            displayMode: block,
          });
        } catch {
          target.textContent = latex;
          target.classList.add("is-invalid");
        }
      };
      const paint = () => {
        dom.dataset.formulaId = current.attrs.id;
        button.classList.remove("is-invalid");
        render(button, current.attrs.latex);
        const valid = typeof current.attrs.latex === "string";
        button.setAttribute(
          "aria-label",
          valid ? `公式：${current.attrs.latex || "添加 TeX 公式"}` : "公式数据格式无法识别",
        );
        button.disabled = !editor.isEditable || !valid;
      };
      const open = () => {
        if (!editor.isEditable || typeof current.attrs.latex !== "string") return;
        if (closePopup) {
          closePopup();
          return;
        }
        const panel = doc.createElement("div");
        panel.className = "semlo-editor-formula-editor";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "编辑公式");
        panel.tabIndex = -1;
        const input = doc.createElement("textarea");
        input.value = current.attrs.latex;
        input.setAttribute("aria-label", "TeX 公式");
        input.placeholder = "输入 TeX 公式";
        const preview = doc.createElement("div");
        preview.className = "semlo-editor-formula-preview";
        preview.setAttribute("aria-label", "公式预览");
        preview.addEventListener("click", () => {
          if (!panel.contains(doc.activeElement)) panel.focus({ preventScroll: true });
        });
        const footer = doc.createElement("div");
        footer.className = "semlo-editor-formula-footer";
        const save = doc.createElement("button");
        save.type = "button";
        save.className = "semlo-editor-formula-confirm";
        save.setAttribute("aria-label", "确定");
        save.setAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
        save.append(doc.createTextNode("确定"));
        const shortcut = doc.createElement("span");
        shortcut.setAttribute("aria-hidden", "true");
        const isApple = /Mac|iPhone|iPad|iPod/.test(doc.defaultView?.navigator.platform ?? "");
        shortcut.textContent = ` (${isApple ? "Cmd" : "Ctrl"} + Enter)`;
        save.append(shortcut);
        footer.append(save);
        panel.append(input, preview, footer);
        doc.body.append(panel);
        const win = doc.defaultView;
        const position = () => {
          const rect = dom.getBoundingClientRect();
          const viewportWidth = win?.innerWidth ?? 1000;
          const viewportHeight = win?.innerHeight ?? 800;
          const width = Math.max(0, Math.min(752, viewportWidth - 16));
          panel.style.width = `${width}px`;
          panel.style.maxHeight = `${Math.max(0, viewportHeight - 16)}px`;
          panel.style.overflowY = "auto";
          panel.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`;
          panel.style.top = `${Math.max(8, Math.min(rect.bottom + 8, viewportHeight - panel.offsetHeight - 8))}px`;
        };
        position();
        const paintPreview = () => {
          preview.classList.remove("is-invalid");
          render(preview, input.value);
          if (preview.classList.contains("is-invalid")) preview.textContent = "公式语法有误";
          button.classList.remove("is-invalid");
          render(button, input.value);
          button.setAttribute("aria-label", `公式：${input.value || "添加 TeX 公式"}`);
          position();
        };
        paintPreview();
        input.addEventListener("input", paintPreview);
        const outside = (event: Event) => {
          if (!panel.contains(event.target as globalThis.Node) && !dom.contains(event.target as globalThis.Node))
            commit(false);
        };
        const key = (event: KeyboardEvent) => {
          if (event.isComposing || event.keyCode === 229 || !panel.contains(event.target as globalThis.Node)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            commit();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
          }
        };
        const close = () => {
          if (!closePopup) return;
          closePopup = undefined;
          panel.remove();
          paint();
          doc.removeEventListener("pointerdown", outside, true);
          doc.removeEventListener("keydown", key, true);
          doc.removeEventListener("scroll", position, true);
          win?.removeEventListener("resize", position);
        };
        const commit = (restoreFocus = true) => {
          if (!editor.isEditable || editor.isDestroyed) {
            close();
            return;
          }
          const pos = getPos();
          const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
          if (node && node.type === current.type && typeof pos === "number" && node.attrs.latex !== input.value)
            view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: input.value }));
          close();
          if (restoreFocus && !editor.isDestroyed) editor.commands.focus();
        };
        save.addEventListener("click", () => commit());
        closePopup = close;
        doc.addEventListener("pointerdown", outside, true);
        doc.addEventListener("keydown", key, true);
        doc.addEventListener("scroll", position, true);
        win?.addEventListener("resize", position);
        input.focus();
      };
      button.addEventListener("click", open);
      dom.addEventListener("semlo-editor:open-formula", open);
      const editableChanged = () => {
        closePopup?.();
        paint();
      };
      const replacedSameNodes = new WeakSet<Transaction>();
      const beforeTransaction = ({ transaction }: { transaction: Transaction }) => {
        const pos = getPos();
        if (
          typeof pos === "number" &&
          view.state.doc.nodeAt(pos) === current &&
          replacesSameNode(transaction, pos, current)
        )
          replacedSameNodes.add(transaction);
      };
      const transaction = ({
        transaction,
        appendedTransactions = [],
      }: {
        transaction: Transaction;
        appendedTransactions?: Transaction[];
      }) => {
        if (editor.isDestroyed) return;
        const position = getPos();
        if (
          replacedSameNodes.has(transaction) ||
          (typeof position === "number" && appendedReplacesSameNode(appendedTransactions, position, current))
        )
          closePopup?.();
        const pos = getPos();
        const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (node && node.type === current.type && node !== current) {
          // Equal replacements can reuse this view without calling update().
          closePopup?.();
          current = node;
          paint();
        }
      };
      view.dom.addEventListener("semlo-editor:editable", editableChanged);
      editor.on("beforeTransaction", beforeTransaction);
      editor.on("transaction", transaction);
      paint();
      return {
        dom,
        update(node) {
          if (node.type !== current.type) return false;
          if (node !== current) {
            closePopup?.();
            current = node;
            paint();
          } else if (!closePopup) {
            paint();
          }
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy() {
          closePopup?.();
          editor.off("beforeTransaction", beforeTransaction);
          editor.off("transaction", transaction);
          view.dom.removeEventListener("semlo-editor:editable", editableChanged);
        },
      };
    };
  },
});

export const BlockFormula = Formula.extend({
  name: "semloEditorBlockFormula",
  group: "block",
  inline: false,
  parseHTML() {
    return [
      {
        tag: "div[data-semlo-editor-block-formula]",
        getAttrs: (element: HTMLElement) => (latexFromHTML(element) === null ? { latex: null } : {}),
      },
    ];
  },
  renderText({ node }) {
    return typeof node.attrs.latex !== "string"
      ? "[公式数据格式无法识别]"
      : node.attrs.latex
        ? `$$${node.attrs.latex}$$`
        : "";
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        "data-semlo-editor-block-formula": "",
        ...latexHTMLAttrs(node.attrs.latex),
        "data-formula-id": node.attrs.id,
        class: "semlo-editor-block-formula",
      },
      typeof node.attrs.latex !== "string"
        ? "公式数据格式无法识别"
        : node.attrs.latex
          ? `$$${node.attrs.latex}$$`
          : "添加 TeX 公式",
    ];
  },
});
