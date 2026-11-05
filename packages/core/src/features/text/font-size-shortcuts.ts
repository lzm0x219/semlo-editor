import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { MarkType } from "@tiptap/pm/model";
import { Plugin, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { dispatchFormattingWithHistory } from "../../runtime/format-history";
import { getHeadingSelection } from "../heading/selection";

const fontSizes = [12, 13, 14, 15, 16, 19, 22, 24, 29, 32, 40, 48] as const;
const defaultSize = 15;

function fontSize(value: unknown): number {
  if (typeof value !== "string") return defaultSize;
  const match = /^\s*(\d+(?:\.\d+)?)px\s*$/i.exec(value);
  const size = match ? Number(match[1]) : NaN;
  return Number.isFinite(size) && size > 0 ? size : defaultSize;
}

function nextSize(current: number, direction: 1 | -1): number | undefined {
  return direction > 0
    ? fontSizes.find((size) => size > current)
    : [...fontSizes].reverse().find((size) => size < current);
}

type FontSizeRun = { from: number; to: number; attrs: Record<string, unknown> };

function selectedFontRuns(state: EditorState, textStyle: MarkType): { runs: FontSizeRun[]; hasHeading: boolean } {
  const runs: FontSizeRun[] = [];
  let hasHeading = false;
  const ranges = [...state.selection.ranges].sort((a, b) => a.$from.pos - b.$from.pos);
  for (const range of ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos, parent) => {
      if (node.type.name === "heading") {
        hasHeading = true;
        return false;
      }
      if (!node.isText || !parent?.type.allowsMarkType(textStyle)) return;
      const from = Math.max(pos, range.$from.pos),
        to = Math.min(pos + node.nodeSize, range.$to.pos);
      if (from < to) runs.push({ from, to, attrs: textStyle.isInSet(node.marks)?.attrs ?? {} });
    });
  }
  return { runs, hasHeading };
}

function applyFontSizeRuns(editor: Editor, runs: FontSizeRun[], textStyle: MarkType, value: string) {
  const { state } = editor;
  const tr = closeHistory(state.tr);
  for (const run of runs) {
    if (run.attrs.fontSize !== value) tr.addMark(run.from, run.to, textStyle.create({ ...run.attrs, fontSize: value }));
  }
  if (tr.docChanged) dispatchFormattingWithHistory(editor, tr);
}

/** Handle a font-menu change in a mixed heading selection, leaving headings untouched. */
export function setFontSizeOutsideHeadings(editor: Editor, value: string): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const { state } = editor;
  if (getHeadingSelection(state).headingsOnly) return true;
  const textStyle = state.schema.marks.textStyle;
  if (state.selection.empty || !textStyle) return false;
  const { runs, hasHeading } = selectedFontRuns(state, textStyle);
  if (!hasHeading) return false;
  applyFontSizeRuns(editor, runs, textStyle, value);
  return true;
}

/** Change only font size; preserve each text run's other marks and attributes. */
function changeFontSize(editor: Editor, direction: 1 | -1): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const { state, view } = editor,
    textStyle = state.schema.marks.textStyle;
  if (getHeadingSelection(state).headingsOnly) return true;
  if (!textStyle) return false;
  const { selection } = state;
  if (selection.empty) {
    if (!(selection instanceof TextSelection) || !selection.$from.parent.type.allowsMarkType(textStyle)) return false;
    const current = textStyle.isInSet(state.storedMarks ?? selection.$from.marks());
    const size = nextSize(fontSize(current?.attrs.fontSize), direction);
    if (size === undefined) return true;
    view.dispatch(
      closeHistory(state.tr)
        .addStoredMark(textStyle.create({ ...current?.attrs, fontSize: `${size}px` }))
        .setMeta("addToHistory", false),
    );
    return true;
  }

  const { runs } = selectedFontRuns(state, textStyle);
  if (!runs.length) return false;
  const size = nextSize(fontSize(runs[0].attrs.fontSize), direction);
  if (size === undefined) return true;
  applyFontSizeRuns(editor, runs, textStyle, `${size}px`);
  return true;
}

function directionForKey(event: KeyboardEvent, view: EditorView): 1 | -1 | null {
  const navigator = view.dom.ownerDocument.defaultView?.navigator;
  const mac = /Mac|iPhone|iPad|iPod/i.test(navigator?.platform ?? "");
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    view.composing ||
    event.defaultPrevented ||
    (!mac && event.getModifierState("AltGraph")) ||
    !event.altKey ||
    (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)
  )
    return null;
  if (event.code === "Equal" || event.code === "NumpadAdd" || event.key === "+" || event.key === "=") return 1;
  if ((event.code === "Minus" && !event.shiftKey) || event.code === "NumpadSubtract" || event.key === "-") return -1;
  return null;
}

/** Install with the editor's regular TextStyle and FontSize extensions. */
export const FontSizeShortcuts = Extension.create({
  name: "semloEditorFontSizeShortcuts",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            const direction = directionForKey(event, view);
            if (direction === null) return false;
            try {
              return changeFontSize(editor, direction);
            } catch (error) {
              event.preventDefault();
              throw error;
            }
          },
        },
      }),
    ];
  },
});
