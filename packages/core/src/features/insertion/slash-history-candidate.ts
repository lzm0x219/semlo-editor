import { isHistoryTransaction, undoDepth, redoDepth } from "@tiptap/pm/history";
import type { Node } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";

import { slashSuggestionKey, slashHistoryProbeKey } from "./keys";
type Marker = { before: Node; range: { from: number; to: number } };
type Token = Marker | null;
type Tracking = {
  done: Token[];
  undone: Token[];
  pending: Marker | null;
  valid: boolean;
  reopenFrom: number | null;
  trusted: boolean;
};
export const slashHistoryCandidate = () => {
  const plugin = new Plugin<Tracking>({
    key: slashHistoryProbeKey,
    props: {
      handleTextInput(view, from, to, text, deflt) {
        if (
          view.composing ||
          (!(text === "/" && from === to && view.state.selection.$from.parent.content.size === 0) &&
            slashHistoryProbeKey.getState(view.state)?.reopenFrom == null)
        )
          return false;
        const plugins = view.state.plugins;
        const index = plugins.indexOf(plugin);
        if (index < 0) return false;
        for (const later of plugins.slice(index + 1)) {
          const handler = later.props.handleTextInput;
          if (handler?.call(later, view, from, to, text, deflt)) return true;
        }
        const transaction = deflt();
        transaction.setMeta("semloEditorTrustedSlashInput", transaction.doc);
        view.dispatch(transaction);
        return true;
      },
    },
    state: {
      init: (_config, state) => ({
        done: Array(undoDepth(state)).fill(null),
        undone: Array(redoDepth(state)).fill(null),
        pending: null,
        valid: true,
        reopenFrom: null,
        trusted: false,
      }),
      apply(tr, prev, old, state) {
        const before = undoDepth(old),
          after = undoDepth(state),
          rb = redoDepth(old),
          ra = redoDepth(state);
        let done = prev.done.slice(),
          undone = prev.undone.slice(),
          pending: Marker | null = null,
          valid = prev.valid;
        const rawMarker = tr.getMeta("semloEditorSlashHistoryProbe") as Marker | undefined;
        const marker = prev.trusted ? rawMarker : undefined;
        let trusted = prev.trusted;
        const expected = tr.getMeta("semloEditorTrustedSlashInput") as Node | undefined;
        const trustedInput = !!expected && tr.doc.eq(expected);
        if (tr.docChanged && !isHistoryTransaction(tr) && !rawMarker && !trustedInput) trusted = false;
        const reopenMeta = tr.getMeta("semloEditorSlashReopen") as number | undefined;
        let reopenFrom = typeof reopenMeta === "number" ? reopenMeta : prev.reopenFrom;
        if (
          tr.getMeta("semloEditorSlashDiscard") ||
          (tr.getMeta(slashSuggestionKey)?.exit && typeof reopenMeta !== "number")
        )
          reopenFrom = null;
        if (reopenFrom !== null && tr.docChanged && typeof reopenMeta !== "number")
          reopenFrom = tr.mapping.map(reopenFrom, -1);
        if (
          reopenFrom !== null &&
          (reopenFrom < 0 ||
            reopenFrom >= state.doc.content.size ||
            state.doc.textBetween(reopenFrom, reopenFrom + 1) !== "/" ||
            tr.selection.from < reopenFrom ||
            tr.selection.$from.start() !== state.doc.resolve(reopenFrom).start())
        )
          reopenFrom = null;
        if (
          reopenFrom === null &&
          !tr.getMeta("semloEditorSlashDiscard") &&
          !isHistoryTransaction(tr) &&
          tr.docChanged &&
          tr.selection.empty &&
          tr.selection.$from.parent.type.name === "paragraph" &&
          tr.selection.$from.parent.textContent === "/" &&
          tr.selection.$from.parentOffset === 1
        ) {
          reopenFrom = tr.selection.from - 1;
          trusted = true;
        }
        const reset = () => {
          done = Array(after).fill(null);
          undone = Array(ra).fill(null);
          valid = false;
        };
        if (done.length !== before || undone.length !== rb) {
          reset();
          return { done, undone, pending, valid, reopenFrom, trusted };
        }
        if (isHistoryTransaction(tr)) {
          if (after === before - 1 && ra === rb + 1) {
            const popped = done.pop() ?? null;
            undone.push(popped);
            pending = valid ? popped : null;
          } else if (after === before + 1 && ra === rb - 1) {
            done.push(undone.pop() ?? null);
          } else reset();
        } else if (after === before + 1) {
          done.push(marker ?? null);
          if (ra === 0) undone = [];
          else reset();
        } else if (after === before && ra === 0) {
          undone = [];
          if (marker) reset();
          if (tr.docChanged && after >= 100) reset();
        } else if (after !== before || ra !== rb) reset();
        return { done, undone, pending, valid, reopenFrom, trusted };
      },
    },
    appendTransaction(transactions, old, state) {
      const hist = transactions.some(isHistoryTransaction);
      const marker = slashHistoryProbeKey.getState(state)?.pending;
      const index = state.plugins.indexOf(plugin);
      const hasLaterAppender =
        index < 0 || state.plugins.slice(index + 1).some((plugin) => !!plugin.spec.appendTransaction);
      if (hist && marker && !hasLaterAppender && state.doc.eq(marker.before))
        return state.tr
          .delete(marker.range.from + 1, marker.range.to)
          .setMeta("semloEditorSlashReopen", marker.range.from)
          .setMeta("addToHistory", false);
      return null;
    },
  });
  return plugin;
};
