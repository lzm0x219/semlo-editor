export const observedMixedRoman = [
  [1, "ⅰ"],
  [2, "ⅱ"],
  [3, "ⅲ"],
  [4, "ⅳ"],
  [5, "ⅴ"],
  [6, "ⅵ"],
  [7, "ⅶ"],
  [8, "ⅷ"],
  [9, "ⅸ"],
  [10, "X"],
  [11, "Xⅰ"],
  [12, "Xⅱ"],
  [13, "Xⅲ"],
  [14, "Xⅳ"],
  [19, "Xⅸ"],
  [20, "XX"],
  [21, "XXⅰ"],
  [24, "XXⅳ"],
  [39, "XXXⅸ"],
  [40, "XL"],
  [44, "XLⅳ"],
  [49, "XLⅸ"],
  [50, "L"],
  [69, "LXⅸ"],
  [70, "LXX"],
  [79, "LXXⅸ"],
  [80, "LXXX"],
  [89, "LXXXⅸ"],
  [90, "XC"],
  [94, "XCⅳ"],
  [99, "XCⅸ"],
  [100, "C"],
] as const;

export function mixedRomanContent(count = 100, start = 1, type: string | null = null, indent = 2) {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start, type },
        content: Array.from({ length: count }, (_, index) => ({
          type: "listItem",
          attrs: { semloEditorListIndent: indent },
          content: [{ type: "paragraph", content: [{ type: "text", text: `项${start + index}` }] }],
        })),
      },
    ],
  };
}

export function mixedRomanSequenceContent(count = 13, start = 1, type: string | null = null) {
  const doc = mixedRomanContent(count, start, type);
  const list = doc.content[0];
  return {
    ...doc,
    content: [
      {
        ...list,
        attrs: {
          ...list.attrs,
          semloEditorListSequences: { version: 1, sequences: [{ id: "R", start, origin: "initial" }] },
        },
        content: list.content.map((item) => ({
          ...item,
          attrs: { ...item.attrs, semloEditorListSequence: "R" },
        })),
      },
    ],
  };
}
