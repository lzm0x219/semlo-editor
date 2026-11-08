import { isHistoryTransaction, undoDepth, redoDepth } from "@tiptap/pm/history";
import type { Node } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";

import { slashSuggestionKey, slashHistoryProbeKey } from "./keys";
import { isSlashDraftDeletion, isSlashDraftParagraph } from "./slash-draft";
type Marker = { before: Node; range: { from: number; to: number } };
type Token = Marker | null;
type TrustedInput = { document: Node; from: number; to: number; text: string };
type Tracking = {
  done: Token[];
  undone: Token[];
  pending: Marker | null;
  valid: boolean;
  reopenFrom: number | null;
  trusted: boolean;
  draftFrom: number | null;
};
export const slashHistoryCandidate = () => {
  const plugin = new Plugin<Tracking>({
    key: slashHistoryProbeKey,
    props: {
      handleTextInput(view, from, to, text, deflt) {
        if (
          view.composing ||
          (!(text === "/" && from === to && view.state.doc.resolve(from).parent.content.size === 0) &&
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
        transaction.setMeta("semloEditorTrustedSlashInput", { document: transaction.doc, from, to, text });
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
        draftFrom: null,
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
        const expected = tr.getMeta("semloEditorTrustedSlashInput") as TrustedInput | undefined;
        const trustedInput = !!expected && tr.doc.eq(expected.document);
        // 保存投影单独要求可信输入，不能把载入或粘贴的斜杠当作临时查询。
        let draftFrom = prev.draftFrom;
        const draftReopen = tr.getMeta("semloEditorSlashReopen") as number | undefined;
        if (
          tr.getMeta("preventUpdate") ||
          tr.getMeta("semloEditorSlashDiscard") ||
          tr.getMeta(slashSuggestionKey)?.exit
        )
          draftFrom = null;
        else if (typeof draftReopen === "number") draftFrom = draftReopen;
        else if (trustedInput) {
          if (draftFrom !== null) draftFrom = tr.mapping.map(draftFrom, -1);
          else if (
            expected.from === expected.to &&
            expected.text === "/" &&
            isSlashDraftParagraph(old.doc.resolve(expected.from)) &&
            old.doc.resolve(expected.from).parent.content.size === 0 &&
            tr.selection.empty &&
            tr.selection.from === expected.from + 1 &&
            tr.selection.$from.parent.textContent === "/"
          )
            // DOM 光标可能先于模型选区；只信任输入钩子记录且与事务文档一致的范围。
            draftFrom = expected.from;
        } else {
          const queryDeletion = draftFrom !== null && !isHistoryTransaction(tr) && isSlashDraftDeletion(tr, draftFrom);
          if (!queryDeletion && (tr.docChanged || (tr.selectionSet && !old.selection.eq(state.selection))))
            draftFrom = null;
        }
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
          return { done, undone, pending, valid, reopenFrom, trusted, draftFrom };
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
        return { done, undone, pending, valid, reopenFrom, trusted, draftFrom };
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
