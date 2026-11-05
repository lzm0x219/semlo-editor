import "./heading-end-boundary-fixture";
import type { EditorContent } from "../../../packages/core/src/types";

type Point = { node: string | null; offset: number; pos: number | null; parent: string | null };
type Snapshot = {
  json: unknown;
  html: string;
  dom: { text: string; collapsed: boolean; anchor: Point; focus: Point };
  pm: { anchor: number; head: number; text: string; empty: boolean; anchorParent: string; headParent: string };
  focused: boolean;
};
type RtlProbe = {
  events: Array<{ phase: string; key: string; snapshot: Snapshot }>;
  inspect(): Snapshot;
};
declare global {
  interface Window {
    setupRtlSingleLine?(content: EditorContent, direction: "ltr" | "rtl", width: number, native: boolean): void;
    rtlSingleLineProbe?: RtlProbe;
  }
}

window.setupRtlSingleLine = (content, direction, width, native) => {
  window.__semloRequireFixture("mountHeadingEndBoundary")(content, width, native);
  const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
  const view = editor.view;
  view.dom.setAttribute("dir", direction);
  const events: RtlProbe["events"] = [];
  const point = (node: Node | null, offset: number): Point => {
    let pos: number | null = null;
    try {
      if (node) pos = view.posAtDOM(node, offset);
    } catch {
      // The endpoint may be outside the editor.
    }
    return { node: node?.nodeName ?? null, offset, pos, parent: node?.parentElement?.tagName ?? null };
  };
  const inspect = (): Snapshot => {
    const selection = view.state.selection;
    const dom = view.dom.ownerDocument.getSelection();
    return {
      json: editor.getJSON(),
      html: editor.getHTML(),
      dom: {
        text: dom?.toString() ?? "",
        collapsed: dom?.isCollapsed ?? true,
        anchor: point(dom?.anchorNode ?? null, dom?.anchorOffset ?? 0),
        focus: point(dom?.focusNode ?? null, dom?.focusOffset ?? 0),
      },
      pm: {
        anchor: selection.anchor,
        head: selection.head,
        text: view.state.doc.textBetween(selection.from, selection.to, "|"),
        empty: selection.empty,
        anchorParent: selection.$anchor.parent.type.name,
        headParent: selection.$head.parent.type.name,
      },
      focused: view.hasFocus(),
    };
  };
  view.dom.addEventListener(
    "keydown",
    (event) => events.push({ phase: "keydown", key: event.key, snapshot: inspect() }),
    true,
  );
  window.rtlSingleLineProbe = { events, inspect };
};
