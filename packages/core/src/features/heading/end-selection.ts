import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { HeadingHomeLineEvidence } from "./home-line-evidence";
import { stopUnverifiedHeadingLineSelection } from "./line-selection-fallback";

const textMarks = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
  "textStyle",
  "highlight",
  "subscript",
  "superscript",
]);
const textElements = new Set([
  "SPAN",
  "A",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "DEL",
  "STRIKE",
  "MARK",
  "CODE",
  "SUB",
  "SUP",
]);
const numberedStyles = new Set(["mixed", "decimal", "chinese"]);
// Script=Common includes characters with right-to-left bidi classes. Only
// accept a bounded subset of common characters for this geometry shortcut.
const simpleLTR =
  /^[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Inherited}\u0400-\u052f\x20-\x7e\u2000-\u2065\u2600-\u27bf\u3000-\u303f\uff01-\uff60\u{1f000}-\u{1faff}]*$/u;
// 西里尔基本与补充区的字符双向类别为 L 或 NSM，仅扩展已验证的单行路径。
const singleLineLTR =
  /^[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Inherited}\u0400-\u052f\x20-\x7e\u2000-\u2065\u2600-\u27bf\u3000-\u303f\uff01-\uff60\u{1f000}-\u{1faff}]*$/u;
// 两端与段落方向一致，并通过字形几何验证整行的逻辑端点。
const mixedSingleLineLTR =
  /^[A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff \u05d0-\u05ea\u0621-\u063a\u0641-\u064a]*[A-Za-z\u4e00-\u9fff](?![\s\S])/u;
// 仅支持英文开头、单一希伯来文或阿拉伯文字段结尾的单行标题。
const trailingRtlLTR = /^[A-Za-z]+(?: +[A-Za-z]+)* +(?:[\u05d0-\u05ea]+|[\u0621-\u063a\u0641-\u064a]+)(?![\s\S])/u;
const mixedSingleLineRTL =
  /^(?:[\u05d0-\u05ea][\u05d0-\u05ea A-Za-z\u4e00-\u9fff]*[\u05d0-\u05ea]|[\u0621-\u063a\u0641-\u064a][\u0621-\u063a\u0641-\u064a A-Za-z\u4e00-\u9fff]*[\u0621-\u063a\u0641-\u064a])(?![\s\S])/u;
const bidiControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
// In Unicode Character Database 16.0.0 these letters are Lo and Bidi=R or AL;
// U+0020 is WS and is only allowed between letters from one script.
const simpleRTL =
  /^(?:[\u05d0-\u05ea]+(?: +[\u05d0-\u05ea]+)*|[\u0621-\u063a\u0641-\u064a]+(?: +[\u0621-\u063a\u0641-\u064a]+)*)(?![\s\S])/u;

function hasCoordinateTransform(style: CSSStyleDeclaration): boolean {
  return ["transform", "translate", "rotate", "scale", "offset-path"].some((property) => {
    const value = style.getPropertyValue(property);
    return value !== "" && value !== "none";
  });
}

/** Only use model order for a normal, unfragmented horizontal text flow. */
function hasSupportedHeadingLayout(element: HTMLElement, win: Window): boolean {
  if (win.getComputedStyle(element).display !== "block") return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = win.getComputedStyle(ancestor);
    if (
      hasCoordinateTransform(style) ||
      (style.columnCount !== "auto" && style.columnCount !== "1") ||
      (style.columnWidth !== "" && style.columnWidth !== "auto")
    )
      return false;
  }
  return true;
}

function hasSupportedInlineLayout(style: CSSStyleDeclaration): boolean {
  return (
    style.display === "inline" &&
    style.position === "static" &&
    style.cssFloat === "none" &&
    style.direction === "ltr" &&
    style.writingMode === "horizontal-tb" &&
    style.unicodeBidi === "normal" &&
    !hasCoordinateTransform(style)
  );
}

/** Known editor controls have no corresponding text in the heading model. */
function supportedHeadingWidget(
  child: HTMLElement,
  heading: HTMLElement,
  getStyle: (element: Element) => CSSStyleDeclaration,
): boolean | null {
  if (child.parentElement !== heading || child.getAttribute("contenteditable") !== "false") return null;
  const style = getStyle(child);
  if (child.classList.contains("semlo-editor-heading-number")) return hasSupportedInlineLayout(style);
  if (
    child.classList.contains("semlo-editor-heading-fold-toggle") ||
    child.classList.contains("semlo-editor-heading-link")
  )
    return style.position === "absolute" && style.cssFloat === "none" && !hasCoordinateTransform(style);
  return null;
}

/**
 * Verify that the model and rendered heading contain only text and known
 * built-in widgets, and that every rendered text rectangle shares one line.
 */
function singleVisualTextHeading(
  view: EditorView,
  heading: ProseMirrorNode,
  pos: number,
  direction: "ltr" | "rtl" = "ltr",
  allowTrailingRtl = false,
): boolean {
  if (heading.content.size > 4096 || heading.childCount > 256) return false;
  let supported = heading.childCount > 0 && Boolean(heading.textContent);
  heading.forEach((node) => {
    if (!node.isText || node.marks.some((mark) => !textMarks.has(mark.type.name))) supported = false;
  });
  if (!supported || bidiControls.test(heading.textContent)) return false;
  const mixedLTR = direction === "ltr" && !singleLineLTR.test(heading.textContent);
  const mixedRTL = direction === "rtl" && !simpleRTL.test(heading.textContent);
  const trailingRtl = direction === "ltr" && allowTrailingRtl && trailingRtlLTR.test(heading.textContent);
  if (direction === "ltr") {
    if (
      mixedLTR &&
      (heading.content.size > 128 ||
        heading.childCount !== 1 ||
        !heading.firstChild?.isText ||
        heading.firstChild.marks.some((mark) => !["bold", "italic"].includes(mark.type.name)) ||
        (!mixedSingleLineLTR.test(heading.textContent) && !trailingRtl))
    )
      return false;
  } else if (
    heading.content.size > 128 ||
    heading.childCount !== 1 ||
    !heading.firstChild?.isText ||
    heading.firstChild.marks.some((mark) => !["bold", "italic"].includes(mark.type.name)) ||
    (mixedRTL && !mixedSingleLineRTL.test(heading.textContent))
  )
    return false;

  const win = view.dom.ownerDocument.defaultView;
  const element = view.nodeDOM(pos);
  if (!win || !(element instanceof win.HTMLElement)) return false;
  const headingElement: HTMLElement = element;
  const getStyle = win.getComputedStyle.bind(win);
  const headingStyle = win.getComputedStyle(element);
  // 包括闭合 Shadow DOM 的实际缩放；无法取得尺度时不猜测。
  if (trailingRtl && Reflect.get(element, "currentCSSZoom") !== 1) return false;
  if (
    !hasSupportedHeadingLayout(element, win) ||
    headingStyle.writingMode !== "horizontal-tb" ||
    headingStyle.direction !== direction ||
    (mixedLTR && headingStyle.display !== "block") ||
    (direction === "rtl" && headingStyle.display !== "block") ||
    !["normal", "isolate"].includes(headingStyle.unicodeBidi)
  )
    return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = win.getComputedStyle(ancestor);
    // zoom 会改变字形矩形的坐标尺度，但计算后的 line-height 仍是未缩放值。
    const zoom = style.getPropertyValue("zoom");
    if (trailingRtl && zoom !== "" && zoom !== "normal" && zoom !== "1") return false;
    if (style.transform !== "none" || (style.columnCount !== "auto" && style.columnCount !== "1")) return false;
    if (
      direction === "rtl" &&
      (hasCoordinateTransform(style) || (style.columnWidth !== "" && style.columnWidth !== "auto"))
    )
      return false;
    if (ancestor === view.dom && direction === "ltr" && !trailingRtl) break;
  }

  const rects: DOMRect[] = [];
  let content = "";
  let visited = 0;
  let rtlText: Text | undefined;
  let mixedLtrText: Text | undefined;
  const rtlMarks = new Set<string>(
    heading.firstChild?.marks.map((mark) => (mark.type.name === "bold" ? "STRONG" : "EM")),
  );
  const visitedRtlMarks = new Set<string>();
  function visit(node: Node): boolean {
    if (++visited > 512) return false;
    if (node.nodeType === 3) {
      content += node.textContent ?? "";
      if (!node.textContent) return true;
      if (mixedLTR) {
        if (mixedLtrText) return false;
        mixedLtrText = node as Text;
      }
      if (direction === "rtl") {
        if (rtlText) return false;
        rtlText = node as Text;
      }
      const range = view.dom.ownerDocument.createRange();
      range.selectNodeContents(node);
      const textRects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0);
      if (!textRects.length || rects.length + textRects.length > 256) return false;
      rects.push(...textRects);
      return true;
    }
    if (node.nodeType !== 1) return false;
    const child = node as HTMLElement;
    // 标题链接是位于文字流之外的编辑器控件，不应使整行定位失效。
    if (child.classList.contains("semlo-editor-heading-link"))
      return supportedHeadingWidget(child, headingElement, getStyle) === true;
    if (
      child.parentElement === element &&
      child.getAttribute("contenteditable") === "false" &&
      (child.classList.contains("semlo-editor-heading-number") ||
        child.classList.contains("semlo-editor-heading-fold-toggle"))
    ) {
      if (direction === "ltr" && !mixedLTR) return true;
      if (mixedLTR) {
        const style = getStyle(child);
        if (child.classList.contains("semlo-editor-heading-fold-toggle"))
          return style.position === "absolute" && style.cssFloat === "none" && !hasCoordinateTransform(style);
        return (
          style.display === "inline" &&
          style.position === "static" &&
          style.cssFloat === "none" &&
          style.direction === "ltr" &&
          style.unicodeBidi === "normal" &&
          !hasCoordinateTransform(style)
        );
      }
      const style = getStyle(child);
      if (child.classList.contains("semlo-editor-heading-number"))
        return (
          style.display === "inline" &&
          style.position === "static" &&
          style.cssFloat === "none" &&
          style.direction === "rtl" &&
          style.unicodeBidi === "normal" &&
          !hasCoordinateTransform(style)
        );
      return style.position === "absolute" && style.cssFloat === "none" && !hasCoordinateTransform(style);
    }
    if (direction === "rtl" || mixedLTR) {
      if (!rtlMarks.has(child.tagName) || visitedRtlMarks.has(child.tagName) || child.hasAttribute("contenteditable"))
        return false;
      const style = getStyle(child);
      if (
        style.display !== "inline" ||
        style.position !== "static" ||
        style.cssFloat !== "none" ||
        style.direction !== direction ||
        style.writingMode !== "horizontal-tb" ||
        style.unicodeBidi !== "normal" ||
        hasCoordinateTransform(style)
      )
        return false;
      visitedRtlMarks.add(child.tagName);
      for (const next of child.childNodes) if (!visit(next)) return false;
      return true;
    }
    if (!textElements.has(child.tagName) || child.hasAttribute("contenteditable")) return false;
    const style = getStyle(child);
    if (!hasSupportedInlineLayout(style)) return false;
    for (const next of child.childNodes) if (!visit(next)) return false;
    return true;
  }
  for (const child of element.childNodes) if (!visit(child)) return false;
  if (content !== heading.textContent || !rects.length) return false;

  if (mixedLTR) {
    if (!mixedLtrText || mixedLtrText.data !== heading.textContent || visitedRtlMarks.size !== rtlMarks.size)
      return false;
    const lineHeight = Number.parseFloat(headingStyle.lineHeight);
    // 行距小于字形高度时，不同行的矩形可能重叠，不能据此判成单行。
    if (trailingRtl && (!Number.isFinite(lineHeight) || lineHeight <= 0)) return false;
    const glyph = view.dom.ownerDocument.createRange();
    let firstLeft = Infinity;
    let lastRight = -Infinity;
    let minLeft = Infinity;
    let maxRight = -Infinity;
    let firstTop: number | undefined;
    const rightmostOffset = trailingRtl
      ? mixedLtrText.data.search(/[\u05d0-\u05ea\u0621-\u063a\u0641-\u064a]/u)
      : mixedLtrText.length - 1;
    for (let offset = 0; offset < mixedLtrText.length; offset++) {
      glyph.setStart(mixedLtrText, offset);
      glyph.setEnd(mixedLtrText, offset + 1);
      const boxes = Array.from(glyph.getClientRects());
      if (boxes.length !== 1) return false;
      const box = boxes[0];
      if (
        ![box.left, box.right, box.top, box.bottom, box.width, box.height].every(Number.isFinite) ||
        box.width <= 0 ||
        box.height <= 0 ||
        (trailingRtl && box.height < 1) ||
        (trailingRtl && box.height > lineHeight + 0.5)
      )
        return false;
      if (offset === 0) firstLeft = box.left;
      if (trailingRtl) {
        if (firstTop !== undefined && box.top !== firstTop) return false;
        firstTop = box.top;
      }
      if (offset === rightmostOffset) lastRight = box.right;
      minLeft = Math.min(minLeft, box.left);
      maxRight = Math.max(maxRight, box.right);
    }
    if (firstLeft > minLeft + 1 || lastRight < maxRight - 1) return false;
  }

  if (direction === "rtl") {
    if (!rtlText || rtlText.data !== heading.textContent || visitedRtlMarks.size !== rtlMarks.size) return false;
    const glyph = view.dom.ownerDocument.createRange();
    let previousLeft = Infinity;
    let previousRight = Infinity;
    let firstRight = -Infinity;
    let minLeft = Infinity;
    let maxRight = -Infinity;
    for (let offset = 0; offset < rtlText.length; offset++) {
      glyph.setStart(rtlText, offset);
      glyph.setEnd(rtlText, offset + 1);
      const boxes = Array.from(glyph.getClientRects());
      if (boxes.length !== 1) return false;
      const box = boxes[0];
      if (
        ![box.left, box.right, box.top, box.bottom, box.width, box.height].every(Number.isFinite) ||
        box.width <= 0 ||
        box.height <= 0 ||
        (!mixedRTL && (box.left > previousLeft + 1 || box.right > previousRight + 1))
      )
        return false;
      previousLeft = box.left;
      previousRight = box.right;
      if (offset === 0) firstRight = box.right;
      minLeft = Math.min(minLeft, box.left);
      maxRight = Math.max(maxRight, box.right);
    }
    if (mixedRTL && (firstRight < maxRight - 1 || previousLeft > minLeft + 1)) return false;
  }

  const commonTop = Math.max(...rects.map((rect) => rect.top));
  const commonBottom = Math.min(...rects.map((rect) => rect.bottom));
  const minHeight = Math.min(...rects.map((rect) => rect.height));
  const centers = rects.map((rect) => (rect.top + rect.bottom) / 2);
  return commonBottom > commonTop && Math.max(...centers) - Math.min(...centers) <= minHeight / 2;
}

/** 在已核实的横向从左至右文字中定位视觉行末。 */
function multiVisualLineEnd(
  view: EditorView,
  heading: ProseMirrorNode,
  pos: number,
  cursor: number,
  allowInterior = false,
  allowVerifiedLineOverlap = false,
): number | null {
  if (heading.content.size > 4096 || heading.childCount > 256 || typeof Intl.Segmenter !== "function") return null;
  let supported = heading.childCount > 0;
  heading.forEach((node) => {
    if (node.isText) {
      if (node.text?.includes("\n")) supported = false;
      if (
        node.marks.some(
          (mark) => !textMarks.has(mark.type.name) || ["subscript", "superscript"].includes(mark.type.name),
        )
      )
        supported = false;
    } else if (node.type.name !== "hardBreak" || node.marks.length) supported = false;
  });
  if (!supported) return null;
  const content = heading.textBetween(0, heading.content.size, "", "\n");
  if (
    content.length !== heading.content.size ||
    bidiControls.test(content) ||
    Array.from(content).some((character) => {
      const code = character.codePointAt(0)!;
      return (code < 32 && code !== 10) || code === 127;
    }) ||
    // At this point newlines can only come from validated hardBreak nodes.
    !simpleLTR.test(content.replaceAll("\n", ""))
  )
    return null;
  const win = view.dom.ownerDocument.defaultView;
  const element = view.nodeDOM(pos);
  if (!win || !(element instanceof win.HTMLElement)) return null;
  const browserWindow = win;
  const headingElement: HTMLElement = element;
  const getStyle = win.getComputedStyle.bind(win);
  const style = win.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (
    style.direction !== "ltr" ||
    style.writingMode !== "horizontal-tb" ||
    !["normal", "isolate"].includes(style.unicodeBidi) ||
    !Number.isFinite(lineHeight) ||
    !hasSupportedHeadingLayout(element, win)
  )
    return null;

  let domText = "";
  let visited = 0;
  const heights: number[] = [];
  function visit(node: Node): boolean {
    if (++visited > 512) return false;
    if (node.nodeType === 3) {
      domText += node.textContent ?? "";
      if (!node.textContent) return true;
      const range = view.dom.ownerDocument.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0);
      if (!rects.length || heights.length + rects.length > 256) return false;
      heights.push(...rects.map((rect) => rect.height));
      return true;
    }
    if (node.nodeType !== 1) return false;
    const child = node as HTMLElement;
    const widget = supportedHeadingWidget(child, headingElement, getStyle);
    if (widget !== null) return widget;
    if (child.tagName === "IMG" && child.getAttribute("class") === "ProseMirror-separator") {
      const siblings = Array.from(headingElement.childNodes);
      const index = siblings.indexOf(child);
      const next = child.nextSibling;
      const box = child.getBoundingClientRect();
      const imageStyle = getStyle(child);
      if (
        child.parentElement !== headingElement ||
        index < 0 ||
        child.getAttributeNames().length !== 2 ||
        child.getAttribute("alt") !== "" ||
        !(next instanceof browserWindow.HTMLElement) ||
        next.tagName !== "BR" ||
        next.classList.contains("ProseMirror-trailingBreak") ||
        box.width !== 0 ||
        box.height !== 0 ||
        !hasSupportedInlineLayout(imageStyle) ||
        imageStyle.visibility !== "visible" ||
        imageStyle.backgroundImage !== "none"
      )
        return false;
      const before = view.posAtDOM(headingElement, index);
      const after = view.posAtDOM(headingElement, index + 1);
      const afterBreak = view.posAtDOM(headingElement, index + 2);
      return before === after && afterBreak === before + 1 && view.state.doc.nodeAt(before)?.type.name === "hardBreak";
    }
    if (child.tagName === "BR" && child.classList.contains("ProseMirror-trailingBreak")) {
      return (
        child.parentElement === headingElement &&
        child === headingElement.lastElementChild &&
        child.getAttributeNames().length === 1 &&
        child.getAttribute("class") === "ProseMirror-trailingBreak"
      );
    }
    if (child.tagName === "BR" && !child.classList.contains("ProseMirror-trailingBreak")) {
      const breakStyle = getStyle(child);
      if (!hasSupportedInlineLayout(breakStyle) || breakStyle.visibility !== "visible") return false;
      domText += "\n";
      return true;
    }
    if (!textElements.has(child.tagName) || child.hasAttribute("contenteditable")) return false;
    const computed = getStyle(child);
    if (
      !hasSupportedInlineLayout(computed) ||
      computed.verticalAlign !== "baseline" ||
      computed.fontSize !== style.fontSize
    )
      return false;
    for (const next of child.childNodes) if (!visit(next)) return false;
    return true;
  }
  for (const child of element.childNodes) if (!visit(child)) return null;
  if (
    domText !== content ||
    (heights.length > 0 &&
      ((!allowVerifiedLineOverlap && Math.max(...heights) > lineHeight + 1) ||
        Math.max(...heights) - Math.min(...heights) > 1))
  )
    return null;

  const offsets = [0];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const segment of segmenter.segment(content)) offsets.push(segment.index + segment.segment.length);
  const relative = cursor - pos - 1;
  const index = offsets.indexOf(relative);
  if (index < 0) return null;
  const hardBreakEnd =
    content[relative] === "\n" || (relative === content.length && relative > 0 && content[relative - 1] === "\n");
  if (!heights.length && !hardBreakEnd) return null;
  const caret = view.coordsAtPos(cursor, 1);
  const center = (caret.top + caret.bottom) / 2;
  // A visible hardBreak directly after the caret fixes the end of this line.
  // At that end Shift+End keeps the selection collapsed.
  if (hardBreakEnd) {
    const before = view.coordsAtPos(cursor, -1);
    if (before.top <= center && before.bottom >= center) return cursor;
  }
  if (index > 0) {
    const previous = view.coordsAtPos(pos + 1 + offsets[index - 1], 1);
    if (!allowInterior && previous.top <= center && previous.bottom >= center) return null;
    if (previous.top > center) return null;
  }
  let low = index;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const measured = view.coordsAtPos(pos + 1 + offsets[middle], -1);
    if (measured.top <= center && measured.bottom >= center) low = middle;
    else if (measured.top > center) high = middle - 1;
    else return null;
  }
  if (low <= index) return null;
  const lastStart = view.coordsAtPos(pos + 1 + offsets[low - 1], 1);
  if (lastStart.top > center || lastStart.bottom < center) return null;
  if (low + 1 < offsets.length && content.slice(offsets[low], offsets[low + 1]) !== "\n") {
    const nextStart = view.coordsAtPos(pos + 1 + offsets[low], 1);
    const nextEnd = view.coordsAtPos(pos + 1 + offsets[low + 1], -1);
    if (nextStart.top <= center && nextStart.bottom >= center && nextEnd.top > center) return null;
  }
  return pos + 1 + offsets[low];
}

function previousGraphemeBoundary(text: string, offset: number): number | null {
  if (offset <= 0 || offset > text.length || typeof Intl.Segmenter !== "function") return null;
  let previous = 0;
  for (const segment of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    if (segment.index === offset) return previous;
    previous = segment.index;
  }
  return offset === text.length ? previous : null;
}

function hasStableTextLineRange(
  view: EditorView,
  blockPos: number,
  start: number,
  end: number,
  allowWrappedEnd = false,
): boolean {
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView;
  const heading = view.nodeDOM(blockPos);
  if (
    !win ||
    !(heading instanceof win.HTMLElement) ||
    Reflect.get(heading, "currentCSSZoom") !== 1 ||
    heading.getClientRects().length !== 1
  )
    return false;
  const lineHeight = Number.parseFloat(win.getComputedStyle(heading).lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0 || start >= end) return false;
  const before = view.coordsAtPos(end, -1);
  const after = view.coordsAtPos(end, 1);
  if (![before.top, before.bottom, after.top, after.bottom].every(Number.isFinite)) return false;
  const wrappedEnd = before.top !== after.top || before.bottom !== after.bottom;
  if (wrappedEnd && !allowWrappedEnd) return false;
  const from = view.domAtPos(start, 1);
  const to = view.domAtPos(end, -1);
  const range = doc.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  const rects = Array.from(range.getClientRects());
  if (!rects.length || rects.length > 256) return false;
  const top = rects[0].top;
  const fromCaret = range.cloneRange();
  fromCaret.collapse(true);
  const toCaret = range.cloneRange();
  toCaret.collapse(false);
  const left = fromCaret.getBoundingClientRect();
  const right = toCaret.getBoundingClientRect();
  if (
    ![left.left, left.top, left.width, left.height, right.left, right.top, right.width, right.height].every(
      Number.isFinite,
    ) ||
    left.height < 1 ||
    right.height < 1 ||
    left.width > 0.5 ||
    right.width > 0.5 ||
    left.top !== right.top ||
    left.left >= right.left
  )
    return false;
  if (wrappedEnd) {
    const resolved = view.state.doc.resolve(end);
    const content = resolved.parent.textBetween(0, resolved.parent.content.size, "", "\n");
    const previous = previousGraphemeBoundary(content, resolved.parentOffset);
    if (resolved.before() !== blockPos || previous === null || resolved.start() + previous < start) return false;
    const lastFrom = view.domAtPos(resolved.start() + previous, 1);
    const lastRange = doc.createRange();
    lastRange.setStart(lastFrom.node, lastFrom.offset);
    lastRange.setEnd(to.node, to.offset);
    const lastRects = Array.from(lastRange.getClientRects());
    if (!lastRects.length || lastRects.some((box) => box.top !== top || box.width <= 0 || box.height < 1)) return false;
  }
  // 文字块未分片、范围内各格式矩形处于同一行时，才使用逻辑行端点。
  return rects.every(
    (box) =>
      [box.left, box.right, box.top, box.bottom, box.width, box.height].every(Number.isFinite) &&
      box.width > 0 &&
      box.height >= 1 &&
      box.height <= lineHeight * 1.25 + 0.5 &&
      box.top === top,
  );
}

function selectTextLineBoundary(view: EditorView, event: KeyboardEvent, home: boolean): boolean {
  if (
    !event.isTrusted ||
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.getModifierState("AltGraph") ||
    event.isComposing ||
    event.keyCode === 229 ||
    view.composing ||
    view.isDestroyed ||
    !view.editable ||
    !view.hasFocus() ||
    !(view.state.selection instanceof TextSelection)
  )
    return false;
  const native = view.dom.ownerDocument.getSelection();
  if (
    !native?.anchorNode ||
    !native.focusNode ||
    !view.dom.contains(native.anchorNode) ||
    !view.dom.contains(native.focusNode)
  )
    return false;
  const state = view.state;
  let selected: TextSelection;
  try {
    const anchor = state.doc.resolve(view.posAtDOM(native.anchorNode, native.anchorOffset));
    const head = state.doc.resolve(view.posAtDOM(native.focusNode, native.focusOffset));
    if (state.selection.anchor !== anchor.pos || state.selection.head !== head.pos) return false;
    const collapsed = state.selection.empty && native.isCollapsed;
    if (anchor.sameParent(head) && anchor.parent.type.name !== "paragraph") return false;
    if (state.selection.empty !== native.isCollapsed) return false;
    const forward = anchor.pos < head.pos;
    const edge = home ? (forward ? anchor : head) : forward ? head : anchor;
    const block = edge.parent;
    if (
      !["heading", "paragraph"].includes(block.type.name) ||
      (home && block.type.name !== "paragraph") ||
      !(
        edge.depth === 1 ||
        (edge.depth === 2 && edge.node(1).type.name === "blockquote") ||
        (edge.depth === 3 && edge.node(1).type.name === "details" && edge.node(2).type.name === "detailsContent") ||
        (edge.depth === 3 &&
          ((["bulletList", "orderedList"].includes(edge.node(1).type.name) && edge.node(2).type.name === "listItem") ||
            (edge.node(1).type.name === "taskList" && edge.node(2).type.name === "taskItem")))
      )
    )
      return false;
    let target: number;
    if (home) {
      let start = edge.start();
      block.forEach((node, offset) => {
        if (node.type.name === "hardBreak" && offset < edge.parentOffset) start = edge.start() + offset + node.nodeSize;
      });
      const content = block.textBetween(0, block.content.size, "", "\n");
      if (
        content.length !== block.content.size ||
        (edge.pos > start &&
          (previousGraphemeBoundary(content, edge.parentOffset) === null ||
            !hasStableTextLineRange(view, edge.before(), start, edge.pos)))
      )
        return false;
      const firstEnd = multiVisualLineEnd(view, block, edge.before(), start, false, true);
      if (firstEnd === null || edge.pos > firstEnd) return false;
      target = start;
    } else {
      if (edge.parentOffset > 0 && edge.nodeBefore?.type.name !== "hardBreak") {
        const before = view.coordsAtPos(edge.pos, -1);
        const after = view.coordsAtPos(edge.pos, 1);
        if (before.top !== after.top || before.bottom !== after.bottom) return false;
      }
      const end = multiVisualLineEnd(view, block, edge.before(), edge.pos, true, true);
      if (end === null || end < edge.pos) return false;
      if (end > edge.pos && !hasStableTextLineRange(view, edge.before(), edge.pos, end, true)) return false;
      target = end;
    }
    selected = collapsed
      ? TextSelection.create(state.doc, anchor.pos, target)
      : home
        ? TextSelection.create(state.doc, forward ? target : anchor.pos, forward ? head.pos : target)
        : TextSelection.create(state.doc, forward ? anchor.pos : target, forward ? target : head.pos);
  } catch {
    return false;
  }
  event.preventDefault();
  if (!state.selection.eq(selected)) view.dispatch(state.tr.setSelection(selected).setMeta("addToHistory", false));
  return true;
}

/** Extend an existing selection only within a validated heading visual line. */
function selectNonemptyHeadingEnd(view: EditorView, event: KeyboardEvent, remember: (origin: number) => void): boolean {
  if (
    view.isDestroyed ||
    !view.editable ||
    !view.hasFocus() ||
    event.defaultPrevented ||
    event.key !== "End" ||
    !event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.isComposing ||
    event.keyCode === 229 ||
    view.composing ||
    !(view.state.selection instanceof TextSelection)
  )
    return false;
  const native = view.dom.ownerDocument.getSelection();
  if (
    !native ||
    native.isCollapsed ||
    !native.anchorNode ||
    !native.focusNode ||
    !view.dom.contains(native.anchorNode) ||
    !view.dom.contains(native.focusNode)
  )
    return false;
  let selected: TextSelection;
  let anchor: number;
  let end: number;
  let origin: number;
  const doc = view.state.doc;
  try {
    anchor = view.posAtDOM(native.anchorNode, native.anchorOffset);
    const position = view.posAtDOM(native.focusNode, native.focusOffset);
    if (
      !view.state.selection.empty &&
      (view.state.selection.anchor !== anchor || view.state.selection.head !== position)
    )
      return false;
    origin = position;
    const $anchor = view.state.doc.resolve(anchor),
      $head = view.state.doc.resolve(position);
    const heading = $head.parent;
    if (
      heading.type.name !== "heading" ||
      !Number.isInteger(heading.attrs.level) ||
      heading.attrs.level < 1 ||
      heading.attrs.level > 6 ||
      $anchor.parent !== heading ||
      $anchor.start() !== $head.start()
    )
      return false;
    const inside =
      $head.depth === 1 ||
      ($head.depth === 2 && $head.node(1).type.name === "blockquote") ||
      ($head.depth === 3 && $head.node(1).type.name === "details" && $head.node(2).type.name === "detailsContent");
    if (!inside) return false;
    const before = view.coordsAtPos(position, -1),
      after = view.coordsAtPos(position, 1);
    const center = (before.top + before.bottom) / 2;
    if (after.top > center || after.bottom < center) return false;
    const singleLine = singleVisualTextHeading(view, heading, $head.before());
    const target = singleLine
      ? $head.end()
      : multiVisualLineEnd(view, heading, $head.before(), position, !event.getModifierState("AltGraph"));
    if (target === null) return false;
    end = target;
    selected = TextSelection.create(doc, anchor, end);
  } catch {
    return false;
  }
  // 选区事务一旦交给宿主，本次按键即结束；拒绝或重入不能继续执行原生扩选。
  event.preventDefault();
  if (!view.state.selection.eq(selected))
    view.dispatch(view.state.tr.setSelection(selected).setMeta("addToHistory", false));
  if (
    view.isDestroyed ||
    !view.editable ||
    !view.hasFocus() ||
    view.state.doc !== doc ||
    !view.state.selection.eq(selected)
  )
    return true;
  try {
    const committed = view.dom.ownerDocument.getSelection();
    if (
      !committed?.anchorNode ||
      !committed.focusNode ||
      !view.dom.contains(committed.anchorNode) ||
      !view.dom.contains(committed.focusNode) ||
      view.posAtDOM(committed.anchorNode, committed.anchorOffset) !== anchor ||
      view.posAtDOM(committed.focusNode, committed.focusOffset) !== end
    )
      return true;
    remember(origin);
    return true;
  } catch {
    return true;
  }
}

/** 探测后恢复光标；宿主状态变化或探测失败时停止本次默认操作。 */
function probeWrappedLineSide(view: EditorView, position: number, target: number): "upper" | "lower" | "abort" | null {
  const selection = view.dom.ownerDocument.getSelection();
  const state = view.state;
  if (!selection?.isCollapsed || !selection.anchorNode || typeof selection.modify !== "function") return null;
  const anchorNode = selection.anchorNode;
  const anchorOffset = selection.anchorOffset;
  try {
    selection.modify("extend", "forward", "lineboundary");
    if (view.state !== state || view.isDestroyed || !view.hasFocus()) return "abort";
    if (
      !selection.anchorNode ||
      !selection.focusNode ||
      view.posAtDOM(selection.anchorNode, selection.anchorOffset) !== position
    ) {
      selection.collapse(anchorNode, anchorOffset);
      return "abort";
    }
    const end = view.posAtDOM(selection.focusNode, selection.focusOffset);
    const upper = selection.isCollapsed && end === position;
    const lower = !selection.isCollapsed && end === target;
    if (upper) {
      // 向前一个字符再移至该行末，恢复浏览器隐藏的上行亲和性。
      selection.modify("move", "backward", "character");
      selection.modify("move", "forward", "lineboundary");
    } else {
      selection.collapse(anchorNode, anchorOffset);
    }
    if (
      (!upper && !lower) ||
      view.state !== state ||
      view.isDestroyed ||
      !view.hasFocus() ||
      !selection.isCollapsed ||
      !selection.anchorNode ||
      view.posAtDOM(selection.anchorNode, selection.anchorOffset) !== position
    )
      return "abort";
    return upper ? "upper" : "lower";
  } catch {
    if (view.state === state && !view.isDestroyed && view.hasFocus()) {
      try {
        selection.collapse(anchorNode, anchorOffset);
      } catch {
        // 宿主可能已经移除选区节点；交还当前状态并阻止本次默认操作。
      }
    }
    return "abort";
  }
}

function selectHeadingEnd(view: EditorView, event: KeyboardEvent, provenVisualLine = false): boolean {
  const home = event.key === "Home" && !event.shiftKey;
  const shiftHome = event.key === "Home" && event.shiftKey;
  const shiftEnd = event.key === "End" && event.shiftKey;
  if (
    view.isDestroyed ||
    !view.editable ||
    !view.hasFocus() ||
    event.defaultPrevented ||
    (!home && !shiftHome && !shiftEnd) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.isComposing ||
    event.keyCode === 229 ||
    view.composing ||
    !(view.state.selection instanceof TextSelection) ||
    (shiftEnd && !view.state.selection.empty)
  )
    return false;
  const native = view.dom.ownerDocument.getSelection();
  if (
    !native?.anchorNode ||
    !native.focusNode ||
    (shiftEnd && !native.isCollapsed) ||
    !view.dom.contains(native.anchorNode) ||
    !view.dom.contains(native.focusNode)
  )
    return false;
  let transaction: Transaction | undefined;
  let syncNativeSelection = false;
  try {
    const nativeHead = view.state.doc.resolve(view.posAtDOM(native.focusNode, native.focusOffset));
    const nativeAnchor = view.state.doc.resolve(view.posAtDOM(native.anchorNode, native.anchorOffset));
    if (
      !view.state.selection.empty &&
      (view.state.selection.anchor !== nativeAnchor.pos || view.state.selection.head !== nativeHead.pos)
    )
      return false;
    const crossesBlock = !nativeAnchor.sameParent(nativeHead);
    const forwardCrossHeading =
      shiftHome && crossesBlock && nativeAnchor.pos < nativeHead.pos && nativeAnchor.parent.type.name === "heading";
    const cursor = forwardCrossHeading ? nativeAnchor : nativeHead;
    const position = cursor.pos;
    const heading = cursor.parent;
    if (
      heading.type.name !== "heading" ||
      !Number.isInteger(heading.attrs.level) ||
      heading.attrs.level < 1 ||
      heading.attrs.level > 6 ||
      (crossesBlock &&
        (!shiftHome ||
          event.getModifierState("AltGraph") ||
          view.state.selection.empty ||
          native.isCollapsed ||
          (!forwardCrossHeading && nativeHead.pos > nativeAnchor.pos))) ||
      ((home || shiftHome) &&
        heading.attrs.semloEditorHeadingNumbering != null &&
        !numberedStyles.has(heading.attrs.semloEditorHeadingNumbering))
    )
      return false;
    const insideRoot = cursor.depth === 1;
    const insideQuote = cursor.depth === 2 && cursor.node(1).type.name === "blockquote";
    const insideDetails =
      cursor.depth === 3 && cursor.node(1).type.name === "details" && cursor.node(2).type.name === "detailsContent";
    if (!insideRoot && !insideQuote && !insideDetails) return false;
    // 仅接管已核对的末尾 Home 与行首 Shift+End，不猜测双向行内选区。
    const allowTrailingRtl =
      view.state.selection.empty &&
      native.isCollapsed &&
      !event.getModifierState("AltGraph") &&
      ((home && cursor.parentOffset === heading.content.size) || (shiftEnd && cursor.parentOffset === 0));
    const singleLine =
      singleVisualTextHeading(view, heading, cursor.before(), "ltr", allowTrailingRtl) ||
      ((shiftEnd || home) &&
        !event.getModifierState("AltGraph") &&
        singleVisualTextHeading(view, heading, cursor.before(), "rtl"));
    let anchor = cursor.start();
    let head = home ? cursor.start() : cursor.end();
    if (shiftHome) {
      if (singleLine) {
        if (position > cursor.start()) {
          const content = heading.textBetween(0, heading.content.size, "", "\n");
          // 不能仅凭重叠矩形认定标题为单行，也不能在字素内部扩选。
          if (
            content.length !== heading.content.size ||
            previousGraphemeBoundary(content, cursor.parentOffset) === null ||
            !hasStableTextLineRange(view, cursor.before(), cursor.start(), position)
          )
            return false;
        }
        anchor = forwardCrossHeading ? cursor.start() : nativeAnchor.pos;
        head = forwardCrossHeading ? nativeHead.pos : cursor.start();
      } else if (
        event.getModifierState("AltGraph") ||
        (!crossesBlock && (!view.state.selection.empty || !native.isCollapsed))
      )
        return false;
    }
    if (singleLine && shiftEnd && cursor.parentOffset !== 0) {
      if (event.getModifierState("AltGraph")) return false;
      const previous = previousGraphemeBoundary(heading.textContent, cursor.parentOffset);
      if (previous === null) return false;
      const validatedPosition = position === cursor.end() ? cursor.start() + previous : position;
      if (multiVisualLineEnd(view, heading, cursor.before(), validatedPosition, true) !== cursor.end()) return false;
      anchor = position;
    }
    if (!singleLine) {
      if (home || shiftHome) {
        // 明确的 hardBreak 给出下一逻辑行的起点；仍验证完整布局及其第一视觉行，
        // 不能把同一逻辑行的后续自动换行误当作该起点。
        if (heading.content.size > 4096 || heading.childCount > 256) return false;
        let start = cursor.start();
        heading.forEach((node, offset) => {
          if (node.type.name === "hardBreak" && offset < cursor.parentOffset)
            start = cursor.start() + offset + node.nodeSize;
        });
        if (shiftHome) {
          const content = heading.textBetween(0, heading.content.size, "", "\n");
          // 只扩展明确换行之后已核对的视觉行，且不能把光标拆在字素内部。
          if (
            start === cursor.start() ||
            content.length !== heading.content.size ||
            previousGraphemeBoundary(content, cursor.parentOffset) === null ||
            !hasStableTextLineRange(view, cursor.before(), start, position)
          )
            return false;
        }
        // Shift+Home 已逐项核对光标和文字范围，可接受默认 H1 字形略高于行距。
        const firstEnd = multiVisualLineEnd(view, heading, cursor.before(), start, false, shiftHome);
        if (firstEnd === null || position > firstEnd) return false;
        anchor = shiftHome && !forwardCrossHeading ? nativeAnchor.pos : start;
        head = forwardCrossHeading ? nativeHead.pos : start;
        if (position === firstEnd && position > start) {
          // A wrapped boundary can represent a caret on either adjacent line;
          // only handle it when both position affinities remain on one line.
          const before = view.coordsAtPos(position, -1);
          const after = view.coordsAtPos(position, 1);
          const center = (before.top + before.bottom) / 2;
          if (after.top > center || after.bottom < center) return false;
        }
      } else {
        // At an automatic wrap the same model position can denote either the
        // preceding line's end or the next line's start. Do not guess.
        const before = view.coordsAtPos(position, -1);
        const after = view.coordsAtPos(position, 1);
        const center = (before.top + before.bottom) / 2;
        if (
          !provenVisualLine &&
          cursor.parentOffset > 0 &&
          cursor.nodeBefore?.type.name !== "hardBreak" &&
          (after.top > center || after.bottom < center)
        ) {
          if (!event.isTrusted || event.getModifierState("AltGraph")) return false;
          const end = multiVisualLineEnd(view, heading, cursor.before(), position, true);
          if (end === null || end <= position) return false;
          const side = probeWrappedLineSide(view, position, end);
          if (side === "upper" || side === "abort") {
            event.preventDefault();
            return true;
          }
          if (side !== "lower") return false;
        }
        const target = multiVisualLineEnd(
          view,
          heading,
          cursor.before(),
          position,
          !event.getModifierState("AltGraph"),
        );
        if (target === null) return false;
        anchor = position;
        head = target;
      }
    }
    const selected = TextSelection.create(view.state.doc, anchor, head);
    if ((home || anchor === head) && view.state.selection.eq(selected))
      syncNativeSelection = position !== selected.anchor;
    else transaction = view.state.tr.setSelection(selected).setMeta("addToHistory", false);
  } catch {
    return false;
  }
  // Once a transaction is dispatched, its final result belongs to the host.
  event.preventDefault();
  if (transaction) {
    view.dispatch(transaction);
  } else if (syncNativeSelection) view.focus();
  return true;
}

export const HeadingEndSelection = Extension.create({
  name: "semloEditorHeadingEndSelection",
  priority: 1002,
  addProseMirrorPlugins() {
    const key = new PluginKey<number>("semloEditorHeadingEndSelection");
    const home = new HeadingHomeLineEvidence(multiVisualLineEnd, (state) => key.getState(state));
    let clickLine: {
      doc: ProseMirrorNode;
      state: EditorState;
      synced: boolean;
      pos: number;
      node: Node;
      rects: number[];
    } | null = null;
    let repeatedEnd: {
      state: EditorState;
      origin: number;
      anchor: number;
      head: number;
      node: Element;
      rects: number[];
    } | null = null;
    const rectsAt = (view: EditorView, pos: number, node: Element): number[] => {
      const before = view.coordsAtPos(pos, -1),
        after = view.coordsAtPos(pos, 1),
        box = node.getBoundingClientRect();
      return [
        before.left,
        before.top,
        before.bottom,
        after.left,
        after.top,
        after.bottom,
        box.left,
        box.top,
        box.right,
        box.bottom,
      ];
    };
    return [
      new Plugin({
        key,
        state: { init: () => 0, apply: (_tr, count) => count + 1 },
        props: {
          handleDOMEvents: {
            pointerdown: () => {
              home.clear();
              clickLine = null;
              repeatedEnd = null;
              return false;
            },
            mousedown: () => {
              home.clear();
              clickLine = null;
              repeatedEnd = null;
              return false;
            },
            click(view, event) {
              clickLine = null;
              repeatedEnd = null;
              if (
                !event.isTrusted ||
                event.detail !== 1 ||
                event.button !== 0 ||
                event.shiftKey ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey
              )
                return false;
              try {
                const native = view.dom.ownerDocument.getSelection();
                if (!native?.isCollapsed || !native.anchorNode || !view.dom.contains(native.anchorNode)) return false;
                const pos = view.posAtDOM(native.anchorNode, native.anchorOffset),
                  resolved = view.state.doc.resolve(pos);
                if (resolved.parent.type.name !== "heading") return false;
                const node = view.nodeDOM(resolved.before());
                if (
                  !(node instanceof view.dom.ownerDocument.defaultView!.Element) ||
                  !node.contains(event.target as Node)
                )
                  return false;
                const before = view.coordsAtPos(pos, -1),
                  after = view.coordsAtPos(pos, 1);
                const center = (after.top + after.bottom) / 2;
                if (before.top <= center && before.bottom >= center) return false;
                if (
                  event.clientY < after.top ||
                  event.clientY > after.bottom ||
                  Math.abs(event.clientX - after.left) > 2
                )
                  return false;
                clickLine = {
                  doc: view.state.doc,
                  state: view.state,
                  synced: view.state.selection.empty && view.state.selection.anchor === pos,
                  pos,
                  node,
                  rects: rectsAt(view, pos, node),
                };
              } catch {
                clickLine = null;
              }
              return false;
            },
          },
          handleKeyDown(view, event) {
            if (event.key === "Home" && event.shiftKey) {
              clickLine = null;
              repeatedEnd = null;
              home.clear();
              const candidate = home.prepare(view, event, true);
              if (candidate) {
                const selected = TextSelection.create(candidate.document, candidate.source, candidate.start);
                // 与 Home、Shift+End 保持相同的事务归属，尊重宿主最终选区。
                event.preventDefault();
                if (!view.state.selection.eq(selected))
                  view.dispatch(view.state.tr.setSelection(selected).setMeta("addToHistory", false));
                return true;
              }
              return (
                selectTextLineBoundary(view, event, true) ||
                selectHeadingEnd(view, event) ||
                stopUnverifiedHeadingLineSelection(view, event)
              );
            }
            if (event.key === "Home" && !event.shiftKey) {
              clickLine = null;
              repeatedEnd = null;
              if (home.handle(view, event)) return true;
              return selectHeadingEnd(view, event) || stopUnverifiedHeadingLineSelection(view, event);
            }
            if (event.key === "Shift") return selectHeadingEnd(view, event);
            const eligible =
              event.isTrusted &&
              !event.defaultPrevented &&
              event.key === "End" &&
              event.shiftKey &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.isComposing &&
              event.keyCode !== 229 &&
              !view.composing;
            if (eligible && selectTextLineBoundary(view, event, false)) {
              clickLine = null;
              repeatedEnd = null;
              home.clear();
              return true;
            }
            if (
              eligible &&
              !event.getModifierState("AltGraph") &&
              repeatedEnd &&
              repeatedEnd.state === view.state &&
              view.editable &&
              view.hasFocus()
            ) {
              try {
                const hint = repeatedEnd;
                const native = view.dom.ownerDocument.getSelection();
                const resolved = view.state.doc.resolve(hint.origin);
                const node = view.nodeDOM(resolved.before());
                if (
                  native?.anchorNode &&
                  native.focusNode &&
                  !native.isCollapsed &&
                  view.dom.contains(native.anchorNode) &&
                  view.dom.contains(native.focusNode) &&
                  view.posAtDOM(native.anchorNode, native.anchorOffset) === hint.anchor &&
                  view.posAtDOM(native.focusNode, native.focusOffset) === hint.head &&
                  node === hint.node &&
                  rectsAt(view, hint.origin, hint.node).every((value, i) => value === hint.rects[i]) &&
                  multiVisualLineEnd(view, resolved.parent, resolved.before(), hint.origin, true) === hint.head
                ) {
                  event.preventDefault();
                  return true;
                }
              } catch {
                /* Fall back when the host or layout cannot be verified. */
              }
            }
            repeatedEnd = null;
            if (
              eligible &&
              selectNonemptyHeadingEnd(view, event, (origin) => {
                try {
                  const resolved = view.state.doc.resolve(origin);
                  const node = view.nodeDOM(resolved.before());
                  if (!(node instanceof view.dom.ownerDocument.defaultView!.Element)) return;
                  repeatedEnd = {
                    state: view.state,
                    origin,
                    anchor: view.state.selection.anchor,
                    head: view.state.selection.head,
                    node,
                    rects: rectsAt(view, origin, node),
                  };
                } catch {
                  repeatedEnd = null;
                }
              })
            ) {
              clickLine = null;
              home.clear();
              return true;
            }
            let clicked = false;
            if (eligible && clickLine && clickLine.doc === view.state.doc && clickLine.state === view.state) {
              try {
                const native = view.dom.ownerDocument.getSelection();
                const pos = native?.anchorNode ? view.posAtDOM(native.anchorNode, native.anchorOffset) : -1;
                const node = view.nodeDOM(view.state.doc.resolve(clickLine.pos).before());
                clicked =
                  !!native?.isCollapsed &&
                  pos === clickLine.pos &&
                  node === clickLine.node &&
                  node instanceof view.dom.ownerDocument.defaultView!.Element &&
                  rectsAt(view, pos, node).every((value, index) => value === clickLine!.rects[index]);
              } catch {
                clicked = false;
              }
            }
            clickLine = null;
            const proven = eligible ? home.consume(view, view.state.selection.anchor) || clicked : false;
            if (!eligible) home.clear();
            return selectHeadingEnd(view, event, proven) || stopUnverifiedHeadingLineSelection(view, event);
          },
        },
        view(view) {
          home.attach(view);
          const doc = view.dom.ownerDocument;
          const win = doc.defaultView;
          const clearClick = () => {
            clickLine = null;
            repeatedEnd = null;
          };
          const onSelectionChange = () => {
            const selection = doc.getSelection();
            try {
              if (
                repeatedEnd &&
                (!selection?.anchorNode ||
                  !selection.focusNode ||
                  selection.isCollapsed ||
                  !view.dom.contains(selection.anchorNode) ||
                  !view.dom.contains(selection.focusNode) ||
                  view.posAtDOM(selection.anchorNode, selection.anchorOffset) !== repeatedEnd.anchor ||
                  view.posAtDOM(selection.focusNode, selection.focusOffset) !== repeatedEnd.head)
              )
                repeatedEnd = null;
              if (
                clickLine &&
                (!selection?.isCollapsed ||
                  !selection.anchorNode ||
                  !view.dom.contains(selection.anchorNode) ||
                  view.posAtDOM(selection.anchorNode, selection.anchorOffset) !== clickLine.pos)
              )
                clickLine = null;
            } catch {
              clearClick();
            }
          };
          doc.addEventListener("selectionchange", onSelectionChange);
          doc.addEventListener("scroll", clearClick, true);
          view.dom.addEventListener("blur", clearClick, true);
          win?.addEventListener("resize", clearClick);
          win?.visualViewport?.addEventListener("scroll", clearClick);
          win?.visualViewport?.addEventListener("resize", clearClick);
          return {
            update(view) {
              home.update(view);
              if (repeatedEnd && repeatedEnd.state !== view.state) repeatedEnd = null;
              if (clickLine && clickLine.state !== view.state) {
                if (
                  !clickLine.synced &&
                  clickLine.doc === view.state.doc &&
                  view.state.selection.empty &&
                  view.state.selection.anchor === clickLine.pos
                ) {
                  clickLine.state = view.state;
                  clickLine.synced = true;
                } else clickLine = null;
              }
            },
            destroy() {
              clickLine = null;
              repeatedEnd = null;
              doc.removeEventListener("selectionchange", onSelectionChange);
              doc.removeEventListener("scroll", clearClick, true);
              view.dom.removeEventListener("blur", clearClick, true);
              win?.removeEventListener("resize", clearClick);
              win?.visualViewport?.removeEventListener("scroll", clearClick);
              win?.visualViewport?.removeEventListener("resize", clearClick);
              home.destroy();
            },
          };
        },
      }),
    ];
  },
});
