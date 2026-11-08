import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { formatChineseNumber } from "../../shared/chinese-number";
import { headingNumberingClipboardPlugin } from "./numbering-clipboard";

export type HeadingNumberingStyle = "mixed" | "chinese" | "decimal";
type HeadingNumberingState = { markers: ReadonlyMap<number, string>; decorations: DecorationSet };
const headingNumberingKey = new PluginKey<HeadingNumberingState>("semloEditorHeadingNumbering");

export function headingNumberingStyle(value: unknown): HeadingNumberingStyle | null {
  return value === "mixed" || value === "chinese" || value === "decimal" ? value : null;
}

/** The nearest prior same-level heading supplies numbering within one container. */
export function inheritedHeadingNumbering(
  doc: ProseMirrorNode,
  pos: number,
  level: number,
): HeadingNumberingStyle | null {
  const resolved = doc.resolve(pos);
  const parent = resolved.parent;
  for (let index = resolved.index() - 1; index >= 0; index -= 1) {
    const sibling = parent.child(index);
    if (sibling.type.name !== "heading") continue;
    const siblingLevel = Number(sibling.attrs.level);
    if (siblingLevel < level) return null;
    if (siblingLevel === level) return headingNumberingStyle(sibling.attrs.semloEditorHeadingNumbering);
  }
  return null;
}

type NumberedAncestor = { level: number; number: number };

function alphabetic(value: number): string {
  let result = "";
  for (let current = value; current > 0; current = Math.floor((current - 1) / 26))
    result = String.fromCharCode(97 + ((current - 1) % 26)) + result;
  return result;
}

function roman(value: number): string {
  const digits: Array<[number, string]> = [
    [1000, "ⅿ"],
    [900, "ⅽⅿ"],
    [500, "ⅾ"],
    [400, "ⅽⅾ"],
    [100, "ⅽ"],
    [90, "ⅹⅽ"],
    [50, "ⅼ"],
    [40, "ⅹⅼ"],
    [12, "ⅻ"],
    [11, "ⅺ"],
    [10, "ⅹ"],
    [9, "ⅸ"],
    [8, "ⅷ"],
    [7, "ⅶ"],
    [6, "ⅵ"],
    [5, "ⅴ"],
    [4, "ⅳ"],
    [3, "ⅲ"],
    [2, "ⅱ"],
    [1, "ⅰ"],
  ];
  let result = "";
  for (const [amount, character] of digits) {
    const count = Math.floor(value / amount);
    if (count) result += character.repeat(count);
    value %= amount;
  }
  return result;
}

function mixedMarker(number: number, depth: number): string {
  if (depth % 3 === 1) return `${alphabetic(number)}.`;
  if (depth % 3 === 2) return `${roman(number)}.`;
  return `${number}.`;
}

function numberMarker(
  style: HeadingNumberingStyle,
  ancestors: readonly NumberedAncestor[],
  number: number,
  depth: number,
): string {
  if (style === "decimal") return `${[...ancestors.map((item) => item.number), number].join(".")}.`;
  if (style === "chinese") {
    if (depth % 3 === 0) return `${formatChineseNumber(number)}、`;
    if (depth % 3 === 1) return `(${formatChineseNumber(number)})`;
    return `${number}.`;
  }
  return mixedMarker(number, depth);
}

type HeadingNumber = { pos: number; style: HeadingNumberingStyle; marker: string };

function headingNumbers(doc: ProseMirrorNode): HeadingNumber[] {
  const numbers: HeadingNumber[] = [];
  const levels = new Set<number>();
  doc.descendants((node) => {
    if (node.type.name !== "heading" || !headingNumberingStyle(node.attrs.semloEditorHeadingNumbering)) return;
    const level = Number(node.attrs.level);
    if (Number.isInteger(level) && level >= 1 && level <= 6) levels.add(level);
  });
  const order = [...levels].sort((left, right) => left - right);
  const scan = (parent: ProseMirrorNode, parentStart: number) => {
    const stack: NumberedAncestor[] = [];
    parent.forEach((node, offset) => {
      const pos = parentStart + offset;
      if (node.type.name !== "heading") {
        if (!node.isTextblock && node.childCount) scan(node, pos + 1);
        return;
      }
      const level = Number(node.attrs.level);
      if (!Number.isInteger(level) || level < 1 || level > 6) return;
      const style = headingNumberingStyle(node.attrs.semloEditorHeadingNumbering);
      if (!style) {
        while (stack.length && stack[stack.length - 1].level > level) stack.pop();
        return;
      }
      let previous: NumberedAncestor | undefined;
      while (stack.length && stack[stack.length - 1].level >= level) {
        const entry = stack.pop()!;
        if (entry.level === level) previous = entry;
      }
      const current = { level, number: (previous?.number ?? 0) + 1 };
      const marker = numberMarker(style, stack, current.number, order.indexOf(level));
      stack.push(current);
      numbers.push({ pos, style, marker });
    });
  };
  scan(doc, 0);
  return numbers;
}

function headingNumberDecorations(doc: ProseMirrorNode, numbers: readonly HeadingNumber[]): DecorationSet {
  return DecorationSet.create(
    doc,
    numbers.map(({ pos, style, marker }) =>
      Decoration.widget(
        pos + 1,
        (view) => {
          const span = view.dom.ownerDocument.createElement("span");
          span.className = "semlo-editor-heading-number";
          span.contentEditable = "false";
          span.setAttribute("role", "button");
          span.setAttribute("aria-label", marker);
          span.setAttribute("aria-description", "设置编号");
          span.setAttribute("aria-disabled", String(!view.editable));
          span.tabIndex = view.editable ? 0 : -1;
          span.title = "设置编号";
          span.dataset.semloEditorHeadingNumberPos = String(pos);
          span.dataset.semloEditorHeadingNumberStyle = style;
          span.textContent = `${marker} `;
          return span;
        },
        { side: -1, key: `semlo-editor-heading-number-${pos}-${style}-${marker}` },
      ),
    ),
  );
}

function numberMarkers(numbers: readonly HeadingNumber[]): ReadonlyMap<number, string> {
  return new Map(numbers.map(({ pos, marker }) => [pos, marker]));
}

function numberingState(doc: ProseMirrorNode): HeadingNumberingState {
  const numbers = headingNumbers(doc);
  return { markers: numberMarkers(numbers), decorations: headingNumberDecorations(doc, numbers) };
}

/** Read the same derived markers used by heading decorations, without changing document content. */
export function headingNumberMarkers(state: EditorState): ReadonlyMap<number, string> {
  return headingNumberingKey.getState(state)?.markers ?? numberMarkers(headingNumbers(state.doc));
}

/** Add visible, generated numbering to standalone HTML without changing the document text. */
export function serializeHeadingNumbersHTML(html: string, owner: Document, doc: ProseMirrorNode): string {
  const numbers = headingNumbers(doc);
  if (!numbers.length) return html;
  const template = owner.createElement("template");
  template.innerHTML = html;
  const headings = template.content.querySelectorAll(
    "h1[data-semlo-editor-heading-numbering],h2[data-semlo-editor-heading-numbering],h3[data-semlo-editor-heading-numbering],h4[data-semlo-editor-heading-numbering],h5[data-semlo-editor-heading-numbering],h6[data-semlo-editor-heading-numbering]",
  );
  if (headings.length !== numbers.length) return html;
  for (let index = 0; index < numbers.length; index += 1) {
    if (headings[index].getAttribute("data-semlo-editor-heading-numbering") !== numbers[index].style) return html;
  }
  numbers.forEach(({ marker }, index) => {
    const span = owner.createElement("span");
    span.setAttribute("data-semlo-editor-heading-marker", "");
    span.textContent = `${marker} `;
    headings[index].prepend(span);
  });
  return template.innerHTML;
}

/** Preserve numbering as heading metadata, while rendering markers as view decorations. */
export const HeadingNumbering = Extension.create({
  name: "semloEditorHeadingNumbering",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          semloEditorHeadingNumbering: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              headingNumberingStyle(element.getAttribute("data-semlo-editor-heading-numbering")),
            renderHTML: (attrs: Record<string, unknown>) => {
              const style = headingNumberingStyle(attrs.semloEditorHeadingNumbering);
              return style ? { "data-semlo-editor-heading-numbering": style } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: headingNumberingKey,
        state: {
          init: (_, state) => numberingState(state.doc),
          apply: (transaction, previous) => (transaction.docChanged ? numberingState(transaction.doc) : previous),
        },
        props: { decorations: (state) => headingNumberingKey.getState(state)?.decorations ?? null },
      }),
      headingNumberingClipboardPlugin(headingNumbers, this.editor),
    ];
  },
});
