import { Node, mergeAttributes } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";

/** Widths are fractions of the available content width; unset widths are equal. */
function normalizeWidths(value: unknown, count: number): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item) || item <= 0)
  )
    return Array(count).fill(1 / count);
  const sum = value.reduce((total, item) => total + item, 0);
  if (!Number.isFinite(sum) || sum <= 0) return Array(count).fill(1 / count);
  return value.map((item) => item / sum);
}
function parseWidths(value: string | null): number[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length < 2 ||
      parsed.length > 4 ||
      parsed.some((item) => typeof item !== "number" || !Number.isFinite(item) || item <= 0)
    )
      return null;
    return normalizeWidths(parsed, parsed.length);
  } catch {
    return null;
  }
}
function gridWidths(widths: number[]) {
  return widths.map((width) => `minmax(0, ${width}fr)`).join(" ");
}

export const Columns = Node.create({
  name: "semloEditorColumns",
  group: "block",
  content: "semloEditorColumn{2,4}",
  isolating: true,
  addAttributes() {
    return {
      widths: {
        default: null,
        rendered: false,
        parseHTML: (element) => parseWidths(element.getAttribute("data-widths")),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-semlo-editor-columns]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const widths =
      Array.isArray(node.attrs.widths) && node.attrs.widths.length === node.childCount
        ? normalizeWidths(node.attrs.widths, node.childCount)
        : null;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-semlo-editor-columns": "",
        class: "semlo-editor-columns",
        ...(widths
          ? { "data-widths": JSON.stringify(widths), style: `grid-template-columns: ${gridWidths(widths)}` }
          : {}),
      }),
      0,
    ];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("div");
      dom.className = "semlo-editor-columns-node";
      const contentDOM = doc.createElement("div");
      contentDOM.className = "semlo-editor-columns";
      contentDOM.setAttribute("data-semlo-editor-columns", "");
      const controls = doc.createElement("div");
      controls.className = "semlo-editor-column-controls";
      controls.contentEditable = "false";
      dom.append(contentDOM, controls);
      let current = initial;
      let resizing: (() => void) | undefined;
      let frame: number | undefined;
      let destroyed = false;
      const win = doc.defaultView;
      const widths = () => normalizeWidths(current.attrs.widths, current.childCount);
      const paintWidths = (values: number[]) => {
        contentDOM.style.gridTemplateColumns = gridWidths(values);
      };
      const syncHandles = (values = widths()) => {
        const bounds = dom.getBoundingClientRect();
        const children = [...contentDOM.children] as HTMLElement[];
        const handles = [...controls.querySelectorAll<HTMLButtonElement>(".semlo-editor-column-handle")];
        handles.forEach((handle, index) => {
          if (!children[index] || !children[index + 1]) return;
          const left = children[index].getBoundingClientRect();
          const right = children[index + 1].getBoundingClientRect();
          handle.style.left = `${(left.right + right.left) / 2 - bounds.left}px`;
          handle.setAttribute("aria-valuenow", String(Math.round(values[index] * 100)));
          handle.setAttribute("aria-valuetext", `第 ${index + 1} 栏占 ${Math.round(values[index] * 100)}%`);
        });
      };
      const schedule = () => {
        if (frame !== undefined || !win || destroyed) return;
        frame = win.requestAnimationFrame(() => {
          frame = undefined;
          if (!destroyed && !resizing) syncHandles();
        });
      };
      const commit = (next: number[]) => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const node = view.state.doc.nodeAt(pos);
        if (!node || node.type !== current.type || node.childCount !== next.length) return;
        const rounded = next.map((value) => Math.round(value * 1_000_000) / 1_000_000);
        const previous = normalizeWidths(node.attrs.widths, node.childCount);
        if (rounded.every((value, index) => Math.abs(value - previous[index]) < 0.00001)) {
          paintWidths(previous);
          syncHandles(previous);
          return;
        }
        view.dispatch(closeHistory(view.state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, widths: rounded }));
        view.dispatch(closeHistory(view.state.tr));
        view.focus();
      };
      const resizePair = (base: number[], index: number, delta: number, available: number) => {
        const pair = base[index] + base[index + 1];
        const minimum = Math.min(72 / Math.max(available, 1), pair / 3);
        const left = Math.max(minimum, Math.min(pair - minimum, base[index] + delta));
        const result = base.slice();
        result[index] = left;
        result[index + 1] = pair - left;
        return result;
      };
      const availableWidth = () => {
        const gap = Number.parseFloat(win?.getComputedStyle(contentDOM).columnGap ?? "0") || 0;
        return Math.max(1, contentDOM.getBoundingClientRect().width - gap * (current.childCount - 1));
      };
      const beginResize = (index: number, event: PointerEvent) => {
        if (!editor.isEditable || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        resizing?.();
        const start = event.clientX;
        const base = widths();
        const original = current;
        const available = availableWidth();
        let next = base;
        dom.classList.add("is-resizing");
        const move = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== event.pointerId) return;
          next = resizePair(base, index, (moveEvent.clientX - start) / available, available);
          paintWidths(next);
          syncHandles(next);
        };
        const finish = (endEvent: PointerEvent) => {
          if (endEvent.pointerId !== event.pointerId) return;
          cleanup();
          const pos = getPos();
          const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
          if (node !== original) {
            if (node?.type === current.type) current = node;
            paintWidths(widths());
            syncHandles();
            return;
          }
          commit(next);
        };
        const abort = (endEvent: PointerEvent) => {
          if (endEvent.pointerId !== event.pointerId) return;
          cleanup();
          paintWidths(widths());
          syncHandles();
        };
        const key = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key === "Escape") {
            keyEvent.preventDefault();
            cleanup();
            paintWidths(widths());
            syncHandles();
            view.focus();
          }
        };
        const cleanup = () => {
          doc.removeEventListener("pointermove", move, true);
          doc.removeEventListener("pointerup", finish, true);
          doc.removeEventListener("pointercancel", abort, true);
          doc.removeEventListener("keydown", key, true);
          dom.classList.remove("is-resizing");
          resizing = undefined;
        };
        resizing = cleanup;
        doc.addEventListener("pointermove", move, true);
        doc.addEventListener("pointerup", finish, true);
        doc.addEventListener("pointercancel", abort, true);
        doc.addEventListener("keydown", key, true);
      };
      const rebuildHandles = () => {
        if (controls.childElementCount === current.childCount - 1) return;
        controls.replaceChildren();
        for (let index = 0; index < current.childCount - 1; index++) {
          const handle = doc.createElement("button");
          handle.type = "button";
          handle.className = "semlo-editor-column-handle";
          handle.setAttribute("role", "separator");
          handle.setAttribute("aria-orientation", "vertical");
          handle.setAttribute("aria-valuemin", "0");
          handle.setAttribute("aria-valuemax", "100");
          handle.setAttribute("aria-label", `调整第 ${index + 1} 栏与第 ${index + 2} 栏宽度`);
          handle.addEventListener("pointerdown", (event) => beginResize(index, event));
          handle.addEventListener("keydown", (event) => {
            if (
              editor.isEditable &&
              (event.metaKey || event.ctrlKey) &&
              (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (event.key.toLowerCase() === "y" || event.shiftKey) editor.commands.redo();
              else editor.commands.undo();
              handle.focus();
              return;
            }
            if (!editor.isEditable || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
            event.preventDefault();
            event.stopPropagation();
            const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 0.05 : 0.01);
            commit(resizePair(widths(), index, delta, availableWidth()));
            handle.focus();
          });
          controls.append(handle);
        }
      };
      const paint = () => {
        controls.hidden = !editor.isEditable;
        rebuildHandles();
        if (!resizing) paintWidths(widths());
        schedule();
      };
      const editableChanged = () => {
        resizing?.();
        paint();
      };
      view.dom.addEventListener("semlo-editor:editable", editableChanged);
      const observer = win?.ResizeObserver ? new win.ResizeObserver(schedule) : undefined;
      observer?.observe(dom);
      paint();
      return {
        dom,
        contentDOM,
        update(node) {
          if (node.type !== current.type) return false;
          // A resize preview is based on the original node. Do not let a
          // pending pointerup overwrite an intervening document update.
          if (node !== current) resizing?.();
          current = node;
          paint();
          return true;
        },
        stopEvent(event) {
          return controls.contains(event.target as globalThis.Node);
        },
        ignoreMutation(mutation) {
          return (
            mutation.target === dom ||
            controls.contains(mutation.target) ||
            (mutation.type === "attributes" && mutation.target === contentDOM)
          );
        },
        destroy() {
          destroyed = true;
          resizing?.();
          observer?.disconnect();
          if (frame !== undefined) win?.cancelAnimationFrame(frame);
          view.dom.removeEventListener("semlo-editor:editable", editableChanged);
        },
      };
    };
  },
});
export const Column = Node.create({
  name: "semloEditorColumn",
  content: "block+",
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-semlo-editor-column]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-semlo-editor-column": "", class: "semlo-editor-column" }),
      0,
    ];
  },
});
