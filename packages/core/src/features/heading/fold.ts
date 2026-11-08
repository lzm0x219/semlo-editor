import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Selection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import type { EditorController, EditorSnapshot } from "../../types";

type FoldState = { folded: ReadonlySet<number>; adapter: HeadingFoldPreferencesAdapter | null; valid: boolean };
type FoldAction =
  | { kind: "set"; pos: number; folded: boolean }
  | { kind: "expand"; positions: number[] }
  | { kind: "configure"; adapter: HeadingFoldPreferencesAdapter; positions: number[] }
  | { kind: "revision"; adapter: HeadingFoldPreferencesAdapter };
type Section = { pos: number; node: ProseMirrorNode; from: number; to: number };

const headingFoldKey = new PluginKey<FoldState>("semloEditorHeadingFold");
const revisionCaptures = new WeakMap<Editor, { next: number; committed: number }>();
export const headingFoldAttribute = "semloEditorHeadingFolded";
const headingFoldHTMLAttribute = "data-semlo-editor-heading-folded";

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

export interface HeadingFoldRevisionCapture {
  /** 与捕获的折叠状态对应的文档快照。 */
  readonly snapshot: EditorSnapshot;
  /** 宿主确认原样保存快照后，提交保存所得的版本。 */
  commit(revision: string): boolean;
}

function mountedView(editor: Editor): EditorView | null {
  if (editor.isDestroyed) return null;
  try {
    const view = editor.view;
    // 未挂载时 Tiptap 的占位 view 也会报告 isDestroyed 为 false。
    return !view.isDestroyed && view.dom ? view : null;
  } catch {
    return null;
  }
}

/** 捕获同一份文档及其折叠状态，供宿主保存成功后关联新版本。 */
export function captureHeadingFoldRevision(controller: EditorController): HeadingFoldRevisionCapture | null {
  const editor = controller.editor;
  const view = mountedView(editor);
  if (!view) return null;
  const doc = editor.state.doc;
  const initial = headingFoldKey.getState(editor.state);
  const initialAdapter = initial?.adapter;
  if (!initialAdapter) return null;
  const snapshot = controller.getSnapshot();
  const captured = headingFoldKey.getState(editor.state);
  if (mountedView(editor) !== view || editor.state.doc !== doc || captured?.adapter !== initialAdapter) return null;
  const positions = Array.from(captured.folded).sort((a, b) => a - b);
  let coordinator = revisionCaptures.get(editor);
  if (!coordinator) revisionCaptures.set(editor, (coordinator = { next: 0, committed: 0 }));
  const sequence = ++coordinator.next;
  let used = false;
  return {
    snapshot,
    commit(revision) {
      if (
        used ||
        typeof revision !== "string" ||
        !revision.trim() ||
        sequence < coordinator.committed ||
        mountedView(editor) !== view
      )
        return false;
      const state = headingFoldKey.getState(editor.state);
      const adapter = state?.adapter;
      if (
        !adapter ||
        adapter.documentId !== initialAdapter.documentId ||
        adapter.load !== initialAdapter.load ||
        adapter.save !== initialAdapter.save ||
        (!state.valid && revision === adapter.revision)
      )
        return false;
      const savedPositions = editor.state.doc.eq(doc) ? Array.from(state.folded).sort((a, b) => a - b) : positions;
      const previousCommit = coordinator.committed;
      coordinator.committed = sequence;
      used = true;
      try {
        adapter.save(adapter.documentId, revision, { version: 1, positions: [...savedPositions] });
      } catch {
        if (coordinator.committed === sequence) {
          coordinator.committed = previousCommit;
          used = false;
        }
        return false;
      }
      if (coordinator.committed !== sequence || mountedView(editor) !== view) return false;
      const current = headingFoldKey.getState(editor.state);
      if (current?.adapter !== adapter) return false;
      if (editor.state.doc.eq(doc)) {
        try {
          view.dispatch(
            editor.state.tr
              .setMeta(headingFoldKey, { kind: "revision", adapter: { ...adapter, revision } } satisfies FoldAction)
              .setMeta("addToHistory", false),
          );
        } catch {
          return false;
        }
        const rebound = headingFoldKey.getState(editor.state);
        if (
          mountedView(editor) !== view ||
          !rebound?.valid ||
          rebound.adapter?.revision !== revision ||
          !editor.state.doc.eq(doc)
        )
          return false;
      }
      return true;
    },
  };
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

function persistedFolded(doc: ProseMirrorNode): Set<number> {
  const positions = new Set<number>();
  doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.attrs[headingFoldAttribute] === true && sectionAt(doc, pos))
      positions.add(pos);
    return !node.isTextblock;
  });
  return positions;
}

/** 只吸收新增标题或显式变化的折叠属性，保留只读时的临时展开状态。 */
function syncPersistedFolded(tr: Transaction, positions: Set<number>) {
  const inverse = tr.mapping.invert();
  tr.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return !node.isTextblock;
    const mapped = inverse.mapResult(pos + 1, 1);
    const resolved =
      !mapped.deletedAcross && mapped.pos <= tr.before.content.size ? tr.before.resolve(mapped.pos) : null;
    const previous = resolved?.parent.type.name === "heading" ? resolved.parent : null;
    const previousPos = previous && resolved ? resolved.before() : -1;
    if (
      !previous ||
      previous.attrs[headingFoldAttribute] !== node.attrs[headingFoldAttribute] ||
      (!sectionAt(tr.before, previousPos) && sectionAt(tr.doc, pos))
    ) {
      if (node.attrs[headingFoldAttribute] === true && sectionAt(tr.doc, pos)) positions.add(pos);
      else positions.delete(pos);
    }
    return false;
  });
}

/** 默认将可编辑文档的折叠状态随标题保存；显式适配器仍独立管理视图状态。 */
function writeFolded(tr: Transaction, editor: Editor, state: FoldState, positions: readonly number[], value: boolean) {
  if (state.adapter || !editor.isEditable) return;
  for (const pos of positions) {
    const heading = tr.doc.nodeAt(pos);
    if (heading?.type.name === "heading" && heading.attrs[headingFoldAttribute] !== value)
      tr.setNodeMarkup(pos, undefined, { ...heading.attrs, [headingFoldAttribute]: value });
  }
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

/** 更新标题折叠状态，不为该操作增加撤销步骤。 */
export function setHeadingFolded(editor: Editor, pos: number, folded: boolean): boolean {
  if (editor.isDestroyed) return false;
  const state = headingFoldKey.getState(editor.state),
    section = sectionAt(editor.state.doc, pos);
  if (!state || !section) return false;
  if (state.folded.has(pos) === folded) return true;
  let tr = editor.state.tr
    .setMeta(headingFoldKey, { kind: "set", pos, folded } satisfies FoldAction)
    .setMeta("addToHistory", false);
  writeFolded(tr, editor, state, [pos], folded);
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
  const tr = editor.state.tr
    .setMeta(headingFoldKey, { kind: "expand", positions } satisfies FoldAction)
    .setMeta("addToHistory", false);
  writeFolded(tr, editor, state, positions, false);
  editor.view.dispatch(tr);
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
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          [headingFoldAttribute]: {
            default: false,
            keepOnSplit: false,
            validate(value: unknown) {
              if (typeof value !== "boolean") throw new Error("标题折叠状态无效");
            },
            parseHTML: (element: HTMLElement) => element.getAttribute(headingFoldHTMLAttribute) === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes[headingFoldAttribute] === true ? { [headingFoldHTMLAttribute]: "true" } : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<FoldState>({
        key: headingFoldKey,
        state: {
          init: (_config, state) => ({ folded: persistedFolded(state.doc), adapter: null, valid: false }),
          apply(tr, previous) {
            const folded = new Set<number>();
            for (const pos of previous.folded) {
              // 标题属性变化会替换起始标记；映射内部位置以保留同一标题的折叠状态。
              const mapped = tr.mapping.mapResult(pos + 1, 1);
              if (mapped.deletedAcross) continue;
              const resolved = tr.doc.resolve(mapped.pos);
              if (resolved.parent.type.name !== "heading") continue;
              const headingPos = resolved.before();
              if (sectionAt(tr.doc, headingPos)) folded.add(headingPos);
            }
            if (!previous.adapter && tr.docChanged) syncPersistedFolded(tr, folded);
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
            const adapter =
              action?.kind === "configure" || action?.kind === "revision" ? action.adapter : previous.adapter;
            const valid =
              action?.kind === "configure" || action?.kind === "revision"
                ? true
                : previous.valid && (!tr.docChanged || tr.before.eq(tr.doc));
            return { folded, adapter, valid };
          },
        },
        props: {
          decorations: (state) => decorations(editor, state.doc, headingFoldKey.getState(state)?.folded ?? new Set()),
        },
        view(view) {
          let previousDoc = view.state.doc;
          let previousFolded = headingFoldKey.getState(view.state)?.folded ?? new Set<number>();
          let previousEntry = headingFoldKey.getState(view.state);
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
                Array.from(folded).some((pos) => !previousFolded.has(pos)) ||
                (!!previousEntry?.adapter &&
                  !!entry?.adapter &&
                  (previousEntry.adapter.revision !== entry.adapter.revision || (!previousEntry.valid && entry.valid)));
              previousDoc = next.state.doc;
              previousFolded = folded;
              previousEntry = entry;
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
          const positions = owners.map((owner) => owner.pos);
          const tr = state.tr
            .setMeta(headingFoldKey, { kind: "expand", positions } satisfies FoldAction)
            .setMeta("addToHistory", false);
          writeFolded(tr, editor, foldState!, positions, false);
          return tr;
        },
      }),
    ];
  },
});
