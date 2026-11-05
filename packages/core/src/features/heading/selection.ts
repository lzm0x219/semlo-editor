import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

export type HeadingStyleLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Classify all text blocks touched by the selection. Menu value and toolbar
 * availability differ for a selection spanning multiple heading levels.
 */
export function getHeadingSelection(state: EditorState): {
  level: HeadingStyleLevel | null;
  headingsOnly: boolean;
  headingLevels: HeadingStyleLevel[];
} {
  let level: HeadingStyleLevel | null | undefined;
  let textblocks = 0;
  let headings = 0;
  let otherTextblock = false;
  const headingLevels = new Set<HeadingStyleLevel>();

  const visit = (node: ProseMirrorNode) => {
    if (!node.isTextblock) return;
    textblocks += 1;
    let next: HeadingStyleLevel | null;
    if (node.type.name === "heading") {
      headings += 1;
      const value = node.attrs.level;
      next = Number.isInteger(value) && value >= 1 && value <= 6 ? (value as HeadingStyleLevel) : null;
      headingLevels.add(next ?? 0);
    } else if (node.type.name === "paragraph") {
      next = 0;
    } else {
      otherTextblock = true;
      return;
    }
    if (level === undefined) level = next;
    else if (level !== next) level = null;
  };

  for (const range of state.selection.ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    if (from === to) visit(range.$from.parent);
    else
      state.doc.nodesBetween(from, to, (node) => {
        if (!node.isTextblock) return true;
        visit(node);
        return false;
      });
  }

  return {
    level: otherTextblock && headings ? null : level === undefined ? 0 : level,
    headingsOnly: textblocks > 0 && headings === textblocks,
    headingLevels: [...headingLevels],
  };
}
