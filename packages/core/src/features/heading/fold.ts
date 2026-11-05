import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type FoldState = { folded: ReadonlySet<number>; adapter: HeadingFoldPreferencesAdapter | null; valid: boolean };
type FoldAction =
  | { kind: "set"; pos: number; folded: boolean }
  | { kind: "expand"; positions: number[] }
  | { kind: "configure"; adapter: HeadingFoldPreferencesAdapter; positions: number[] };
type Section = { pos: number; node: ProseMirrorNode; from: number; to: number };

const headingFoldKey = new PluginKey<FoldState>("semloEditorHeadingFold");

/** The host supplies a stable document identity and owns storage and its privacy. */
export interface HeadingFoldPreferencesAdapter {
  documentId: string;
  /** The host must change revision whenever the document content changes. */
  revision: string;
  load(documentId: string, revision: string): unknown;
  save(documentId: string, revision: string, state: HeadingFoldPreferences): void;
}

export interface HeadingFoldPreferences {
  version: 1;
  positions: number[];
}

/** The host must bind the document and revision to the initial content. */
export function configureHeadingFoldPreferences(editor: Editor, adapter: HeadingFoldPreferencesAdapter | null): void {
  if (!adapter || editor.isDestroyed) return;
  const initialState = editor.state;
  let positions: number[] = [];
  let captured: HeadingFoldPreferencesAdapter;
  try {
    if (
      typeof adapter.documentId !== "string" ||
      !adapter.documentId.trim() ||
      typeof adapter.revision !== "string" ||
      !adapter.revision.trim()
    )
      return;
    captured = {
      documentId: adapter.documentId,
      revision: adapter.revision,
      load: adapter.load.bind(adapter),
      save: adapter.save.bind(adapter),
    };
  } catch {
    return;
  }
  try {
    const record = captured.load(captured.documentId, captured.revision);
    if (editor.isDestroyed || editor.state !== initialState) return;
    if (record && typeof record === "object") {
      const value = record as Partial<HeadingFoldPreferences>;
      if (value.version === 1 && Array.isArray(value.positions))
        positions = Array.from(
          new Set(value.positions.filter((pos) => Number.isInteger(pos) && !!sectionAt(editor.state.doc, pos))),
        );
    }
  } catch {
    // Unavailable or malformed host storage must not prevent editing.
  }
  if (!editor.isDestroyed && editor.state === initialState)
    editor.view.dispatch(
      editor.state.tr
        .setMeta(headingFoldKey, { kind: "configure", adapter: captured, positions } satisfies FoldAction)
        .setMeta("addToHistory", false),
    );
}

/** A heading controls its following siblings up to the next heading of equal or higher level. */
function sectionAt(doc: ProseMirrorNode, pos: number): Section | null {
  if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return null;
  const resolved = doc.resolve(pos),
    node = resolved.nodeAfter;
  if (!node || node.type.name !== "heading") return null;
  const level = Number(node.attrs.level);
  if (!Number.isInteger(level) || level < 1 || level > 6) return null;
  const parent = resolved.parent,
    index = resolved.index();
  const from = pos + node.nodeSize;
  let to = from;
  for (let i = index + 1; i < parent.childCount; i++) {
    const next = parent.child(i);
    if (next.type.name === "heading" && Number(next.attrs.level) <= level) break;
    to += next.nodeSize;
  }
  return to > from ? { pos, node, from, to } : null;
}

function hasHiddenEndpoint(selection: Selection, section: Section): boolean {
  const inside = (pos: number) => pos >= section.from && pos < section.to;
  return selection.ranges.some(({ $from, $to }) => inside($from.pos) || inside($to.pos));
}

function hiddenOwners(doc: ProseMirrorNode, folded: ReadonlySet<number>, selection: Selection): Section[] {
  const owners: Section[] = [];
  const positions = Array.from(folded).sort((a, b) => a - b);
  for (const pos of positions) {
    const section = sectionAt(doc, pos);
    if (section && hasHiddenEndpoint(selection, section)) owners.push(section);
  }
  return owners;
}

function selectionAtHeading(doc: ProseMirrorNode, section: Section): TextSelection {
  return TextSelection.create(doc, section.pos + section.node.nodeSize - 1);
}

/** `pos` is the heading node position, such as the position returned by doc.descendants. */
export function isHeadingFolded(editor: Editor, pos: number): boolean {
  return !editor.isDestroyed && !!headingFoldKey.getState(editor.state)?.folded.has(pos);
}

/** Toggle UI state without changing document content or adding a history step. */
export function setHeadingFolded(editor: Editor, pos: number, folded: boolean): boolean {
  if (editor.isDestroyed) return false;
  const state = headingFoldKey.getState(editor.state),
    section = sectionAt(editor.state.doc, pos);
  if (!state || !section) return false;
  if (state.folded.has(pos) === folded) return true;
  let tr = editor.state.tr
    .setMeta(headingFoldKey, { kind: "set", pos, folded } satisfies FoldAction)
    .setMeta("addToHistory", false);
  if (folded && hasHiddenEndpoint(tr.selection, section)) tr = tr.setSelection(selectionAtHeading(tr.doc, section));
  const active = editor.view.dom.ownerDocument.activeElement;
  editor.view.dispatch(tr);
  if (folded && active && editor.view.dom.contains(active) && active.closest(".semlo-editor-heading-fold-hidden"))
    editor.view.focus();
  return true;
}

/** Expand folded headings whose hidden sections contain the target heading. */
export function expandHeadingAncestors(editor: Editor, headingPos: number): boolean {
  if (editor.isDestroyed || editor.state.doc.nodeAt(headingPos)?.type.name !== "heading") return false;
  const state = headingFoldKey.getState(editor.state);
  if (!state) return false;
  const positions = Array.from(state.folded).filter((pos) => {
    const section = sectionAt(editor.state.doc, pos);
    return section && headingPos >= section.from && headingPos < section.to;
  });
  if (!positions.length) return false;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(headingFoldKey, { kind: "expand", positions } satisfies FoldAction)
      .setMeta("addToHistory", false),
  );
  return true;
}

function foldButton(editor: Editor, doc: Document, section: Section, folded: boolean): HTMLButtonElement {
  const button = doc.createElement("button");
  const title = section.node.textContent.trim() || `标题 ${section.node.attrs.level}`;
  button.type = "button";
  button.className = "semlo-editor-heading-fold-toggle";
  button.contentEditable = "false";
  button.setAttribute("aria-expanded", String(!folded));
  button.setAttribute("aria-label", `${folded ? "展开" : "折叠"}标题：${title}`);
  button.setAttribute("data-semlo-editor-heading-fold-pos", String(section.pos));
  button.title = folded ? "展开标题内容" : "折叠标题内容";
  button.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor"><path d="M6.4 4.7v6.6a.6.6 0 0 0 1.02.43l3.1-3.3a.6.6 0 0 0 0-.86l-3.1-3.3a.6.6 0 0 0-1.02.43Z"/></svg>';
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const keyboard = event.detail === 0 && doc.activeElement === button;
    if (!setHeadingFolded(editor, section.pos, !folded) || !keyboard || editor.isDestroyed) return;
    const next = editor.view.dom.querySelector<HTMLButtonElement>(
      `[data-semlo-editor-heading-fold-pos="${section.pos}"]`,
    );
    next?.focus({ preventScroll: true });
  });
  return button;
}

function decorations(editor: Editor, doc: ProseMirrorNode, folded: ReadonlySet<number>): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    const section = sectionAt(doc, pos);
    if (!section) return false;
    const isFolded = folded.has(pos);
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "semlo-editor-heading-foldable" }));
    decorations.push(
      Decoration.widget(pos + 1, (view) => foldButton(editor, view.dom.ownerDocument, section, isFolded), {
        side: -1,
        key: `semlo-editor-heading-fold-${pos}-${isFolded}-${node.textContent}`,
        stopEvent: () => true,
      }),
    );
    if (isFolded) {
      const resolved = doc.resolve(pos),
        parent = resolved.parent,
        index = resolved.index();
      let childPos = section.from;
      for (let i = index + 1; i < parent.childCount && childPos < section.to; i++) {
        const child = parent.child(i);
        decorations.push(
          Decoration.node(childPos, childPos + child.nodeSize, {
            class: "semlo-editor-heading-fold-hidden",
            "aria-hidden": "true",
          }),
        );
        childPos += child.nodeSize;
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export const HeadingFold = Extension.create({
  name: "semloEditorHeadingFold",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<FoldState>({
        key: headingFoldKey,
        state: {
          init: () => ({ folded: new Set<number>(), adapter: null, valid: false }),
          apply(tr, previous) {
            const folded = new Set<number>();
            for (const pos of previous.folded) {
              const mapped = tr.mapping.mapResult(pos, 1);
              if (!mapped.deleted && sectionAt(tr.doc, mapped.pos)) folded.add(mapped.pos);
            }
            const action = tr.getMeta(headingFoldKey) as FoldAction | undefined;
            if (action?.kind === "set" && sectionAt(tr.doc, action.pos)) {
              if (action.folded) folded.add(action.pos);
              else folded.delete(action.pos);
            } else if (action?.kind === "expand") {
              for (const pos of action.positions) folded.delete(pos);
            } else if (action?.kind === "configure") {
              folded.clear();
              for (const pos of action.positions) if (sectionAt(tr.doc, pos)) folded.add(pos);
            }
            const adapter = action?.kind === "configure" ? action.adapter : previous.adapter;
            const valid =
              action?.kind === "configure" ? true : previous.valid && (!tr.docChanged || tr.before.eq(tr.doc));
            return { folded, adapter, valid };
          },
        },
        props: {
          decorations: (state) => decorations(editor, state.doc, headingFoldKey.getState(state)?.folded ?? new Set()),
        },
        view(view) {
          let previousDoc = view.state.doc;
          let previousFolded = headingFoldKey.getState(view.state)?.folded ?? new Set<number>();
          let pending = false;
          let closed = false;
          const flush = () => {
            if (!pending) return;
            pending = false;
            const state = headingFoldKey.getState(view.state);
            if (!state?.valid || !state.adapter) return;
            const { adapter } = state;
            try {
              adapter.save(adapter.documentId, adapter.revision, {
                version: 1,
                positions: Array.from(headingFoldKey.getState(view.state)?.folded ?? []).sort((a, b) => a - b),
              });
            } catch {
              // Host persistence is optional; keep the editor's in-memory state.
            }
          };
          return {
            update(next) {
              const folded = headingFoldKey.getState(next.state)?.folded ?? new Set<number>();
              const entry = headingFoldKey.getState(next.state);
              const changed =
                previousDoc !== next.state.doc ||
                folded.size !== previousFolded.size ||
                Array.from(folded).some((pos) => !previousFolded.has(pos));
              previousDoc = next.state.doc;
              previousFolded = folded;
              if (!changed || !entry?.valid || pending) return;
              pending = true;
              queueMicrotask(() => {
                if (!closed) flush();
              });
            },
            destroy() {
              closed = true;
              flush();
            },
          };
        },
        appendTransaction(_transactions, _oldState, state) {
          const foldState = headingFoldKey.getState(state);
          const owners = foldState ? hiddenOwners(state.doc, foldState.folded, state.selection) : [];
          if (!owners.length) return null;
          if (state.selection.empty)
            return state.tr.setSelection(selectionAtHeading(state.doc, owners[0])).setMeta("addToHistory", false);
          return state.tr
            .setMeta(headingFoldKey, {
              kind: "expand",
              positions: owners.map((owner) => owner.pos),
            } satisfies FoldAction)
            .setMeta("addToHistory", false);
        },
      }),
    ];
  },
});
