import { type Editor } from "@tiptap/core";
import { type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { type SelectionBookmark } from "@tiptap/pm/state";
import { type EditorView } from "@tiptap/pm/view";

export interface BlockInsertTarget {
  /** Position and end of the original node in the current document. */
  pos: number;
  after: number;
  kind: "block" | "item";
  node: ProseMirrorNode;
  /** Parent menu and trigger remain available while the insert panel is open. */
  anchor: HTMLElement;
  trigger: HTMLButtonElement;
  focusPanel: boolean;
  onOpen: (panel: HTMLElement) => void;
  onClose: () => void;
  closeMenu: () => void;
  selection: SelectionBookmark;
}
export interface BlockActionsOptions {
  /** Open a deferred insertion panel; do not insert until the user chooses an item. */
  openInsertBelow?: (editor: Editor, target: BlockInsertTarget) => (() => void) | undefined;
}

export type Target = {
  pos: number;
  node: ProseMirrorNode;
  rootPos: number;
  rootNode: ProseMirrorNode;
  kind: "block" | "item";
  parentPos: number;
  dom: HTMLElement;
  rootDOM: HTMLElement;
  heading: HTMLElement | null;
};

/** 分栏及展开折叠块里的直接正文可作为独立块操作。 */
export function isContainerParagraph(position: ResolvedPos): boolean {
  if (position.depth !== 2 || position.nodeAfter?.type.name !== "paragraph") return false;
  const container = position.node(1);
  return (
    (container.type.name === "semloEditorColumns" && position.parent.type.name === "semloEditorColumn") ||
    (container.type.name === "details" &&
      container.attrs.open === true &&
      position.parent.type.name === "detailsContent")
  );
}

export function currentTarget(
  view: EditorView,
  pos: number,
  rootPos: number,
  dom: HTMLElement,
  rootDOM: HTMLElement,
  item: boolean,
  heading: HTMLElement | null = null,
): Target | null {
  const node = view.state.doc.nodeAt(pos),
    rootNode = view.state.doc.nodeAt(rootPos);
  if (!node || !rootNode) return null;
  const resolved = view.state.doc.resolve(pos);
  const parentPos = item && resolved.depth ? resolved.before(resolved.depth) : -1;
  return { pos, node, rootPos, rootNode, kind: item ? "item" : "block", parentPos, dom, rootDOM, heading };
}
