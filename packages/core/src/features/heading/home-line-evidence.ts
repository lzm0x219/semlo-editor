import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

type Rect = { left: number; right: number; top: number; bottom: number };
type LineEnd = (view: EditorView, heading: ProseMirrorNode, pos: number, cursor: number) => number | null;
type Candidate = {
  document: ProseMirrorNode;
  headingPos: number;
  source: number;
  start: number;
  end: number;
  before: Rect;
  after: Rect;
};
type Hint = Candidate & {
  state: EditorState;
  heading: HTMLElement;
  html: string;
  style: string;
  bounds: Rect;
  editorBounds: Rect;
  viewport: string;
};

function rect(value: Rect): Rect {
  return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
}
function sameRect(a: Rect, b: Rect): boolean {
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
}
function inLine(box: Rect, center: number): boolean {
  return box.top <= center && center <= box.bottom;
}
function styleSnapshot(win: Window, heading: HTMLElement): string | null {
  const elements = [heading, ...heading.querySelectorAll<HTMLElement>("*")];
  if (elements.length > 512) return null;
  return JSON.stringify(
    elements.map((element) => {
      const style = win.getComputedStyle(element);
      return [
        element.tagName,
        style.font,
        style.fontSize,
        style.fontFamily,
        style.fontWeight,
        style.fontStyle,
        style.fontStretch,
        style.fontKerning,
        style.fontFeatureSettings,
        style.fontVariationSettings,
        style.letterSpacing,
        style.wordSpacing,
        style.lineHeight,
        style.whiteSpace,
        style.width,
        style.direction,
        style.writingMode,
        style.unicodeBidi,
        style.display,
        style.position,
        style.transform,
        style.verticalAlign,
        style.visibility,
        style.textIndent,
        style.textTransform,
        style.wordBreak,
        style.overflowWrap,
      ];
    }),
  );
}
function viewport(win: Window): string {
  return JSON.stringify([
    win.innerWidth,
    win.innerHeight,
    win.scrollX,
    win.scrollY,
    win.devicePixelRatio,
    win.visualViewport?.width,
    win.visualViewport?.height,
    win.visualViewport?.scale,
    ...[
      "(prefers-color-scheme: dark)",
      "(prefers-reduced-motion: reduce)",
      "(forced-colors: active)",
      "(prefers-contrast: more)",
      "(prefers-contrast: less)",
      "(pointer: coarse)",
      "(hover: hover)",
    ].map((query) => win.matchMedia(query).matches),
  ]);
}

/** Track a verified wrapped-line Home selection until the next key action. */
export class HeadingHomeLineEvidence {
  private hint: Hint | null = null;
  private view: EditorView | null = null;
  private observer: MutationObserver | null = null;
  private stop: (() => void) | null = null;
  constructor(
    private readonly lineEnd: LineEnd,
    private readonly sequence: (state: EditorState) => number | undefined,
  ) {}

  attach(view: EditorView): void {
    this.view = view;
  }

  private observe(view: EditorView): boolean {
    const doc = view.dom.ownerDocument;
    const win = doc.defaultView;
    if (!win) return false;
    const clear = () => this.clear();
    const selectionChanged = () => {
      const hint = this.hint;
      const selection = doc.getSelection();
      if (!hint || !selection?.isCollapsed || !selection.anchorNode || !view.dom.contains(selection.anchorNode)) {
        if (hint) this.clear();
        return;
      }
      try {
        if (view.posAtDOM(selection.anchorNode, selection.anchorOffset) !== hint.start) this.clear();
      } catch {
        this.clear();
      }
    };
    doc.addEventListener("selectionchange", selectionChanged);
    doc.addEventListener("scroll", clear, true);
    win.addEventListener("resize", clear);
    win.visualViewport?.addEventListener("resize", clear);
    win.visualViewport?.addEventListener("scroll", clear);
    view.dom.addEventListener("blur", clear, true);
    doc.fonts?.addEventListener("loading", clear);
    doc.fonts?.addEventListener("loadingdone", clear);
    doc.fonts?.addEventListener("loadingerror", clear);
    this.stop = () => {
      doc.removeEventListener("selectionchange", selectionChanged);
      doc.removeEventListener("scroll", clear, true);
      win.removeEventListener("resize", clear);
      win.visualViewport?.removeEventListener("resize", clear);
      win.visualViewport?.removeEventListener("scroll", clear);
      view.dom.removeEventListener("blur", clear, true);
      doc.fonts?.removeEventListener("loading", clear);
      doc.fonts?.removeEventListener("loadingdone", clear);
      doc.fonts?.removeEventListener("loadingerror", clear);
    };
    this.observer = new win.MutationObserver(() => {
      if (this.hint) this.clear();
    });
    this.observer.observe(view.dom, { childList: true, characterData: true, attributes: true, subtree: true });
    if (doc.head)
      this.observer.observe(doc.head, { childList: true, characterData: true, attributes: true, subtree: true });
    for (let parent = view.dom.parentElement; parent; parent = parent.parentElement)
      this.observer.observe(parent, { attributes: true, attributeFilter: ["class", "style", "dir"] });
    return true;
  }

  prepare(view: EditorView, event: KeyboardEvent, shifted = false): Candidate | null {
    try {
      if (
        this.view !== view ||
        !event.isTrusted ||
        event.defaultPrevented ||
        event.key !== "Home" ||
        event.shiftKey !== shifted ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.keyCode === 229 ||
        !view.editable ||
        !view.hasFocus() ||
        view.composing ||
        !(view.state.selection instanceof TextSelection) ||
        !view.state.selection.empty ||
        typeof Intl.Segmenter !== "function"
      )
        return null;
      const native = view.dom.ownerDocument.getSelection();
      if (!native?.isCollapsed || !native.anchorNode || !view.dom.contains(native.anchorNode)) return null;
      const position = view.posAtDOM(native.anchorNode, native.anchorOffset);
      const resolved = view.state.doc.resolve(position);
      const heading = resolved.parent;
      if (
        heading.type.name !== "heading" ||
        !Number.isInteger(heading.attrs.level) ||
        heading.attrs.level < 1 ||
        heading.attrs.level > 6 ||
        heading.content.size > 4096 ||
        heading.childCount > 256
      )
        return null;
      const inside =
        resolved.depth === 1 ||
        (resolved.depth === 2 && resolved.node(1).type.name === "blockquote") ||
        (resolved.depth === 3 &&
          resolved.node(1).type.name === "details" &&
          resolved.node(2).type.name === "detailsContent");
      if (!inside) return null;
      const text = heading.textBetween(0, heading.content.size, "", "\n");
      if (text.length !== heading.content.size) return null;
      const offsets = [0];
      for (const segment of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text))
        offsets.push(segment.index + segment.segment.length);
      const index = offsets.indexOf(position - resolved.start());
      if (index <= 0) return null;
      const before = rect(view.coordsAtPos(position, -1));
      const after = rect(view.coordsAtPos(position, 1));
      const center = (after.top + after.bottom) / 2;
      if (!inLine(before, center)) return null;
      let low = 0,
        high = index;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        const measured = view.coordsAtPos(resolved.start() + offsets[mid], 1);
        if (measured.bottom < center) low = mid + 1;
        else if (inLine(measured, center)) high = mid;
        else return null;
      }
      const start = resolved.start() + offsets[low];
      if (
        start <= resolved.start() ||
        start >= position ||
        view.state.doc.resolve(start).nodeBefore?.type.name === "hardBreak"
      )
        return null;
      const end = this.lineEnd(view, heading, resolved.before(), start);
      if (end === null || end <= position) return null;
      const atStartBefore = rect(view.coordsAtPos(start, -1));
      const atStartAfter = rect(view.coordsAtPos(start, 1));
      if (!inLine(atStartAfter, center) || inLine(atStartBefore, center)) return null;
      return {
        document: view.state.doc,
        headingPos: resolved.before(),
        source: position,
        start,
        end,
        before: atStartBefore,
        after: atStartAfter,
      };
    } catch {
      return null;
    }
  }

  handle(view: EditorView, event: KeyboardEvent): boolean {
    const previous = this.hint;
    if (
      previous &&
      event.isTrusted &&
      !event.defaultPrevented &&
      event.key === "Home" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      view.editable &&
      !view.composing &&
      this.consume(view, view.state.selection.anchor)
    ) {
      this.hint = previous;
      if (!this.observe(view)) this.clear();
      event.preventDefault();
      return true;
    }
    this.clear();
    const candidate = this.prepare(view, event);
    if (!candidate) return false;
    const old = view.state;
    const oldSequence = this.sequence(old);
    const selection = TextSelection.create(old.doc, candidate.start);
    const tr = old.tr.setSelection(selection).setMeta("addToHistory", false);
    event.preventDefault();
    view.dispatch(tr);
    if (view.state === old && !view.isDestroyed && view.hasFocus()) {
      // A native click may not have reached the editor state yet. Never use a
      // stale committed selection to move the browser caret to another block.
      const native = view.dom.ownerDocument.getSelection();
      if (old.selection.anchor === candidate.source && native?.isCollapsed && native.anchorNode) {
        try {
          if (
            view.dom.contains(native.anchorNode) &&
            view.posAtDOM(native.anchorNode, native.anchorOffset) === candidate.source
          )
            view.focus();
        } catch {
          // Leave an unrecognized native selection untouched.
        }
      }
      return true;
    }
    if (
      view.isDestroyed ||
      oldSequence === undefined ||
      this.sequence(view.state) !== oldSequence + 1 ||
      view.state.doc !== candidate.document ||
      view.state.selection !== tr.selection ||
      !view.state.selection.eq(selection)
    )
      return true;
    try {
      const doc = view.dom.ownerDocument;
      const win = doc.defaultView;
      const native = doc.getSelection();
      const heading = view.nodeDOM(candidate.headingPos);
      if (
        !win ||
        !(heading instanceof win.HTMLElement) ||
        !view.hasFocus() ||
        !native?.isCollapsed ||
        !native.anchorNode ||
        view.posAtDOM(native.anchorNode, native.anchorOffset) !== candidate.start
      )
        return true;
      const before = rect(view.coordsAtPos(candidate.start, -1));
      const after = rect(view.coordsAtPos(candidate.start, 1));
      if (!sameRect(before, candidate.before) || !sameRect(after, candidate.after)) return true;
      const style = styleSnapshot(win, heading);
      if (style === null) return true;
      this.hint = {
        ...candidate,
        state: view.state,
        heading,
        html: heading.outerHTML,
        style,
        bounds: rect(heading.getBoundingClientRect()),
        editorBounds: rect(view.dom.getBoundingClientRect()),
        viewport: viewport(win),
      };
      if (!this.observe(view)) this.clear();
    } catch {
      this.clear();
    }
    return true;
  }

  consume(view: EditorView, position: number): boolean {
    const hint = this.hint;
    const mutated = Boolean(this.observer?.takeRecords().length);
    this.clear();
    if (
      !hint ||
      mutated ||
      this.view !== view ||
      view.state !== hint.state ||
      view.state.doc !== hint.document ||
      !view.hasFocus() ||
      !(view.state.selection instanceof TextSelection) ||
      !view.state.selection.empty ||
      view.state.selection.anchor !== hint.start ||
      position !== hint.start
    )
      return false;
    try {
      const doc = view.dom.ownerDocument;
      const win = doc.defaultView;
      const native = doc.getSelection();
      if (
        !win ||
        !native?.isCollapsed ||
        !native.anchorNode ||
        view.posAtDOM(native.anchorNode, native.anchorOffset) !== hint.start ||
        view.nodeDOM(hint.headingPos) !== hint.heading ||
        hint.heading.outerHTML !== hint.html ||
        styleSnapshot(win, hint.heading) !== hint.style ||
        viewport(win) !== hint.viewport ||
        !sameRect(rect(hint.heading.getBoundingClientRect()), hint.bounds) ||
        !sameRect(rect(view.dom.getBoundingClientRect()), hint.editorBounds) ||
        !sameRect(rect(view.coordsAtPos(hint.start, -1)), hint.before) ||
        !sameRect(rect(view.coordsAtPos(hint.start, 1)), hint.after)
      )
        return false;
      const heading = view.state.doc.nodeAt(hint.headingPos);
      return !!heading && this.lineEnd(view, heading, hint.headingPos, hint.start) === hint.end;
    } catch {
      return false;
    }
  }

  update(view: EditorView): void {
    if (this.hint && view.state !== this.hint.state) this.clear();
  }
  clear(): void {
    this.hint = null;
    this.stop?.();
    this.observer?.disconnect();
    this.stop = null;
    this.observer = null;
  }
  destroy(): void {
    this.clear();
    this.view = null;
  }
}
