import { Extension, type Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { expandHeadingAncestors, headingFoldAttribute } from "./fold";

const anchorAttribute = "semloEditorHeadingAnchor";
const anchorHTMLAttribute = "data-semlo-editor-heading-anchor";
const anchorParameter = "semlo-heading";
const anchorPattern = /^sh-[a-zA-Z0-9-]{1,64}$/;
const anchorKey = new PluginKey<DecorationSet>("semloEditorHeadingAnchor");

function validAnchor(value: unknown): value is string {
  return typeof value === "string" && anchorPattern.test(value);
}

function anchors(doc: ProseMirrorNode): Map<string, number[]> {
  const result = new Map<string, number[]>();
  doc.descendants((node, pos) => {
    const value = node.type.name === "heading" ? node.attrs[anchorAttribute] : null;
    if (validAnchor(value)) result.set(value, [...(result.get(value) ?? []), pos]);
    return !node.isTextblock;
  });
  return result;
}

function newAnchor(reserved: ReadonlySet<string>, owner: Document): string | null {
  const crypto = owner.defaultView?.crypto;
  if (!crypto?.getRandomValues) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    let random: string;
    try {
      random =
        crypto.randomUUID?.() ??
        Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      return null;
    }
    const value = `sh-${random}`;
    if (!reserved.has(value)) return value;
  }
  return null;
}

/** 粘贴时只为与目标文档或片段内重复的标题重新分配身份。 */
function remapPastedAnchors(slice: Slice, state: EditorView["state"], owner: Document, preserveFold: boolean): Slice {
  let hasAnchors = false;
  let hasFold = false;
  slice.content.descendants((node) => {
    if (node.type.name === "heading" && validAnchor(node.attrs[anchorAttribute])) hasAnchors = true;
    if (!preserveFold && node.type.name === "heading" && node.attrs[headingFoldAttribute] === true) hasFold = true;
    return !(hasAnchors && hasFold);
  });
  if (!hasAnchors && !hasFold) return slice;
  const reserved = new Set(anchors(state.doc).keys());
  let failed = false;
  let changed = false;
  const copy = (node: ProseMirrorNode): ProseMirrorNode => {
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(copy(child)));
    let result = node.isLeaf ? node : node.copy(Fragment.fromArray(children));
    if (node.type.name !== "heading") return result;
    // 粘贴的单独标题不能折叠目标文档中原有的后续内容。
    if (!preserveFold && node.attrs[headingFoldAttribute] === true) {
      changed = true;
      result = result.type.create({ ...result.attrs, [headingFoldAttribute]: false }, result.content, result.marks);
    }
    const current = node.attrs[anchorAttribute];
    if (!validAnchor(current)) return result;
    const next = reserved.has(current) ? newAnchor(reserved, owner) : current;
    if (!next) {
      failed = true;
      return result;
    }
    reserved.add(next);
    if (next !== current) {
      changed = true;
      result = result.type.create({ ...result.attrs, [anchorAttribute]: next }, result.content, result.marks);
    }
    return result;
  };
  const children: ProseMirrorNode[] = [];
  slice.content.forEach((child) => children.push(copy(child)));
  // 无法生成唯一身份时不把旧身份复制进目标文档。
  if (failed) {
    const clear = (node: ProseMirrorNode): ProseMirrorNode => {
      const children: ProseMirrorNode[] = [];
      node.forEach((child) => children.push(clear(child)));
      const result = node.isLeaf ? node : node.copy(Fragment.fromArray(children));
      return node.type.name === "heading" && validAnchor(node.attrs[anchorAttribute])
        ? result.type.create({ ...result.attrs, [anchorAttribute]: null }, result.content, result.marks)
        : result;
    };
    return new Slice(Fragment.fromArray(children.map(clear)), slice.openStart, slice.openEnd);
  }
  return changed ? new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd) : slice;
}

/** 仅修复结构性拆分产生的重复身份，宿主整体替换的内容不做隐式改写。 */
function normalizeSplitAnchors(
  transactions: readonly Transaction[],
  oldState: EditorState,
  state: EditorState,
): Transaction | null {
  const candidates = new Map<string, { atStart: boolean; text: string }>();
  for (const transaction of transactions) {
    if (transaction.getMeta("preventUpdate")) continue;
    transaction.steps.forEach((step, index) => {
      if (
        !(step instanceof ReplaceStep) ||
        step.from !== step.to ||
        step.slice.openStart !== 1 ||
        step.slice.openEnd !== 1 ||
        step.slice.content.childCount !== 2 ||
        !step.toJSON().structure
      )
        return;
      const before = transaction.docs[index].resolve(step.from);
      const heading = before.parent;
      const id = heading.type.name === "heading" ? heading.attrs[anchorAttribute] : null;
      const left = step.slice.content.firstChild,
        right = step.slice.content.lastChild;
      if (
        validAnchor(id) &&
        left?.type.name === "heading" &&
        right?.type.name === "heading" &&
        left.attrs[anchorAttribute] === id &&
        right.attrs[anchorAttribute] === id
      )
        candidates.set(id, { atStart: before.parentOffset === 0, text: heading.textContent });
    });
  }
  if (!candidates.size) return null;
  const previous = anchors(oldState.doc),
    current = anchors(state.doc);
  const tr = state.tr;
  for (const [id, candidate] of candidates) {
    const old = previous.get(id),
      positions = current.get(id);
    if (old?.length !== 1 || !positions || positions.length < 2) continue;
    let mapped = old[0];
    for (const transaction of transactions) mapped = transaction.mapping.map(mapped, 1);
    const keep = candidate.atStart
      ? positions.find((pos) => state.doc.nodeAt(pos)?.textContent === candidate.text)
      : positions.find((pos) => pos === mapped);
    if (keep === undefined) continue;
    for (const pos of positions) {
      if (pos === keep) continue;
      const node = tr.doc.nodeAt(pos);
      if (node?.type.name === "heading" && node.attrs[anchorAttribute] === id)
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [anchorAttribute]: null });
    }
  }
  return tr.docChanged ? tr : null;
}

/** 标题锚点按需写入内容，宿主继续负责保存和文档地址。 */
export const HeadingAnchor = Extension.create({
  name: "semloEditorHeadingAnchor",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          [anchorAttribute]: {
            default: null,
            keepOnSplit: false,
            validate(value: unknown) {
              if (value != null && !validAnchor(value)) throw new Error("标题链接标识无效");
            },
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute(anchorHTMLAttribute);
              return validAnchor(value) ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes[anchorAttribute];
              return validAnchor(value) ? { [anchorHTMLAttribute]: value } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const editor: Editor = this.editor;
    let announce: (message: string) => void = () => {};
    let activeView: EditorView | undefined;
    let closed = false;
    let sequence = 0;
    const copyLink = (view: EditorView, getPos: () => number | undefined) => {
      if (closed || activeView !== view || editor.isDestroyed || view.isDestroyed) return;
      const owner = view.dom.ownerDocument,
        win = owner.defaultView,
        clipboard = win?.navigator.clipboard;
      const widgetPos = getPos();
      const pos = widgetPos === undefined ? undefined : widgetPos - 1;
      const state = view.state;
      const heading = pos === undefined ? null : state.doc.nodeAt(pos);
      if (!win || !clipboard?.writeText || !heading || heading.type.name !== "heading" || pos === undefined) {
        announce("无法复制段落链接");
        return;
      }
      let url: URL;
      try {
        url = new URL(win.location.href);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported-url");
      } catch {
        announce("无法复制段落链接");
        return;
      }
      let id = heading.attrs[anchorAttribute];
      const existing = anchors(state.doc);
      if (!validAnchor(id) || existing.get(id)?.length !== 1) {
        if (!view.editable) {
          announce("此标题暂无可复制的链接");
          return;
        }
        id = newAnchor(new Set(existing.keys()), owner);
        if (!id) {
          announce("无法创建段落链接");
          return;
        }
        view.dispatch(
          state.tr
            .setNodeMarkup(pos, undefined, { ...heading.attrs, [anchorAttribute]: id })
            .setMeta("addToHistory", false),
        );
        if (
          closed ||
          editor.isDestroyed ||
          view.isDestroyed ||
          view.state.doc.nodeAt(pos)?.attrs[anchorAttribute] !== id ||
          anchors(view.state.doc).get(id)?.length !== 1
        ) {
          announce("无法创建段落链接");
          return;
        }
      }
      url.searchParams.set(anchorParameter, id);
      const current = ++sequence;
      try {
        void clipboard.writeText(url.href).then(
          () => {
            if (!closed && activeView === view && !editor.isDestroyed && !view.isDestroyed && current === sequence)
              announce("复制成功");
          },
          () => {
            if (!closed && activeView === view && !editor.isDestroyed && !view.isDestroyed && current === sequence)
              announce("无法复制段落链接");
          },
        );
      } catch {
        announce("无法复制段落链接");
      }
    };
    const decorations = (doc: ProseMirrorNode) => {
      const result: Decoration[] = [];
      doc.forEach((node, pos) => {
        if (node.type.name !== "heading") return;
        const level = Number(node.attrs.level);
        if (!Number.isInteger(level) || level < 1 || level > 6) return;
        result.push(Decoration.node(pos, pos + node.nodeSize, { class: "semlo-editor-heading-linkable" }));
        result.push(
          Decoration.widget(
            pos + 1,
            (view, getPos) => {
              const button = view.dom.ownerDocument.createElement("button");
              button.type = "button";
              button.className = "semlo-editor-heading-link";
              button.contentEditable = "false";
              button.title = "复制段落链接";
              button.setAttribute("aria-label", `复制 ${level} 级标题的段落链接`);
              button.dataset.semloEditorHeadingAnchorPos = String(pos);
              button.dataset.label = `H${level}`;
              button.addEventListener("mousedown", (event) => event.preventDefault());
              button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                copyLink(view, getPos);
              });
              return button;
            },
            { side: -1, key: `semlo-editor-heading-link-${pos}-${level}`, stopEvent: () => true },
          ),
        );
      });
      return DecorationSet.create(doc, result);
    };
    return [
      new Plugin<DecorationSet>({
        key: anchorKey,
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (tr, previous) => (tr.docChanged ? decorations(tr.doc) : previous),
        },
        appendTransaction: normalizeSplitAnchors,
        props: {
          decorations: (state) => anchorKey.getState(state) ?? null,
          transformPasted: (slice, view) =>
            remapPastedAnchors(slice, view.state, view.dom.ownerDocument, view.dragging?.move === true),
        },
        view(view) {
          closed = false;
          activeView = view;
          const owner = view.dom.ownerDocument,
            win = owner.defaultView;
          const status = owner.createElement("div");
          status.className = "semlo-editor-heading-link-status";
          status.setAttribute("role", "status");
          status.setAttribute("aria-live", "polite");
          status.hidden = true;
          owner.body.append(status);
          let timer: number | undefined;
          let frame: number | undefined;
          let handled = "";
          announce = (message) => {
            if (closed || activeView !== view) return;
            if (timer !== undefined) win?.clearTimeout(timer);
            status.textContent = message;
            status.hidden = false;
            timer = win?.setTimeout(() => {
              status.hidden = true;
            }, 2400);
          };
          const schedule = () => {
            if (!win || closed || frame !== undefined) return;
            frame = win.requestAnimationFrame(() => {
              frame = undefined;
              if (closed || editor.isDestroyed || view.isDestroyed || activeView !== view) return;
              const id = new URL(win.location.href).searchParams.get(anchorParameter);
              if (!validAnchor(id) || id === handled) return;
              const found = anchors(view.state.doc).get(id);
              if (found?.length !== 1) return;
              handled = id;
              expandHeadingAncestors(editor, found[0]);
              if (closed || editor.isDestroyed || view.isDestroyed) return;
              const element = view.nodeDOM(found[0]);
              if (element instanceof win.HTMLElement) element.scrollIntoView({ block: "center" });
            });
          };
          const reset = () => {
            handled = "";
            schedule();
          };
          win?.addEventListener("popstate", reset);
          win?.addEventListener("hashchange", reset);
          view.dom.addEventListener("semlo-editor:document-replace", reset);
          schedule();
          return {
            update() {
              schedule();
            },
            destroy() {
              closed = true;
              sequence++;
              if (timer !== undefined) win?.clearTimeout(timer);
              if (frame !== undefined) win?.cancelAnimationFrame(frame);
              win?.removeEventListener("popstate", reset);
              win?.removeEventListener("hashchange", reset);
              view.dom.removeEventListener("semlo-editor:document-replace", reset);
              status.remove();
              if (activeView === view) activeView = undefined;
            },
          };
        },
      }),
    ];
  },
});
