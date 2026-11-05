import { Node, type Editor, type Range } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import { appendedReplacesSameNode, replacesSameNode } from "../../runtime/same-node-replacement";

const statusColors = ["#f8ced3", "#f6e1ac", "#dbf1b7", "#eff0f0", "#c0ddfc", "#c0cafc"] as const;
const statusForeground = ["#70000d", "#664900", "#2a4200", "#262626", "#00346b", "#101e60"] as const;
const statusBorders = ["#f1a2ab", "#f5d480", "#c1e77e", "#eff0f0", "#81bbf8", "#96a7fd"] as const;
const safeColor = (value: unknown) =>
  Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) < statusColors.length ? Number(value) : 0;

/** Insert a status and open only that new status for editing. */
export function insertStatus(editor: Editor, range?: Range): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const probe = editor.can().chain().focus();
  if (range) probe.deleteRange(range);
  if (!probe.insertContent({ type: "semloEditorStatus" }).run()) return false;

  const previous = new Set<ProseMirrorNode>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "semloEditorStatus") previous.add(node);
  });
  const chain = editor.chain().focus();
  if (range) chain.deleteRange(range);
  if (!chain.insertContent({ type: "semloEditorStatus" }).run()) return false;
  let inserted: ProseMirrorNode | undefined;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "semloEditorStatus" && !previous.has(node)) inserted = node;
  });
  if (!inserted) return true;

  const doc = editor.view.dom.ownerDocument;
  const openInserted = () => {
    if (editor.isDestroyed || !editor.isEditable) return;
    const active = doc.activeElement;
    if (active && active !== doc.body && !editor.view.dom.contains(active)) return;
    let position: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node === inserted) position = pos;
    });
    if (position === undefined) return;
    const dom = editor.view.nodeDOM(position);
    if (dom?.nodeType === 1) (dom as Element).querySelector<HTMLButtonElement>(".semlo-editor-status")?.click();
  };
  if (doc.defaultView) doc.defaultView.requestAnimationFrame(openInserted);
  else queueMicrotask(openInserted);
  return true;
}

export const Status = Node.create({
  name: "semloEditorStatus",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      label: { default: "", rendered: false, parseHTML: (el) => el.getAttribute("data-label") ?? "" },
      color: { default: 0, rendered: false, parseHTML: (el) => safeColor(el.getAttribute("data-color")) },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-semlo-editor-status]" }];
  },
  renderText({ node }) {
    return node.attrs.label || "";
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-semlo-editor-status": "",
        "data-label": node.attrs.label,
        "data-color": safeColor(node.attrs.color),
        class: "semlo-editor-status",
      },
      node.attrs.label || "设置状态",
    ];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("span");
      dom.className = "semlo-editor-status-node";
      dom.contentEditable = "false";
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "semlo-editor-status";
      dom.append(button);
      let current = initial;
      let closePopup: (() => void) | undefined;
      let refreshPopup: (() => void) | undefined;
      let updatingFromPopup = false;
      let popupTransaction: Transaction | undefined;
      const paint = () => {
        const color = safeColor(current.attrs.color);
        button.textContent = current.attrs.label || "设置状态";
        button.style.backgroundColor = statusColors[color];
        button.style.color = statusForeground[color];
        button.setAttribute("aria-label", `状态：${current.attrs.label || "设置状态"}`);
        button.disabled = !editor.isEditable;
      };
      const updateAttrs = (attrs: Record<string, unknown>) => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const node = view.state.doc.nodeAt(pos);
        if (!node || node.type !== current.type) return;
        if (Object.entries(attrs).every(([key, value]) => node.attrs[key] === value)) return;
        updatingFromPopup = true;
        const transaction = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
        popupTransaction = transaction;
        try {
          view.dispatch(transaction);
        } finally {
          popupTransaction = undefined;
          updatingFromPopup = false;
          refreshPopup?.();
        }
      };
      const open = () => {
        if (!editor.isEditable) return;
        if (closePopup) {
          closePopup();
          return;
        }
        const panel = doc.createElement("div");
        panel.className = "semlo-editor-status-editor";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "编辑状态");
        panel.tabIndex = -1;
        panel.addEventListener("click", () => {
          if (panel.isConnected && !panel.contains(doc.activeElement)) panel.focus({ preventScroll: true });
        });
        let composing = false;
        const input = doc.createElement("input");
        input.type = "text";
        input.value = current.attrs.label;
        input.setAttribute("aria-label", "状态文字");
        const colors = doc.createElement("div");
        colors.className = "semlo-editor-status-colors";
        for (let index = 0; index < statusColors.length; index++) {
          const swatch = doc.createElement("button");
          swatch.type = "button";
          swatch.style.background = statusColors[index];
          swatch.style.borderColor = statusBorders[index];
          swatch.setAttribute("aria-label", ["红色", "黄色", "绿色", "灰色", "蓝色", "紫色"][index]);
          swatch.setAttribute("aria-pressed", String(safeColor(current.attrs.color) === index));
          swatch.addEventListener("click", () => {
            updateAttrs({ color: index });
            input.focus();
          });
          colors.append(swatch);
        }
        panel.append(input, colors);
        doc.body.append(panel);
        const win = doc.defaultView;
        let frame: number | undefined;
        const position = () => {
          if (!win) return;
          const rect = button.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > win.innerHeight || rect.right < 0 || rect.left > win.innerWidth) {
            close();
            return;
          }
          const width = panel.offsetWidth;
          const height = panel.offsetHeight;
          const below = rect.bottom + 8;
          const above = rect.top - height - 8;
          const top = below + height <= win.innerHeight - 8 ? below : above >= 8 ? above : below;
          panel.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - width - 8))}px`;
          panel.style.top = `${Math.max(8, Math.min(top, win.innerHeight - height - 8))}px`;
        };
        const schedulePosition = () => {
          if (!win) return;
          if (frame !== undefined) win.cancelAnimationFrame(frame);
          frame = win.requestAnimationFrame(() => {
            frame = undefined;
            position();
          });
        };
        input.addEventListener("compositionstart", () => {
          composing = true;
        });
        input.addEventListener("compositionend", () => {
          composing = false;
          refreshPopup?.();
        });
        input.addEventListener("input", () => updateAttrs({ label: input.value }));
        const outside = (event: Event) => {
          if (!panel.contains(event.target as globalThis.Node) && !dom.contains(event.target as globalThis.Node))
            close();
        };
        const key = (event: KeyboardEvent) => {
          if (event.isComposing || event.keyCode === 229) return;
          if (
            (event.key === "Escape" && panel.contains(event.target as globalThis.Node)) ||
            (event.key === "Enter" && event.target === input)
          ) {
            event.preventDefault();
            close();
            editor.commands.focus();
          }
        };
        const close = () => {
          if (!closePopup) return;
          closePopup = undefined;
          refreshPopup = undefined;
          panel.remove();
          doc.removeEventListener("pointerdown", outside, true);
          doc.removeEventListener("keydown", key, true);
          doc.removeEventListener("scroll", schedulePosition, true);
          win?.removeEventListener("resize", schedulePosition);
          if (frame !== undefined) win?.cancelAnimationFrame(frame);
        };
        closePopup = close;
        refreshPopup = () => {
          if (!composing && input.value !== current.attrs.label) input.value = current.attrs.label;
          colors
            .querySelectorAll("button")
            .forEach((el, index) => el.setAttribute("aria-pressed", String(safeColor(current.attrs.color) === index)));
          schedulePosition();
        };
        doc.addEventListener("pointerdown", outside, true);
        doc.addEventListener("keydown", key, true);
        doc.addEventListener("scroll", schedulePosition, true);
        win?.addEventListener("resize", schedulePosition);
        position();
        input.focus();
        input.select();
      };
      button.addEventListener("click", open);
      const editableChanged = () => {
        closePopup?.();
        paint();
      };
      const replacedSameNodes = new WeakSet<Transaction>();
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
        if (updatingFromPopup) return;
        const pos = getPos();
        const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (node && node.type === current.type && node !== current) {
          // Equal replacements can reuse this view without calling update().
          closePopup?.();
          current = node;
          paint();
        }
      };
      const beforeTransaction = ({ transaction }: { transaction: Transaction }) => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const before = view.state.doc.nodeAt(pos);
        if (transaction !== popupTransaction && before === current && replacesSameNode(transaction, pos, current))
          replacedSameNodes.add(transaction);
        if (!updatingFromPopup || transaction === popupTransaction) return;
        const after = transaction.doc.nodeAt(pos);
        if (before && after && before !== after && before.type === current.type && before.eq(after)) closePopup?.();
      };
      view.dom.addEventListener("semlo-editor:editable", editableChanged);
      editor.on("beforeTransaction", beforeTransaction);
      editor.on("transaction", transaction);
      paint();
      return {
        dom,
        update(node) {
          if (node.type !== current.type) return false;
          const changed = node.attrs.label !== current.attrs.label || node.attrs.color !== current.attrs.color;
          current = node;
          paint();
          if (changed && !updatingFromPopup) refreshPopup?.();
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
