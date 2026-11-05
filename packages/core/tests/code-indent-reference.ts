import { ensureSyntaxTree, indentRange, indentUnit, language } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { closeHistory, undoDepth } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Step, Transform } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { codeIndentLanguage } from "../src/features/code-block/indent-language";
import { readCodeSettings } from "../src/features/code-block/settings";
import type { EditorController } from "../src/types";

export function restoreOriginalAutolink(controller: EditorController) {
  const editor = controller.editor;
  const link = editor.extensionManager.extensions.find((extension) => extension.name === "link");
  if (!link) throw new Error("Missing link extension");
  let base = link;
  let createPlugins = base.config.addProseMirrorPlugins;
  while (base.parent) {
    base = base.parent;
    createPlugins = base.config.addProseMirrorPlugins ?? createPlugins;
  }
  if (!createPlugins) throw new Error("Missing link plugin factory");
  const invoke = createPlugins as unknown as (this: {
    name: string;
    options: unknown;
    editor: typeof editor;
    type: (typeof editor.schema.marks)[string];
  }) => Plugin[];
  const original = invoke.call({
    name: "link",
    options: link.options,
    editor,
    type: editor.schema.marks.link,
  });
  const autolink = original.find((plugin) => (plugin as Plugin & { key: string }).key.startsWith("autolink$"));
  if (!autolink) throw new Error("Missing autolink plugin");
  const plugins = editor.state.plugins.map((plugin) =>
    (plugin as Plugin & { key: string }).key.startsWith("autolink$") ? autolink : plugin,
  );
  editor.view.updateState(editor.state.reconfigure({ plugins }));
}

/** Baseline for browser tests; never exported from the package entry point. */
export function referenceCodeIndent(text: string, languageName: string, mode: "space" | "tab", width: number) {
  let state = EditorState.create({
    doc: text,
    extensions: [
      codeIndentLanguage(languageName),
      indentUnit.of(mode === "tab" ? "\t" : " ".repeat(width)),
      EditorState.tabSize.of(width),
    ],
  });
  if (state.facet(language)) {
    if (!ensureSyntaxTree(state, state.doc.length, 5000)) throw new Error("Reference parser did not finish");
    state = state.update({}).state;
  }
  return indentRange(state, 0, state.doc.length).apply(state.doc).toString();
}

function referenceCodeIndentTransaction(editor: EditorController, pos: number) {
  const view = editor.editor.view;
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "codeBlock") throw new Error("Missing code block");
  const { indentMode, indentWidth } = readCodeSettings(node.attrs);
  let state = EditorState.create({
    doc: node.textContent,
    extensions: [
      codeIndentLanguage(node.attrs.language),
      indentUnit.of(indentMode === "tab" ? "\t" : " ".repeat(indentWidth)),
      EditorState.tabSize.of(indentWidth),
    ],
  });
  if (state.facet(language)) {
    if (!ensureSyntaxTree(state, state.doc.length, 5000)) throw new Error("Reference parser did not finish");
    state = state.update({}).state;
  }
  const changes = indentRange(state, 0, state.doc.length);
  const edits: Array<{ from: number; to: number; text: string }> = [];
  changes.iterChanges((from, to, _newFrom, _newTo, text) => edits.push({ from, to, text: text.toString() }));
  const tr = view.state.tr;
  for (const edit of edits.reverse()) tr.insertText(edit.text, pos + 1 + edit.from, pos + 1 + edit.to);
  return tr;
}

/** Reference PM transaction used to compare original and inserted text marks. */
export function referenceCodeIndentJSON(editor: EditorController, pos: number) {
  return referenceCodeIndentTransaction(editor, pos).doc.toJSON();
}

export function applyReferenceCodeIndent(editor: EditorController, pos: number) {
  const view = editor.editor.view;
  view.dispatch(closeHistory(referenceCodeIndentTransaction(editor, pos)));
  view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
}

export function referenceCodeIndentMappings(editor: EditorController, pos: number) {
  const transaction = referenceCodeIndentTransaction(editor, pos);
  const positions = [];
  for (let position = 0; position <= editor.editor.state.doc.content.size; position += 1) {
    for (const assoc of [-1, 1]) {
      const result = transaction.mapping.mapResult(position, assoc);
      positions.push({
        position,
        assoc,
        mapped: result.pos,
        deleted: result.deleted,
        deletedBefore: result.deletedBefore,
        deletedAfter: result.deletedAfter,
        deletedAcross: result.deletedAcross,
      });
    }
  }
  return positions;
}

/** Compare the grouped step with individual steps under collaboration rebasing. */
export function compareCodeIndentRebases(editor: EditorController, grouped: Step, pos: number, count: number) {
  const state = editor.editor.state;
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "codeBlock") throw new Error("Missing code block");
  const individual = referenceCodeIndentTransaction(editor, pos);
  const combined = state.tr.step(grouped);
  // Mirrors are used by ProseMirror's collaboration rebase to map positions
  // through a locally undone step and its remapped counterpart.
  const rebase = (local: typeof individual, remote: Step) => {
    const transform = new Transform(local.doc);
    for (let i = local.steps.length - 1; i >= 0; i -= 1) transform.step(local.steps[i].invert(local.docs[i]));
    transform.step(remote);
    for (let i = 0, mapFrom = local.steps.length; i < local.steps.length; i += 1) {
      const mapped = local.steps[i].map(transform.mapping.slice(mapFrom));
      mapFrom -= 1;
      if (mapped && !transform.maybeStep(mapped).failed) {
        const mapping = transform.mapping as typeof transform.mapping & { setMirror: (a: number, b: number) => void };
        mapping.setMirror(mapFrom, transform.steps.length - 1);
      }
    }
    return transform.doc;
  };
  const mismatches: Array<{ from: number; to: number; insert: string; expected: string; actual: string }> = [];
  let random = 0x12f00d;
  const next = (max: number) => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random % max;
  };
  for (let i = 0; i < count; i += 1) {
    const from = pos + 1 + next(node.content.size + 1);
    const to = Math.min(pos + 1 + node.content.size, from + next(12));
    const insert = ["", "Z", "  ", "x\ny"][next(4)];
    const remote = state.tr.insertText(insert, from, to).steps[0];
    if (!remote) continue;
    const expected = rebase(individual, remote);
    const actual = rebase(combined, remote);
    if (!expected.eq(actual)) {
      mismatches.push({ from, to, insert, expected: expected.textContent, actual: actual.textContent });
      if (mismatches.length === 5) break;
    }
  }
  return mismatches;
}

const decorationProbes = new WeakMap<EditorController, PluginKey<DecorationSet>>();

/** A host-owned decoration must continue tracking unmodified code text. */
export function attachCodeIndentDecoration(editor: EditorController, from: number, to: number) {
  const key = new PluginKey<DecorationSet>("semloEditorCodeIndentDecorationProbe");
  editor.editor.registerPlugin(
    new Plugin({
      key,
      state: {
        init: (_config, state) =>
          DecorationSet.create(state.doc, [Decoration.inline(from, to, { class: "indent-probe" })]),
        apply: (transaction, decorations) => decorations.map(transaction.mapping, transaction.doc),
      },
      props: { decorations: (state) => key.getState(state) },
    }),
  );
  decorationProbes.set(editor, key);
}

export function codeIndentDecorations(editor: EditorController) {
  return (
    decorationProbes
      .get(editor)
      ?.getState(editor.editor.state)
      ?.find()
      .map(({ from, to }) => ({ from, to })) ?? []
  );
}

export function codeIndentUndoDepth(editor: EditorController) {
  return undoDepth(editor.editor.state);
}
