import type { JSONContent } from "@tiptap/core";

export function nestedLegacyPasteContent(): JSONContent {
  const item = (text: string): JSONContent => ({
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        content: [
          {
            ...item("父"),
            content: [
              { type: "paragraph", content: [{ type: "text", text: "父" }] },
              { type: "orderedList", content: ["甲开头", "乙中段", "丙结尾", "丁后续"].map(item) },
            ],
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
    ],
  };
}
