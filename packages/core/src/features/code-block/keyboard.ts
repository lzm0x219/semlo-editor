import { insertNewlineAndIndent } from "@codemirror/commands";
import { deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, indentUnit, language, StreamLanguage } from "@codemirror/language";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import {
  countColumn,
  EditorSelection,
  EditorState,
  type ChangeSet,
  type SelectionRange,
  type Transaction,
} from "@codemirror/state";
import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Mark, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { showCodeFeedback, showCodeProgress } from "./feedback";
import { codeIndentLanguage } from "./indent-language";
import { CodeIndentStep } from "./indent-step";
import { createCodeIndentWork } from "./indent-work";
import { normalizeCodeLanguage } from "./language-aliases";
import { legacyPHPIndentation } from "./php-indent";
import { readCodeSettings } from "./settings";

const sqlFormattingLanguage = StreamLanguage.define(standardSQL);
const codeDeleteGroupMeta = "semlo-editor-code-block-delete-group";

/** Make an ephemeral CodeMirror state for its language-aware indentation rules. */
function codeState(
  view: EditorView,
  pos: number,
  options: Pick<CodeIndentOptions, "indentWidth" | "sqlStream" | "phpFormatting"> & {
    plainText?: boolean;
  } = {},
): { state: EditorState; hasCodeSelection: boolean } | null {
  const { selection, doc } = view.state;
  const node = doc.nodeAt(pos);
  if (!node || node.type.name !== "codeBlock") return null;
  const start = pos + 1;
  const end = start + node.content.size;
  const hasCodeSelection =
    selection instanceof TextSelection &&
    selection.$from.sameParent(selection.$to) &&
    selection.from >= start &&
    selection.to <= end;
  const { indentMode, indentWidth: configuredWidth } = readCodeSettings(node.attrs);
  const indentWidth = options.indentWidth ?? configuredWidth;
  const state = EditorState.create({
    doc: node.textContent,
    selection: hasCodeSelection ? EditorSelection.single(selection.anchor - start, selection.head - start) : undefined,
    extensions: [
      options.plainText
        ? []
        : options.phpFormatting
          ? legacyPHPIndentation
          : options.sqlStream
            ? sqlFormattingLanguage
            : codeIndentLanguage(typeof node.attrs.language === "string" ? node.attrs.language : null),
      indentUnit.of(indentMode === "tab" ? "\t" : " ".repeat(indentWidth)),
      EditorState.tabSize.of(indentWidth),
    ],
  });
  return { state, hasCodeSelection };
}

/** Publish the parser's latest tree into the headless state before using it. */
function parsedState(state: EditorState, upto: number, timeout: number): EditorState | null {
  if (!state.facet(language)) return state;
  if (!ensureSyntaxTree(state, upto, timeout)) return null;
  return state.update({}).state;
}

/** Apply only changed ranges so untouched code and its marks remain intact. */
function applyCodeChanges(
  view: EditorView,
  pos: number,
  changes: ChangeSet,
  selection?: SelectionRange,
  groupDeletion = false,
): void {
  if (changes.empty) return;
  const edits: Array<{ from: number; to: number; text: string }> = [];
  changes.iterChanges((from, to, _newFrom, _newTo, text) => edits.push({ from, to, text: text.toString() }));
  const start = pos + 1;
  let tr = groupDeletion ? view.state.tr.setMeta(codeDeleteGroupMeta, true) : closeHistory(view.state.tr);
  for (const edit of edits.reverse()) tr = tr.insertText(edit.text, start + edit.from, start + edit.to);
  if (selection) tr.setSelection(TextSelection.create(tr.doc, start + selection.anchor, start + selection.head));
  view.dispatch(tr.scrollIntoView());
  // Keep the entire indentation operation separate from subsequent typing.
  if (!groupDeletion) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
}

export type CodeIndentResult = "success" | "cancelled" | "failed";

interface CodeIndentOptions {
  /** Override formatting width without altering the stored editor preference. */
  indentWidth?: 2 | 4 | 8;
  plainIndentToZero?: boolean;
  sqlStream?: boolean;
  phpFormatting?: boolean;
  /** Internal injection points for deterministic parser timeout tests. */
  ensureTree?: typeof ensureSyntaxTree;
  now?: () => number;
  parseTimeoutMs?: number;
}

const indentationJobs = new WeakMap<EditorView, { cancel: () => void; committing: boolean }>();
const latestIndentByView = new WeakMap<EditorView, Promise<CodeIndentResult>>();
const latestIndentByDocument = new WeakMap<Document, Promise<CodeIndentResult>>();
const indentationSliceMs = 6;
const parseSliceMs = 3;
const asyncCodeSize = 2048;
const maxParseMs = 30_000;

/** Whether this editor currently has scheduled indentation work. */
export function isAutoIndentPending(view: EditorView): boolean {
  return indentationJobs.has(view);
}

/** Prevent an older completion from replacing a newer editor's feedback. */
export function isCurrentAutoIndent(view: EditorView, task: Promise<CodeIndentResult>): boolean {
  return (
    !view.isDestroyed &&
    latestIndentByView.get(view) === task &&
    latestIndentByDocument.get(view.dom.ownerDocument) === task
  );
}

/** Cancel an editor's pending indentation, including its scheduled callback. */
export function cancelAutoIndentCodeBlock(view: EditorView) {
  indentationJobs.get(view)?.cancel();
}

function releaseAutoIndent(view: EditorView) {
  cancelAutoIndentCodeBlock(view);
  const task = latestIndentByView.get(view);
  if (task && latestIndentByDocument.get(view.dom.ownerDocument) === task)
    latestIndentByDocument.delete(view.dom.ownerDocument);
  latestIndentByView.delete(view);
}

/** Reindent one block without blocking input or applying stale work. */
export function autoIndentCodeBlock(
  view: EditorView,
  pos: number,
  options: CodeIndentOptions = {},
): Promise<CodeIndentResult> {
  cancelAutoIndentCodeBlock(view);
  const win = view.dom.ownerDocument.defaultView;
  const node = view.state.doc.nodeAt(pos);
  if (!win || view.isDestroyed || !view.editable || view.composing || !node || node.type.name !== "codeBlock") {
    const failed = Promise.resolve<CodeIndentResult>("failed");
    latestIndentByView.set(view, failed);
    latestIndentByDocument.set(view.dom.ownerDocument, failed);
    return failed;
  }

  const doc = view.dom.ownerDocument;
  const nodeLanguage = typeof node.attrs.language === "string" ? normalizeCodeLanguage(node.attrs.language) : null;
  const initialDoc = view.state.doc;
  const initialSelection = view.state.selection;
  const initialStoredMarks = view.state.storedMarks;
  const initialActiveElement = doc.activeElement;
  const documentHadFocus = doc.hasFocus();

  const task = new Promise<CodeIndentResult>((resolve) => {
    let done = false;
    let timer: number | undefined;
    let stage: "create" | "parse" | "indent" | "assemble" = "create";
    let state: EditorState;
    let hasCodeSelection = false;
    let work: ReturnType<typeof createCodeIndentWork>;
    let changes: ChangeSet;
    let edits: Array<{ from: number; to: number; text: string }> = [];
    const stepEdits: Array<{ from: number; to: number; slice: Slice }> = [];
    let editIndex = 0;
    let segments: Array<{ from: number; to: number; text: string; marks: readonly Mark[] }> = [];
    let segmentIndex = 0;
    let cursor = 0;
    const runs: Array<{ marks: readonly Mark[]; parts: string[] }> = [];
    const now = options.now ?? (() => win.performance.now());
    const ensureTree = options.ensureTree ?? ensureSyntaxTree;
    const parseTimeout = options.parseTimeoutMs ?? maxParseMs;
    let parseStarted = 0;
    const job = { cancel: () => finish("cancelled"), committing: false };
    const finish = (result: CodeIndentResult) => {
      if (done) return;
      done = true;
      if (timer !== undefined) win.clearTimeout(timer);
      doc.removeEventListener("focusin", onFocusIn, true);
      doc.removeEventListener("focusout", onFocusOut, true);
      win.removeEventListener("blur", onWindowBlur);
      if (indentationJobs.get(view) === job) indentationJobs.delete(view);
      resolve(result);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!job.committing && event.target !== initialActiveElement) finish("cancelled");
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!job.committing && event.target === initialActiveElement) finish("cancelled");
    };
    const onWindowBlur = () => {
      if (!job.committing && documentHadFocus) finish("cancelled");
    };
    const valid = () =>
      indentationJobs.get(view) === job &&
      !view.isDestroyed &&
      view.editable &&
      !view.composing &&
      view.state.doc === initialDoc &&
      view.state.selection.eq(initialSelection) &&
      (view.state.storedMarks === initialStoredMarks ||
        (view.state.storedMarks !== null &&
          initialStoredMarks !== null &&
          Mark.sameSet(view.state.storedMarks, initialStoredMarks))) &&
      doc.activeElement === initialActiveElement &&
      (!documentHadFocus || doc.hasFocus());
    const schedule = () => {
      timer = win.setTimeout(run, 0);
    };
    const append = (text: string, marks: readonly Mark[]) => {
      if (!text) return;
      const last = runs[runs.length - 1];
      if (last && Mark.sameSet(last.marks, marks)) last.parts.push(text);
      else runs.push({ marks, parts: [text] });
    };
    const appendOriginal = (to: number) => {
      while (cursor < to) {
        const segment = segments[segmentIndex];
        if (!segment || cursor < segment.from) throw new Error("Invalid code text");
        const end = Math.min(to, segment.to);
        append(segment.text.slice(cursor - segment.from, end - segment.from), segment.marks);
        cursor = end;
        if (cursor === segment.to) segmentIndex += 1;
      }
    };
    const run = () => {
      timer = undefined;
      if (!valid()) return finish("cancelled");
      const deadline = now() + indentationSliceMs;
      try {
        while (now() < deadline) {
          if (stage === "create") {
            const isPHP = nodeLanguage === "php";
            const code = codeState(view, pos, {
              ...options,
              sqlStream: options.sqlStream ?? nodeLanguage === "sql",
              phpFormatting: options.phpFormatting ?? isPHP,
            });
            if (!code) return finish("failed");
            state = code.state;
            hasCodeSelection = code.hasCodeSelection;
            parseStarted = now();
            stage = "parse";
          } else if (stage === "parse") {
            if (state.facet(language) && !ensureTree(state, state.doc.length, parseSliceMs)) {
              if (now() - parseStarted >= parseTimeout) return finish("failed");
              schedule();
              return;
            }
            // An empty update publishes the parser's completed tree. No text
            // or selection changes are made to the ProseMirror editor here.
            if (state.facet(language)) state = state.update({}).state;
            work = createCodeIndentWork(state, options.plainIndentToZero ?? nodeLanguage === "graphql");
            stage = "indent";
          } else if (stage === "indent") {
            if (!work.step(deadline, now)) {
              schedule();
              return;
            }
            changes = work.finish();
            if (changes.empty) return finish("success");
            edits = [];
            changes.iterChanges((from, to, _newFrom, _newTo, text) => edits.push({ from, to, text: text.toString() }));
            segments = [];
            node.forEach((child, offset) => {
              if (!child.isText || !child.text) throw new Error("Invalid code content");
              segments.push({ from: offset, to: offset + child.nodeSize, text: child.text, marks: child.marks });
            });
            stage = "assemble";
          } else {
            while (editIndex < edits.length && now() < deadline) {
              const edit = edits[editIndex];
              appendOriginal(edit.from);
              let fragment = Fragment.empty;
              if (edit.text) {
                const $from = initialDoc.resolve(pos + 1 + edit.from);
                const marks =
                  editIndex === edits.length - 1 && initialStoredMarks
                    ? initialStoredMarks
                    : edit.from === edit.to
                      ? $from.marks()
                      : ($from.marksAcross(initialDoc.resolve(pos + 1 + edit.to)) ?? []);
                append(edit.text, marks);
                fragment = Fragment.from(initialDoc.type.schema.text(edit.text, marks));
              }
              stepEdits.push({ from: pos + 1 + edit.from, to: pos + 1 + edit.to, slice: new Slice(fragment, 0, 0) });
              cursor = edit.to;
              while (segments[segmentIndex] && segments[segmentIndex].to <= cursor) segmentIndex += 1;
              editIndex += 1;
            }
            if (editIndex < edits.length) {
              schedule();
              return;
            }
            appendOriginal(node.content.size);
            if (!valid()) return finish("cancelled");
            const nodes: ProseMirrorNode[] = runs.map((run) =>
              initialDoc.type.schema.text(run.parts.join(""), run.marks),
            );
            const after = initialDoc.replace(
              pos + 1,
              pos + 1 + node.content.size,
              new Slice(Fragment.fromArray(nodes), 0, 0),
            );
            const tr = closeHistory(view.state.tr).step(new CodeIndentStep(stepEdits, { before: initialDoc, after }));
            if (hasCodeSelection) {
              const mapped = state.selection.map(changes).main;
              tr.setSelection(TextSelection.create(tr.doc, pos + 1 + mapped.anchor, pos + 1 + mapped.head));
            } else if (initialSelection instanceof TextSelection) {
              const start = pos + 1;
              const end = start + node.content.size;
              const map = (value: number) =>
                value < start
                  ? value
                  : value > end
                    ? value + changes.newLength - changes.length
                    : start + changes.mapPos(value - start, 1);
              tr.setSelection(TextSelection.create(tr.doc, map(initialSelection.anchor), map(initialSelection.head)));
            }
            job.committing = true;
            view.dispatch(tr.scrollIntoView());
            job.committing = false;
            if (view.isDestroyed) return finish("cancelled");
            view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
            return finish("success");
          }
        }
        schedule();
      } catch {
        finish("failed");
      }
    };

    indentationJobs.set(view, job);
    doc.addEventListener("focusin", onFocusIn, true);
    doc.addEventListener("focusout", onFocusOut, true);
    win.addEventListener("blur", onWindowBlur);
    if (node.content.size > asyncCodeSize) schedule();
    else run();
  });
  latestIndentByView.set(view, task);
  latestIndentByDocument.set(doc, task);
  return task;
}

/** Insert a newline using the same language-aware rules as the reference editor. */
function insertCodeNewline(view: EditorView): boolean {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.$from.sameParent(selection.$to)) return false;
  if (selection.$from.parent.type.name !== "codeBlock") return false;
  const pos = selection.$from.start() - 1;
  const code = codeState(view, pos);
  if (!code || !code.hasCodeSelection) return false;
  // If a very large block cannot be parsed promptly, preserve the keystroke and
  // existing line indentation with the plain-text rule instead of delaying it.
  const upto = code.state.doc.lineAt(code.state.selection.main.to).to;
  const state = parsedState(code.state, upto, 40) ?? codeState(view, pos, { plainText: true })?.state;
  if (!state) return false;
  const result: { transaction?: Transaction } = {};
  const target = {
    state,
    dispatch(transaction: Transaction) {
      result.transaction = transaction;
    },
  };
  // Match Markdown list and blockquote continuation before the general rule.
  const handled = insertNewlineContinueMarkup(target) || insertNewlineAndIndent(target);
  if (!handled || !result.transaction) return false;
  applyCodeChanges(view, pos, result.transaction.changes, result.transaction.newSelection.main);
  return true;
}

/** Delete Markdown list or quote markup at the cursor, leaving normal deletion to the editor. */
function deleteCodeMarkup(view: EditorView): boolean {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty || !selection.$from.sameParent(selection.$to))
    return false;
  const node = selection.$from.parent;
  if (node.type.name !== "codeBlock" || typeof node.attrs.language !== "string") return false;
  if (normalizeCodeLanguage(node.attrs.language) !== "markdown") return false;
  const pos = selection.$from.start() - 1;
  const code = codeState(view, pos);
  if (!code || !code.hasCodeSelection) return false;
  const upto = code.state.doc.lineAt(code.state.selection.main.to).to;
  const state = parsedState(code.state, upto, 40);
  if (!state) return false;
  const result: { transaction?: Transaction } = {};
  const handled = deleteMarkupBackward({
    state,
    dispatch(transaction) {
      result.transaction = transaction;
    },
  });
  if (!handled || !result.transaction) return false;
  applyCodeChanges(view, pos, result.transaction.changes, result.transaction.newSelection.main);
  return true;
}

/** Match the reference editor when indentation or a skin-tone modifier is deleted. */
function deleteCodeIndentOrModifier(view: EditorView): boolean {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty || !selection.$from.sameParent(selection.$to))
    return false;
  const node = selection.$from.parent;
  if (node.type.name !== "codeBlock") return false;
  const cursor = selection.$from.parentOffset;
  const prefixStart = Math.max(0, cursor - 200);
  const prefix = node.textBetween(prefixStart, cursor, "\n");
  const newline = prefix.lastIndexOf("\n");
  const before = prefix.slice(newline + 1);
  const lastCodePoint = before.codePointAt(before.length - 2);
  const isModifier = lastCodePoint !== undefined && lastCodePoint >= 0x1f3fb && lastCodePoint <= 0x1f3ff;
  const isIndent =
    (prefixStart === 0 || newline >= 0) &&
    before.length > 1 &&
    before.length < 200 &&
    /^[ \t]+$/.test(before) &&
    before.endsWith(" ");
  if (!isModifier && !isIndent) return false;
  const pos = selection.$from.start() - 1;
  const code = codeState(view, pos, { plainText: true });
  if (!code || !code.hasCodeSelection) return false;
  const state = code.state;
  let deleteFrom: number;
  if (isModifier) {
    deleteFrom = cursor - 2;
  } else {
    const { indentWidth } = readCodeSettings(node.attrs);
    const column = countColumn(before, indentWidth);
    const drop = column % indentWidth || indentWidth;
    let spaces = 0;
    while (spaces < drop && before[before.length - 1 - spaces] === " ") spaces++;
    // Keep ordinary one-character deletion on the browser's native history path.
    if (spaces <= 1) return false;
    deleteFrom = cursor - spaces;
  }
  const transaction = state.update({
    changes: { from: deleteFrom, to: cursor },
    selection: { anchor: deleteFrom },
  });
  applyCodeChanges(view, pos, transaction.changes, transaction.newSelection.main, true);
  return true;
}

/** Adjust the selected code lines without changing selections in other nodes. */
function indentCode(view: EditorView, outdent: boolean): boolean {
  const { state } = view;
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.$from.sameParent(selection.$to)) return false;
  const { $from, $to } = selection;
  if ($from.parent.type.name !== "codeBlock") return false;

  const base = $from.start();
  const text = $from.parent.textContent;
  const { indentMode, indentWidth: width } = readCodeSettings($from.parent.attrs);
  const indent = indentMode === "tab" ? "\t" : " ".repeat(width);
  const from = $from.parentOffset;
  const to = $to.parentOffset;
  const tr = closeHistory(state.tr);

  if (selection.empty && !outdent) {
    tr.insertText("\t", selection.from);
    tr.setSelection(TextSelection.create(tr.doc, selection.from + 1));
  } else {
    const firstLine = from > 0 ? text.lastIndexOf("\n", from - 1) + 1 : 0;
    // An end at the beginning of a line does not include that line.
    const lastCharacter = !selection.empty && to > from && text[to - 1] === "\n" ? to - 2 : to - 1;
    const lastLine = selection.empty || lastCharacter < 0 ? firstLine : text.lastIndexOf("\n", lastCharacter) + 1;
    const starts = [firstLine];
    for (let i = firstLine; i < lastLine; i += 1) if (text[i] === "\n") starts.push(i + 1);

    for (const lineStart of starts.reverse()) {
      if (!outdent) tr.insertText(indent, base + lineStart);
      else {
        const line = text.slice(lineStart);
        const remove = line.startsWith("\t") ? 1 : Math.min(line.match(/^ */)?.[0].length ?? 0, width);
        if (remove) tr.delete(base + lineStart, base + lineStart + remove);
      }
    }
    if (!tr.docChanged) return true;

    if (selection.empty) {
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(selection.from, 1)));
    } else {
      const mappedFrom = tr.mapping.map(selection.from, 1);
      const mappedTo = tr.mapping.map(selection.to, 1);
      const forward = selection.anchor <= selection.head;
      tr.setSelection(TextSelection.create(tr.doc, forward ? mappedFrom : mappedTo, forward ? mappedTo : mappedFrom));
    }
  }

  view.dispatch(tr.scrollIntoView());
  // A following typed character should not be folded into the indentation undo.
  view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
  return true;
}

export const CodeBlockKeyboard = Extension.create({
  name: "semloEditorCodeBlockKeyboard",
  priority: 1000,
  addProseMirrorPlugins() {
    let closeFeedback: (() => void) | undefined;
    let pluginView: EditorView | undefined;
    const key = new PluginKey<boolean>("semloEditorCodeBlockKeyboard");
    return [
      new Plugin({
        key,
        filterTransaction(transaction, state) {
          const grouped = key.getState(state) ?? false;
          const isGroupedDelete = transaction.getMeta(codeDeleteGroupMeta) === true;
          if (
            (!grouped && isGroupedDelete) ||
            (grouped &&
              !isGroupedDelete &&
              (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet))
          )
            closeHistory(transaction);
          return true;
        },
        state: {
          init: () => false,
          apply(transaction, value) {
            const job = pluginView && indentationJobs.get(pluginView);
            if (
              job &&
              !job.committing &&
              (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet)
            )
              job.cancel();
            if (transaction.getMeta(codeDeleteGroupMeta) === true) return true;
            if (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet) return false;
            return value;
          },
        },
        props: {
          handleDOMEvents: {
            keydown(view, event) {
              // Let the browser/IME handle composing keys without invoking
              // downstream ProseMirror keymaps or preventing the event.
              return (
                (event.isComposing || event.keyCode === 229) &&
                view.state.selection.$from.parent.type.name === "codeBlock"
              );
            },
          },
          handleKeyDown(view, event) {
            if (event.isComposing || event.keyCode === 229 || view.composing || !view.editable) return false;
            if (event.key === "Backspace" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey)
              return deleteCodeMarkup(view) || deleteCodeIndentOrModifier(view);
            if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey)
              return indentCode(view, event.shiftKey);
            if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey)
              return insertCodeNewline(view);
            const platform = view.dom.ownerDocument.defaultView?.navigator.platform ?? "";
            const mac = /Mac|iPhone|iPad|iPod/.test(platform);
            const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
            if (event.key.toLowerCase() !== "f" || !event.shiftKey || event.altKey || !mod) return false;
            const { selection } = view.state;
            if (!(selection instanceof TextSelection) || !selection.$from.sameParent(selection.$to)) return false;
            if (selection.$from.parent.type.name !== "codeBlock") return false;
            closeFeedback?.();
            const pending = autoIndentCodeBlock(view, selection.$from.start() - 1);
            const dismissProgress = isAutoIndentPending(view)
              ? showCodeProgress(view.dom.ownerDocument, "正在自动缩进…")
              : undefined;
            closeFeedback = dismissProgress;
            void pending.then((result) => {
              dismissProgress?.();
              if (closeFeedback === dismissProgress) closeFeedback = undefined;
              if (result === "cancelled" || !isCurrentAutoIndent(view, pending)) return;
              closeFeedback?.();
              closeFeedback = showCodeFeedback(
                view.dom.ownerDocument,
                result === "success" ? "自动缩进成功" : "自动缩进未完成",
                result === "success" ? "success" : "error",
              );
            });
            return true;
          },
        },
        view(view) {
          pluginView = view;
          return {
            destroy() {
              releaseAutoIndent(view);
              if (pluginView === view) pluginView = undefined;
              closeFeedback?.();
              closeFeedback = undefined;
            },
          };
        },
      }),
    ];
  },
});
