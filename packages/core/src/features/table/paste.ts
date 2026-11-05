import type { Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { Plugin, Selection, TextSelection, type SelectionBookmark } from "@tiptap/pm/state";
import { CellSelection, TableMap, addColumn, addRow, isInTable, selectedRect } from "@tiptap/pm/tables";
import type { Mappable } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { rebaseOrderedListLevelStarts } from "../list/ordinals";
import { adjustParagraphIndent } from "../text/paragraph-layout";
import {
  cellBackground,
  cellVerticalAlign,
  cellLineHeight,
  yuqueLineHeight,
  pastedFontSize,
  cellFontSizeChain,
  cellFontVariables,
  resolvedCellFontSize,
} from "./attributes";
import { semloEditorTableClipboardKey } from "./keys";
import { selectedTableText } from "./selection";
import { clearTableCells, dispatchTableChange } from "./transactions";

const simpleLineText =
  /^[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Inherited}\t\n\x20-\x7e\u2000-\u2027\u202f-\u2065\u2600-\u27bf\u3000-\u303f\uff01-\uff60\u{1f000}-\u{1faff}]*$/u;
const bidiControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function indentableCellTextblock(position: ResolvedPos): boolean {
  for (let depth = position.depth - 1; depth >= 0; depth--) {
    const node = position.node(depth);
    if (["cell", "header_cell"].includes(node.type.spec.tableRole ?? "")) return true;
    if (node.type.name !== "blockquote" || position.parent.type.name !== "paragraph") return false;
  }
  return false;
}

function indentableCellListItem(position: ResolvedPos): boolean {
  if (position.depth < 4 || position.parent.type.name !== "paragraph") return false;
  const item = position.node(-1);
  const list = position.node(-2);
  const cell = position.node(-3);
  return (
    item.type.name === "listItem" &&
    item.firstChild === position.parent &&
    ["bulletList", "orderedList"].includes(list.type.name) &&
    ["cell", "header_cell"].includes(cell.type.spec.tableRole ?? "")
  );
}

function safeVisualLine(view: EditorView, position: ResolvedPos): boolean {
  const parent = position.parent;
  if (parent.content.size > 4096 || parent.childCount > 256 || bidiControls.test(parent.textContent)) return false;
  if (!simpleLineText.test(parent.textContent)) return false;
  const first = parent.firstChild;
  const singleMark =
    parent.childCount === 1 && first?.isText && first.marks.length === 1 ? first.marks[0].type.name : null;
  const allowedTags =
    singleMark === "bold"
      ? ["STRONG", "B"]
      : singleMark === "italic"
        ? ["EM", "I"]
        : singleMark === "underline"
          ? ["U"]
          : null;
  let supported = true;
  parent.forEach((node) => {
    if ((node.isText && node.marks.length > 0 && !allowedTags) || (!node.isText && node.type.name !== "hardBreak"))
      supported = false;
  });
  if (!supported) return false;
  const win = view.dom.ownerDocument.defaultView;
  const element = view.nodeDOM(position.before());
  if (!win || !(element instanceof win.HTMLElement)) return false;
  let contentElement = element;
  if (allowedTags) {
    const marked = element.firstElementChild;
    if (
      element.childNodes.length !== 1 ||
      !(marked instanceof win.HTMLElement) ||
      !allowedTags.includes(marked.tagName)
    )
      return false;
    contentElement = marked;
  }
  if (parent.type.name === "codeBlock") {
    const matches = element.querySelectorAll(".semlo-editor-code-body > pre > code");
    const code = matches[0];
    if (matches.length !== 1 || !(code instanceof win.HTMLElement)) return false;
    const style = win.getComputedStyle(code);
    if (style.direction !== "ltr" || style.writingMode !== "horizontal-tb" || style.unicodeBidi !== "normal")
      return false;
    contentElement = code;
  }
  if (
    contentElement.textContent !== parent.textContent ||
    [...contentElement.childNodes].some((node) => node.nodeType !== 3 && !(node instanceof win.HTMLBRElement))
  )
    return false;
  for (let ancestor: HTMLElement | null = contentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = win.getComputedStyle(ancestor);
    if (
      style.direction !== "ltr" ||
      style.writingMode !== "horizontal-tb" ||
      !["normal", "isolate"].includes(style.unicodeBidi) ||
      style.transform !== "none" ||
      (style.columnCount !== "auto" && style.columnCount !== "1")
    )
      return false;
    if (ancestor === view.dom) break;
  }
  return true;
}

function safeSingleFormattedLine(view: EditorView, position: ResolvedPos): boolean {
  const parent = position.parent;
  if (parent.childCount < 2 || parent.childCount > 128 || parent.content.size > 4096) return false;
  if (bidiControls.test(parent.textContent) || !simpleLineText.test(parent.textContent)) return false;
  const win = view.dom.ownerDocument.defaultView;
  const element = view.nodeDOM(position.before());
  if (!win || !(element instanceof win.HTMLElement) || element.childNodes.length !== parent.childCount) return false;
  const tags: Record<string, string[]> = { bold: ["STRONG", "B"], italic: ["EM", "I"], underline: ["U"] };
  const rects: DOMRect[] = [];
  let metrics: string | undefined;
  let safe = true;
  parent.forEach((child, _offset, index) => {
    const dom = element.childNodes[index];
    if (!child.isText || child.marks.length > 1 || !dom || dom.textContent !== child.text) {
      safe = false;
      return;
    }
    const mark = child.marks[0];
    if (mark) {
      if (
        !(dom instanceof win.HTMLElement) ||
        !tags[mark.type.name]?.includes(dom.tagName) ||
        [...dom.childNodes].some((node) => node.nodeType !== 3)
      ) {
        safe = false;
        return;
      }
    } else if (dom.nodeType !== 3) {
      safe = false;
      return;
    }
    const owner = dom instanceof win.HTMLElement ? dom : element;
    const style = win.getComputedStyle(owner);
    const current = [style.fontFamily, style.fontSize, style.lineHeight, style.verticalAlign].join("|");
    if (metrics !== undefined && metrics !== current) safe = false;
    metrics = current;
    if (
      style.direction !== "ltr" ||
      style.writingMode !== "horizontal-tb" ||
      !["normal", "isolate"].includes(style.unicodeBidi) ||
      style.transform !== "none" ||
      (mark &&
        (style.unicodeBidi !== "normal" ||
          style.display !== "inline" ||
          style.position !== "static" ||
          style.float !== "none"))
    )
      safe = false;
    const range = view.dom.ownerDocument.createRange();
    range.selectNodeContents(dom);
    const boxes = [...range.getClientRects()].filter((rect) => rect.height > 0);
    if (boxes.length !== 1) safe = false;
    else rects.push(boxes[0]);
  });
  if (!safe || rects.length !== parent.childCount) return false;
  const commonTop = Math.max(...rects.map((rect) => rect.top));
  const commonBottom = Math.min(...rects.map((rect) => rect.bottom));
  const centers = rects.map((rect) => (rect.top + rect.bottom) / 2);
  if (
    commonBottom <= commonTop ||
    Math.max(...centers) - Math.min(...centers) > Math.min(...rects.map((r) => r.height)) / 2
  )
    return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = win.getComputedStyle(ancestor);
    if (
      style.direction !== "ltr" ||
      style.writingMode !== "horizontal-tb" ||
      !["normal", "isolate"].includes(style.unicodeBidi) ||
      style.transform !== "none" ||
      (style.columnCount !== "auto" && style.columnCount !== "1")
    )
      return false;
    if (ancestor === view.dom) break;
  }
  return true;
}

function graphemeBoundary(position: ResolvedPos): boolean {
  if (typeof Intl.Segmenter !== "function") return false;
  const text = position.parent.textBetween(0, position.parent.content.size, "\n", "\ufffc");
  const offset = position.parentOffset;
  if (offset === text.length) return true;
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].some(
    (part) => part.index === offset,
  );
}

function visualLineEnd(view: EditorView, start: number, end: number): number {
  if (start >= end) return start;
  const firstLine = view.coordsAtPos(start, 1);
  let low = start + 1;
  let high = end + 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (view.coordsAtPos(middle, -1).top >= firstLine.bottom - 1) high = middle;
    else low = middle + 1;
  }
  return low - 1;
}

function visualLineStart(view: EditorView, start: number, end: number): number {
  if (start >= end) return end;
  const lastLine = view.coordsAtPos(end, 1);
  let low = start;
  let high = end;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (view.coordsAtPos(middle, 1).bottom <= lastLine.top + 1) low = middle + 1;
    else high = middle;
  }
  return low;
}

function alignPastedCells(slice: Slice): Slice {
  let changed = false;
  const visit = (node: ProseMirrorNode, align: string | null, color: string | null): ProseMirrorNode => {
    const role = node.type.spec.tableRole;
    if (role === "cell" || role === "header_cell") {
      align = ["left", "center", "right", "justify"].includes(node.attrs.semloEditorCellTextAlign)
        ? node.attrs.semloEditorCellTextAlign
        : null;
      color = cellBackground(node.attrs.semloEditorCellTextColor);
    }
    if (node.isText && color) {
      const type = node.type.schema.marks.textStyle;
      const mark = type?.isInSet(node.marks);
      if (type && !mark?.attrs.color) {
        changed = true;
        return node.mark(type.create({ ...mark?.attrs, color }).addToSet(node.marks));
      }
    }
    let result = node;
    if (node.isTextblock && align && Object.hasOwn(node.attrs, "textAlign") && !node.attrs.textAlign) {
      changed = true;
      result = node.type.create({ ...node.attrs, textAlign: align }, node.content, node.marks);
    }
    if (result.isLeaf) return result;
    const children: ProseMirrorNode[] = [];
    result.forEach((child) => children.push(visit(child, align, color)));
    const fragment = Fragment.fromArray(children);
    return fragment.eq(result.content) ? result : result.copy(fragment);
  };
  const children: ProseMirrorNode[] = [];
  slice.content.forEach((node) => children.push(visit(node, null, null)));
  return changed ? new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd) : slice;
}

class TableCodeBoundaryDefinition extends Selection {
  readonly side: "before" | "after";
  visible = false;
  constructor($pos: ResolvedPos, side: "before" | "after") {
    super($pos, $pos);
    this.side = side;
  }
  static valid($pos: ResolvedPos, side: "before" | "after") {
    const adjacent = side === "before" ? $pos.nodeAfter : $pos.nodeBefore;
    return ["tableCell", "tableHeader"].includes($pos.parent.type.name) && adjacent?.type.name === "codeBlock";
  }
  eq(other: Selection) {
    return other instanceof TableCodeBoundary && other.head === this.head && other.side === this.side;
  }
  map(doc: ProseMirrorNode, mapping: Mappable): Selection {
    const mapped = mapping.map(this.head, this.side === "before" ? 1 : -1);
    const $pos = doc.resolve(mapped);
    return TableCodeBoundary.valid($pos, this.side) ? new TableCodeBoundary($pos, this.side) : Selection.near($pos);
  }
  toJSON() {
    return { type: "semloEditorTableCodeBoundary", pos: this.head, side: this.side };
  }
  static fromJSON(doc: ProseMirrorNode, json: { pos: number; side: "before" | "after" }): Selection {
    const $pos = doc.resolve(json.pos);
    return TableCodeBoundary.valid($pos, json.side) ? new TableCodeBoundary($pos, json.side) : Selection.near($pos);
  }
  getBookmark(): SelectionBookmark {
    return new TableCodeBoundaryBookmark(this.head, this.side);
  }
}
class TableCodeBoundaryBookmark implements SelectionBookmark {
  constructor(
    readonly pos: number,
    readonly side: "before" | "after",
  ) {}
  map(mapping: Mappable) {
    return new TableCodeBoundaryBookmark(mapping.map(this.pos, this.side === "before" ? 1 : -1), this.side);
  }
  resolve(doc: ProseMirrorNode) {
    return TableCodeBoundary.fromJSON(doc, { pos: this.pos, side: this.side });
  }
}
// Browser entry bundles may share one ProseMirror registry. Reuse the type,
// while each editor keeps its document and selection in its own state.
const tableCodeBoundaryTypeKey = Symbol.for("semlo-editor.tableCodeBoundary.v1");
const existingTableCodeBoundary = Reflect.get(Selection, tableCodeBoundaryTypeKey) as
  | typeof TableCodeBoundaryDefinition
  | undefined;
const TableCodeBoundary = existingTableCodeBoundary ?? TableCodeBoundaryDefinition;
if (!existingTableCodeBoundary) {
  Selection.jsonID("semloEditorTableCodeBoundary", TableCodeBoundary);
  Reflect.set(Selection, tableCodeBoundaryTypeKey, TableCodeBoundary);
}

/** Match table-cell paste behavior while preserving destination merges where appropriate. */
export function mergedTablePaste(editor: Editor) {
  let navigatedCode: { doc: ProseMirrorNode; selection: Selection } | null = null;
  const selectNavigatedCell = (view: EditorView, position: number) => {
    const doc = view.state.doc;
    const cell = doc.nodeAt(position);
    if (!cell) return false;
    const next = TextSelection.between(doc.resolve(position), doc.resolve(position + cell.nodeSize));
    view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
    // The host may synchronously replace the document or selection during dispatch.
    navigatedCode =
      !view.isDestroyed &&
      view.editable &&
      view.state.doc === doc &&
      view.state.selection.eq(next) &&
      cell.childCount === 1 &&
      cell.firstChild?.type.name === "codeBlock"
        ? { doc, selection: next }
        : null;
    return true;
  };
  return new Plugin({
    key: semloEditorTableClipboardKey,
    view() {
      return {
        update(view) {
          if (
            navigatedCode &&
            (navigatedCode.doc !== view.state.doc || !navigatedCode.selection.eq(view.state.selection))
          )
            navigatedCode = null;
        },
      };
    },
    props: {
      decorations(state) {
        if (!(state.selection instanceof TableCodeBoundary)) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(state.selection.head, (view) => {
            const caret = view.dom.ownerDocument.createElement("span");
            caret.className = "semlo-editor-table-code-boundary";
            caret.style.cssText = "display:block;width:2px;height:1em;background:currentColor;pointer-events:none";
            return caret;
          }),
        ]);
      },
      transformPastedHTML(html, view) {
        if (!/<table(?:\s|>)/i.test(html)) return html;
        const document = view.dom.ownerDocument;
        const template = document.createElement("template");
        template.innerHTML = html;
        if (template.content.querySelector("[data-pm-slice]")) return html;
        let changed = false;
        const source = template.content.querySelector("ne-clipboard[source]")?.getAttribute("source");
        let yuqueSource = false;
        if (source) {
          try {
            const hostname = new URL(decodeURIComponent(source)).hostname.toLowerCase();
            yuqueSource = hostname === "yuque.com" || hostname.endsWith(".yuque.com");
          } catch {
            // Unrecognised clipboard metadata is not proof of origin.
          }
        }
        if (yuqueSource) {
          for (const element of template.content.querySelectorAll<HTMLElement>("table[style], table [style]")) {
            if (!element.style.fontFamily) continue;
            element.style.removeProperty("font-family");
            changed = true;
          }
        }
        for (const block of template.content.querySelectorAll<HTMLElement>(
          "table p[style], table h1[style], table h2[style], table h3[style], table h4[style], table h5[style], table h6[style]",
        )) {
          const color = cellBackground(block.style.color);
          if (!color || !block.firstChild) continue;
          const span = document.createElement("span");
          span.style.color = color;
          while (block.firstChild) span.append(block.firstChild);
          block.append(span);
          changed = true;
        }
        for (const cell of template.content.querySelectorAll<HTMLElement>("table td, table th")) {
          if (yuqueSource) {
            const inherited = [cell, cell.parentElement, cell.closest("table")]
              .map((element) => (element ? yuqueLineHeight(element.style.lineHeight) : null))
              .find((value) => value !== null);
            const blocks = [...cell.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,h5,h6")];
            const inlineTags = new Set([
              "SPAN",
              "A",
              "B",
              "STRONG",
              "I",
              "EM",
              "U",
              "S",
              "STRIKE",
              "DEL",
              "SUB",
              "SUP",
              "BR",
              "CODE",
            ]);
            const inlineOnly =
              [...cell.childNodes].every(
                (node) => node.nodeType === 3 || (node.nodeType === 1 && inlineTags.has((node as HTMLElement).tagName)),
              ) && [...cell.querySelectorAll("*")].every((element) => inlineTags.has(element.tagName));
            if (!blocks.length && inherited && inlineOnly) {
              const paragraph = document.createElement("p");
              while (cell.firstChild) paragraph.append(cell.firstChild);
              cell.append(paragraph);
              blocks.push(paragraph);
              changed = true;
            }
            for (const block of blocks) {
              const height = yuqueLineHeight(block.style.lineHeight) ?? inherited;
              if (height && block.style.lineHeight !== height) {
                block.style.lineHeight = height;
                changed = true;
              }
            }
          } else {
            const row = cell.parentElement;
            const group = row?.parentElement;
            const table = cell.closest("table");
            const lineHeight = [cell, row, group, table]
              .map((element) => (element ? cellLineHeight(element.style.lineHeight) : null))
              .find((value) => value !== null);
            if (lineHeight) {
              cell.setAttribute("data-semlo-editor-cell-line-height", lineHeight);
              changed = true;
            }
            const chain = [...new Set([cell, row, group, table])]
              .map((element) => (element ? pastedFontSize(element.style.fontSize, false) : null))
              .filter((value): value is string => value !== null);
            const baseSize = chain.length ? (resolvedCellFontSize(chain) ?? chain[0]) : null;
            if (baseSize) {
              cell.setAttribute("data-semlo-editor-cell-base-font-size", baseSize);
              cell.setAttribute("data-semlo-editor-cell-font-size-chain", JSON.stringify(chain));
              changed = true;
            }
            const variables: Record<string, string> = {};
            for (const element of [cell, row, group, table]) {
              if (!element) continue;
              for (const name of element.style) {
                if (!name.startsWith("--") || name in variables) continue;
                const safe = cellFontVariables({ [name]: element.style.getPropertyValue(name).trim() });
                if (safe) variables[name] = safe[name];
              }
            }
            const safeVariables = cellFontVariables(variables);
            if (safeVariables) {
              cell.setAttribute("data-semlo-editor-cell-font-variables", JSON.stringify(safeVariables));
              changed = true;
            }
            if (!cell.style.backgroundColor && !row?.style.backgroundColor && group?.style.backgroundColor) {
              cell.style.backgroundColor = group.style.backgroundColor;
              changed = true;
            }
            if (!cell.style.textAlign && !row?.style.textAlign) {
              const alignment = group?.style.textAlign || table?.style.textAlign;
              if (alignment) {
                cell.style.textAlign = alignment;
                changed = true;
              }
            }
          }
          const walker = document.createTreeWalker(cell, 4);
          const texts: Text[] = [];
          while (walker.nextNode()) texts.push(walker.currentNode as Text);
          for (const text of texts) {
            if (!text.data.trim()) continue;
            let bold = false;
            let italic = false;
            let underline = false;
            let strike = false;
            let weightSet = false;
            let styleSet = false;
            let size = "";
            let sizeNode: HTMLElement | null = null;
            let family = "";
            let textColor = "";
            let current: HTMLElement | null = text.parentElement;
            while (current) {
              if (!yuqueSource || !["THEAD", "TBODY", "TFOOT"].includes(current.tagName)) {
                const weight = current.style.fontWeight;
                const isBold =
                  weight === "bold" || weight === "bolder" || (/^\d+$/.test(weight) && Number(weight) >= 500);
                const fontStyle = current.style.fontStyle;
                const isItalic = fontStyle === "italic" || fontStyle === "oblique";
                if (yuqueSource) {
                  bold ||= isBold;
                  italic ||= isItalic;
                } else {
                  if (weight && !weightSet) {
                    bold = isBold;
                    weightSet = true;
                  }
                  if (fontStyle && !styleSet) {
                    italic = isItalic;
                    styleSet = true;
                  }
                }
                const decoration = `${current.style.textDecoration} ${current.style.textDecorationLine}`;
                underline ||= decoration.includes("underline");
                strike ||= decoration.includes("line-through");
                if (!size) {
                  size = pastedFontSize(current.style.fontSize, yuqueSource) ?? "";
                  if (size) sizeNode = current;
                }
                if (!yuqueSource) {
                  family ||= current.style.fontFamily;
                  textColor ||= cellBackground(current.style.color) ?? "";
                }
              }
              if (current.tagName === "TABLE") break;
              current = current.parentElement;
            }
            const fromCellBase =
              !yuqueSource &&
              cell.hasAttribute("data-semlo-editor-cell-base-font-size") &&
              sizeNode &&
              (sizeNode === cell || sizeNode.contains(cell)) &&
              (/(?:%|em|rem|vh|vw|vmin|vmax)$/i.test(size) ||
                /^(?:calc|var|min|max|clamp)\(/i.test(size) ||
                /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger|inherit|initial|unset|revert|revert-layer)$/i.test(
                  size,
                ));
            const fontSize = fromCellBase ? null : size || null;
            if (!bold && !italic && !underline && !strike && !fontSize && !family && !textColor) continue;
            const span = document.createElement("span");
            if (bold) span.style.fontWeight = "bold";
            if (italic) span.style.fontStyle = "italic";
            if (underline || strike)
              span.style.textDecoration = [underline && "underline", strike && "line-through"]
                .filter(Boolean)
                .join(" ");
            if (fontSize) span.style.fontSize = fontSize;
            if (family) span.style.fontFamily = family;
            if (textColor) span.style.color = textColor;
            text.replaceWith(span);
            span.append(text);
            changed = true;
          }
        }
        if (!yuqueSource) {
          for (const element of template.content.querySelectorAll<HTMLElement>(
            "table[style], table tr[style], table td[style], table th[style], table thead[style], table tbody[style], table tfoot[style]",
          )) {
            if (!element.style.fontWeight && !element.style.fontStyle) continue;
            element.style.removeProperty("font-weight");
            element.style.removeProperty("font-style");
            changed = true;
          }
        }
        return changed ? template.innerHTML : html;
      },
      transformPasted: alignPastedCells,
      clipboardTextSerializer(slice, view) {
        const selection = view.state.selection;
        return selection instanceof CellSelection && slice.eq(selection.content()) ? selectedTableText(selection) : "";
      },
      handleDOMEvents: {
        beforeinput(view, event) {
          const selection = view.state.selection;
          if (
            event.inputType !== "insertCompositionText" ||
            !(selection instanceof TableCodeBoundary) ||
            !view.editable
          )
            return false;
          const paragraph = view.state.schema.nodes.paragraph?.create();
          if (!paragraph) return false;
          const tr = view.state.tr.insert(selection.head, paragraph);
          tr.setSelection(TextSelection.create(tr.doc, selection.head + 1));
          view.dispatch(tr);
          return false;
        },
        mousedown() {
          navigatedCode = null;
          return false;
        },
        keydown(view, event) {
          const selection = view.state.selection;
          if (event.isComposing || view.composing || event.keyCode === 229) return selection instanceof CellSelection;
          if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return false;
          const codeWasNavigated = navigatedCode?.doc === view.state.doc && navigatedCode.selection.eq(selection);
          if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) navigatedCode = null;
          if (
            view.editable &&
            codeWasNavigated &&
            event.shiftKey &&
            (event.key === "Home" || event.key === "End") &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            navigatedCode = { doc: view.state.doc, selection };
            event.preventDefault();
            return true;
          }
          if (
            view.editable &&
            codeWasNavigated &&
            event.shiftKey &&
            (event.key === "ArrowLeft" || event.key === "ArrowUp") &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const rect = selectedRect(view.state);
            const cells = [...new Set(rect.map.map)].sort((a, b) => a - b);
            const current = rect.map.map[rect.top * rect.map.width + rect.left];
            const previous =
              event.key === "ArrowLeft"
                ? cells[cells.indexOf(current) - 1]
                : rect.top > 0
                  ? rect.map.map[(rect.top - 1) * rect.map.width + rect.left]
                  : undefined;
            if (previous !== undefined) {
              event.preventDefault();
              view.dispatch(
                view.state.tr.setSelection(
                  CellSelection.create(view.state.doc, rect.tableStart + current, rect.tableStart + previous),
                ),
              );
              return true;
            }
          }
          if (
            view.editable &&
            codeWasNavigated &&
            event.key === "ArrowUp" &&
            !event.shiftKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const rect = selectedRect(view.state);
            if (rect.top > 0) {
              const target = rect.tableStart + rect.map.map[(rect.top - 1) * rect.map.width + rect.left];
              const cell = view.state.doc.nodeAt(target);
              if (cell?.childCount === 1 && cell.firstChild?.type.name === "paragraph") {
                event.preventDefault();
                view.dispatch(
                  view.state.tr
                    .setSelection(TextSelection.near(view.state.doc.resolve(target + 1), 1))
                    .scrollIntoView(),
                );
                return true;
              }
            }
          }
          if (
            view.editable &&
            codeWasNavigated &&
            event.key === "ArrowDown" &&
            !event.shiftKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const rect = selectedRect(view.state);
            const cells = [...new Set(rect.map.map)].sort((a, b) => a - b);
            const current = rect.map.map[rect.top * rect.map.width + rect.left];
            const next = cells[cells.indexOf(current) + 1];
            if (next !== undefined && rect.map.findCell(next).top === rect.top) {
              const cell = view.state.doc.nodeAt(rect.tableStart + next);
              const $pos = view.state.doc.resolve(rect.tableStart + next + 1);
              if (cell?.childCount === 1 && TableCodeBoundary.valid($pos, "before")) {
                event.preventDefault();
                view.dispatch(view.state.tr.setSelection(new TableCodeBoundary($pos, "before")).scrollIntoView());
                return true;
              }
            }
          }
          if (
            view.editable &&
            selection instanceof TableCodeBoundary &&
            !event.shiftKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            ((selection.side === "before" && event.key === "ArrowRight") ||
              (selection.side === "after" && event.key === "ArrowLeft"))
          ) {
            const pos = selection.head + (selection.side === "before" ? 1 : -1);
            event.preventDefault();
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).scrollIntoView());
            return true;
          }
          if (
            view.editable &&
            selection instanceof TableCodeBoundary &&
            !event.shiftKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            ((selection.side === "before" && event.key === "Delete") ||
              (selection.side === "after" && event.key === "Backspace"))
          ) {
            const node = selection.side === "before" ? selection.$from.nodeAfter : selection.$from.nodeBefore;
            const position = selection.side === "before" ? selection.head : selection.head - (node?.nodeSize ?? 0);
            const paragraph = view.state.schema.nodes.paragraph?.create();
            if (!node || !paragraph) return false;
            const tr = view.state.tr.replaceWith(position, position + node.nodeSize, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, position + 1));
            event.preventDefault();
            view.dispatch(tr.scrollIntoView());
            return true;
          }
          if (
            view.editable &&
            codeWasNavigated &&
            ["ArrowLeft", "ArrowRight", "ArrowDown", "Home", "End"].includes(event.key) &&
            (!event.shiftKey || event.key === "ArrowRight" || event.key === "ArrowDown") &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const rect = selectedRect(view.state);
            if (event.key === "ArrowDown" && !event.shiftKey) return false;
            const cellPos = rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left];
            const cell = view.state.doc.nodeAt(cellPos);
            const side = event.key === "ArrowRight" || event.key === "ArrowDown" ? "after" : "before";
            if (cell) {
              const pos = side === "before" ? cellPos + 1 : cellPos + cell.nodeSize - 1;
              const $pos = view.state.doc.resolve(pos);
              if (TableCodeBoundary.valid($pos, side)) {
                event.preventDefault();
                view.dispatch(view.state.tr.setSelection(new TableCodeBoundary($pos, side)));
                return true;
              }
            }
          }
          const platform = view.dom.ownerDocument.defaultView?.navigator.platform ?? "";
          const mac = /Mac|iPhone|iPad|iPod/i.test(platform);
          const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
          if (
            view.editable &&
            codeWasNavigated &&
            event.key === "Enter" &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const rect = selectedRect(view.state);
            const position = rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left];
            const cell = view.state.doc.nodeAt(position);
            const paragraph = view.state.schema.nodes.paragraph;
            const hardBreak = view.state.schema.nodes.hardBreak;
            if (!cell || !paragraph || !hardBreak) return false;
            const content = event.shiftKey
              ? Fragment.from(paragraph.create(null, hardBreak.create()))
              : Fragment.fromArray([paragraph.create(), paragraph.create()]);
            if (!cell.type.validContent(content)) return false;
            const tr = view.state.tr.replaceWith(position + 1, position + cell.nodeSize - 1, content);
            tr.setSelection(TextSelection.near(tr.doc.resolve(position + (event.shiftKey ? 3 : 4))));
            event.preventDefault();
            view.dispatch(tr.scrollIntoView());
            return true;
          }
          if (
            view.editable &&
            codeWasNavigated &&
            (event.key === "Backspace" || event.key === "Delete") &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey
          ) {
            const rect = selectedRect(view.state);
            const position = rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left];
            const cell = view.state.doc.nodeAt(position);
            const paragraph = view.state.schema.nodes.paragraph?.create();
            if (!cell || !paragraph || !cell.type.validContent(Fragment.from(paragraph))) return false;
            const tr = view.state.tr.replaceWith(position + 1, position + cell.nodeSize - 1, paragraph);
            tr.setSelection(TextSelection.near(tr.doc.resolve(position + 2)));
            event.preventDefault();
            view.dispatch(tr.scrollIntoView());
            return true;
          }
          if (
            view.editable &&
            selection instanceof CellSelection &&
            event.key === "Tab" &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const rect = selectedRect(view.state);
            const cells = [...new Set(rect.map.map)].sort((a, b) => a - b);
            const index = cells.indexOf(selection.$headCell.pos - rect.tableStart);
            if (index < 0) return false;
            const target = cells[index + (event.shiftKey ? -1 : 1)];
            const position = rect.tableStart + (target ?? cells[index]);
            if (!view.state.doc.nodeAt(position)) return false;
            event.preventDefault();
            return selectNavigatedCell(view, position);
          }
          if (
            view.editable &&
            selection instanceof TextSelection &&
            selection.empty &&
            selection.$from.parentOffset === 0 &&
            indentableCellListItem(selection.$from) &&
            event.key === "Tab" &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            event.preventDefault();
            const item = selection.$from.node(-1);
            const list = selection.$from.node(-2);
            const raw = item.attrs.semloEditorListIndent;
            const current = Number.isInteger(raw) && raw >= 0 && raw <= 8 ? raw : 0;
            const next = Math.max(0, Math.min(8, current + (event.shiftKey ? -1 : 1)));
            if (next === current) return true;
            if (list.type.name === "orderedList" && list.attrs.semloEditorOrderedAncestorPath != null) {
              adjustParagraphIndent(editor, event.shiftKey ? -1 : 1);
              return true;
            }
            let listAttrs: Record<string, unknown> | null = null;
            if (list.type.name === "orderedList" && selection.$from.index(selection.$from.depth - 2) === 0) {
              const rebased = rebaseOrderedListLevelStarts(list, next);
              if (!rebased.ok) return true;
              if (rebased.attrs) listAttrs = { ...list.attrs, ...rebased.attrs };
            }
            let transaction = view.state.tr.setNodeMarkup(
              selection.$from.before(selection.$from.depth - 1),
              undefined,
              {
                ...item.attrs,
                semloEditorListIndent: next,
              },
            );
            if (listAttrs)
              transaction = transaction.setNodeMarkup(
                selection.$from.before(selection.$from.depth - 2),
                undefined,
                listAttrs,
              );
            // Keep immediately following text input adjacent to this history event.
            transaction = transaction.setNodeMarkup(selection.$from.before(), undefined, selection.$from.parent.attrs);
            view.dispatch(transaction);
            return true;
          }
          if (
            view.editable &&
            selection instanceof TextSelection &&
            selection.empty &&
            selection.$from.parentOffset === 0 &&
            ["paragraph", "heading"].includes(selection.$from.parent.type.name) &&
            selection.$from.parent.textContent.length > 0 &&
            indentableCellTextblock(selection.$from) &&
            event.key === "Tab" &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const paragraph = selection.$from.parent;
            const raw = paragraph.attrs.semloEditorIndent;
            const current = Number.isInteger(raw) && raw >= 0 && raw <= 8 ? raw : 0;
            const next = Math.max(0, Math.min(8, current + (event.shiftKey ? -1 : 1)));
            event.preventDefault();
            if (next !== current)
              view.dispatch(
                view.state.tr.setNodeMarkup(selection.$from.before(), undefined, {
                  ...paragraph.attrs,
                  semloEditorIndent: next,
                }),
              );
            return true;
          }
          if (
            view.editable &&
            selection instanceof TextSelection &&
            isInTable(view.state) &&
            event.key === "Tab" &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            (codeWasNavigated || selection.$from.parent.type.name !== "codeBlock")
          ) {
            const rect = selectedRect(view.state);
            const cells = [...new Set(rect.map.map)].sort((a, b) => a - b);
            const current = rect.map.map[rect.top * rect.map.width + rect.left];
            const index = cells.indexOf(current);
            const target = cells[index + (event.shiftKey ? -1 : 1)];
            const position = target === undefined ? null : rect.tableStart + target;
            const cell = position === null ? null : view.state.doc.nodeAt(position);
            const isCodeCell = cell?.childCount === 1 && cell.firstChild?.type.name === "codeBlock";
            if (position !== null && (codeWasNavigated || isCodeCell)) {
              event.preventDefault();
              return selectNavigatedCell(view, position);
            }
            if (codeWasNavigated) {
              event.preventDefault();
              if (!event.shiftKey && editor.can().addRowAfter()) editor.chain().addRowAfter().goToNextCell().run();
              return true;
            }
          }
          if (
            selection instanceof TextSelection &&
            selection.$from.sameParent(selection.$to) &&
            selection.$to.parent.isTextblock &&
            (event.key === "Home" || event.key === "End") &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            isInTable(view.state)
          ) {
            const singleFormattedLine = safeSingleFormattedLine(view, selection.$head);
            if (!singleFormattedLine && !safeVisualLine(view, selection.$head)) return false;
            const head = event.shiftKey ? selection.head : event.key === "Home" ? selection.from : selection.to;
            let target = singleFormattedLine
              ? event.key === "Home"
                ? selection.$head.start()
                : selection.$head.end()
              : event.key === "Home"
                ? visualLineStart(view, selection.$head.start(), head)
                : visualLineEnd(view, head, selection.$head.end());
            if (
              event.key === "End" &&
              selection.$head.parent.type.name === "codeBlock" &&
              target > head &&
              view.state.doc.textBetween(target - 1, target) === "\n"
            )
              target--;
            const anchor = event.shiftKey ? selection.anchor : target;
            if (!graphemeBoundary(view.state.doc.resolve(target))) return false;
            event.preventDefault();
            if (anchor !== selection.anchor || target !== selection.head)
              view.dispatch(
                view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, target)).scrollIntoView(),
              );
            return true;
          }
          if (
            view.editable &&
            selection instanceof CellSelection &&
            ["Backspace", "Delete"].includes(event.key) &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey
          ) {
            event.preventDefault();
            return clearTableCells(view, true);
          }
          if (event.key.toLowerCase() === "a" && mod && !event.altKey && !event.shiftKey && isInTable(view.state)) {
            const rect = selectedRect(view.state);
            if (!(selection instanceof CellSelection)) {
              if (
                selection instanceof TextSelection &&
                selection.$from.parent.type.name === "codeBlock" &&
                selection.$from.sameParent(selection.$to)
              ) {
                event.preventDefault();
                const code = TextSelection.create(view.state.doc, selection.$from.start(), selection.$from.end());
                if (!selection.eq(code)) view.dispatch(view.state.tr.setSelection(code));
                return true;
              }
              const position = rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left];
              const cell = view.state.doc.nodeAt(position);
              if (!cell || selection.from < position + 1 || selection.to > position + cell.nodeSize - 1) return false;
              const allCellText = TextSelection.between(
                view.state.doc.resolve(position + 1),
                view.state.doc.resolve(position + cell.nodeSize - 1),
              );
              if (!selection.eq(allCellText)) {
                event.preventDefault();
                view.dispatch(view.state.tr.setSelection(allCellText));
                return true;
              }
            }
            const first = rect.tableStart + rect.map.map[0];
            const last = rect.tableStart + rect.map.map[rect.map.map.length - 1];
            event.preventDefault();
            view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, first, last)));
            return true;
          }
          return false;
        },
      },
      handleKeyDown(view, event) {
        if (event.isComposing || view.composing || event.keyCode === 229) return false;
        const selection = view.state.selection;
        if (
          selection instanceof CellSelection &&
          (event.key === "Home" || event.key === "End") &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          const rect = selectedRect(view.state);
          const position = rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left];
          const cell = view.state.doc.nodeAt(position);
          if (!cell) return false;
          if (event.shiftKey) {
            const content = TextSelection.between(
              view.state.doc.resolve(position + 1),
              view.state.doc.resolve(position + cell.nodeSize - 1),
            );
            view.dispatch(view.state.tr.setSelection(content).scrollIntoView());
            return true;
          }
          let target: number | undefined;
          let end: number | undefined;
          cell.descendants((node, offset) => {
            if (node.isTextblock && target === undefined) {
              target = position + 2 + offset;
              end = target + node.content.size;
            }
          });
          if (target === undefined || end === undefined) return false;
          if (!safeVisualLine(view, view.state.doc.resolve(target))) return false;
          if (event.key === "End") {
            const start = target;
            target = visualLineEnd(view, start, end);
            if (
              view.state.doc.resolve(start).parent.type.name === "codeBlock" &&
              target > start &&
              view.state.doc.textBetween(target - 1, target) === "\n"
            )
              target--;
          }
          if (!graphemeBoundary(view.state.doc.resolve(target))) return false;
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target))).scrollIntoView(),
          );
          return true;
        }
        if (
          view.editable &&
          selection instanceof CellSelection &&
          event.key === "Enter" &&
          event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          const rect = selectedRect(view.state);
          const position = rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left];
          const cell = view.state.doc.nodeAt(position);
          const breakType = view.state.schema.nodes.hardBreak;
          if (!cell || !breakType) return false;
          const replacement = view.state.schema.nodes.paragraph?.create(null, breakType.create());
          if (!replacement || !cell.type.validContent(Fragment.from(replacement))) return false;
          const tr = view.state.tr.replaceWith(position + 1, position + cell.nodeSize - 1, replacement);
          let breakPosition: number | undefined;
          tr.doc.nodeAt(position)?.descendants((node, offset) => {
            if (node.type === breakType && breakPosition === undefined) breakPosition = position + 1 + offset;
          });
          if (breakPosition === undefined) return false;
          tr.setSelection(TextSelection.create(tr.doc, breakPosition + 1));
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        if (
          selection instanceof CellSelection &&
          event.key === "Enter" &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        )
          return true;
        if (
          !(selection instanceof CellSelection) ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
        )
          return false;
        const rect = selectedRect(view.state);
        const row =
          event.key === "ArrowUp"
            ? Math.max(0, rect.top - 1)
            : event.key === "ArrowDown"
              ? Math.min(rect.map.height - 1, rect.bottom)
              : rect.top;
        const column =
          event.key === "ArrowLeft"
            ? Math.max(0, rect.left - 1)
            : event.key === "ArrowRight"
              ? Math.min(rect.map.width - 1, rect.right)
              : rect.left;
        const position = rect.tableStart + rect.map.map[row * rect.map.width + column];
        view.dispatch(
          view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position + 1), 1)).scrollIntoView(),
        );
        return true;
      },
      handleTextInput(view, _from, _to, text) {
        const selection = view.state.selection;
        if (view.editable && selection instanceof TableCodeBoundary && text) {
          const paragraph = view.state.schema.nodes.paragraph?.create(null, view.state.schema.text(text));
          if (!paragraph) return false;
          const tr = view.state.tr.insert(selection.head, paragraph);
          tr.setSelection(TextSelection.create(tr.doc, selection.head + 1 + text.length));
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        const codeWasNavigated = navigatedCode?.doc === view.state.doc && navigatedCode.selection.eq(selection);
        navigatedCode = null;
        if (!view.editable || (!(selection instanceof CellSelection) && !codeWasNavigated) || !text) return false;
        const rect = selectedRect(view.state);
        const position = rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left];
        const cell = view.state.doc.nodeAt(position);
        const block = cell?.firstChild;
        if (!cell || !block) return false;
        const replaceFirstTextblock = (node: ProseMirrorNode): ProseMirrorNode | null => {
          const child = node.isTextblock
            ? view.state.schema.text(text, node.firstChild?.marks)
            : node.firstChild && replaceFirstTextblock(node.firstChild);
          if (!child) return null;
          const fragment = Fragment.from(child);
          return node.type.validContent(fragment) ? node.copy(fragment) : null;
        };
        const replacement =
          block.type.name === "codeBlock"
            ? view.state.schema.nodes.paragraph?.create(null, view.state.schema.text(text))
            : replaceFirstTextblock(block);
        if (!replacement) return false;
        const content = Fragment.from(replacement);
        if (!cell.type.validContent(content)) return false;
        const tr = view.state.tr.replaceWith(position + 1, position + cell.nodeSize - 1, content);
        let textPosition: number | undefined;
        tr.doc.nodeAt(position)?.descendants((node, offset) => {
          if (node.isText && textPosition === undefined) textPosition = position + 1 + offset;
        });
        if (textPosition === undefined) return false;
        tr.setSelection(TextSelection.create(tr.doc, textPosition + text.length));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      handlePaste(view, _event, slice: Slice) {
        if (!view.editable || !isInTable(view.state)) return false;
        const activeSelection = view.state.selection;
        if (activeSelection instanceof CellSelection) {
          const blocks: ProseMirrorNode[] = [];
          slice.content.forEach((node) => blocks.push(node));
          if (blocks.length && blocks.every((node) => node.isTextblock)) {
            const rect = selectedRect(view.state);
            const cells: Array<{ position: number; node: ProseMirrorNode; content: Fragment }> = [];
            activeSelection.forEachCell((node, position) => {
              const row = rect.map.findCell(position - rect.tableStart).top - rect.top;
              cells.push({ position, node, content: Fragment.from(blocks[row % blocks.length]) });
            });
            if (cells.every(({ node, content: fragment }) => node.type.validContent(fragment))) {
              const tr = view.state.tr;
              for (const { node, position, content: fragment } of cells)
                tr.replaceWith(tr.mapping.map(position + 1), tr.mapping.map(position + node.nodeSize - 1), fragment);
              tr.setSelection(activeSelection.getBookmark().map(tr.mapping).resolve(tr.doc));
              if (tr.docChanged) dispatchTableChange(view, tr);
              return true;
            }
          }
          const listPaste =
            blocks.length && blocks.every((node) => ["bulletList", "orderedList"].includes(node.type.name));
          const quote = blocks.length === 1 && blocks[0].type.name === "blockquote" ? blocks[0] : null;
          const quoteBlocks: ProseMirrorNode[] = [];
          quote?.forEach((node) => quoteBlocks.push(node));
          const quotePaste = quoteBlocks.length && quoteBlocks.every((node) => node.isTextblock);
          if (listPaste || quotePaste) {
            const cells: Array<{ position: number; node: ProseMirrorNode }> = [];
            activeSelection.forEachCell((node, position) => cells.push({ position, node }));
            cells.sort((a, b) => a.position - b.position);
            const firstContent = Fragment.fromArray(quotePaste ? quoteBlocks : blocks);
            if (cells.length && cells[0].node.type.validContent(firstContent)) {
              const tr = view.state.tr;
              for (const [index, { node, position }] of cells.entries()) {
                const content =
                  index === 0
                    ? firstContent
                    : quotePaste
                      ? Fragment.from(quoteBlocks[0])
                      : node.type.createAndFill(node.attrs)?.content;
                if (!content || !node.type.validContent(content)) return false;
                tr.replaceWith(tr.mapping.map(position + 1), tr.mapping.map(position + node.nodeSize - 1), content);
              }
              const firstPosition = tr.mapping.map(cells[0].position);
              let start: number | undefined;
              let end: number | undefined;
              tr.doc.nodeAt(firstPosition)?.descendants((node, position) => {
                if (node.isText) {
                  start ??= firstPosition + 1 + position;
                  end = firstPosition + 1 + position + node.nodeSize;
                }
              });
              if (start !== undefined && end !== undefined) tr.setSelection(TextSelection.create(tr.doc, start, end));
              else tr.setSelection(TextSelection.near(tr.doc.resolve(firstPosition + 1)));
              if (tr.docChanged) dispatchTableChange(view, tr);
              return true;
            }
          }
        }
        let { content, openStart, openEnd } = slice;
        while (
          content.childCount === 1 &&
          ((openStart > 0 && openEnd > 0) || content.firstChild?.type.spec.tableRole === "table")
        ) {
          content = content.firstChild!.content;
          openStart--;
          openEnd--;
        }
        const sourceRows: ProseMirrorNode[][] = [];
        let invalidRows = false;
        const role = content.firstChild?.type.spec.tableRole;
        if (role === "row") {
          content.forEach((row) => {
            const cells: ProseMirrorNode[] = [];
            if (row.type.spec.tableRole === "row") row.forEach((cell) => cells.push(cell));
            else invalidRows = true;
            sourceRows.push(cells);
          });
        } else if (role === "cell" || role === "header_cell") {
          const cells: ProseMirrorNode[] = [];
          content.forEach((cell) => cells.push(cell));
          sourceRows.push(cells);
        } else return false;
        const rows: Array<Array<ProseMirrorNode | null>> = Array.from({ length: sourceRows.length }, () => []);
        let invalid = false;
        let sourceMerged = false;
        sourceRows.forEach((row, rowIndex) => {
          let column = 0;
          row.forEach((cell) => {
            while (column in rows[rowIndex]) column++;
            const colspan = Number(cell.attrs.colspan);
            const rowspan = Number(cell.attrs.rowspan);
            if (
              !["cell", "header_cell"].includes(cell.type.spec.tableRole ?? "") ||
              !Number.isSafeInteger(colspan) ||
              colspan < 1 ||
              colspan > 1000 ||
              !Number.isSafeInteger(rowspan) ||
              rowspan < 1 ||
              rowIndex + rowspan > rows.length
            ) {
              invalid = true;
              return;
            }
            sourceMerged ||= colspan > 1 || rowspan > 1;
            for (let down = 0; down < rowspan; down++) {
              for (let across = 0; across < colspan; across++) {
                if (column + across in rows[rowIndex + down]) invalid = true;
                rows[rowIndex + down][column + across] = down === 0 && across === 0 ? cell : null;
              }
            }
            column += colspan;
          });
        });
        const sourceWidth = Math.max(0, ...rows.map((row) => row.length));
        if (invalidRows || invalid || !rows.length || !sourceWidth || sourceWidth > 1000) return false;
        for (const row of rows) for (let column = 0; column < sourceWidth; column++) row[column] ??= null;
        const selection = view.state.selection;
        if (selection instanceof CellSelection) {
          if (sourceRows.length !== 1 || !sourceRows[0].length) return false;
          const rect = selectedRect(view.state);
          const cells: Array<{ position: number; node: ProseMirrorNode }> = [];
          let containsMerge = false;
          let containsStyle = sourceRows[0].some(
            (cell) =>
              cell.attrs.semloEditorCellBackground ||
              cell.attrs.semloEditorCellVerticalAlign ||
              cell.attrs.semloEditorCellBaseFontSize ||
              cell.attrs.semloEditorCellFontVariables ||
              cell.attrs.semloEditorCellLineHeight,
          );
          selection.forEachCell((node, position) => {
            containsMerge ||= node.attrs.colspan > 1 || node.attrs.rowspan > 1;
            containsStyle ||= Boolean(
              node.attrs.semloEditorCellBackground ||
              node.attrs.semloEditorCellVerticalAlign ||
              node.attrs.semloEditorCellBaseFontSize ||
              node.attrs.semloEditorCellFontVariables ||
              node.attrs.semloEditorCellLineHeight,
            );
            cells.push({ position, node });
          });
          if (!containsMerge && !sourceMerged && !containsStyle) return false;
          const tr = view.state.tr;
          let currentRow = -1;
          let sourceIndex = 0;
          for (const { node, position } of cells) {
            const row = rect.map.findCell(position - rect.tableStart).top;
            if (row !== currentRow) {
              currentRow = row;
              sourceIndex = 0;
            }
            const source = sourceRows[0][sourceIndex++ % sourceRows[0].length];
            if (!node.type.validContent(source.content)) return false;
            const background = cellBackground(source.attrs.semloEditorCellBackground);
            const vertical = cellVerticalAlign(source.attrs.semloEditorCellVerticalAlign);
            const baseSize = pastedFontSize(source.attrs.semloEditorCellBaseFontSize ?? "", false);
            const lineHeight = cellLineHeight(source.attrs.semloEditorCellLineHeight);
            const fontSizeChain = cellFontSizeChain(source.attrs.semloEditorCellFontSizeChain);
            const fontVariables = cellFontVariables(source.attrs.semloEditorCellFontVariables);
            const variables = fontVariables
              ? cellFontVariables({ ...cellFontVariables(node.attrs.semloEditorCellFontVariables), ...fontVariables })
              : null;
            if (background || vertical || baseSize || variables || lineHeight)
              tr.setNodeMarkup(tr.mapping.map(position), undefined, {
                ...node.attrs,
                ...(background ? { semloEditorCellBackground: background } : {}),
                ...(vertical ? { semloEditorCellVerticalAlign: vertical } : {}),
                ...(lineHeight ? { semloEditorCellLineHeight: lineHeight } : {}),
                ...(baseSize
                  ? {
                      semloEditorCellBaseFontSize: baseSize,
                      semloEditorCellFontSizeChain: fontSizeChain,
                    }
                  : {}),
                ...(variables ? { semloEditorCellFontVariables: variables } : {}),
              });
            tr.replaceWith(tr.mapping.map(position + 1), tr.mapping.map(position + node.nodeSize - 1), source.content);
          }
          tr.setSelection(selection.getBookmark().map(tr.mapping).resolve(tr.doc));
          if (tr.docChanged) dispatchTableChange(view, tr);
          return true;
        }
        const rect = selectedRect(view.state);
        const tr = view.state.tr;
        let table = rect.table;
        let map = rect.map;
        while (rect.top + rows.length > map.height) {
          addRow(tr, { ...rect, table, map }, map.height);
          const next = tr.doc.nodeAt(rect.tableStart - 1);
          if (!next) return false;
          table = next;
          map = TableMap.get(table);
        }
        let extraColumns = 0;
        for (let row = 0; row < rows.length; row++) {
          let column = rect.left;
          let available = 0;
          while (column < map.width && available < rows[row].length) {
            const bounds = map.findCell(map.map[(rect.top + row) * map.width + column]);
            if (bounds.left !== column) return false;
            available++;
            column = bounds.right;
          }
          extraColumns = Math.max(extraColumns, rows[row].length - available);
        }
        for (let index = 0; index < extraColumns; index++) {
          addColumn(tr, { ...rect, table, map }, map.width);
          const next = tr.doc.nodeAt(rect.tableStart - 1);
          if (!next) return false;
          table = next;
          map = TableMap.get(table);
        }
        const mappingStart = tr.mapping.maps.length;
        const changes: Array<{ position: number; cell: ProseMirrorNode; source: ProseMirrorNode }> = [];
        const seen = new Set<number>();
        let merged = false;
        let containsStyle = false;
        for (let row = 0; row < rows.length; row++) {
          let column = rect.left;
          for (const source of rows[row]) {
            if (column >= map.width) return false;
            const offset = map.map[(rect.top + row) * map.width + column];
            const cell = table.nodeAt(offset);
            if (!cell || (source && !cell.type.validContent(source.content))) return false;
            const bounds = map.findCell(offset);
            if (bounds.left !== column) return false;
            merged ||= bounds.right - bounds.left > 1 || bounds.bottom - bounds.top > 1;
            containsStyle ||= Boolean(
              source?.attrs.semloEditorCellBackground ||
              source?.attrs.semloEditorCellVerticalAlign ||
              source?.attrs.semloEditorCellBaseFontSize ||
              source?.attrs.semloEditorCellFontVariables ||
              source?.attrs.semloEditorCellLineHeight ||
              cell.attrs.semloEditorCellBackground ||
              cell.attrs.semloEditorCellVerticalAlign ||
              cell.attrs.semloEditorCellBaseFontSize ||
              cell.attrs.semloEditorCellFontVariables ||
              cell.attrs.semloEditorCellLineHeight,
            );
            if (source && !seen.has(offset)) {
              seen.add(offset);
              changes.push({ position: rect.tableStart + offset, cell, source });
            }
            column = bounds.right;
          }
        }
        if ((!merged && !sourceMerged && !containsStyle) || !changes.length) return false;
        for (const change of changes) {
          const background = cellBackground(change.source.attrs.semloEditorCellBackground);
          const vertical = cellVerticalAlign(change.source.attrs.semloEditorCellVerticalAlign);
          const baseSize = pastedFontSize(change.source.attrs.semloEditorCellBaseFontSize ?? "", false);
          const lineHeight = cellLineHeight(change.source.attrs.semloEditorCellLineHeight);
          const fontSizeChain = cellFontSizeChain(change.source.attrs.semloEditorCellFontSizeChain);
          const fontVariables = cellFontVariables(change.source.attrs.semloEditorCellFontVariables);
          const variables = fontVariables
            ? cellFontVariables({
                ...cellFontVariables(change.cell.attrs.semloEditorCellFontVariables),
                ...fontVariables,
              })
            : null;
          if (background || vertical || baseSize || variables || lineHeight)
            tr.setNodeMarkup(tr.mapping.slice(mappingStart).map(change.position), undefined, {
              ...change.cell.attrs,
              ...(background ? { semloEditorCellBackground: background } : {}),
              ...(vertical ? { semloEditorCellVerticalAlign: vertical } : {}),
              ...(lineHeight ? { semloEditorCellLineHeight: lineHeight } : {}),
              ...(baseSize
                ? {
                    semloEditorCellBaseFontSize: baseSize,
                    semloEditorCellFontSizeChain: fontSizeChain,
                  }
                : {}),
              ...(variables ? { semloEditorCellFontVariables: variables } : {}),
            });
          const from = tr.mapping.slice(mappingStart).map(change.position + 1);
          const to = tr.mapping.slice(mappingStart).map(change.position + change.cell.nodeSize - 1);
          tr.replaceWith(from, to, change.source.content);
        }
        const firstPosition = tr.mapping.slice(mappingStart).map(changes[0].position);
        const firstParagraph = tr.doc.nodeAt(firstPosition)?.firstChild;
        if (
          firstParagraph?.isTextblock &&
          firstParagraph.childCount === 1 &&
          firstParagraph.firstChild?.isText &&
          firstParagraph.content.size > 0
        )
          tr.setSelection(
            TextSelection.create(tr.doc, firstPosition + 2, firstPosition + 2 + firstParagraph.content.size),
          );
        if (tr.docChanged) dispatchTableChange(view, tr);
        return true;
      },
    },
  });
}
