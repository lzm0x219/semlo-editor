import { deleteGroupBackward, deleteGroupForward } from "@codemirror/commands";
import { php } from "@codemirror/lang-php";
import { Mapping } from "@tiptap/pm/transform";

export interface CodeFoldRange {
  from: number;
  to: number;
}
export interface VisibleCodeLine {
  number: number;
  from: number;
  to: number;
}

/** Fold offsets use UTF-16 code units, as do ProseMirror and CodeMirror. */
export function normalizeFolds(value: unknown, length: number): CodeFoldRange[] {
  if (!Array.isArray(value)) return [];
  const ranges: CodeFoldRange[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { from, to } = item as Record<string, unknown>;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) continue;
    if ((from as number) < 0 || (to as number) > length || (from as number) >= (to as number)) continue;
    ranges.push({ from: from as number, to: to as number });
  }
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);
  const accepted: CodeFoldRange[] = [];
  const stack: CodeFoldRange[] = [];
  for (const range of ranges) {
    while (stack.length && range.from >= stack[stack.length - 1].to) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent && (range.from === parent.from || range.to > parent.to)) continue;
    accepted.push(range);
    stack.push(range);
  }
  return accepted;
}

/** Map saved folds through edits elsewhere in the same code block. */
export function mapFolds(
  ranges: CodeFoldRange[],
  mapping: Mapping,
  oldStart: number,
  newStart: number,
  newLength: number,
): CodeFoldRange[] {
  return normalizeFolds(
    ranges.flatMap(({ from, to }) => {
      const mappedFrom = mapping.mapResult(oldStart + from, 1);
      const mappedTo = mapping.mapResult(oldStart + to, -1);
      if (mappedFrom.deletedAcross || mappedTo.deletedAcross) return [];
      return [{ from: mappedFrom.pos - newStart, to: mappedTo.pos - newStart }];
    }),
    newLength,
  );
}

/** Logical lines hidden by folds are removed from the visible gutter. */
export function visibleCodeLines(text: string, ranges: CodeFoldRange[]): VisibleCodeLine[] {
  const normalized = normalizeFolds(ranges, text.length);
  const folds: CodeFoldRange[] = [];
  for (const fold of normalized) if (!folds.length || fold.from >= folds[folds.length - 1].to) folds.push(fold);
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const visible: VisibleCodeLine[] = [];
  let foldIndex = 0;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    while (foldIndex < folds.length && folds[foldIndex].to < start) foldIndex++;
    if (foldIndex < folds.length && start > folds[foldIndex].from && start <= folds[foldIndex].to) continue;
    let endIndex = i;
    let active = foldIndex;
    while (active < folds.length && (endIndex + 1 === starts.length || folds[active].from < starts[endIndex + 1])) {
      const fold = folds[active++];
      while (endIndex + 1 < starts.length && starts[endIndex + 1] <= fold.to) endIndex++;
    }
    visible.push({
      number: i + 1,
      from: start,
      to: endIndex + 1 < starts.length ? starts[endIndex + 1] - 1 : text.length,
    });
  }
  return visible;
}

import { ensureSyntaxTree, foldable, language } from "@codemirror/language";
import { EditorSelection, EditorState, findClusterBreak } from "@codemirror/state";

import { codeIndentLanguage } from "./indent-language";
import { normalizeCodeLanguage } from "./language-aliases";

// These language modes do not expose folding metadata; the related parsers
// provide matching brace folds without changing the stored language.
const plainPHPFoldingLanguage = php({ plain: true });

function foldingLanguage(name: string | null, text: string) {
  const normalized = name ? normalizeCodeLanguage(name) : null;
  // Yuque does not offer SQL folds for multiline parenthesized queries.
  if (normalized === "sql") return [];
  if (normalized === "php") {
    // Yuque shows no fold control in the observed examples beginning with a PHP tag.
    return /^[ \t\r\n]*<\?(?:php|=)/i.test(text) ? [] : plainPHPFoldingLanguage;
  }
  if (normalized === "csharp") return codeIndentLanguage("cpp");
  if (normalized === "graphql") return codeIndentLanguage("javascript");
  return codeIndentLanguage(name);
}

export interface CodeFoldable {
  line: number;
  from: number;
  to: number;
}
/** Returns null if the parser has not completed within the caller's budget. */
export function findCodeFoldables(text: string, name: string | null, timeout = 50): CodeFoldable[] | null {
  let state = EditorState.create({ doc: text, extensions: [foldingLanguage(name, text)] });
  if (!state.facet(language)) return [];
  if (!ensureSyntaxTree(state, state.doc.length, timeout)) return null;
  state = state.update({}).state;
  const ranges: CodeFoldable[] = [];
  for (let index = 1; index <= state.doc.lines; index++) {
    const line = state.doc.line(index);
    const range = foldable(state, line.from, line.to);
    if (range && text.indexOf("\n", range.from) < range.to && text.indexOf("\n", range.from) !== -1)
      ranges.push({ line: index, ...range });
  }
  return ranges;
}

/** Parse and enumerate foldable lines in bounded slices; cancelling never publishes stale results. */
export function scanCodeFoldables(
  text: string,
  name: string | null,
  win: Window,
  done: (folds: CodeFoldable[]) => void,
): () => void {
  let state = EditorState.create({ doc: text, extensions: [foldingLanguage(name, text)] });
  let timer = 0,
    cancelled = false,
    line = 1,
    parsed = false;
  const deadline = win.performance.now() + 15000;
  const folds: CodeFoldable[] = [];
  const step = () => {
    if (cancelled) return;
    if (!state.facet(language)) {
      done([]);
      return;
    }
    if (!parsed) {
      if (!ensureSyntaxTree(state, state.doc.length, 5)) {
        if (win.performance.now() >= deadline) {
          done([]);
          return;
        }
        timer = win.setTimeout(step, 0);
        return;
      }
      state = state.update({}).state;
      parsed = true;
    }
    const started = win.performance.now();
    while (line <= state.doc.lines) {
      const current = state.doc.line(line),
        range = foldable(state, current.from, current.to);
      if (range && text.indexOf("\n", range.from) < range.to && text.indexOf("\n", range.from) !== -1)
        folds.push({ line, ...range });
      line++;
      if (win.performance.now() - started >= 5) break;
    }
    if (line <= state.doc.lines) timer = win.setTimeout(step, 0);
    else if (!cancelled) done(folds);
  };
  timer = win.setTimeout(step, 0);
  return () => {
    cancelled = true;
    if (timer) win.clearTimeout(timer);
  };
}

import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export const foldPluginKey = new PluginKey<Map<number, CodeFoldRange[]>>("semloEditorCodeFolds");

export function readCodeFolds(view: EditorView, pos: number, node: import("@tiptap/pm/model").Node): CodeFoldRange[] {
  return foldPluginKey.getState(view.state)?.get(pos) ?? normalizeFolds(node.attrs.folds, node.content.size);
}

function equalFolds(a: CodeFoldRange[], b: CodeFoldRange[]) {
  return a.length === b.length && a.every((fold, index) => fold.from === b[index].from && fold.to === b[index].to);
}

export function toggleCodeFold(view: EditorView, pos: number, target: CodeFoldRange) {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "codeBlock") return;
  const folds = readCodeFolds(view, pos, node);
  const present = folds.some((fold) => fold.from === target.from && fold.to === target.to);
  const next = present
    ? folds.filter((fold) => fold.from !== target.from || fold.to !== target.to)
    : normalizeFolds([...folds, target], node.content.size);
  if (equalFolds(folds, next)) return;
  let transaction = view.editable
    ? view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, folds: next })
    : view.state.tr.setMeta(foldPluginKey, { set: [[pos, next]] });
  transaction = transaction.setMeta("addToHistory", false);
  const { from, to } = view.state.selection;
  if (!present && from < pos + 1 + target.to && to > pos + 1 + target.from)
    transaction = transaction.setSelection(TextSelection.create(transaction.doc, pos + 1 + target.from));
  view.dispatch(transaction);
}

export function createCodeFoldingPlugin(editor: import("@tiptap/core").Editor) {
  return new Plugin({
    key: foldPluginKey,
    state: {
      init: () => new Map<number, CodeFoldRange[]>(),
      apply(tr, previous) {
        const action = tr.getMeta(foldPluginKey) as
          | { clear?: boolean; set?: Array<[number, CodeFoldRange[]]> }
          | undefined;
        if (action?.clear || tr.docChanged) return action?.set ? new Map(action.set) : new Map();
        if (!action?.set) return previous;
        const next = new Map(previous);
        for (const [pos, folds] of action.set) next.set(pos, folds);
        return next;
      },
    },
    view(view) {
      const editableChanged = () =>
        view.dispatch(view.state.tr.setMeta(foldPluginKey, { clear: true }).setMeta("addToHistory", false));
      view.dom.addEventListener("semlo-editor:editable", editableChanged);
      return {
        update(view, previous) {
          if (foldPluginKey.getState(previous) === foldPluginKey.getState(view.state)) return;
          const EventType = view.dom.ownerDocument.defaultView?.Event;
          if (EventType) view.dom.dispatchEvent(new EventType("semlo-editor:code-folds"));
        },
        destroy() {
          view.dom.removeEventListener("semlo-editor:editable", editableChanged);
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        if (
          (event.key !== "Backspace" && event.key !== "Delete") ||
          (event.altKey && event.ctrlKey) ||
          event.metaKey ||
          (event.shiftKey && event.key === "Delete" && (event.altKey || event.ctrlKey)) ||
          !view.editable ||
          view.composing
        )
          return false;
        const selection = view.state.selection;
        if (!selection.empty || !(selection instanceof TextSelection)) return false;
        const parent = selection.$from.parent;
        if (parent.type.name !== "codeBlock") return false;
        const blockPos = selection.$from.before();
        const offset = selection.from - blockPos - 1;
        const backward = event.key === "Backspace";
        const deleteLine = event.shiftKey && event.key === "Delete";
        const fold = readCodeFolds(view, blockPos, parent).find((item) =>
          backward ? item.to === offset : item.from === offset || (deleteLine && item.to === offset),
        );
        if (!fold) return false;
        let from = offset;
        let to = offset;
        if (deleteLine) {
          const text = parent.textContent;
          from = text.lastIndexOf("\n", offset - 1) + 1;
          to = text.indexOf("\n", offset);
          if (to < 0) to = text.length;
          // 折叠末端紧邻的换行属于隐藏内容，删除可见末行时保留它。
          if (from > 0 && fold.to !== offset) from--;
          else if (to < text.length) to++;
        } else if (event.altKey || event.ctrlKey) {
          const state = EditorState.create({ doc: parent.textContent, selection: EditorSelection.cursor(offset) });
          const command = backward ? deleteGroupBackward : deleteGroupForward;
          command({
            state,
            dispatch: (transaction) => {
              transaction.changes.iterChanges((changeFrom, changeTo) => {
                from = changeFrom;
                to = changeTo;
              });
            },
          });
        } else {
          const adjacent = findClusterBreak(parent.textContent, offset, !backward);
          from = backward ? Math.max(fold.from, adjacent) : offset;
          to = backward ? offset : Math.min(fold.to, adjacent);
        }
        if (from >= to) return false;
        const transaction = view.state.tr.delete(blockPos + 1 + from, blockPos + 1 + to);
        if (deleteLine) {
          const updated = transaction.doc.nodeAt(blockPos);
          if (updated?.type === parent.type) {
            const folds = normalizeFolds(
              readCodeFolds(view, blockPos, parent).map((range) => ({
                from: transaction.mapping.map(blockPos + 1 + range.from, 1) - blockPos - 1,
                to: transaction.mapping.map(blockPos + 1 + range.to, -1) - blockPos - 1,
              })),
              updated.content.size,
            );
            transaction.setNodeMarkup(blockPos, undefined, { ...updated.attrs, folds });
          }
        }
        view.dispatch(transaction.scrollIntoView());
        return true;
      },
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "codeBlock") return;
          const all = foldPluginKey.getState(state)?.get(pos) ?? normalizeFolds(node.attrs.folds, node.content.size);
          const visible: CodeFoldRange[] = [];
          for (const fold of all)
            if (!visible.length || fold.from >= visible[visible.length - 1].to) visible.push(fold);
          for (const fold of visible) {
            decorations.push(
              Decoration.inline(pos + 1 + fold.from, pos + 1 + fold.to, { class: "semlo-editor-code-fold-hidden" }),
            );
            decorations.push(
              Decoration.widget(
                pos + 1 + fold.from,
                (view, getPos) => {
                  const el = view.dom.ownerDocument.createElement("button");
                  el.type = "button";
                  el.className = "semlo-editor-code-fold-placeholder";
                  el.textContent = "…";
                  el.setAttribute("aria-label", "展开折叠代码");
                  el.addEventListener("mousedown", (event) => event.preventDefault());
                  el.addEventListener("click", () => {
                    const at = getPos();
                    if (typeof at !== "number") return;
                    const $at = view.state.doc.resolve(at);
                    if ($at.parent.type.name !== "codeBlock") return;
                    const blockPos = $at.before(),
                      from = at - blockPos - 1;
                    const match = readCodeFolds(view, blockPos, $at.parent).find((item) => item.from === from);
                    if (match) {
                      toggleCodeFold(view, blockPos, match);
                      view.focus();
                    }
                  });
                  return el;
                },
                { side: -1, key: `fold-${fold.from}-${fold.to}` },
              ),
            );
          }
          return false;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
    appendTransaction(transactions, oldState, newState) {
      if (
        !editor.isEditable ||
        !transactions.some((tr) => tr.docChanged || tr.selectionSet) ||
        transactions.some((tr) => tr.getMeta(foldPluginKey))
      )
        return null;
      const mapping = new Mapping();
      for (const tr of transactions) mapping.appendMapping(tr.mapping);
      let out = newState.tr;
      oldState.doc.descendants((node, pos) => {
        if (node.type.name !== "codeBlock") return;
        const old = normalizeFolds(node.attrs.folds, node.content.size);
        if (!old.length) return false;
        const mapped = mapping.mapResult(pos, 1);
        if (mapped.deleted) return false;
        const next = newState.doc.nodeAt(mapped.pos);
        if (!next || next.type !== node.type) return false;
        const attrs = normalizeFolds(next.attrs.folds, next.content.size);
        // A direct fold toggle is already authoritative.
        if (JSON.stringify(node.attrs.folds) !== JSON.stringify(next.attrs.folds)) return false;
        let adjusted =
          node.textContent === next.textContent
            ? attrs
            : mapFolds(old, mapping, pos + 1, mapped.pos + 1, next.content.size);
        if (transactions.some((tr) => tr.selectionSet)) {
          const selection = newState.selection;
          adjusted = adjusted.filter(
            (fold) => !(selection.from < mapped.pos + 1 + fold.to && selection.to > mapped.pos + 1 + fold.from),
          );
        }
        if (JSON.stringify(next.attrs.folds) !== JSON.stringify(adjusted))
          out = out.setNodeMarkup(mapped.pos, undefined, { ...next.attrs, folds: adjusted });
        return false;
      });
      if (!out.docChanged) return null;
      out.setMeta(foldPluginKey, true);
      if (
        !transactions.some((tr) => tr.docChanged) ||
        transactions.every((tr) => !tr.docChanged || tr.getMeta("addToHistory") === false)
      )
        out.setMeta("addToHistory", false);
      return out;
    },
  });
}
