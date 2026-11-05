import { Node } from "@tiptap/core";
import { closeHistory, redo, undo } from "@tiptap/pm/history";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import { CANVAS_DEFAULT_HEIGHT, canvasHeight, mountCanvasHeight } from "../canvas/height";
import { presentationPayload, readPresentationHeight, supportedCanvasHeight } from "../canvas/presentation";

export interface MindmapItem {
  text: string;
  children: MindmapItem[];
  collapsed?: boolean;
}
export const defaultMindmapLabels = ["思维导图", "新建节点", "新建节点", "新建节点"] as const;
const defaultTree = (): MindmapItem => ({
  text: defaultMindmapLabels[0],
  children: defaultMindmapLabels.slice(1).map((text) => ({ text, children: [] })),
});
/** Freeze the initial tree at insertion to keep saved documents stable across versions. */
export function createMindmapContent() {
  return { type: "semloEditorMindmap", attrs: { tree: defaultTree() } };
}
function treeFrom(value: unknown, labels?: unknown, onInvalid: () => void = () => {}): MindmapItem {
  let count = 0;
  const visit = (item: unknown, depth: number): MindmapItem | null => {
    if (!item || typeof item !== "object" || depth > 64 || ++count > 5000) return null;
    const candidate = item as Record<string, unknown>;
    if (
      Object.keys(candidate).some((key) => !["text", "children", "collapsed"].includes(key)) ||
      (candidate.collapsed !== undefined && typeof candidate.collapsed !== "boolean") ||
      typeof candidate.text !== "string" ||
      !Array.isArray(candidate.children)
    )
      return null;
    const children = candidate.children.map((child) => visit(child, depth + 1));
    if (children.some((child) => child === null)) return null;
    return {
      text: candidate.text,
      children: children as MindmapItem[],
      ...(candidate.collapsed === true ? { collapsed: true } : {}),
    };
  };
  if (value != null) {
    const tree = visit(value, 0);
    if (tree) return tree;
    onInvalid();
    return defaultTree();
  }
  if (labels != null) {
    if (Array.isArray(labels) && labels.length === 4 && labels.every((label) => typeof label === "string"))
      return { text: labels[0], children: labels.slice(1).map((text) => ({ text, children: [] })) };
    onInvalid();
  }
  return defaultTree();
}
function parseJSON(value: string | null): unknown {
  try {
    return value === null ? null : JSON.parse(value);
  } catch {
    return value;
  }
}
function itemAt(root: MindmapItem, path: number[]): MindmapItem | undefined {
  return path.reduce<MindmapItem | undefined>((item, index) => item?.children[index], root);
}
function descendantCount(item: MindmapItem): number {
  return item.children.reduce((total, child) => total + 1 + descendantCount(child), 0);
}
function plainText(item: MindmapItem): string {
  return [item.text, ...item.children.map(plainText)].join("\n");
}
function exportMindmap(root: MindmapItem): DOMOutputSpec {
  interface Layout {
    item: MindmapItem;
    depth: number;
    color: string;
    x: number;
    y: number;
    width: number;
    children: Layout[];
  }
  const palette = ["#a48ed5", "#7989d5", "#8cc5bd", "#d5ba74", "#db9292"];
  const widths: number[] = [];
  const measure = (item: MindmapItem, depth: number) => {
    const textWidth = Array.from(item.text).reduce((sum, ch) => sum + (ch.codePointAt(0)! > 255 ? 14 : 8), 0);
    widths[depth] = Math.max(widths[depth] ?? 65, Math.min(2000, textWidth + 20));
    if (!item.collapsed) item.children.forEach((child) => measure(child, depth + 1));
  };
  measure(root, 0);
  const columns: number[] = [];
  for (let i = 0, x = 16; i < widths.length; i++) {
    columns.push(x);
    x += widths[i] + 48;
  }
  let nextY = 24;
  const place = (item: MindmapItem, depth: number, color: string): Layout => {
    const children = item.collapsed
      ? []
      : item.children.map((child, index) =>
          place(child, depth + 1, depth === 0 ? palette[index % palette.length] : color),
        );
    const y = children.length ? (children[0].y + children[children.length - 1].y) / 2 : nextY;
    if (!children.length) nextY += 54;
    return { item, depth, color, x: columns[depth], y, width: widths[depth], children };
  };
  const tree = place(root, 0, palette[0]);
  const parts: DOMOutputSpec[] = [];
  const draw = (node: Layout) => {
    for (const child of node.children) {
      const startX = node.x + node.width,
        endX = child.x;
      const startY = node.y + (node.depth ? 16 : 0),
        endY = child.y + 16,
        bend = (startX + endX) / 2;
      parts.push([
        "path",
        {
          d: `M ${startX} ${startY} C ${bend} ${startY}, ${bend} ${endY}, ${endX} ${endY}`,
          fill: "none",
          stroke: child.color,
          "stroke-width": 3,
        },
      ]);
      draw(child);
    }
    if (!node.depth)
      parts.push(["rect", { x: node.x, y: node.y - 16, width: node.width, height: 32, rx: 4, fill: "#f0f1f1" }]);
    else
      parts.push([
        "path",
        {
          d: `M ${node.x} ${node.y + 16} H ${node.x + node.width}`,
          fill: "none",
          stroke: node.color,
          "stroke-width": 3,
        },
      ]);
    parts.push([
      "text",
      {
        x: node.x + node.width / 2,
        y: node.y + 5,
        "text-anchor": "middle",
        "font-size": 14,
        fill: "#252525",
        ...(node.depth ? {} : { "font-weight": "600" }),
      },
      node.item.text,
    ]);
    if (node.item.collapsed && node.item.children.length)
      parts.push([
        "text",
        { x: node.x + node.width + 10, y: node.y + 18, "font-size": 11, fill: node.color },
        String(descendantCount(node.item)),
      ]);
  };
  draw(tree);
  const width = columns[columns.length - 1] + widths[widths.length - 1] + 20;
  return [
    "http://www.w3.org/2000/svg svg",
    { viewBox: `0 0 ${width} ${Math.max(48, nextY + 4)}`, width: "100%", role: "img", "aria-label": "思维导图" },
    ...parts,
  ];
}

export const Mindmap = Node.create({
  name: "semloEditorMindmap",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      height: {
        default: CANVAS_DEFAULT_HEIGHT,
        rendered: false,
        parseHTML: readPresentationHeight,
      },
      tree: { default: null, rendered: false, parseHTML: (element) => parseJSON(element.getAttribute("data-tree")) },
      // Read documents created by the earlier four-label prototype.
      labels: {
        default: null,
        rendered: false,
        parseHTML: (element) => parseJSON(element.getAttribute("data-labels")),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-semlo-editor-mindmap]",
        priority: 100,
        getAttrs: (element: HTMLElement) => (readPresentationHeight(element) === null ? { height: null } : {}),
      },
    ];
  },
  renderText({ node }) {
    let supported = supportedCanvasHeight(node.attrs.height);
    const tree = treeFrom(node.attrs.tree, node.attrs.labels, () => {
      supported = false;
    });
    return supported ? plainText(tree) : "思维导图数据格式不受支持";
  },
  renderHTML({ node }) {
    const presentation = presentationPayload(node.attrs.height);
    let supported = supportedCanvasHeight(node.attrs.height);
    const tree = treeFrom(node.attrs.tree, node.attrs.labels, () => {
      supported = false;
    });
    return [
      "figure",
      {
        "data-semlo-editor-mindmap": "",
        "data-height": canvasHeight(node.attrs.height),
        ...(presentation === null ? {} : { "data-semlo-editor-presentation": presentation }),
        "data-tree": JSON.stringify(node.attrs.tree),
        "data-labels": JSON.stringify(node.attrs.labels),
        class: "semlo-editor-mindmap-export",
      },
      supported ? exportMindmap(tree) : ["p", "思维导图数据格式不受支持，暂无法显示。"],
    ];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("div");
      dom.className = "semlo-editor-mindmap";
      dom.dataset.type = "semloEditorMindmap";
      dom.contentEditable = "false";
      let current = initial;
      let documentEpoch = 0;
      let observedNode = initial;
      let observedPosition = getPos();
      let observedDocument = view.state.doc;
      let selected: number[] | null = null;
      let destroyed = false;
      let input: HTMLInputElement | null = null;
      let layoutObserver: ResizeObserver | null = null;
      let removeResizeFallback: (() => void) | null = null;
      const isSelected = (path: number[]) =>
        selected !== null && path.length === selected.length && path.every((n, i) => n === selected![i]);
      const dataSupported = () => {
        let supported = supportedCanvasHeight(current.attrs.height);
        treeFrom(current.attrs.tree, current.attrs.labels, () => {
          supported = false;
        });
        return supported;
      };
      const commit = (tree: MindmapItem) => {
        if (destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return false;
        const pos = getPos();
        const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (typeof pos !== "number" || !live || !live.eq(current)) return false;
        view.dispatch(
          closeHistory(view.state.tr.setNodeAttribute(pos, "tree", tree).setNodeAttribute(pos, "labels", null)),
        );
        view.dispatch(closeHistory(view.state.tr));
        return true;
      };
      const commitHeight = (value: number) => {
        if (destroyed || editor.isDestroyed || !editor.isEditable || !dataSupported()) return;
        const pos = getPos();
        const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (typeof pos !== "number" || !live || !live.eq(current)) return;
        view.dispatch(closeHistory(view.state.tr.setNodeAttribute(pos, "height", canvasHeight(value))));
        view.dispatch(closeHistory(view.state.tr));
      };
      const focusSelected = () =>
        dom.querySelector<HTMLButtonElement>('.semlo-editor-mindmap-label[aria-pressed="true"]')?.focus();
      const edit = (path: number[]) => {
        if (!editor.isEditable || destroyed || input) return;
        const editNode = current;
        const editEpoch = documentEpoch;
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const item = itemAt(tree, path);
        const button = dom.querySelector<HTMLButtonElement>('.semlo-editor-mindmap-label[aria-pressed="true"]');
        if (!item || !button) return;
        const field = doc.createElement("input");
        field.className = "semlo-editor-mindmap-input";
        field.setAttribute("aria-label", path.length ? "编辑节点" : "编辑中心节点");
        field.value = item.text;
        input = field;
        button.replaceWith(field);
        let done = false;
        const finish = (save: boolean) => {
          if (done) return;
          done = true;
          input = null;
          if (destroyed || documentEpoch !== editEpoch || !current.eq(editNode)) return;
          if (save && field.value !== item.text) {
            item.text = field.value;
            if (commit(tree)) {
              focusSelected();
              return;
            }
          }
          if (!destroyed) {
            paint();
            focusSelected();
          }
        };
        field.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        });
        field.addEventListener("blur", () => finish(true));
        field.focus();
        field.select();
      };
      const add = (path: number[], sibling: boolean) => {
        if (!editor.isEditable || destroyed) return;
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const parentPath = sibling ? path.slice(0, -1) : path;
        const parent = itemAt(tree, parentPath);
        if (!parent || (sibling && !path.length)) return;
        const index = sibling ? path[path.length - 1] + 1 : parent.children.length;
        parent.collapsed = false;
        parent.children.splice(index, 0, { text: "", children: [] });
        selected = [...parentPath, index];
        if (commit(tree)) edit(selected);
      };
      const remove = (path: number[]) => {
        if (!path.length || !editor.isEditable) return;
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const parentPath = path.slice(0, -1);
        const parent = itemAt(tree, parentPath);
        if (!parent || !parent.children[path[path.length - 1]]) return;
        parent.children.splice(path[path.length - 1], 1);
        selected = parentPath;
        if (commit(tree)) focusSelected();
      };
      const toggleCollapsed = (path: number[]) => {
        if (!editor.isEditable || destroyed) return;
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        const item = itemAt(tree, path);
        if (!item?.children.length) return;
        item.collapsed = !item.collapsed;
        selected = path;
        if (commit(tree)) focusSelected();
      };
      const makePlus = (path: number[]) => {
        const plus = doc.createElement("button");
        plus.type = "button";
        plus.className = "semlo-editor-mindmap-add";
        plus.setAttribute("aria-label", "添加下级节点");
        plus.textContent = "+";
        plus.addEventListener("click", () => add(path, false));
        return plus;
      };
      const paint = () => {
        const previousHeightHandle = dom.querySelector(".semlo-editor-canvas-height-handle");
        const restoreHeightFocus = previousHeightHandle !== null && previousHeightHandle === doc.activeElement;
        layoutObserver?.disconnect();
        layoutObserver = null;
        removeResizeFallback?.();
        removeResizeFallback = null;
        dom.replaceChildren();
        if (!dataSupported()) {
          const message = doc.createElement("p");
          message.textContent = "思维导图数据格式不受支持，暂无法编辑。";
          message.setAttribute("role", "status");
          dom.append(message);
          return;
        }
        const tree = treeFrom(current.attrs.tree, current.attrs.labels);
        if (selected && !itemAt(tree, selected)) selected = null;
        const links: Array<{ parent: HTMLElement; child: HTMLElement; color: string; fromRoot: boolean }> = [];
        const colors = ["#a48ed5", "#7989d5", "#8cc5bd", "#d5ba74", "#db9292"];
        const render = (item: MindmapItem, path: number[], parent?: HTMLElement): HTMLElement => {
          const row = doc.createElement("div");
          row.className = `semlo-editor-mindmap-branch${path.length ? "" : " semlo-editor-mindmap-root"}`;
          const labelWrap = doc.createElement("div");
          labelWrap.className = "semlo-editor-mindmap-label-wrap";
          const label = doc.createElement("button");
          label.type = "button";
          label.className = "semlo-editor-mindmap-label";
          const color = colors[(path[0] ?? 0) % colors.length];
          if (path.length) {
            label.style.borderBottomColor = color;
            if (parent) links.push({ parent, child: label, color, fromRoot: path.length === 1 });
          }
          label.textContent = item.text;
          label.setAttribute("aria-label", `${path.length ? "节点" : "中心节点"}：${item.text}`);
          label.setAttribute("aria-pressed", String(isSelected(path)));
          label.addEventListener("click", () => {
            selected = path;
            dom
              .querySelectorAll<HTMLButtonElement>(".semlo-editor-mindmap-label")
              .forEach((button) => button.setAttribute("aria-pressed", String(button === label)));
            dom.querySelectorAll(".semlo-editor-mindmap-add").forEach((button) => button.remove());
            if (editor.isEditable) labelWrap.append(makePlus(path));
          });
          label.addEventListener("dblclick", () => {
            selected = path;
            edit(path);
          });
          label.addEventListener("keydown", (event) => {
            if (!editor.isEditable || event.isComposing) return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
              event.preventDefault();
              (event.shiftKey ? redo : undo)(view.state, view.dispatch);
              focusSelected();
              return;
            }
            if (event.key === "Tab" && !event.shiftKey) {
              event.preventDefault();
              add(path, false);
            } else if (event.key === "Enter" && path.length) {
              event.preventDefault();
              add(path, true);
            } else if ((event.key === "Backspace" || event.key === "Delete") && path.length) {
              event.preventDefault();
              remove(path);
            }
          });
          labelWrap.append(label);
          if (item.children.length && path.length) {
            const toggle = doc.createElement("button");
            toggle.type = "button";
            toggle.className = "semlo-editor-mindmap-collapse";
            toggle.setAttribute("aria-label", item.collapsed ? "展开分支" : "折叠分支");
            toggle.setAttribute("aria-expanded", String(!item.collapsed));
            toggle.textContent = item.collapsed ? String(descendantCount(item)) : "‹";
            toggle.disabled = !editor.isEditable;
            toggle.addEventListener("click", () => toggleCollapsed(path));
            labelWrap.append(toggle);
            labelWrap.classList.add("has-children");
          }
          if (isSelected(path) && editor.isEditable) labelWrap.append(makePlus(path));
          row.append(labelWrap);
          if (item.children.length && !item.collapsed) {
            const children = doc.createElement("div");
            children.className = "semlo-editor-mindmap-children";
            item.children.forEach((child, index) => children.append(render(child, [...path, index], label)));
            row.append(children);
          }
          return row;
        };
        const content = doc.createElement("div");
        content.className = "semlo-editor-mindmap-content";
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("semlo-editor-mindmap-lines");
        svg.setAttribute("aria-hidden", "true");
        content.append(svg, render(tree, []));
        dom.append(content);
        const draw = () => {
          if (destroyed || !content.isConnected) return;
          const origin = content.getBoundingClientRect();
          svg.setAttribute("width", String(content.scrollWidth));
          svg.setAttribute("height", String(content.scrollHeight));
          svg.replaceChildren();
          for (const link of links) {
            const parent = link.parent.getBoundingClientRect(),
              child = link.child.getBoundingClientRect();
            if (!parent.width || !child.width) continue;
            const x1 = parent.right - origin.left,
              x2 = child.left - origin.left;
            const y1 = (link.fromRoot ? parent.top + parent.height / 2 : parent.bottom - 1) - origin.top;
            const y2 = child.bottom - 1 - origin.top;
            const bend = (x1 + x2) / 2;
            const path = doc.createElementNS(svg.namespaceURI, "path");
            path.classList.add("semlo-editor-mindmap-line");
            path.setAttribute("d", `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", link.color);
            path.setAttribute("stroke-width", "3");
            svg.append(path);
          }
        };
        draw();
        doc.defaultView?.requestAnimationFrame(draw);
        if (doc.defaultView?.ResizeObserver) {
          layoutObserver = new doc.defaultView.ResizeObserver(draw);
          layoutObserver.observe(content);
        } else if (doc.defaultView) {
          const win = doc.defaultView;
          win.addEventListener("resize", draw);
          removeResizeFallback = () => win.removeEventListener("resize", draw);
        }
        mountCanvasHeight(dom, current.attrs.height, editor.isEditable, commitHeight);
        if (restoreHeightFocus && editor.isEditable)
          dom.querySelector<HTMLElement>(".semlo-editor-canvas-height-handle")?.focus({ preventScroll: true });
      };
      let editable = editor.isEditable;
      const refreshEditable = () => {
        if (editable === editor.isEditable || destroyed) return;
        editable = editor.isEditable;
        paint();
      };
      const resetAfterDocumentReplacement = ({
        transaction,
        appendedTransactions,
      }: {
        transaction: Transaction;
        appendedTransactions: Transaction[];
      }) => {
        if (destroyed) return;
        const transactions = [transaction, ...appendedTransactions];
        if (!transactions.some((entry) => entry.docChanged)) return;
        const outOfOrder = observedDocument !== transaction.before;
        observedDocument = view.state.doc;
        const previousNode = observedNode;
        let position = observedPosition;
        const finalPosition = getPos();
        const finalNode = typeof finalPosition === "number" ? view.state.doc.nodeAt(finalPosition) : null;
        observedNode = finalNode ?? current;
        observedPosition = finalPosition;
        if (position === undefined) {
          transaction.before.descendants((node, offset) => {
            if (node === previousNode && position === undefined) position = offset;
          });
        }
        let replaced = false;
        let replacedNode = false;
        for (const entry of transactions)
          for (const [index, map] of entry.mapping.maps.entries()) {
            const before = entry.docs[index];
            const candidate = typeof position === "number" ? before.nodeAt(position) : null;
            map.forEach((oldStart, oldEnd, newStart) => {
              if (oldStart === 0 && oldEnd === before.content.size && newStart === 0) replaced = true;
              if (
                candidate &&
                typeof position === "number" &&
                oldStart <= position &&
                oldEnd >= position + candidate.nodeSize &&
                oldEnd > oldStart
              )
                replacedNode = true;
            });
            if (typeof position === "number") position = map.map(position, 1);
          }
        if (!outOfOrder && !replaced && !replacedNode) return;
        if (
          !outOfOrder &&
          previousNode === finalNode &&
          (!replaced || transaction.before.eq(transactions[transactions.length - 1].doc))
        )
          return;
        documentEpoch++;
        selected = null;
        input = null;
        paint();
      };
      editor.on("update", refreshEditable);
      editor.on("transaction", resetAfterDocumentReplacement);
      view.dom.addEventListener("semlo-editor:editable", refreshEditable);
      paint();
      return {
        dom,
        update(node) {
          if (node.type !== current.type) return false;
          current = node;
          input = null;
          paint();
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy() {
          destroyed = true;
          layoutObserver?.disconnect();
          removeResizeFallback?.();
          editor.off("update", refreshEditable);
          editor.off("transaction", resetAfterDocumentReplacement);
          view.dom.removeEventListener("semlo-editor:editable", refreshEditable);
          input = null;
        },
      };
    };
  },
});
