import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { revealDetailsAt } from "../../features/blocks/details";
import { foldPluginKey, normalizeFolds } from "../../features/code-block/folding";
import {
  findDatabaseMatches,
  findStringRanges,
  orderedFindTableGroups,
  type DatabaseFindMatch,
} from "../../features/database/find-database-matches";
import { normalizeDatabaseData, visibleDatabaseRecords, type DatabaseView } from "../../features/database/model";
import { getDatabaseViewProjection } from "../../features/database/view-projection";
import { expandHeadingPositions, isHeadingFolded } from "../../features/heading/fold";
import { linkPopup } from "../../platform/dom/popup-owner";

type TextRange = { from: number; to: number };
type Match = ({ kind: "text" } & TextRange) | DatabaseFindMatch;
type SearchState = { query: string; matches: Match[]; index: number };
type SearchAction = { query?: string; index?: number; refresh?: boolean };
const activeEditorShell = new WeakMap<Document, HTMLElement>();

/** Search text within each text block, joining adjacent runs with different marks. */
export function findTextMatches(doc: ProseMirrorNode, query: string): TextRange[] {
  if (!query) return [];
  const matches: TextRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    let start = 0;
    const flush = () => {
      if (!text) return;
      for (const range of findStringRanges(text, query)) {
        const from = start + range.start;
        const to = start + range.end;
        const previous = matches[matches.length - 1];
        if (!previous || from >= previous.to) matches.push({ from, to });
      }
      text = "";
    };
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        if (!text) start = pos + 1 + offset;
        text += child.text;
      } else {
        // Inline atoms and hard breaks are boundaries: their labels are UI,
        // not text that can safely be replaced in the document.
        flush();
      }
    });
    flush();
    return false;
  });
  return matches;
}

function findMatches(doc: ProseMirrorNode, query: string, editor: Editor): Match[] {
  // Read-only view switches are local to the node view and do not change document attrs.
  const viewAt = editor.isEditable
    ? undefined
    : (position: number) => {
        const element = editor.view.nodeDOM(position);
        const win = editor.view.dom.ownerDocument.defaultView;
        return win && element instanceof win.HTMLElement ? element.dataset.semloEditorDatabaseViewId : undefined;
      };
  const projectionAt = (position: number, node: ProseMirrorNode, view: DatabaseView) => {
    const element = editor.view.nodeDOM(position);
    const win = editor.view.dom.ownerDocument.defaultView;
    if (!win || !(element instanceof win.HTMLElement)) return undefined;
    const projection = getDatabaseViewProjection(element);
    return projection?.node === node && projection.viewId === view.id && projection.groupFieldId === view.groupFieldId
      ? projection
      : undefined;
  };
  const collapsedRecords = new Map<number, Set<string>>();
  return [
    ...findTextMatches(doc, query)
      .filter((match) => {
        const resolved = doc.resolve(match.from);
        if (resolved.parent.type.name !== "codeBlock") return true;
        const pos = resolved.before();
        const node = resolved.parent;
        const local = doc === editor.state.doc ? foldPluginKey.getState(editor.state)?.get(pos) : undefined;
        const folds = local ?? normalizeFolds(node.attrs.folds, node.content.size);
        return !folds.some((fold) => match.from < pos + 1 + fold.to && match.to > pos + 1 + fold.from);
      })
      .map((match): Match => ({ kind: "text", ...match })),
    ...findDatabaseMatches(doc, query, viewAt, projectionAt).filter((match) => {
      const cached = collapsedRecords.get(match.from);
      if (cached) return !cached.has(match.recordId);
      const hidden = new Set<string>();
      collapsedRecords.set(match.from, hidden);
      const node = doc.nodeAt(match.from);
      const element = editor.view.nodeDOM(match.from);
      const win = editor.view.dom.ownerDocument.defaultView;
      if (!node?.attrs.data || !win || !(element instanceof win.HTMLElement)) return true;
      const data = normalizeDatabaseData(node.attrs.data);
      const view = data.views.find((item) => item.id === (viewAt?.(match.from) ?? data.activeViewId)) ?? data.views[0];
      if (view?.kind !== "table" || !view.groupFieldId || projectionAt(match.from, node, view)) return true;
      const field = data.fields.find((item) => item.id === view.groupFieldId);
      if (!field) return true;
      const ordered = orderedFindTableGroups(visibleDatabaseRecords(data, view), field, view);
      const headings = element.querySelectorAll<HTMLElement>(".semlo-editor-database-group-heading");
      ordered.forEach((group, index) => {
        if (headings[index]?.getAttribute("aria-expanded") === "false")
          group.records.forEach((record) => hidden.add(record.id));
      });
      return !hidden.has(match.recordId);
    }),
  ].sort((left, right) => left.from - right.from);
}

/** Find the matching UI inside this editor only; copied tables may share their data IDs. */
function databaseMatchElement(view: EditorView, match: DatabaseFindMatch): HTMLElement | null {
  const node = view.nodeDOM(match.from);
  const win = view.dom.ownerDocument.defaultView;
  if (!win || !(node instanceof win.HTMLElement)) return null;
  const cells = node.querySelectorAll<HTMLElement>(".semlo-editor-database-cell[data-record-id][data-field-id]");
  for (const cell of cells) {
    if (cell.dataset.recordId === match.recordId && cell.dataset.fieldId === match.fieldId) return cell;
  }
  for (const card of node.querySelectorAll<HTMLElement>(".semlo-editor-database-card[data-record-id]")) {
    if (card.dataset.recordId === match.recordId) return card;
  }
  return null;
}

export interface FindReplaceController {
  open(): void;
  close(): void;
  destroy(unregisterPlugin?: boolean): void;
}

/** Find an unchanged node after unrelated edits, without guessing between duplicates. */
function uniqueNodePosition(doc: ProseMirrorNode, target: ProseMirrorNode): number | null {
  let position: number | null = null;
  let count = 0;
  doc.descendants((node, pos) => {
    if (node === target) {
      position = pos;
      count++;
    }
  });
  return count === 1 ? position : null;
}

/** 展开包含查找结果的标题，正文命中时记录展开历史。 */
function revealHeadingOwners(editor: Editor, position: number) {
  if (editor.isDestroyed) return;
  const doc = editor.state.doc;
  const owners: Array<{ pos: number; node: ProseMirrorNode }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    if (!isHeadingFolded(editor, pos)) return false;
    const start = pos + node.nodeSize;
    // A match in the folded heading itself also opens its section.
    if (position > pos && position < start) {
      owners.push({ pos, node });
      return false;
    }
    if (position < start) return false;
    const resolved = doc.resolve(pos);
    const parent = resolved.parent;
    const level = Number(node.attrs.level);
    let end = start;
    for (let index = resolved.index() + 1; index < parent.childCount; index++) {
      const sibling = parent.child(index);
      if (sibling.type.name === "heading" && Number(sibling.attrs.level) <= level) break;
      end += sibling.nodeSize;
    }
    if (position < end) owners.push({ pos, node });
    return false;
  });
  const inHeading = doc.resolve(position).parent.type.name === "heading";
  expandHeadingPositions(
    editor,
    owners.map((owner) => owner.pos),
    !inHeading,
  );
}

/** Body matches create an undo step; title matches open without one. */
function revealDetailsForSearch(editor: Editor, position: number) {
  if (!editor.isEditable) {
    revealDetailsAt(editor, position);
    const resolved = editor.state.doc.resolve(position);
    for (let depth = 1; depth < resolved.depth; depth++) {
      const node = resolved.node(depth);
      if (node.type.name === "details" && resolved.node(depth + 1).type.name === "detailsSummary") {
        revealDetailsAt(editor, resolved.before(depth) + 2 + node.firstChild!.nodeSize);
      }
    }
    return;
  }
  const { state, view } = editor;
  const resolved = state.doc.resolve(position);
  const tr = closeHistory(state.tr);
  const titleOwners: number[] = [];
  for (let depth = 1; depth < resolved.depth; depth++) {
    if (resolved.node(depth).type.name !== "details") continue;
    const pos = resolved.before(depth);
    if (resolved.node(depth + 1).type.name === "detailsSummary") {
      titleOwners.push(pos);
      continue;
    }
    const node = tr.doc.nodeAt(pos);
    if (node && !node.attrs.open) tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: true });
  }
  if (tr.docChanged) {
    const titleNodes = titleOwners.map((pos) => tr.doc.nodeAt(pos));
    const canContinue = () => {
      if (view.isDestroyed) return false;
      if (view.state.doc === tr.doc) return true;
      if (!titleNodes.length || titleNodes.some((node) => !node)) return false;
      const positions = titleNodes.map((node) => (node ? uniqueNodePosition(view.state.doc, node) : null));
      if (positions.some((position) => position === null)) return false;
      titleOwners.splice(
        0,
        titleOwners.length,
        ...positions.filter((position): position is number => position !== null),
      );
      return true;
    };
    view.dispatch(tr);
    if (view.isDestroyed) return;
    view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    if (!canContinue()) return;
  }
  const titleTr = view.state.tr;
  for (const pos of titleOwners) {
    const node = titleTr.doc.nodeAt(pos);
    if (node && !node.attrs.open) titleTr.setNodeMarkup(pos, undefined, { ...node.attrs, open: true });
  }
  if (titleTr.docChanged) view.dispatch(titleTr.setMeta("addToHistory", false));
}

/** Mount the find panel for one editor. The trigger and shortcuts are owned by this controller. */
export function mountFindReplace(
  editor: Editor,
  anchor: HTMLElement | undefined,
  shell: HTMLElement,
): FindReplaceController {
  const doc = shell.ownerDocument;
  const win = doc.defaultView;
  const key = new PluginKey<SearchState>("semlo-editor-find-replace");
  const plugin = new Plugin<SearchState>({
    key,
    state: {
      init: () => ({ query: "", matches: [], index: 0 }),
      apply(tr, previous) {
        const action = tr.getMeta(key) as SearchAction | undefined;
        const query = action?.query ?? previous.query;
        if (!tr.docChanged && action?.query === undefined && action?.index === undefined && !action?.refresh)
          return previous;
        const matches =
          tr.docChanged || action?.query !== undefined || action?.refresh
            ? findMatches(tr.doc, query, editor)
            : previous.matches;
        let index = action?.index ?? (action?.query !== undefined ? 0 : previous.index);
        if ((tr.docChanged || action?.refresh) && action?.index === undefined && previous.matches[previous.index]) {
          const current = previous.matches[previous.index];
          const position = tr.mapping.map(current.from, current.kind === "database" ? 1 : -1);
          let next =
            current.kind === "database"
              ? matches.findIndex(
                  (match) =>
                    match.kind === "database" &&
                    match.from === position &&
                    match.databaseId === current.databaseId &&
                    match.recordId === current.recordId &&
                    match.fieldId === current.fieldId &&
                    match.start >= current.start,
                )
              : -1;
          if (next < 0) next = matches.findIndex((match) => match.from >= position);
          index = next < 0 ? Math.max(0, matches.length - 1) : next;
        }
        index = matches.length ? Math.max(0, Math.min(index, matches.length - 1)) : 0;
        return { query, matches, index };
      },
    },
    props: {
      decorations(state) {
        const search = key.getState(state);
        if (!search?.matches.length) return DecorationSet.empty;
        return DecorationSet.create(
          state.doc,
          search.matches.flatMap((match, index) =>
            match.kind === "text"
              ? [
                  Decoration.inline(match.from, match.to, {
                    class: `semlo-editor-find-match${index === search.index ? " semlo-editor-find-match-current" : ""}`,
                  }),
                ]
              : [],
          ),
        );
      },
    },
    view(view) {
      const win = view.dom.ownerDocument.defaultView;
      let frame: number | undefined;
      let stopped = false;
      let refreshPending = false;
      const updateDatabaseHighlights = () => {
        if (stopped) return;
        const state = key.getState(view.state);
        const targets = new Map<HTMLElement, boolean>();
        state?.matches.forEach((match, index) => {
          if (match.kind !== "database") return;
          const element = databaseMatchElement(view, match);
          if (element) targets.set(element, targets.get(element) || index === state.index);
        });
        for (const element of view.dom.querySelectorAll<HTMLElement>("[data-semlo-editor-find-database]")) {
          if (targets.has(element)) continue;
          delete element.dataset.semloEditorFindDatabase;
          element.classList.remove("semlo-editor-find-match", "semlo-editor-find-match-current");
        }
        for (const [element, current] of targets) {
          element.dataset.semloEditorFindDatabase = "";
          element.classList.add("semlo-editor-find-match");
          element.classList.toggle("semlo-editor-find-match-current", current);
        }
      };
      const schedule = () => {
        if (!win || frame !== undefined || stopped) return;
        frame = win.requestAnimationFrame(() => {
          frame = undefined;
          updateDatabaseHighlights();
        });
      };
      // A table can redraw its own view without a document transaction.
      const observer = win?.MutationObserver ? new win.MutationObserver(schedule) : undefined;
      observer?.observe(view.dom, { childList: true, subtree: true });
      const viewChanged = () => {
        if (stopped || refreshPending || !key.getState(view.state)?.query) return;
        refreshPending = true;
        queueMicrotask(() => {
          refreshPending = false;
          if (stopped || editor.isDestroyed || !key.getState(view.state)?.query) return;
          view.dispatch(
            view.state.tr.setMeta(key, { refresh: true } satisfies SearchAction).setMeta("addToHistory", false),
          );
        });
      };
      view.dom.addEventListener("semlo-editor:database-view-change", viewChanged);
      view.dom.addEventListener("semlo-editor:code-folds", viewChanged);
      let groupFrame: number | undefined;
      const groupClicked = (event: Event) => {
        const target = event.target;
        if (
          win &&
          groupFrame === undefined &&
          target instanceof win.Element &&
          target.closest(".semlo-editor-database-group-heading")
        ) {
          groupFrame = win.requestAnimationFrame(() => {
            groupFrame = undefined;
            viewChanged();
          });
        }
      };
      view.dom.addEventListener("click", groupClicked, true);
      return {
        update(nextView, previousState) {
          updateDatabaseHighlights();
          // Node-view DOM is refreshed after plugin state is applied; a read-only
          // local view may therefore need one more lookup after document changes.
          if (!editor.isEditable && nextView.state.doc !== previousState.doc) viewChanged();
        },
        destroy() {
          stopped = true;
          observer?.disconnect();
          view.dom.removeEventListener("semlo-editor:database-view-change", viewChanged);
          view.dom.removeEventListener("semlo-editor:code-folds", viewChanged);
          view.dom.removeEventListener("click", groupClicked, true);
          if (groupFrame !== undefined) win?.cancelAnimationFrame(groupFrame);
          if (frame !== undefined) win?.cancelAnimationFrame(frame);
          for (const element of view.dom.querySelectorAll<HTMLElement>("[data-semlo-editor-find-database]")) {
            delete element.dataset.semloEditorFindDatabase;
            element.classList.remove("semlo-editor-find-match", "semlo-editor-find-match-current");
          }
        },
      };
    },
  });
  editor.registerPlugin(plugin);
  let panel: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let replaceInput: HTMLInputElement | undefined;
  let counter: HTMLElement | undefined;
  let previousButton: HTMLButtonElement | undefined;
  let nextButton: HTMLButtonElement | undefined;
  let replaceButton: HTMLButtonElement | undefined;
  let replaceAllButton: HTMLButtonElement | undefined;
  let replaceSection: HTMLElement | undefined;
  let findTab: HTMLButtonElement | undefined;
  let replaceTab: HTMLButtonElement | undefined;
  let positionFrame: number | undefined;
  let unlinkPopup: (() => void) | undefined;
  let destroyed = false;
  let savedSearch: { query: string; index: number } | undefined;
  let tab: "find" | "replace" = "find";

  const dispatch = (action: SearchAction) => {
    if (editor.isDestroyed || destroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(key, action).setMeta("addToHistory", false));
  };
  const closeUndoGroup = () => {
    if (editor.isDestroyed || destroyed) return;
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  };
  const update = () => {
    if (!panel || editor.isDestroyed) return;
    const state = key.getState(editor.state);
    const count = state?.matches.length ?? 0;
    if (counter) counter.textContent = count ? `${(state?.index ?? 0) + 1}/${count}` : "0";
    if (previousButton) previousButton.disabled = !count;
    if (nextButton) nextButton.disabled = !count;
    if (replaceButton)
      replaceButton.disabled = !count || !editor.isEditable || state?.matches[state.index]?.kind !== "text";
    if (replaceAllButton)
      replaceAllButton.disabled = !editor.isEditable || !state?.matches.some((match) => match.kind === "text");
    schedulePosition();
  };
  const scrollCurrent = () => {
    if (editor.isDestroyed || destroyed) return;
    const state = key.getState(editor.state);
    const current = state?.matches[state.index];
    if (!current) return;
    const doc = editor.state.doc;
    const resolved = current.kind === "text" ? doc.resolve(current.from) : null;
    const target = resolved ? resolved.parent : doc.nodeAt(current.from);
    const targetPosition = resolved ? resolved.before() : current.from;
    revealHeadingOwners(editor, current.from);
    if (editor.isDestroyed || destroyed) return;
    let position = current.from;
    if (editor.state.doc !== doc) {
      if (!target) return;
      const moved = uniqueNodePosition(editor.state.doc, target);
      if (moved === null) return;
      position = moved + current.from - targetPosition;
    }
    revealDetailsForSearch(editor, position);
    if (editor.isDestroyed || destroyed) return;
    const match =
      current.kind === "database"
        ? databaseMatchElement(editor.view, { ...current, from: position })
        : editor.view.dom.querySelector<HTMLElement>(".semlo-editor-find-match-current");
    match?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const navigate = (direction: number) => {
    const state = key.getState(editor.state);
    if (!state?.matches.length) return;
    dispatch({ index: (state.index + direction + state.matches.length) % state.matches.length });
    scrollCurrent();
  };
  const marksAt = (position: number): readonly Mark[] => editor.state.doc.nodeAt(position)?.marks ?? [];
  const replace = (all: boolean) => {
    if (!editor.isEditable || editor.isDestroyed || destroyed) return;
    const state = key.getState(editor.state);
    if (!state?.matches.length) return;
    const value = replaceInput?.value ?? "";
    const targets = (all ? state.matches : [state.matches[state.index]]).filter(
      (match): match is Extract<Match, { kind: "text" }> => match.kind === "text",
    );
    if (!targets.length) return;
    const tr = closeHistory(editor.state.tr);
    for (const match of [...targets].reverse()) {
      if (value) tr.replaceWith(match.from, match.to, editor.state.schema.text(value, marksAt(match.from)));
      else tr.delete(match.from, match.to);
    }
    // Replacing prose while a table match is selected should keep that cell selected.
    const current = state.matches[state.index];
    tr.setMeta(key, all && current.kind === "database" ? {} : ({ index: state.index } satisfies SearchAction));
    const view = editor.view;
    view.dispatch(tr);
    if (destroyed || editor.isDestroyed || editor.view !== view) return;
    // Keep subsequent typing or replacements out of the same undo group.
    view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    scrollCurrent();
  };
  const position = () => {
    if (!panel || !win) return;
    const viewport = win.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? win.innerWidth);
    const bottom = top + (viewport?.height ?? win.innerHeight);
    const bounds = anchor?.getBoundingClientRect();
    const toolbar = shell.querySelector<HTMLElement>(".semlo-editor-toolbar")?.getBoundingClientRect();
    const shellBounds = shell.getBoundingClientRect();
    const useShell = !(bounds?.width && bounds.height) && !(toolbar?.width && toolbar.height);
    const rect =
      bounds?.width && bounds.height
        ? bounds
        : toolbar?.width && toolbar.height
          ? toolbar
          : { right: shellBounds.right, top: shellBounds.top, bottom: shellBounds.top };
    const shellLeft = Math.max(left + 8, shellBounds.left);
    const shellRight = Math.min(right - 8, shellBounds.right);
    const shellTop = Math.max(top + 8, shellBounds.top);
    const shellBottom = Math.min(bottom - 8, shellBounds.bottom);
    const withinShell = useShell && shellRight > shellLeft && shellBottom > shellTop;
    const minLeft = withinShell ? shellLeft : left + 8;
    const maxRight = withinShell ? shellRight : right - 8;
    const minTop = withinShell ? shellTop : top + 8;
    const maxBottom = withinShell ? shellBottom : bottom - 8;
    panel.style.maxWidth = `${Math.max(0, maxRight - minLeft)}px`;
    panel.style.maxHeight = `${Math.max(0, maxBottom - minTop)}px`;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const below = Math.max(rect.bottom, toolbar?.bottom ?? rect.bottom) + 4;
    const above = rect.top - height - 4;
    const y = below + height <= maxBottom || above < minTop ? below : above;
    let panelLeft = Math.max(minLeft, Math.min(rect.right - width, maxRight - width));
    let panelTop = Math.max(minTop, Math.min(y, maxBottom - height));

    // A persistent search panel must not make a data table's view and filter controls
    // inaccessible. Prefer the nearest horizontal gap before moving it vertically.
    const controls = [
      ...shell.querySelectorAll<HTMLElement>(".semlo-editor-database-toolbar :is(button, input, select)"),
    ]
      .map((element) => element.getBoundingClientRect())
      .filter(
        (bounds) => bounds.width > 0 && bounds.height > 0 && bounds.bottom > panelTop && bounds.top < panelTop + height,
      );
    const overlaps = (x: number) => controls.some((bounds) => x < bounds.right && x + width > bounds.left);
    if (overlaps(panelLeft)) {
      const choices = controls
        .flatMap((bounds) => [bounds.left - width - 8, bounds.right + 8])
        .filter((x) => x >= minLeft && x + width <= maxRight && !overlaps(x))
        .sort((a, b) => Math.abs(a - panelLeft) - Math.abs(b - panelLeft));
      if (choices.length) panelLeft = choices[0];
      else {
        const afterControls = Math.max(...controls.map((bounds) => bounds.bottom)) + 8;
        if (afterControls + height <= maxBottom) panelTop = afterControls;
      }
    }
    panel.style.left = `${panelLeft}px`;
    panel.style.top = `${panelTop}px`;
  };
  const schedulePosition = () => {
    if (!win || !panel) return;
    if (positionFrame !== undefined) win.cancelAnimationFrame(positionFrame);
    positionFrame = win.requestAnimationFrame(() => {
      positionFrame = undefined;
      position();
    });
  };
  const setTab = (next: "find" | "replace") => {
    tab = next;
    findTab?.setAttribute("aria-selected", String(tab === "find"));
    replaceTab?.setAttribute("aria-selected", String(tab === "replace"));
    if (replaceSection) replaceSection.hidden = tab !== "replace";
    if (replaceButton) replaceButton.hidden = tab !== "replace";
    if (replaceAllButton) replaceAllButton.hidden = tab !== "replace";
    position();
  };
  const button = (label: string, className: string, onClick: () => void) => {
    const element = doc.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    element.addEventListener("click", onClick);
    return element;
  };
  const close = () => {
    if (!panel) return;
    savedSearch = undefined;
    const focusWasInside = panel.contains(doc.activeElement);
    unlinkPopup?.();
    unlinkPopup = undefined;
    panel.remove();
    panel = undefined;
    anchor?.setAttribute("aria-expanded", "false");
    doc.removeEventListener("scroll", schedulePosition, true);
    win?.removeEventListener("resize", schedulePosition);
    win?.visualViewport?.removeEventListener("resize", schedulePosition);
    win?.visualViewport?.removeEventListener("scroll", schedulePosition);
    if (positionFrame !== undefined) win?.cancelAnimationFrame(positionFrame);
    positionFrame = undefined;
    dispatch({ query: "" });
    closeUndoGroup();
    if (focusWasInside && !editor.isDestroyed && !destroyed)
      editor.commands.focus(undefined, { scrollIntoView: false });
  };
  const open = () => {
    if (destroyed || editor.isDestroyed) return;
    if (panel) {
      searchInput?.focus();
      searchInput?.select();
      return;
    }
    const selection = editor.state.selection;
    const selectedText =
      selection instanceof TextSelection && !selection.empty
        ? editor.state.doc.textBetween(selection.from, selection.to)
        : "";
    closeUndoGroup();
    if (destroyed || editor.isDestroyed) return;
    tab = "find";
    panel = doc.createElement("div");
    panel.className = "semlo-editor-find-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "查找替换");
    // 没有默认工具栏按钮时，将查找面板关联到编辑器容器。
    unlinkPopup = linkPopup(anchor ?? shell, panel);
    const head = doc.createElement("div");
    head.className = "semlo-editor-find-header";
    const tabs = doc.createElement("div");
    tabs.className = "semlo-editor-find-tabs";
    tabs.setAttribute("role", "tablist");
    findTab = button("查找", "semlo-editor-find-tab", () => setTab("find"));
    replaceTab = button("替换", "semlo-editor-find-tab", () => setTab("replace"));
    findTab.setAttribute("role", "tab");
    replaceTab.setAttribute("role", "tab");
    tabs.append(findTab, replaceTab);
    const closeButton = button("×", "semlo-editor-find-close", close);
    closeButton.setAttribute("aria-label", "关闭查找替换");
    head.append(tabs, closeButton);
    const body = doc.createElement("div");
    body.className = "semlo-editor-find-body";
    const field = doc.createElement("div");
    field.className = "semlo-editor-find-field";
    searchInput = doc.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "请输入";
    searchInput.setAttribute("aria-label", "查找内容");
    searchInput.autocomplete = "off";
    counter = doc.createElement("span");
    counter.className = "semlo-editor-find-counter";
    counter.setAttribute("aria-live", "polite");
    field.append(searchInput, counter);
    replaceSection = doc.createElement("label");
    replaceSection.className = "semlo-editor-find-replace-field";
    replaceSection.append(doc.createTextNode("替换为"));
    replaceInput = doc.createElement("input");
    replaceInput.type = "text";
    replaceInput.placeholder = "请输入";
    replaceInput.setAttribute("aria-label", "替换为");
    replaceInput.autocomplete = "off";
    replaceSection.append(replaceInput);
    const actions = doc.createElement("div");
    actions.className = "semlo-editor-find-actions";
    replaceAllButton = button("全部替换", "semlo-editor-find-action", () => replace(true));
    replaceButton = button("替换", "semlo-editor-find-action", () => replace(false));
    previousButton = button("上一个", "semlo-editor-find-action", () => navigate(-1));
    nextButton = button("下一个", "semlo-editor-find-action", () => navigate(1));
    actions.append(replaceAllButton, replaceButton, previousButton, nextButton);
    body.append(field, replaceSection, actions);
    panel.append(head, body);
    doc.body.append(panel);
    anchor?.setAttribute("aria-expanded", "true");
    searchInput.addEventListener("input", () => {
      const query = searchInput?.value ?? "";
      if (editor.isDestroyed) {
        savedSearch = { query, index: 0 };
        return;
      }
      dispatch({ query });
      scrollCurrent();
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        event.preventDefault();
        navigate(event.shiftKey ? -1 : 1);
      }
    });
    panel.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });
    doc.addEventListener("scroll", schedulePosition, true);
    win?.addEventListener("resize", schedulePosition);
    win?.visualViewport?.addEventListener("resize", schedulePosition);
    win?.visualViewport?.addEventListener("scroll", schedulePosition);
    setTab("find");
    if (selectedText) {
      searchInput.value = selectedText;
      dispatch({ query: selectedText });
      if (destroyed || editor.isDestroyed) return;
      scrollCurrent();
      if (destroyed || editor.isDestroyed) return;
    }
    update();
    searchInput.focus();
  };
  let viewDOM = editor.view.dom;
  let viewDocument = viewDOM.ownerDocument;
  const keyboard = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey) return;
    if (editor.isDestroyed || editor.view.composing) return;
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
    const target = event.target as globalThis.Node | null;
    const element = target?.nodeType === 1 ? (target as Element) : target?.parentElement;
    if (element?.closest(".semlo-editor-database")) return;
    const eventDoc = target?.ownerDocument ?? doc;
    const lastReadOnlyEditor =
      (target === eventDoc.body || target === eventDoc.documentElement) && activeEditorShell.get(eventDoc) === shell;
    if (
      !target ||
      (!shell.contains(target) && !viewDOM.contains(target) && !panel?.contains(target) && !lastReadOnlyEditor)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (panel && (shell.contains(target) || viewDOM.contains(target))) close();
    else open();
  };
  const trackInteraction = (event: Event) => {
    const target = event.target as globalThis.Node | null;
    const eventDoc = target?.ownerDocument ?? doc;
    if (target && (shell.contains(target) || viewDOM.contains(target) || panel?.contains(target)))
      activeEditorShell.set(eventDoc, shell);
    else if (activeEditorShell.get(eventDoc) === shell) activeEditorShell.delete(eventDoc);
  };
  const editableChanged = () => update();
  const anchorClick = () => open();
  const attachDocument = (target: Document) => {
    target.addEventListener("keydown", keyboard, true);
    target.addEventListener("pointerdown", trackInteraction, true);
    target.addEventListener("focusin", trackInteraction, true);
  };
  const detachDocument = (target: Document) => {
    target.removeEventListener("keydown", keyboard, true);
    target.removeEventListener("pointerdown", trackInteraction, true);
    target.removeEventListener("focusin", trackInteraction, true);
    if (activeEditorShell.get(target) === shell) activeEditorShell.delete(target);
  };
  const unmount = () => {
    const state = key.getState(editor.state);
    if (state) savedSearch = { query: state.query, index: state.index };
    viewDOM.removeEventListener("semlo-editor:editable", editableChanged);
    if (viewDocument !== doc) detachDocument(viewDocument);
  };
  const mount = () => {
    if (destroyed || editor.isDestroyed) return;
    viewDOM = editor.view.dom;
    viewDocument = viewDOM.ownerDocument;
    if (viewDocument !== doc) attachDocument(viewDocument);
    viewDOM.addEventListener("semlo-editor:editable", editableChanged);
    editor.registerPlugin(plugin);
    if (destroyed || editor.isDestroyed) return;
    if (savedSearch) dispatch(savedSearch);
    if (!destroyed && !editor.isDestroyed) update();
  };
  anchor?.addEventListener("click", anchorClick);
  attachDocument(doc);
  if (viewDocument !== doc) attachDocument(viewDocument);
  viewDOM.addEventListener("semlo-editor:editable", editableChanged);
  editor.on("transaction", update);
  editor.on("unmount", unmount);
  editor.on("mount", mount);

  return {
    open,
    close,
    destroy(unregisterPlugin = true) {
      if (destroyed) return;
      destroyed = true;
      close();
      anchor?.removeEventListener("click", anchorClick);
      detachDocument(doc);
      if (viewDocument !== doc) detachDocument(viewDocument);
      viewDOM.removeEventListener("semlo-editor:editable", editableChanged);
      editor.off("transaction", update);
      editor.off("unmount", unmount);
      editor.off("mount", mount);
      if (unregisterPlugin && !editor.isDestroyed) editor.unregisterPlugin(key);
    },
  };
}
