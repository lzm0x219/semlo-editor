import type { Transaction } from "@tiptap/pm/state";

const removedMarks = ["bold", "italic", "underline", "strike", "superscript", "subscript"];

function withoutFontSize(attrs: Record<string, unknown>): Record<string, unknown> | null {
  const remaining = { ...attrs, fontSize: null };
  return Object.entries(remaining).some(([key, value]) => key !== "fontSize" && value !== null && value !== undefined)
    ? remaining
    : null;
}

/** 标题转换清除字形和字号，保留颜色、链接及其他标记。 */
export function clearHeadingInlineFormat(tr: Transaction, ranges: Iterable<readonly [number, number]>): void {
  const blocks = [...ranges];
  for (const [from, to] of blocks) {
    for (const name of removedMarks) {
      const mark = tr.doc.type.schema.marks[name];
      if (mark) tr.removeMark(from, to, mark);
    }
  }
  const textStyle = tr.doc.type.schema.marks.textStyle;
  if (textStyle) {
    const runs: Array<{ from: number; to: number; attrs: Record<string, unknown> | null }> = [];
    for (const [from, to] of blocks) {
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline) return;
        const style = textStyle.isInSet(node.marks);
        if (style?.attrs.fontSize === null || style?.attrs.fontSize === undefined) return;
        runs.push({
          from: Math.max(from, pos),
          to: Math.min(to, pos + node.nodeSize),
          attrs: withoutFontSize(style.attrs),
        });
      });
    }
    for (const run of runs) {
      if (run.attrs) tr.addMark(run.from, run.to, textStyle.create(run.attrs));
      else tr.removeMark(run.from, run.to, textStyle);
    }
    const stored = tr.storedMarks && textStyle.isInSet(tr.storedMarks);
    if (tr.selection.empty && stored && stored.attrs.fontSize !== null && stored.attrs.fontSize !== undefined) {
      const attrs = withoutFontSize(stored.attrs);
      tr.removeStoredMark(textStyle);
      if (attrs) tr.addStoredMark(textStyle.create(attrs));
    }
  }
  if (tr.selection.empty && tr.storedMarks) {
    for (const name of removedMarks) {
      const mark = tr.doc.type.schema.marks[name];
      if (mark) tr.removeStoredMark(mark);
    }
  }
}
