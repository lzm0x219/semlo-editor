import { mergeAttributes, type Editor } from "@tiptap/core";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";

const detailRevealers = new WeakMap<globalThis.Node, () => boolean>();

function mergeFirstBodyParagraph(editor: Editor, detailsPos: number, details: ProseMirrorNode): boolean {
  const summary = details.firstChild;
  const body = details.child(1);
  const paragraph = body.firstChild;
  if (!summary || !paragraph || paragraph.type !== editor.schema.nodes.paragraph) return false;
  if (!summary.type.validContent(summary.content.append(paragraph.content))) return false;
  const summaryEnd = detailsPos + summary.nodeSize;
  const paragraphPos = summaryEnd + 2;
  const tr = closeHistory(editor.state.tr);
  tr.insert(summaryEnd, paragraph.content);
  const mapped = tr.mapping.map(paragraphPos);
  if (body.childCount === 1 && !body.type.contentMatch.validEnd)
    tr.replaceWith(mapped, mapped + paragraph.nodeSize, paragraph.type.create());
  else tr.delete(mapped, mapped + paragraph.nodeSize);
  tr.setSelection(Selection.near(tr.doc.resolve(summaryEnd), -1)).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}

/** The last body paragraph can merge into the title, leaving an empty body. */
export const SemloEditorDetailsContent = DetailsContent.extend({ content: "block*" });

/** Keep the summary text-only apart from the soft line breaks Yuque supports. */
export const SemloEditorDetailsSummary = DetailsSummary.extend({
  content: "(text | hardBreak)*",
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      "Shift-Enter": ({ editor }) => {
        const { $from, $to } = editor.state.selection;
        if ($from.parent.type !== this.type || !$from.sameParent($to)) return false;
        const hardBreak = editor.schema.nodes.hardBreak;
        if (!hardBreak) return false;
        const transaction = closeHistory(editor.state.tr).replaceSelectionWith(hardBreak.create()).scrollIntoView();
        editor.view.dispatch(transaction);
        editor.view.dispatch(closeHistory(editor.state.tr));
        return true;
      },
    };
  },
});

/** Reveal each collapsed details body containing a position. */
export function revealDetailsAt(editor: Editor, position: number): boolean {
  if (editor.isDestroyed || position < 0 || position > editor.state.doc.content.size) return false;
  const resolved = editor.state.doc.resolve(position);
  const positions: number[] = [];
  for (let depth = 1; depth < resolved.depth; depth++) {
    if (resolved.node(depth).type.name === "details" && resolved.node(depth + 1).type.name === "detailsContent")
      positions.push(resolved.before(depth));
  }
  let changed = false;
  if (editor.isEditable) {
    const transaction = editor.state.tr;
    for (const pos of positions) {
      const node = transaction.doc.nodeAt(pos);
      if (!node || node.type.name !== "details" || node.attrs.open) continue;
      transaction.setNodeMarkup(pos, undefined, { ...node.attrs, open: true });
      changed = true;
    }
    if (changed) editor.view.dispatch(transaction.setMeta("addToHistory", false));
  }
  for (const pos of positions) {
    const node = editor.view.nodeDOM(pos);
    const reveal = node && detailRevealers.get(node);
    if (reveal?.()) changed = true;
  }
  return changed;
}

export const SemloEditorDetails = Details.extend({
  addAttributes() {
    if (!this.options.persist) return this.parent?.() ?? {};
    return {
      open: {
        default: true,
        parseHTML: (element) => element.hasAttribute("open"),
        renderHTML: ({ open }) => (open ? { open: "" } : {}),
      },
    };
  },

  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.();
    return {
      ...parentShortcuts,
      ArrowRight: (props) => {
        const { editor } = props;
        const { view, state } = editor;
        if (!view.composing) {
          const domSelection = view.dom.ownerDocument.getSelection();
          if (domSelection?.isCollapsed && domSelection.anchorNode && view.dom.contains(domSelection.anchorNode)) {
            let position: number | undefined;
            try {
              position = view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset);
            } catch {
              // A stale DOM selection cannot be safely mapped; let the normal handler decide.
            }
            if (position !== undefined && position >= 0 && position <= state.doc.content.size) {
              const resolved = state.doc.resolve(position);
              if (
                resolved.parent.isTextblock &&
                resolved.depth >= 2 &&
                resolved.node(resolved.depth - 1).type.name === "detailsContent" &&
                (!state.selection.empty || state.selection.from !== position)
              ) {
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, position)));
              }
            }
          }
        }
        return parentShortcuts?.ArrowRight?.(props) ?? false;
      },
      Backspace: (props) => {
        const { editor } = props;
        const { selection } = editor.state;
        const { $head } = selection;
        if (editor.view.composing) return false;
        if (
          selection.empty &&
          $head.parentOffset === 0 &&
          $head.parent.type === editor.schema.nodes.paragraph &&
          $head.depth >= 2
        ) {
          const bodyDepth = $head.depth - 1;
          const body = $head.node(bodyDepth);
          const detailsDepth = bodyDepth - 1;
          const details = $head.node(detailsDepth);
          if (
            body.type === editor.schema.nodes.detailsContent &&
            details.type === this.type &&
            $head.index(bodyDepth) === 0
          ) {
            return mergeFirstBodyParagraph(editor, $head.before(detailsDepth), details);
          }
        }
        if (!selection.empty || $head.parent.type !== editor.schema.nodes.detailsSummary)
          return parentShortcuts?.Backspace?.(props) ?? false;
        if ($head.parentOffset === 0) return true;
        const text = $head.parent.textBetween(0, $head.parentOffset, "\n", "\n");
        const segmenter =
          typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
        const segments = segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
        const length = segments.at(-1)?.length ?? 1;
        editor.view.dispatch(editor.state.tr.delete($head.pos - length, $head.pos).scrollIntoView());
        return true;
      },
      Delete: (props) => {
        const { editor } = props;
        const { selection } = editor.state;
        const { $head } = selection;
        if (
          editor.view.composing ||
          !selection.empty ||
          $head.parent.type !== editor.schema.nodes.detailsSummary ||
          $head.parentOffset !== $head.parent.content.size
        )
          return parentShortcuts?.Delete?.(props) ?? false;
        const depth = $head.depth - 1;
        const details = $head.node(depth);
        if (details.type !== this.type) return false;
        return mergeFirstBodyParagraph(editor, $head.before(depth), details);
      },
      Enter: (props) => {
        const { editor } = props;
        const { view } = editor;
        const { $head, $from, $to } = editor.state.selection;
        if ($head.parent.type !== editor.schema.nodes.detailsSummary) return false;
        if (!$from.sameParent($to)) return false;
        const detailsDepth = $head.depth - 1;
        const details = $head.node(detailsDepth);
        if (details.type !== this.type) return false;
        const pos = $head.before(detailsDepth);

        if (!this.options.persist) return parentShortcuts?.Enter?.(props) ?? false;
        const body = details.child(1);
        const paragraph = editor.schema.nodes.paragraph;
        if (!paragraph) return false;
        const originalBodyStart = pos + 1 + details.child(0).nodeSize + 1;
        const reuseEmpty = body.firstChild?.type === paragraph && !body.firstChild.content.size;
        const tr = closeHistory(editor.state.tr);
        if (!tr.selection.empty) tr.deleteSelection();
        if (!details.attrs.open) {
          tr.setNodeMarkup(pos, undefined, { ...details.attrs, open: true });
          // The inherited selection plugin reads DOM visibility while applying
          // the transaction, before ProseMirror updates this node view.
          const dom = view.nodeDOM(pos);
          if (dom) detailRevealers.get(dom)?.();
        }
        const cursor = tr.selection.$from;
        const suffix = cursor.parent.content.cut(cursor.parentOffset);
        if (suffix.size) tr.delete(cursor.pos, cursor.end());
        const bodyStart = tr.mapping.map(originalBodyStart);
        if (reuseEmpty && suffix.size)
          tr.replaceWith(bodyStart, bodyStart + body.firstChild!.nodeSize, paragraph.create(null, suffix));
        else if (!reuseEmpty) tr.insert(bodyStart, paragraph.create(null, suffix));
        tr.setSelection(Selection.near(tr.doc.resolve(bodyStart), 1)).scrollIntoView();
        view.dispatch(tr);
        view.dispatch(closeHistory(editor.state.tr));
        return true;
      },
    };
  },

  addNodeView() {
    return ({ editor, getPos, node, HTMLAttributes, view }) => {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("div");
      const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { "data-type": this.name });
      for (const [key, value] of Object.entries(attributes)) dom.setAttribute(key, String(value));
      const toggle = doc.createElement("button");
      toggle.type = "button";
      const contentDOM = doc.createElement("div");
      dom.append(toggle, contentDOM);
      let currentNode = node;
      let isOpen = Boolean(node.attrs.open);
      let temporarilyRevealed = false;
      let destroyed = false;

      const syncOpen = () => {
        dom.classList.toggle(this.options.openClassName, isOpen);
        this.options.renderToggleButton({ element: toggle, isOpen, node: currentNode });
        contentDOM.querySelector(':scope > div[data-type="detailsContent"]')?.toggleAttribute("hidden", !isOpen);
      };
      const toggleClicked = () => {
        if (!this.options.persist || !editor.isEditable) {
          isOpen = !isOpen;
          temporarilyRevealed = false;
          syncOpen();
          if (!this.options.persist) editor.commands.focus(undefined, { scrollIntoView: false });
          return;
        }
        const pos = getPos();
        if (typeof pos !== "number") return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current || current.type !== this.type) return;
        const { from, to } = editor.state.selection;
        isOpen = !isOpen;
        temporarilyRevealed = false;
        syncOpen();
        if (isOpen === Boolean(current.attrs.open)) {
          editor.commands.focus(undefined, { scrollIntoView: false });
          return;
        }
        const changed = editor
          .chain()
          .command(({ tr }) => {
            const target = tr.doc.nodeAt(pos);
            if (!target || target.type !== this.type) return false;
            tr.setNodeMarkup(pos, undefined, { ...target.attrs, open: isOpen });
            return true;
          })
          .setTextSelection({ from, to })
          .focus(undefined, { scrollIntoView: false })
          .run();
        if (!changed) {
          isOpen = Boolean(current.attrs.open);
          syncOpen();
        }
      };
      const editableChanged = () => {
        if (!editor.isEditable || editor.isDestroyed) return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current || current.type !== this.type || current.attrs.open === undefined) return;
        currentNode = current;
        if (!temporarilyRevealed) isOpen = Boolean(current.attrs.open);
        syncOpen();
      };

      const reveal = () => {
        if (isOpen || destroyed) return false;
        isOpen = true;
        temporarilyRevealed = true;
        syncOpen();
        return true;
      };

      toggle.addEventListener("click", toggleClicked);
      view.dom.addEventListener("semlo-editor:editable", editableChanged);
      detailRevealers.set(dom, reveal);
      syncOpen();
      // ProseMirror attaches the content node after the node view is created.
      // Reconcile idempotently instead of toggling later, which can undo an update.
      queueMicrotask(() => {
        if (!destroyed) syncOpen();
      });
      return {
        dom,
        contentDOM,
        ignoreMutation(mutation) {
          if (mutation.type === "selection") return false;
          const target = mutation.target;
          return toggle.contains(target) || !dom.contains(target) || dom === target;
        },
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) return false;
          if (updatedNode.attrs.open !== currentNode.attrs.open) temporarilyRevealed = false;
          currentNode = updatedNode;
          if (!temporarilyRevealed && updatedNode.attrs.open !== undefined) isOpen = Boolean(updatedNode.attrs.open);
          syncOpen();
          return true;
        },
        destroy() {
          destroyed = true;
          toggle.removeEventListener("click", toggleClicked);
          view.dom.removeEventListener("semlo-editor:editable", editableChanged);
          detailRevealers.delete(dom);
        },
      };
    };
  },
});
