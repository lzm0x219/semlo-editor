import type { JSONContent } from "@tiptap/core";

/** 旧格式样本只含 indent/restart，首次实际拖动才物化新序列。 */
export function restartedDragDocument(five = false, style: "mixed" | "decimal" = "mixed"): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "列表之前" }] },
      {
        type: "orderedList",
        attrs: { semloEditorOrderedStyle: style },
        content: ["父", "甲", "乙", "丙", ...(five ? ["丁", "戊"] : [])].map((text, index) => ({
          type: "listItem",
          attrs: {
            semloEditorListIndent: index === 0 ? 0 : 1,
            semloEditorListRestart: index === 2 || (five && index === 4),
          },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text, ...(text === "乙" ? { marks: [{ type: "bold" }] } : {}) }],
            },
          ],
        })),
      },
      { type: "paragraph", content: [{ type: "text", text: "列表之后" }] },
    ],
  };
}
