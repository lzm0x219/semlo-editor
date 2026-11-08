import type { JSONContent } from "@tiptap/core";

export function crossLevelPasteContent(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: {
          semloEditorOrderedStyle: "mixed",
          semloEditorListSequences: {
            version: 1,
            sequences: [
              { id: "R", start: 1, origin: "initial" },
              { id: "C", start: 1, origin: "initial" },
            ],
          },
        },
        content: ["父甲", "子甲", "子乙", "父乙", "父丙"].map((text, index) => ({
          type: "listItem",
          attrs: {
            semloEditorListIndent: index === 1 || index === 2 ? 1 : 0,
            semloEditorListSequence: index === 1 || index === 2 ? "C" : "R",
          },
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      },
      { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
    ],
  };
}
