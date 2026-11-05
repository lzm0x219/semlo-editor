import { getIndentation, IndentContext, indentString } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** Incrementally collect the same changes as CodeMirror's full-document indentRange. */
export function createCodeIndentWork(state: EditorState, plainIndentToZero = false) {
  const updated = new Map<number, number>();
  const context = new IndentContext(state, { overrideIndentation: (start) => updated.get(start) ?? -1 });
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let pos = 0;

  return {
    step(deadline: number, now: () => number): boolean {
      // Each line's parser calculation is indivisible; check the deadline
      // between lines and keep the same context across every batch.
      do {
        const line = state.doc.lineAt(pos);
        pos = line.to + 1;
        let indent = getIndentation(context, line.from);
        if (indent === null && plainIndentToZero) indent = 0;
        if (indent !== null) {
          if (!/\S/.test(line.text)) indent = 0;
          const current = /^\s*/.exec(line.text)![0];
          const normalized = indentString(state, indent);
          if (current !== normalized) {
            updated.set(line.from, indent);
            changes.push({ from: line.from, to: line.from + current.length, insert: normalized });
          }
        }
      } while (pos <= state.doc.length && now() < deadline);
      return pos > state.doc.length;
    },
    finish() {
      if (pos <= state.doc.length) throw new Error("Code indentation is incomplete");
      return state.changes(changes);
    },
  };
}
