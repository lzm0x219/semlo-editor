import { Node, mergeAttributes } from "@tiptap/core";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, TextSelection, type EditorState } from "@tiptap/pm/state";

import { rememberCalloutTone } from "./toolbar-callout-preference";

const tones = [
  ["gray", "灰色", "#d8dad9", "#eff0f0", "#e7e9e8"],
  ["info", "浅蓝", "#c0ddfc", "rgba(192, 221, 252, 0.5)", "#81bbf8"],
  ["cyan", "浅青", "#b5eff2", "rgba(181, 239, 242, 0.5)", "#81dfe4"],
  ["green", "浅绿", "#c7f0df", "rgba(199, 240, 223, 0.5)", "#82edc0"],
  ["lime", "黄绿", "#dbf1b7", "rgba(219, 241, 183, 0.5)", "#c1e77e"],
  ["yellow", "黄色", "#f6e1ac", "rgba(246, 225, 172, 0.5)", "#f5d480"],
  ["orange", "橙色", "#f8d6b9", "rgba(248, 214, 185, 0.5)", "#f8b881"],
  ["pink", "粉红", "#f8ced3", "rgba(248, 206, 211, 0.5)", "#f1a2ab"],
  ["mauve", "粉紫", "#f7c4e2", "rgba(247, 196, 226, 0.5)", "#f297cc"],
  ["purple", "紫色", "#d9c9f8", "rgba(217, 201, 248, 0.5)", "#ba9bf2"],
] as const;

function tone(value: unknown): string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : "info";
}

function toneColor(value: unknown): string {
  return tones.find(([name]) => name === value)?.[3] ?? tones[1][3];
}

function toneBorder(value: unknown): string {
  return tones.find(([name]) => name === value)?.[4] ?? tones[1][4];
}

function isPlainTextParagraph(node: ProseMirrorNode | null | undefined): boolean {
  return (
    !!node &&
    node.type.name === "paragraph" &&
    node.childCount === 1 &&
    !!node.firstChild?.isText &&
    node.firstChild.marks.length === 0
  );
}

function isObservedFollowingParagraph(node: ProseMirrorNode): boolean {
  if (node.type.name !== "paragraph" || node.childCount < 1 || node.childCount > 2) return false;
  if (
    node.childCount === 1 &&
    node.firstChild?.isText &&
    node.firstChild.marks.length === 1 &&
    node.firstChild.marks[0].type.name === "underline"
  )
    return true;
  for (let index = 0; index < node.childCount; index++) {
    const child = node.child(index);
    if (!child.isText || !child.marks.every((mark) => ["bold", "italic"].includes(mark.type.name))) return false;
  }
  return true;
}

function isObservedCallout(node: ProseMirrorNode | null): boolean {
  if (!node || node.type.name !== "callout" || node.childCount < 1 || node.childCount > 12 || !node.textContent)
    return false;
  // Yuque treats the preceding block as a unit for the tested
  // text, empty paragraph, status, and one-item unordered-list structures.
  for (let index = 0; index < node.childCount; index++) {
    const block = node.child(index);
    if (block.type.name === "paragraph" && block.childCount === 0) continue;
    if (block.type.name === "paragraph" && block.childCount <= 2) {
      if (block.childCount === 1 && block.firstChild?.type.name === "semloEditorStatus") continue;
      let textOnly = true;
      for (let childIndex = 0; childIndex < block.childCount; childIndex++) {
        const child = block.child(childIndex);
        if (!child.isText || !child.marks.every((mark) => ["bold", "italic"].includes(mark.type.name)))
          textOnly = false;
      }
      if (textOnly) continue;
    }
    if (block.type.name === "bulletList" && block.childCount === 1) {
      const item = block.firstChild!;
      if (item.type.name === "listItem" && item.childCount === 1 && isPlainTextParagraph(item.firstChild)) continue;
    }
    return false;
  }
  return true;
}

/** A self-contained, editable highlight block with stable JSON and HTML forms. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      tone: {
        default: "info",
        parseHTML: (element) => tone(element.getAttribute("data-tone")),
        renderHTML: (attributes) => ({ "data-tone": tone(attributes.tone) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "aside[data-semlo-editor-callout]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, {
        "data-semlo-editor-callout": "",
        style: `background-color: ${toneColor(node.attrs.tone)}; border-color: ${toneBorder(node.attrs.tone)}`,
      }),
      0,
    ];
  },
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;
        if (selection instanceof GapCursor && $from.parent.type.name === "detailsContent") {
          const previous = $from.nodeBefore;
          const next = $from.nodeAfter;
          if (isObservedCallout(previous) && next?.type.name === "callout") {
            const { view } = this.editor;
            const pos = $from.pos - previous!.nodeSize;
            const tr = view.state.tr.replaceWith(pos, $from.pos, view.state.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, pos + 1));
            view.dispatch(closeHistory(tr));
            view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
            return true;
          }
        }
        if (
          selection.empty &&
          $from.depth >= 1 &&
          $from.parent.type.name === "paragraph" &&
          $from.parent.content.size === 0 &&
          $from.node($from.depth - 1).type.name === "detailsContent"
        ) {
          const container = $from.node($from.depth - 1);
          const index = $from.index($from.depth - 1);
          const previous = index > 0 ? container.maybeChild(index - 1) : null;
          const next = container.maybeChild(index + 1);
          if (isObservedCallout(previous) && next?.type.name === "callout") {
            const { view } = this.editor;
            const tr = view.state.tr.delete($from.before(), $from.after());
            tr.setSelection(new GapCursor(tr.doc.resolve($from.before())));
            view.dispatch(closeHistory(tr));
            return true;
          }
        }
        if (
          selection.empty &&
          $from.depth >= 1 &&
          isObservedFollowingParagraph($from.parent) &&
          $from.parentOffset === 0 &&
          ["doc", "detailsContent"].includes($from.node($from.depth - 1).type.name)
        ) {
          const index = $from.index($from.depth - 1);
          const previous = index > 0 ? $from.node($from.depth - 1).maybeChild(index - 1) : null;
          if (previous && isObservedCallout(previous)) {
            const end = $from.before($from.depth);
            const { view } = this.editor;
            view.dispatch(closeHistory(view.state.tr.delete(end - previous.nodeSize, end)));
            view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
            return true;
          }
        }
        return (
          selection.empty &&
          $from.depth >= 2 &&
          $from.parent.type.name === "paragraph" &&
          $from.parentOffset === 0 &&
          $from.node($from.depth - 1).type.name === "callout" &&
          $from.index($from.depth - 1) === 0
        );
      },
      Delete: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;
        if (selection instanceof GapCursor && $from.parent.type.name === "detailsContent") {
          const previous = $from.nodeBefore;
          const next = $from.nodeAfter;
          const afterNext = $from.parent.maybeChild($from.index() + 1);
          if (isObservedCallout(previous) && isObservedCallout(next) && afterNext?.type.name === "callout") {
            const { view } = this.editor;
            const tr = view.state.tr.delete($from.pos, $from.pos + next!.nodeSize);
            tr.setSelection(new GapCursor(tr.doc.resolve($from.pos)));
            view.dispatch(tr);
            return true;
          }
        }
        if (
          !selection.empty ||
          $from.depth < 2 ||
          $from.parent.type.name !== "paragraph" ||
          $from.parentOffset !== $from.parent.content.size
        )
          return false;
        const block = $from.node($from.depth - 1);
        if (block.type.name !== "callout" || $from.index($from.depth - 1) !== block.childCount - 1) return false;
        const container = $from.node($from.depth - 2);
        const next = container.maybeChild($from.index($from.depth - 2) + 1);
        return next?.type.name === "callout" || next?.type.name === "paragraph";
      },
      Enter: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;
        if (
          !selection.empty ||
          $from.parent.type.name !== "paragraph" ||
          $from.parent.content.size !== 0 ||
          $from.depth < 2 ||
          $from.node($from.depth - 1).type.name !== "callout"
        )
          return false;
        return this.editor.commands.splitBlock();
      },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        view(view) {
          const doc = view.dom.ownerDocument;
          const win = doc.defaultView;
          const toolbar = doc.createElement("div");
          toolbar.className = "semlo-editor-callout-palette";
          toolbar.setAttribute("role", "toolbar");
          toolbar.setAttribute("aria-label", "高亮块配色");
          toolbar.hidden = true;
          doc.body.append(toolbar);
          let active: { node: ProseMirrorNode; position: number } | null = null;
          let frame: number | undefined;
          let destroyed = false;
          let suppressed = false;

          const selectedCallout = (state: EditorState) => {
            const selection = state.selection;
            if (selection instanceof NodeSelection && selection.node.type.name === "callout")
              return { node: selection.node, position: selection.from };
            const { $from, $to } = selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name !== "callout") continue;
              if ($to.pos > $from.end(depth)) return null;
              return { node, position: $from.before(depth) };
            }
            return null;
          };

          for (const [value, label, color] of tones) {
            const button = doc.createElement("button");
            button.type = "button";
            button.setAttribute("aria-label", label);
            button.setAttribute("aria-pressed", "false");
            button.title = label;
            button.dataset.tone = value;
            button.style.backgroundColor = color;
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => {
              if (!active || !view.editable || editor.isDestroyed) return;
              const current = view.state.doc.nodeAt(active.position);
              const selected = selectedCallout(view.state);
              if (
                !current ||
                current !== active.node ||
                selected?.position !== active.position ||
                current.type.name !== "callout"
              )
                return;
              rememberCalloutTone(doc, value);
              if (current.attrs.tone === value) return;
              view.dispatch(
                closeHistory(
                  view.state.tr.setNodeMarkup(active.position, undefined, { ...current.attrs, tone: value }),
                ),
              );
              view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
              view.focus();
            });
            toolbar.append(button);
          }

          const position = () => {
            if (!active || toolbar.hidden || !win) return;
            const dom = view.nodeDOM(active.position);
            if (!(dom instanceof win.HTMLElement)) return;
            const rect = dom.getBoundingClientRect();
            const width = toolbar.offsetWidth;
            const height = toolbar.offsetHeight;
            const x = Math.max(8, Math.min(rect.left + (rect.width - width) / 2, win.innerWidth - width - 8));
            const above = rect.top - height - 4;
            const below = rect.bottom + 4;
            const y = above >= 8 ? above : below + height <= win.innerHeight - 8 ? below : null;
            toolbar.style.visibility = y === null ? "hidden" : "";
            if (y === null) return;
            toolbar.style.left = `${x}px`;
            toolbar.style.top = `${y}px`;
          };
          const schedule = () => {
            if (destroyed || !win) return;
            if (frame !== undefined) win.cancelAnimationFrame(frame);
            frame = win.requestAnimationFrame(() => {
              frame = undefined;
              refresh();
            });
          };
          const refresh = () => {
            if (destroyed || editor.isDestroyed) return;
            const focus = view.hasFocus() || toolbar.contains(doc.activeElement);
            active = view.editable && focus && !suppressed ? selectedCallout(view.state) : null;
            toolbar.hidden = !active;
            if (!active) return;
            toolbar.querySelectorAll<HTMLButtonElement>("button[data-tone]").forEach((button) => {
              button.setAttribute("aria-pressed", String(button.dataset.tone === tone(active?.node.attrs.tone)));
            });
            position();
          };
          const onFocus = () => schedule();
          const editable = () => schedule();
          const onPointerDown = (event: Event) => {
            const target = event.target;
            if (win && target instanceof win.Element && target.closest("aside[data-semlo-editor-callout]")) {
              suppressed = false;
              schedule();
            }
          };
          doc.addEventListener("focusin", onFocus, true);
          doc.addEventListener("focusout", onFocus, true);
          doc.addEventListener("scroll", schedule, true);
          win?.addEventListener("resize", schedule);
          view.dom.addEventListener("semlo-editor:editable", editable);
          view.dom.addEventListener("pointerdown", onPointerDown, true);
          schedule();
          return {
            update(next, previous) {
              const current = selectedCallout(next.state);
              const old = selectedCallout(previous);
              if (current && old && current.position === old.position && !current.node.content.eq(old.node.content))
                suppressed = true;
              else if (!current || !old || current.position !== old.position) suppressed = false;
              schedule();
            },
            destroy() {
              destroyed = true;
              if (frame !== undefined) win?.cancelAnimationFrame(frame);
              doc.removeEventListener("focusin", onFocus, true);
              doc.removeEventListener("focusout", onFocus, true);
              doc.removeEventListener("scroll", schedule, true);
              win?.removeEventListener("resize", schedule);
              view.dom.removeEventListener("semlo-editor:editable", editable);
              view.dom.removeEventListener("pointerdown", onPointerDown, true);
              toolbar.remove();
            },
          };
        },
      }),
    ];
  },
});
